// spec-013 P2: SSE 解析器事件映射与容错边界集成测试。
// 补充 sse-parser.integration.test.ts(聚焦 CRLF 归一化)未覆盖的场景:
// - 事件映射:tool calls / reasoning / approval / clarify / message_end reference
// - 容错路径:非法 JSON、空 data、未知事件、流提前断开、空流
// - CRLF 混合:event 行与 data 行使用不同换行符
// - 多行 data: 合并
// - SSE 注释帧 / keepalive 控制帧
// - OpenAI: finish_reason=tool_calls、reasoning_content、延迟 usage 边界
//
// 这些场景验证 P2 修复(decoder.decode(...).replace(/\r\n/g, '\n'))在事件映射
// 与容错路径上的一致性,确保 CRLF 归一化不破坏事件解析逻辑。

import { describe, it, expect, vi } from 'vitest';
import { parseOpenAISSE } from './sse-parser';
import { parseCanvasWorkflowSSE } from '../intellect-rag/parse-canvas-workflow-sse';
import { parseIntellectEnterpriseSSE } from '../intellect-enterprise/parse-intellect-enterprise-sse';
import { parseIntellectEnterpriseRunEventsSSE } from '../intellect-enterprise/parse-intellect-enterprise-run-events-sse';
import type { StreamChunk } from '../../../types/stream';

// ── Helpers ────────────────────────────────────────────────────────────

function singleChunkStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

/** 静默 console.warn,避免容错路径的预期警告污染测试输出 */
function silenceWarn<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi
    .spyOn(console, 'warn')
    .mockImplementation(() => undefined);
  return fn().finally(() => spy.mockRestore());
}

// ===========================================================================
// 1. parseCanvasWorkflowSSE 事件映射边界
// ===========================================================================

