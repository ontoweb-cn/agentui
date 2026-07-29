// Multi-Harness P4 v1.3.0: parseIntellectEnterpriseRunEventsSSE 契约测试。
// Constitution Principle IV (v1.3.0) + VII (Test-First)。
// 验证 intellect-team /v1/runs/{run_id}/events SSE 事件 → StreamChunk 映射。

import { describe, it, expect, vi } from 'vitest';
import { parseIntellectEnterpriseRunEventsSSE } from './parse-intellect-enterprise-run-events-sse';
import type { StreamChunk } from '../../../types/stream';
import {
  runEventsFullConversationFrames,
  runEventsToolCallFrames,
  runEventsApprovalFrames,
  runEventsErrorFrames,
  runEventsCancelledFrames,
  runEventsMalformedFrames,
  runEventsUnknownEventFrames,
  runEventsStreamClosedPrematurelyFrames,
  runEventsKeepaliveFrames,
  runEventsGatewayActualFrames,
  runEventsGatewayToolCallFrames,
  runEventsOutputOnlyFrames,
  runEventsClarifyFrames,
  runEventsClarifySplitFrames,
  runEventsClarifyMissingQuestionFrames,
  runEventsClarifyMixedChoicesFrames,
  makeStream,
} from './fixtures/sse-streams';

function toReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });
}

