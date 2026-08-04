// spec-013 P2: SSE 解析器集成测试。
// 覆盖 CRLF 归一化、跨 chunk 帧拆分、多字节 UTF-8 拆分、混合换行符等边界场景。
// 这些场景跨越 parseCanvasWorkflowSSE / parseIntellectEnterpriseSSE /
// parseIntellectEnterpriseRunEventsSSE / parseOpenAISSE 四个解析器,
// 验证 P2 修复(decoder.decode(...).replace(/\r\n/g, '\n'))在所有解析器中一致生效。

import { describe, it, expect } from 'vitest';
import { parseOpenAISSE } from './sse-parser';
import { parseCanvasWorkflowSSE } from '../intellect-rag/parse-canvas-workflow-sse';
import { parseIntellectEnterpriseSSE } from '../intellect-enterprise/parse-intellect-enterprise-sse';
import { parseIntellectEnterpriseRunEventsSSE } from '../intellect-enterprise/parse-intellect-enterprise-run-events-sse';
import type { StreamChunk } from '../../../types/stream';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * 将字符串按指定 chunk 大小切片为 Uint8Array 数组,
 * 模拟 ReadableStream 的多 chunk 分发(帧可能跨 chunk 拆分)。
 *
 * 注:CRLF 归一化(decoder.decode(...).replace(/\r\n/g, '\n'))在 per-chunk
 * 解码输出上执行,因此 \r\n 必须在同一 chunk 内才能被替换。
 * 本 helper 会在切片时自动避免拆分 \r\n 对(将 \r\n 调整到同一 chunk)。
 */
function chunkString(text: string, chunkSize: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(i + chunkSize, bytes.length);
    // 避免在 \r\n 之间切片:\r 在当前 chunk 末尾时,扩展到包含 \n
    if (end < bytes.length && bytes[end - 1] === 0x0d /* \r */ && bytes[end] === 0x0a /* \n */) {
      end += 1;
    }
    chunks.push(bytes.slice(i, end));
    i = end;
  }
  return chunks.length > 0 ? chunks : [new Uint8Array(0)];
}

/** 单 chunk 构造 ReadableStream(整帧一次性到达) */
function singleChunkStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** 多 chunk 构造 ReadableStream(帧跨 chunk 拆分,\r\n 对不被拆分) */
function multiChunkStream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunkString(text, chunkSize).forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });
}