describe('parseCanvasWorkflowSSE 边界 - 事件映射', () => {
  it('message + start_to_think → reasoning chunk', async () => {
    const sse =
      'data: {"event":"message","data":{"content":"思考中","start_to_think":true}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'reasoning', content: '思考中' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('message + end_to_think → reasoning chunk', async () => {
    const sse =
      'data: {"event":"message","data":{"content":"思考结束","end_to_think":true}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'reasoning', content: '思考结束' });
  });

  it('message_end + reference → delta with metadata', async () => {
    const sse =
      'data: {"event":"message_end","data":{"content":"","reference":{"chunks":[{"id":"c1"}],"doc_aggs":[]}}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('delta');
    expect((chunks[0] as { content: string }).content).toBe('');
    expect((chunks[0] as { metadata?: unknown }).metadata).toEqual({
      reference: { chunks: [{ id: 'c1' }], doc_aggs: [] },
    });
  });

  it('workflow_started / node_started / node_finished → 不产出 chunk', async () => {
    const sse =
      'data: {"event":"workflow_started","data":{}}\n\n' +
      'data: {"event":"node_started","data":{"node_id":"n1"}}\n\n' +
      'data: {"event":"node_finished","data":{"node_id":"n1"}}\n\n' +
      'data: {"event":"message","data":{"content":"hi"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    // 只有 message delta + done
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'hi' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('未知事件类型 → 静默跳过,不中断流', async () => {
    const sse =
      'data: {"event":"unknown_future_event","data":{"foo":"bar"}}\n\n' +
      'data: {"event":"message","data":{"content":"after_unknown"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'after_unknown' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('非法 JSON payload → error chunk', async () => {
    const sse =
      'data: {invalid json}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('error');
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('多行 data: 合并为单个 JSON payload', async () => {
    // 构造一个跨多行的 JSON(SSE 规范允许多行 data: 合并)
    const sse =
      'data: {"event":"message","data":{"content":\n\n' +
      'data: "multi_line"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    // 注:第一帧的 \n\n 会作为帧分隔符,因此多行 data: 实际被拆为两帧。
    // 这里验证单帧内多行 data: 行的合并(用 \n 分隔而非 \n\n)。
    const singleFrameMultiLine =
      'data: {"event":"message","data":{"content":"a"}}\n' +
      'data: "extra"}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    // 上述构造:第一帧含两行 data:,合并为 {"event":"message","data":{"content":"a"}}\n"extra"
    // 这不是合法 JSON,会触发 error。验证合并行为本身。
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(singleFrameMultiLine)));
    // 第一帧合并后非法 JSON → error;第二帧 → done
    expect(chunks[0].type).toBe('error');
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('空 data: 行 → 跳过,不产出 chunk', async () => {
    const sse =
      'data: \n\n' +
      'data: {"event":"message","data":{"content":"after_empty"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'after_empty' });
  });

  it('纯 SSE 注释帧(: keepalive)→ 跳过', async () => {
    const sse =
      ': keepalive\n\n' +
      'data: {"event":"message","data":{"content":"after_comment"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\n\n';
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    // Canvas Workflow 解析器不显式处理注释帧,但 dataLines 为空 → 返回 []
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'after_comment' });
  });

  it('CRLF 混合:event 行 CRLF,data 行 LF,帧分隔 CRLF', async () => {
    // 构造 event 风格的 Canvas 流(CRLF 在 data 行之间)
    // Canvas Workflow 只有 data: 行,这里测试 data: 行之间用 CRLF
    const sse =
      'data: {"event":"message","data":{"content":"a"}}\r\n' +
      'data: {"event":"message","data":{"content":"b"}}\n\n' +
      'data: {"event":"workflow_finished","data":{}}\r\n\r\n';
    // 第一行 data: 后跟 \r\n,第二行 data: 后跟 \n\n(帧分隔)
    // CRLF 归一化后:\r\n → \n,因此第一行和第二行在同一帧内(用 \n 分隔)
    // 合并后:{"event":"message","data":{"content":"a"}}\n{"event":"message","data":{"content":"b"}}
    // 这不是合法 JSON → error
    const chunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('error');
    expect(chunks[1]).toEqual({ type: 'done' });
  });
});

// ===========================================================================
// 2. parseIntellectEnterpriseSSE 事件映射边界
// ===========================================================================

describe('parseIntellectEnterpriseSSE 边界 - 事件映射', () => {
  it('tool.progress + tool_name=_thinking → reasoning', async () => {
    const sse =
      'event: tool.progress\r\n' +
      'data: {"tool_name":"_thinking","delta":"思考内容"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'reasoning', content: '思考内容' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('tool.progress + 普通 tool_name → tool_progress', async () => {
    const sse =
      'event: tool.progress\r\n' +
      'data: {"tool_name":"search","delta":"搜索中..."}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_progress',
      toolName: 'search',
      content: '搜索中...',
    });
  });

  it('tool.started → tool_start with args', async () => {
    const sse =
      'event: tool.started\r\n' +
      'data: {"tool_name":"calculator","message_id":"call_1","args":{"expr":"1+1"}}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_start',
      toolName: 'calculator',
      toolCallId: 'call_1',
      args: { expr: '1+1' },
    });
  });

  it('tool.completed → tool_complete with result', async () => {
    const sse =
      'event: tool.completed\r\n' +
      'data: {"tool_name":"calculator","message_id":"call_1","result":"2"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_complete',
      toolCallId: 'call_1',
      result: '2',
    });
  });

  it('tool.failed → error with toolCallId and details', async () => {
    const sse =
      'event: tool.failed\r\n' +
      'data: {"tool_name":"search","message_id":"call_2","error":"timeout"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('error');
    const errChunk = chunks[0] as Extract<StreamChunk, { type: 'error' }>;
    expect(errChunk.message).toContain('search');
    expect(errChunk.message).toContain('timeout');
    expect(errChunk.toolCallId).toBe('call_2');
    expect(errChunk.details).toBeDefined();
  });

  it('error 事件 → error chunk with details', async () => {
    const sse =
      'event: error\r\n' +
      'data: {"message":"upstream 500","code":"INTERNAL"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('error');
    const errChunk = chunks[0] as Extract<StreamChunk, { type: 'error' }>;
    expect(errChunk.message).toBe('upstream 500');
    expect(errChunk.details).toEqual({ message: 'upstream 500', code: 'INTERNAL' });
  });

  it('run.completed → usage + done', async () => {
    const sse =
      'event: assistant.delta\r\n' +
      'data: {"message_id":"m1","delta":"hi"}\r\n\r\n' +
      'event: run.completed\r\n' +
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'hi' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('run.completed 缺失 usage 字段 → usage 默认 0', async () => {
    const sse =
      'event: run.completed\r\n' +
      'data: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('usage');
    expect((chunks[0] as Extract<StreamChunk, { type: 'usage' }>).usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('流提前断开(无 done 事件)→ error "stream interrupted"', async () => {
    const sse =
      'event: assistant.delta\r\n' +
      'data: {"message_id":"m1","delta":"partial"}\r\n\r\n';
    // 流结束但无 done 事件
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'partial' });
    expect(chunks[1].type).toBe('error');
    expect(
      (chunks[1] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toContain('stream interrupted');
  });

  it('空流(无任何帧)→ error "empty stream"', async () => {
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream('')));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toContain('empty stream');
  });

  it('非法 JSON → 静默跳过(warn),不中断流', async () => {
    const sse =
      'event: assistant.delta\r\n' +
      'data: {invalid}\r\n\r\n' +
      'event: assistant.delta\r\n' +
      'data: {"message_id":"m1","delta":"after_bad"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseSSE(singleChunkStream(sse))),
    );
    // 非法 JSON 帧跳过,只产出 after_bad + done
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'after_bad' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('未知事件 → 静默跳过(warn)', async () => {
    const sse =
      'event: future_event\r\n' +
      'data: {"foo":"bar"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseSSE(singleChunkStream(sse))),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'done' });
  });

  it('帧缺失 event: 行 → 跳过', async () => {
    const sse =
      'data: {"delta":"no_event"}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'done' });
  });

  it('CRLF 混合:event 行用 CRLF,data 行用 LF,帧分隔 CRLF', async () => {
    // event: 行 \r\ndata: 行 \n,帧分隔 \r\n\r\n
    const sse =
      'event: assistant.delta\r\ndata: {"message_id":"m1","delta":"mixed"}\n\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    // CRLF 归一化后:event 行 \n,data 行 \n → 两行用 \n 分隔
    // 帧分隔 \n\n(从 \r\n\r\n 归一化)
    const chunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'mixed' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });
});

// ===========================================================================
// 3. parseIntellectEnterpriseRunEventsSSE 事件映射边界
// ===========================================================================

describe('parseIntellectEnterpriseRunEventsSSE 边界 - 事件映射', () => {
  it('message.delta + type=reasoning.delta → reasoning', async () => {
    const sse =
      'data: {"event":"message.delta","type":"reasoning.delta","text":"推理中"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'reasoning', content: '推理中' });
  });

  it('message.delta 兼容 delta 字段名(旧版)', async () => {
    const sse =
      'data: {"event":"message.delta","type":"assistant.delta","delta":"旧字段"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: '旧字段' });
  });

  it('tool.progress + type=tool.started → tool_start', async () => {
    const sse =
      'data: {"event":"tool.progress","type":"tool.started","tool_id":"t1","name":"search","arguments":"{}"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_start',
      toolName: 'search',
      toolCallId: 't1',
      args: '{}',
    });
  });

  it('tool.progress + type=tool.completed → tool_complete', async () => {
    const sse =
      'data: {"event":"tool.progress","type":"tool.completed","tool_id":"t1","result":"ok"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_complete',
      toolCallId: 't1',
      result: 'ok',
    });
  });

  it('tool.progress 兼容旧版 tool_name 字段', async () => {
    const sse =
      'data: {"event":"tool.progress","type":"tool.started","tool_id":"t2","tool_name":"legacy_tool"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('tool_start');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'tool_start' }>).toolName,
    ).toBe('legacy_tool');
  });

  it('approval.request → approval_request with choices', async () => {
    const sse =
      'data: {"event":"approval.request","tool_name":"dangerous_op","arguments":"{}","run_id":"r1","choices":["once","session","always","deny"]}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('approval_request');
    const req = chunks[0] as Extract<StreamChunk, { type: 'approval_request' }>;
    expect(req.toolName).toBe('dangerous_op');
    expect(req.runId).toBe('r1');
    expect(req.choices).toEqual(['once', 'session', 'always', 'deny']);
  });

  it('approval.request 无 choices → 默认 4 选项', async () => {
    const sse =
      'data: {"event":"approval.request","tool_name":"op","arguments":"{}","run_id":"r2"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    const req = chunks[0] as Extract<StreamChunk, { type: 'approval_request' }>;
    expect(req.choices).toEqual(['once', 'session', 'always', 'deny']);
  });

  it('approval.responded → approval_responded', async () => {
    const sse =
      'data: {"event":"approval.responded","choice":"once","resolved":1,"run_id":"r1"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'approval_responded',
      choice: 'once',
      resolved: 1,
      runId: 'r1',
    });
  });

  it('approval.responded 非法 choice → 跳过(warn)', async () => {
    const sse =
      'data: {"event":"approval.responded","choice":"invalid","resolved":0,"run_id":"r1"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse))),
    );
    // 非法 choice 跳过,只剩 run.completed 的 usage + done
    expect(chunks.length).toBe(2);
    expect(chunks[0].type).toBe('usage');
    expect(chunks[1].type).toBe('done');
  });

  it('clarify 事件 → clarify_request', async () => {
    const sse =
      'data: {"event":"clarify","question":"需要确认","choices":["A","B"],"clarify_id":"sess1:123","session_id":"sess1"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'clarify_request',
      question: '需要确认',
      choices: ['A', 'B'],
      clarifyId: 'sess1:123',
      sessionId: 'sess1',
    });
  });

  it('clarify 缺 question → error chunk', async () => {
    const sse =
      'data: {"event":"clarify","clarify_id":"sess1:123"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse))),
    );
    expect(chunks[0].type).toBe('error');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toContain('clarify');
  });

  it('clarify 缺 clarify_id → error chunk', async () => {
    const sse =
      'data: {"event":"clarify","question":"Q?"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse))),
    );
    expect(chunks[0].type).toBe('error');
  });

  it('clarify 缺 session_id → 从 clarify_id 切分推导', async () => {
    const sse =
      'data: {"event":"clarify","question":"Q?","clarify_id":"sess42:999"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    const req = chunks[0] as Extract<StreamChunk, { type: 'clarify_request' }>;
    expect(req.sessionId).toBe('sess42');
  });

  it('run.completed 带 error → usage + error(非 done)', async () => {
    const sse =
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1},"error":"something went wrong","output":"partial"}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('usage');
    expect(chunks[1].type).toBe('error');
    expect(
      (chunks[1] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toBe('something went wrong');
  });

  it('run.completed 兼容 prompt_tokens/completion_tokens(旧版字段名)', async () => {
    const sse =
      'data: {"event":"run.completed","usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('usage');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'usage' }>).usage,
    ).toEqual({ promptTokens: 5, completionTokens: 3 });
  });

  it('run.completed 无 delta 时 output 兜底为 delta', async () => {
    const sse =
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1},"output":"cached_result"}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    // 无 delta + 有 output → output 作为 delta + usage + done
    expect(chunks[0]).toEqual({ type: 'delta', content: 'cached_result' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('run.failed → error', async () => {
    const sse =
      'data: {"event":"run.failed","message":"execution failed"}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('error');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toBe('execution failed');
  });

  it('run.cancelled → error with default message', async () => {
    const sse =
      'data: {"event":"run.cancelled"}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('error');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toContain('cancelled');
  });

  it('流提前断开(无终态事件)→ error "no terminal event"', async () => {
    const sse =
      'data: {"event":"message.delta","type":"assistant.delta","text":"partial"}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'partial' });
    expect(chunks[1].type).toBe('error');
    expect(
      (chunks[1] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toContain('no terminal event');
  });

  it('空流 → error "empty stream"', async () => {
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream('')));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect(
      (chunks[0] as Extract<StreamChunk, { type: 'error' }>).message,
    ).toContain('empty stream');
  });

  it('帧缺失 event 字段 → 跳过(warn)', async () => {
    const sse =
      'data: {"foo":"bar"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse))),
    );
    expect(chunks.length).toBe(2);
    expect(chunks[0].type).toBe('usage');
    expect(chunks[1].type).toBe('done');
  });

  it('SSE 注释帧 + Gateway keepalive 控制帧均跳过', async () => {
    const sse =
      ': keepalive\n\n' +
      'data: : keepalive\n\n' +
      'data: {"event":"message.delta","type":"assistant.delta","text":"after"}\n\n' +
      'data: {"event":"run.completed","usage":{"input_tokens":1,"output_tokens":1}}\n\n';
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(sse)));
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as Extract<StreamChunk, { type: 'delta' }>).content).toBe('after');
  });
});