async function collect(
  iterable: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe('parseIntellectEnterpriseRunEventsSSE', () => {
  it('完整正常流:reasoning + delta + usage + done', async () => {
    const stream = toReadableStream(makeStream(runEventsFullConversationFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    // run.started 不产出
    expect(chunks[0]).toEqual({ type: 'reasoning', content: '思考中' });
    expect(chunks[1]).toEqual({ type: 'delta', content: '你好' });
    expect(chunks[2]).toEqual({ type: 'delta', content: '!' });
    // run.completed → usage 后接 done
    expect(chunks[3].type).toBe('usage');
    expect(chunks[3]).toMatchObject({
      type: 'usage',
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    expect(chunks[4]).toEqual({ type: 'done' });
  });

  it('message.delta + type:"reasoning.delta" → StreamReasoning', async () => {
    const stream = toReadableStream(makeStream(runEventsFullConversationFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    const reasoning = chunks.find((c) => c.type === 'reasoning');
    expect(reasoning).toBeDefined();
    expect((reasoning as { content: string }).content).toBe('思考中');
  });

  it('工具调用流:tool_start + tool_complete(tool.progress 内层 type 区分)', async () => {
    const stream = toReadableStream(makeStream(runEventsToolCallFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const toolStart = chunks.find((c) => c.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect(toolStart).toMatchObject({
      type: 'tool_start',
      toolName: 'read_file',
      toolCallId: 'tool-abc',
    });

    const toolComplete = chunks.find((c) => c.type === 'tool_complete');
    expect(toolComplete).toBeDefined();
    expect(toolComplete).toMatchObject({
      type: 'tool_complete',
      toolCallId: 'tool-abc',
    });
  });

  it('审批流:approval_request + approval_responded', async () => {
    const stream = toReadableStream(makeStream(runEventsApprovalFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const approvalReq = chunks.find((c) => c.type === 'approval_request');
    expect(approvalReq).toBeDefined();
    expect(approvalReq).toMatchObject({
      type: 'approval_request',
      toolName: 'bash',
      arguments: JSON.stringify({ command: 'rm -rf /tmp/test' }),
      choices: ['once', 'session', 'always', 'deny'],
      runId: 'run-3',
    });

    const approvalResp = chunks.find((c) => c.type === 'approval_responded');
    expect(approvalResp).toBeDefined();
    expect(approvalResp).toMatchObject({
      type: 'approval_responded',
      choice: 'once',
      resolved: 1,
      runId: 'run-3',
    });
  });

  it('run.failed → StreamError(带 message)', async () => {
    const stream = toReadableStream(makeStream(runEventsErrorFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toBe('内部错误');
  });

  it('run.cancelled → StreamError(带 message)', async () => {
    const stream = toReadableStream(makeStream(runEventsCancelledFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toBe('用户取消');
  });

  it('JSON 解析失败:跳过坏帧 + console.warn,不中断流', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = toReadableStream(makeStream(runEventsMalformedFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // 坏帧跳过,正常 delta 保留
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('正常');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('未知事件:跳过 + console.warn,不中断流', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = toReadableStream(makeStream(runEventsUnknownEventFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // 未知事件跳过,正常 delta 保留
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('ok');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('流提前断开(无终态事件)→ 产出 error chunk', async () => {
    const stream = toReadableStream(
      makeStream(runEventsStreamClosedPrematurelyFrames),
    );
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // 已产出的 delta 保留
    expect(chunks.find((c) => c.type === 'delta')).toBeDefined();
    // 最后产出 error(流未正常终止)
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
  });

  it('SSE 注释帧(: keepalive)跳过,不产出', async () => {
    const stream = toReadableStream(makeStream(runEventsKeepaliveFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // keepalive 跳过,正常 delta 保留
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('心跳后内容');
  });

  it('run.started 不产出 StreamChunk(内部状态)', async () => {
    const stream = toReadableStream(makeStream(runEventsFullConversationFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // 第一个产出应是 reasoning(run.started 被跳过)
    expect(chunks[0].type).toBe('reasoning');
    // run.started 不产出,但 run.completed 产出 2 个 chunk(usage + done)抵消
    // 验证 run.started 被跳过:5 frames(run.started/reasoning/2xdelta/run.completed)
    // 产出 5 chunks(reasoning/2xdelta/usage/done),run.started 无对应 chunk
    // 注:c.type 已是 StreamChunk 联合类型(不含 'run.started'),仅检查 event 字段兜底
    const hasRunStartedChunk = chunks.some(
      (c) => (c as { event?: string }).event === 'run.started',
    );
    expect(hasRunStartedChunk).toBe(false);
  });

  it('run.completed 带 error 字段 → 产出 error 而非 done', async () => {
    const frames = [
      `data: ${JSON.stringify({
        event: 'run.started',
        run_id: 'run-err',
        timestamp: 1.0,
      })}\n\n`,
      `data: ${JSON.stringify({
        event: 'run.completed',
        run_id: 'run-err',
        timestamp: 2.0,
        error: '执行失败',
        output: null,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })}\n\n`,
    ];
    const stream = toReadableStream(makeStream(frames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // usage 产出
    expect(chunks.find((c) => c.type === 'usage')).toBeDefined();
    // error 产出(非 done)
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toBe('执行失败');
    // 不产出 done
    expect(chunks.find((c) => c.type === 'done')).toBeUndefined();
  });

  it('approval.request 缺少 choices → 默认 4 个选项', async () => {
    const frames = [
      `data: ${JSON.stringify({
        event: 'approval.request',
        run_id: 'run-def',
        tool_name: 'bash',
        arguments: '{"command":"ls"}',
      })}\n\n`,
      `data: ${JSON.stringify({
        event: 'run.completed',
        run_id: 'run-def',
        timestamp: 2.0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })}\n\n`,
    ];
    const stream = toReadableStream(makeStream(frames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    const req = chunks.find((c) => c.type === 'approval_request') as {
      choices: string[];
    } | undefined;
    expect(req).toBeDefined();
    expect(req?.choices).toEqual(['once', 'session', 'always', 'deny']);
  });

  it('approval.responded 无效 choice → 跳过 + console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frames = [
      `data: ${JSON.stringify({
        event: 'approval.responded',
        run_id: 'run-bad',
        choice: 'invalid',
        resolved: 1,
      })}\n\n`,
      `data: ${JSON.stringify({
        event: 'run.completed',
        run_id: 'run-bad',
        timestamp: 2.0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })}\n\n`,
    ];
    const stream = toReadableStream(makeStream(frames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));
    // 无效 choice 跳过,无 approval_responded 产出
    expect(chunks.find((c) => c.type === 'approval_responded')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ── Rust Gateway (api_server.rs) 实际字段名测试 ──────────────────────

  it('Gateway 实际格式:message.delta 用 text 字段(非 delta)', async () => {
    const stream = toReadableStream(makeStream(runEventsGatewayActualFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    // reasoning.delta 用 text 字段
    const reasoning = chunks.find((c) => c.type === 'reasoning');
    expect(reasoning).toBeDefined();
    expect((reasoning as { content: string }).content).toBe('思考中');

    // assistant.delta 用 text 字段
    const deltas = chunks.filter((c) => c.type === 'delta');
    expect(deltas).toHaveLength(2);
    expect((deltas[0] as { content: string }).content).toBe('你好');
    expect((deltas[1] as { content: string }).content).toBe('!');
  });

  it('Gateway 实际格式:run.completed usage 用 input_tokens/output_tokens', async () => {
    const stream = toReadableStream(makeStream(runEventsGatewayActualFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const usage = chunks.find((c) => c.type === 'usage');
    expect(usage).toBeDefined();
    expect(usage).toMatchObject({
      type: 'usage',
      usage: { promptTokens: 10, completionTokens: 5 },
    });
  });

  it('Gateway 实际格式:tool.progress 用 name 字段(非 tool_name)', async () => {
    const stream = toReadableStream(makeStream(runEventsGatewayToolCallFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const toolStart = chunks.find((c) => c.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect(toolStart).toMatchObject({
      type: 'tool_start',
      toolName: 'search_files',
      toolCallId: 'call_00_abc123',
    });

    const toolComplete = chunks.find((c) => c.type === 'tool_complete');
    expect(toolComplete).toBeDefined();
    expect(toolComplete).toMatchObject({
      type: 'tool_complete',
      toolCallId: 'call_00_abc123',
    });
  });

  it('output 兜底:无 message.delta 时将 run.completed.output 作为 delta 产出', async () => {
    const stream = toReadableStream(makeStream(runEventsOutputOnlyFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    // 产出 delta(来自 output 字段)
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('这是完整答案');

    // 仍产出 usage + done
    expect(chunks.find((c) => c.type === 'usage')).toBeDefined();
    expect(chunks.find((c) => c.type === 'done')).toBeDefined();
  });

  it('output 兜底不触发:有 message.delta 时不重复产出 output', async () => {
    // 使用 Gateway 实际格式 fixture(有 delta + output)
    const stream = toReadableStream(makeStream(runEventsGatewayActualFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    // 仅 2 个 delta(来自 message.delta),不应额外产出 output delta
    const deltas = chunks.filter((c) => c.type === 'delta');
    expect(deltas).toHaveLength(2);
    // 确认无重复内容
    const contents = deltas.map((d) => (d as { content: string }).content);
    expect(contents).toEqual(['你好', '!']);
  });

  // -------------------------------------------------------------------------
  // B5: clarify 事件解析测试(覆盖 session_id 提取/choices 过滤/缺失字段处理)
  // -------------------------------------------------------------------------

  it('clarify 事件(顶层 session_id)→ 产出 clarify_request chunk', async () => {
    const stream = toReadableStream(makeStream(runEventsClarifyFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const clarifyChunk = chunks.find((c) => c.type === 'clarify_request');
    expect(clarifyChunk).toBeDefined();
    expect(clarifyChunk).toMatchObject({
      type: 'clarify_request',
      question: '您想了解什么?',
      choices: ['选项A', '选项B'],
      clarifyId: 'sess-c1:1700000000000',
      sessionId: 'sess-c1',
    });
  });

  it('clarify 事件(缺失 session_id)→ 从 clarify_id 切分兜底', async () => {
    const stream = toReadableStream(makeStream(runEventsClarifySplitFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const clarifyChunk = chunks.find((c) => c.type === 'clarify_request');
    expect(clarifyChunk).toBeDefined();
    // session_id 缺失时,从 clarify_id "sess-c2:1700000000001" 切分首段
    expect((clarifyChunk as { sessionId: string }).sessionId).toBe('sess-c2');
  });

  it('clarify 事件(缺失 question)→ 产出 error chunk 而非静默跳过(M11 修复)', async () => {
    const stream = toReadableStream(makeStream(runEventsClarifyMissingQuestionFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    // M11 修复:缺失关键字段时产出 error chunk,让前端能清理 pending 状态
    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect((errorChunk as { message: string }).message).toMatch(/missing required field/);
    // 不应产出 clarify_request chunk
    expect(chunks.find((c) => c.type === 'clarify_request')).toBeUndefined();
  });

  it('clarify 事件(choices 含非 string 元素)→ 过滤后仅保留有效项', async () => {
    const stream = toReadableStream(makeStream(runEventsClarifyMixedChoicesFrames));
    const chunks = await collect(parseIntellectEnterpriseRunEventsSSE(stream));

    const clarifyChunk = chunks.find((c) => c.type === 'clarify_request');
    expect(clarifyChunk).toBeDefined();
    // 123 和 null 应被过滤,仅保留 2 个 string 元素
    const choices = (clarifyChunk as { choices: string[] }).choices;
    expect(choices).toEqual(['有效选项', '另一个有效选项']);
  });
});