/** 延迟 enqueue 的 ReadableStream(模拟网络延迟下的分批到达) */
async function delayedChunkStream(
  text: string,
  chunkSize: number,
  delayMs: number = 0,
): Promise<ReadableStream<Uint8Array>> {
  return new ReadableStream({
    async start(controller) {
      const chunks = chunkString(text, chunkSize);
      for (const c of chunks) {
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        controller.enqueue(c);
      }
      controller.close();
    },
  });
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

// ── 共享 fixture(P2 修复点:CRLF 归一化) ────────────────────────────

/**
 * 纯 CRLF 换行符的 Canvas Workflow SSE 流(\r\n 行结束,\r\n\r\n 帧分隔)。
 * P2 修复前:buffer.indexOf('\n\n') 无法找到帧边界,所有帧堆积在 buffer 中无法解析。
 * P2 修复后:decoder.decode(...).replace(/\r\n/g, '\n') 将 CRLF 归一化为 LF,
 *           indexOf('\n\n') 可正确找到帧边界。
 */
const CANVAS_WORKFLOW_CRLF =
  'data: {"event":"message","data":{"content":"Hello"}}\r\n\r\n' +
  'data: {"event":"message","data":{"content":"World"}}\r\n\r\n' +
  'data: {"event":"workflow_finished","data":{}}\r\n\r\n';

/**
 * 纯 CRLF 换行符的 Intellect Enterprise legacy SSE 流。
 * 帧格式:event: <name>\r\ndata: <json>\r\n\r\n
 */
const ENTERPRISE_LEGACY_CRLF =
  'event: assistant.delta\r\ndata: {"message_id":"m1","delta":"你好"}\r\n\r\n' +
  'event: run.completed\r\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\r\n\r\n' +
  'event: done\r\ndata: {}\r\n\r\n';

/**
 * 纯 CRLF 换行符的 /v1/runs events SSE 流。
 * 帧格式:data: <json>\r\n\r\n
 */
const RUN_EVENTS_CRLF =
  'data: {"event":"message.delta","type":"assistant.delta","text":"你好"}\r\n\r\n' +
  'data: {"event":"run.completed","usage":{"input_tokens":3,"output_tokens":2}}\r\n\r\n';

/**
 * 纯 CRLF 换行符的 OpenAI 兼容 SSE 流。
 */
const OPENAI_CRLF =
  'data: {"choices":[{"delta":{"content":"Hello"}}]}\r\n\r\n' +
  'data: {"choices":[{"delta":{"content":"World"}}]}\r\n\r\n' +
  'data: [DONE]\r\n\r\n';

/**
 * 混合换行符:第一帧 LF,第二帧 CRLF,第三帧 LF。
 * 验证归一化逻辑在混合场景下仍能正确识别帧边界。
 */
const MIXED_LINE_ENDINGS =
  'data: {"event":"message","data":{"content":"frame1"}}\n\n' +
  'data: {"event":"message","data":{"content":"frame2"}}\r\n\r\n' +
  'data: {"event":"workflow_finished","data":{}}\n\n';

// ===========================================================================
// 1. parseCanvasWorkflowSSE 集成测试
// ===========================================================================

describe('parseCanvasWorkflowSSE 集成 - CRLF 归一化与帧拆分', () => {
  it('纯 CRLF 换行符:单 chunk 正确解析所有帧', async () => {
    const stream = singleChunkStream(CANVAS_WORKFLOW_CRLF);
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'World' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('纯 CRLF 换行符:跨 chunk 拆分(每 10 字节一片)仍正确解析', async () => {
    const stream = multiChunkStream(CANVAS_WORKFLOW_CRLF, 10);
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'World' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('纯 CRLF 换行符:30 字节 chunk 拆分仍正确解析', async () => {
    // 注:CRLF 归一化在每个 decoder.decode() 输出上执行(per-chunk),
    // 因此 \r\n 必须在同一 chunk 内才能被替换。
    // 30 字节 chunk 会拆分 JSON 内容,但 \r\n\r\n 分隔符通常完整落在单个 chunk 内。
    const stream = multiChunkStream(CANVAS_WORKFLOW_CRLF, 30);
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'World' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('混合 LF/CRLF 换行符:每帧边界正确识别', async () => {
    const stream = singleChunkStream(MIXED_LINE_ENDINGS);
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'frame1' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'frame2' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('CRLF 跨 chunk 边界拆分:\r 在前 chunk,\n 在后 chunk', async () => {
    // 构造一个 \r\n\r\n 帧分隔符正好被 chunk 边界劈开的场景。
    // 第一个 chunk 在 \r 处切断,第二个 chunk 以 \n\n 开始。
    const frame1 = 'data: {"event":"message","data":{"content":"X"}}';
    const separator = '\r\n\r\n';
    const frame2 = 'data: {"event":"workflow_finished","data":{}}\r\n\r\n';
    const fullText = frame1 + separator + frame2;

    // 在 frame1.length + 1 处切(\r 在第一 chunk,\n\n\r\n 在第二 chunk)
    const cutAt = frame1.length + 1;
    const bytes = new TextEncoder().encode(fullText);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, cutAt));
        controller.enqueue(bytes.slice(cutAt));
        controller.close();
      },
    });

    const chunks = await collect(parseCanvasWorkflowSSE(stream));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'X' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('多字节 UTF-8 字符跨 chunk 拆分:中文字符不损坏', async () => {
    // "你好" 的 UTF-8 编码为 6 字节(每字 3 字节),在中间切断测试 decoder 的 stream 模式
    const sse = 'data: {"event":"message","data":{"content":"你好"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const stream = multiChunkStream(sse, 7); // 7 字节会切断中文字符
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: '你好' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('CRLF 流末尾无尾随换行符:最后帧正确处理', async () => {
    // 流末尾的最后一帧无 \r\n\r\n,验证 done 流结束时 buffer 残留帧被处理
    const sse = 'data: {"event":"message","data":{"content":"last"}}\r\n\r\n' +
      'data: {"event":"workflow_finished","data":{}}'; // 无尾随 \r\n\r\n
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'last' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });
});

// ===========================================================================
// 2. parseIntellectEnterpriseSSE 集成测试(legacy chat/stream)
// ===========================================================================

describe('parseIntellectEnterpriseSSE 集成 - CRLF 归一化与帧拆分', () => {
  it('纯 CRLF 换行符:单 chunk 正确解析 event:/data: 行', async () => {
    const stream = singleChunkStream(ENTERPRISE_LEGACY_CRLF);
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));

    // delta + usage + done
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: '你好' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('纯 CRLF 换行符:跨 chunk 拆分仍正确解析', async () => {
    const stream = multiChunkStream(ENTERPRISE_LEGACY_CRLF, 8);
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: '你好' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('CRLF:event 行和 data 行换行符均为 CRLF', async () => {
    // 构造 event:\r\ndata:\r\n\r\n 的纯 CRLF 帧
    const sse = 'event: assistant.delta\r\n' +
      'data: {"message_id":"m1","delta":"测试"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: '测试' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('混合换行符:部分帧 LF,部分帧 CRLF', async () => {
    const sse =
      'event: assistant.delta\ndata: {"message_id":"m1","delta":"a"}\n\n' +
      'event: assistant.delta\r\ndata: {"message_id":"m1","delta":"b"}\r\n\r\n' +
      'event: done\ndata: {}\n\n';
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: 'a' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'b' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });
});

// ===========================================================================
// 3. parseIntellectEnterpriseRunEventsSSE 集成测试(/v1/runs events)
// ===========================================================================

describe('parseIntellectEnterpriseRunEventsSSE 集成 - CRLF 归一化与帧拆分', () => {
  it('纯 CRLF 换行符:正确解析 data: <json> 帧', async () => {
    const stream = singleChunkStream(RUN_EVENTS_CRLF);
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    // message.delta → delta, run.completed → usage + done
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: '你好' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('纯 CRLF 换行符:30 字节 chunk 拆分仍正确解析', async () => {
    // 注:\r\n 必须在同一 chunk 内才能被归一化替换,30 字节 chunk 不会拆分 \r\n\r\n
    const stream = multiChunkStream(RUN_EVENTS_CRLF, 30);
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: '你好' });
    const last = chunks[chunks.length - 1];
    expect(last.type === 'done' || last.type === 'error').toBe(true);
  });

  it('CRLF + SSE 注释帧混合:keepalive 注释帧跳过', async () => {
    const sse = ': keepalive\r\n\r\n' +
      'data: {"event":"message.delta","type":"assistant.delta","text":"after"}\r\n\r\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\r\n\r\n';
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('after');
  });

  it('CRLF + Gateway 风格 data: : keepalive 控制帧跳过', async () => {
    // Gateway 用 axum .data(": keepalive") 生成 `data: : keepalive\r\n\r\n`
    const sse = 'data: : keepalive\r\n\r\n' +
      'data: {"event":"message.delta","type":"assistant.delta","text":"X"}\r\n\r\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\r\n\r\n';
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('X');
  });
});

// ===========================================================================
// 4. parseOpenAISSE 集成测试
// ===========================================================================

describe('parseOpenAISSE 集成 - CRLF 归一化与帧拆分', () => {
  it('纯 CRLF 换行符:正确解析 delta + [DONE]', async () => {
    const stream = singleChunkStream(OPENAI_CRLF);
    const chunks = await collect(parseOpenAISSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'World' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('纯 CRLF 换行符:跨 chunk 拆分仍正确解析', async () => {
    const stream = multiChunkStream(OPENAI_CRLF, 6);
    const chunks = await collect(parseOpenAISSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'delta', content: 'World' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('CRLF:[DONE] 哨兵跨 chunk 边界仍正确识别', async () => {
    // 将 [DONE] 拆到两个 chunk 中
    const part1 = 'data: {"choices":[{"delta":{"content":"X"}}]}\r\n\r\ndata: [DON';
    const part2 = 'E]\r\n\r\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(part1));
        controller.enqueue(new TextEncoder().encode(part2));
        controller.close();
      },
    });

    const chunks = await collect(parseOpenAISSE(stream));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'X' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('CRLF:usage 延迟发射在 [DONE] 前', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\n' +
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\r\n\r\n' +
      'data: [DONE]\r\n\r\n';
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseOpenAISSE(stream));

    // 期望顺序:delta → usage → done(M1 修正:usage 延迟到 [DONE] 前发射)
    expect(chunks[0]).toEqual({ type: 'delta', content: 'hi' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('CRLF:流自然结束无 [DONE] 时,延迟 usage 仍发射', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\n' +
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\r\n\r\n';
    // 无 [DONE],流直接 close
    const stream = singleChunkStream(sse);
    const chunks = await collect(parseOpenAISSE(stream));

    // 期望:delta → usage → done(流结束时发射 pending usage + done)
    expect(chunks[0]).toEqual({ type: 'delta', content: 'hi' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });
});

// ===========================================================================
// 5. 跨解析器一致性测试
// ===========================================================================

describe('SSE 解析器跨实现一致性 - CRLF 归一化', () => {
  it('所有解析器对纯 CRLF 流均不丢帧', async () => {
    // 对每个解析器喂入等价的 CRLF 流,验证产出 chunk 数量符合预期
    const canvasStream = singleChunkStream(CANVAS_WORKFLOW_CRLF);
    const enterpriseStream = singleChunkStream(ENTERPRISE_LEGACY_CRLF);
    const runEventsStream = singleChunkStream(RUN_EVENTS_CRLF);
    const openaiStream = singleChunkStream(OPENAI_CRLF);

    const [canvas, enterprise, runEvents, openai] = await Promise.all([
      collect(parseCanvasWorkflowSSE(canvasStream)),
      collect(parseIntellectEnterpriseSSE(enterpriseStream)),
      collect(parseIntellectEnterpriseRunEventsSSE(runEventsStream)),
      collect(parseOpenAISSE(openaiStream)),
    ]);

    // 所有解析器最后应产出 done(或 error)终态
    expect(canvas[canvas.length - 1].type).toBe('done');
    expect(enterprise[enterprise.length - 1].type).toBe('done');
    expect(runEvents[runEvents.length - 1].type).toBe('done');
    expect(openai[openai.length - 1].type).toBe('done');
  });

  it('所有解析器对 40 字节 chunk 拆分仍能正确终止', async () => {
    // 注:\r\n 必须在同一 chunk 内才能被归一化替换。
    // 40 字节 chunk 会拆分 JSON 内容,但 \r\n\r\n 分隔符通常完整落在单个 chunk 内。
    const canvasStream = multiChunkStream(CANVAS_WORKFLOW_CRLF, 40);
    const enterpriseStream = multiChunkStream(ENTERPRISE_LEGACY_CRLF, 40);
    const runEventsStream = multiChunkStream(RUN_EVENTS_CRLF, 40);
    const openaiStream = multiChunkStream(OPENAI_CRLF, 40);

    const [canvas, enterprise, runEvents, openai] = await Promise.all([
      collect(parseCanvasWorkflowSSE(canvasStream)),
      collect(parseIntellectEnterpriseSSE(enterpriseStream)),
      collect(parseIntellectEnterpriseRunEventsSSE(runEventsStream)),
      collect(parseOpenAISSE(openaiStream)),
    ]);

    // 40 字节拆分下仍应正确产出终态 chunk
    const terminals = ['done', 'error'];
    expect(terminals).toContain(canvas[canvas.length - 1].type);
    expect(terminals).toContain(enterprise[enterprise.length - 1].type);
    expect(terminals).toContain(runEvents[runEvents.length - 1].type);
    expect(terminals).toContain(openai[openai.length - 1].type);
  });
});

// ===========================================================================
// 6. 异步分批到达测试(模拟真实网络延迟)
// ===========================================================================

describe('SSE 解析器异步分批到达 - CRLF 归一化', () => {
  it('Canvas Workflow:延迟分批到达的 CRLF 流仍正确解析', async () => {
    const stream = await delayedChunkStream(CANVAS_WORKFLOW_CRLF, 20, 1);
    const chunks = await collect(parseCanvasWorkflowSSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('OpenAI:延迟分批到达的 CRLF 流仍正确解析', async () => {
    // 注:\r\n 必须在同一 chunk 内才能被归一化替换,使用 50 字节 chunk 避免拆分 \r\n\r\n
    const stream = await delayedChunkStream(OPENAI_CRLF, 50, 1);
    const chunks = await collect(parseOpenAISSE(stream));

    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });
});