// ===========================================================================
// 4. parseOpenAISSE 事件映射边界
// ===========================================================================

describe('parseOpenAISSE 边界 - 事件映射', () => {
  it('reasoning_content → reasoning chunk', async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"深度思考"}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'reasoning', content: '深度思考' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('tool_calls 带 function.name → tool_start', async () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search"}}]}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_start',
      toolName: 'search',
      toolCallId: 'call_1',
    });
  });

  it('tool_calls 带 function.arguments → tool_progress', async () => {
    // 先 tool_start(带 name),再 tool_progress(带 arguments 增量)
    // 使用简单的 arguments 值避免复杂 JSON 转义
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calc"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"abc"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"def"}}]}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0].type).toBe('tool_start');
    expect(chunks[1].type).toBe('tool_progress');
    expect(chunks[2].type).toBe('tool_progress');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('tool_calls 无 id → 用 call_${index} 作为 toolCallId', async () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":2,"function":{"name":"op"}}]}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({
      type: 'tool_start',
      toolName: 'op',
      toolCallId: 'call_2',
    });
  });

  it('finish_reason=tool_calls → 所有已跟踪工具 tool_complete', async () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"t1"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"t2"}}]}}]}\n\n' +
      'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    // 2 个 tool_start + 2 个 tool_complete + done
    const starts = chunks.filter((c) => c.type === 'tool_start');
    const completes = chunks.filter((c) => c.type === 'tool_complete');
    expect(starts).toHaveLength(2);
    expect(completes).toHaveLength(2);
    expect(completes[0]).toEqual({ type: 'tool_complete', toolCallId: 'c1' });
    expect(completes[1]).toEqual({ type: 'tool_complete', toolCallId: 'c2' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('usage 字段(stream_options.include_usage)→ 延迟到 [DONE] 前发射', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'hi' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('非法 JSON → error chunk 并终止流(OpenAI 解析器在 error 后 sawDone=true)', async () => {
    // OpenAI 解析器在遇到 error chunk 时会设置 sawDone=true 并终止迭代器,
    // 后续帧不会被处理(与其他解析器的容错策略不同)。
    const sse =
      'data: {bad json}\n\n' +
      'data: {"choices":[{"delta":{"content":"after_error"}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
  });

  it('[DONE] 哨兵跨 CRLF 边界仍正确识别', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"X"}}]}\r\n\r\n' +
      'data: [DONE]\r\n\r\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'X' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('空 data: 行 → 跳过', async () => {
    const sse =
      'data: \n\n' +
      'data: {"choices":[{"delta":{"content":"after_empty"}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'after_empty' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('SSE 注释帧 → 跳过(OpenAI 解析器不显式处理,但 dataLines 为空 → 跳过)', async () => {
    const sse =
      ': keepalive\n\n' +
      'data: {"choices":[{"delta":{"content":"after_comment"}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'after_comment' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('多个 usage chunk:最后一个覆盖前一个(pendingUsage 覆盖)', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    // 只应发射最后一个 usage(10, 20)
    const usages = chunks.filter((c) => c.type === 'usage');
    expect(usages).toHaveLength(1);
    expect(
      (usages[0] as Extract<StreamChunk, { type: 'usage' }>).usage,
    ).toEqual({ promptTokens: 10, completionTokens: 20 });
  });

  it('usage 缺失 prompt_tokens/completion_tokens → 默认 0', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{}}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    const usage = chunks.find((c) => c.type === 'usage');
    expect(usage).toBeDefined();
    expect(
      (usage as Extract<StreamChunk, { type: 'usage' }>).usage,
    ).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('CRLF:delta + usage + [DONE] 完整链路', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n' +
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\r\n\r\n' +
      'data: [DONE]\r\n\r\n';
    const chunks = await collect(parseOpenAISSE(singleChunkStream(sse)));
    expect(chunks[0]).toEqual({ type: 'delta', content: 'hello' });
    expect(chunks[1].type).toBe('usage');
    expect(chunks[2]).toEqual({ type: 'done' });
  });
});

// ===========================================================================
// 5. 跨解析器:容错路径一致性
// ===========================================================================

describe('SSE 解析器跨实现一致性 - 容错路径', () => {
  it('所有解析器对非法 JSON 均产出 error 或静默跳过,不崩溃', async () => {
    const badJson = 'data: {invalid}\n\n';

    // Canvas: 产出 error
    const canvasChunks = await collect(parseCanvasWorkflowSSE(singleChunkStream(badJson)));
    expect(canvasChunks.some((c) => c.type === 'error')).toBe(true);

    // Enterprise: 静默跳过(console.warn),空流 → error
    const enterpriseChunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseSSE(singleChunkStream(badJson))),
    );
    // 非法 JSON 跳过,无任何产出 → "empty stream" error
    expect(enterpriseChunks.some((c) => c.type === 'error')).toBe(true);

    // RunEvents: 静默跳过,空流 → error
    const runEventsChunks = await silenceWarn(() =>
      collect(parseIntellectEnterpriseRunEventsSSE(singleChunkStream(badJson))),
    );
    expect(runEventsChunks.some((c) => c.type === 'error')).toBe(true);

    // OpenAI: 产出 error
    const openaiChunks = await collect(parseOpenAISSE(singleChunkStream(badJson)));
    expect(openaiChunks.some((c) => c.type === 'error')).toBe(true);
  });

  it('所有解析器对空流均产出 error 或 done 终态', async () => {
    const emptyStream = singleChunkStream('');

    // Canvas: 无产出,流结束(Canvas 无 "empty stream" 检查,静默终止)
    const canvasChunks = await collect(parseCanvasWorkflowSSE(emptyStream));
    expect(canvasChunks).toHaveLength(0);

    // Enterprise: error "empty stream"
    const enterpriseChunks = await collect(parseIntellectEnterpriseSSE(singleChunkStream('')));
    expect(enterpriseChunks).toHaveLength(1);
    expect(enterpriseChunks[0].type).toBe('error');

    // RunEvents: error "empty stream"
    const runEventsChunks = await collect(
      parseIntellectEnterpriseRunEventsSSE(singleChunkStream('')),
    );
    expect(runEventsChunks).toHaveLength(1);
    expect(runEventsChunks[0].type).toBe('error');

    // OpenAI: M1 修正 — 流自然结束时发射 done(即使无任何数据)
    const openaiChunks = await collect(parseOpenAISSE(singleChunkStream('')));
    expect(openaiChunks).toHaveLength(1);
    expect(openaiChunks[0]).toEqual({ type: 'done' });
  });
});
