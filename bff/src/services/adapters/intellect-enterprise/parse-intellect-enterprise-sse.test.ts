// Multi-Harness P3 US3:parseIntellectEnterpriseSSE 契约测试。
// Constitution Principle IV (v1.2.0) + VII (Test-First)。
// 验证 intellect-team /api/sessions/{id}/chat/stream SSE 事件 → StreamChunk 映射。

import { describe, it, expect, vi } from 'vitest';
import { parseIntellectEnterpriseSSE } from './parse-intellect-enterprise-sse';
import type { StreamChunk } from '../../../types/stream';
import {
  fullConversationFrames,
  toolCallFrames,
  toolFailedFrames,
  errorFrames,
  malformedFrames,
  unknownEventFrames,
  streamClosedPrematurelyFrames,
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

describe('parseIntellectEnterpriseSSE', () => {
  it('完整正常流:reasoning + delta + usage + done', async () => {
    const stream = toReadableStream(makeStream(fullConversationFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));

    // run.started + message.started 不产出
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

  it('tool.progress(_thinking) → reasoning', async () => {
    const stream = toReadableStream(makeStream(fullConversationFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    const reasoning = chunks.find((c) => c.type === 'reasoning');
    expect(reasoning).toBeDefined();
    expect((reasoning as { content: string }).content).toBe('思考中');
  });

  it('工具调用流:tool_start + tool_progress + tool_complete', async () => {
    const stream = toReadableStream(makeStream(toolCallFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));

    const toolStart = chunks.find((c) => c.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect(toolStart).toMatchObject({ type: 'tool_start', toolName: 'read_file' });

    const toolProgress = chunks.find((c) => c.type === 'tool_progress');
    expect(toolProgress).toBeDefined();
    expect(toolProgress).toMatchObject({
      type: 'tool_progress',
      toolName: 'read_file',
      content: '读取中',
    });

    const toolComplete = chunks.find((c) => c.type === 'tool_complete');
    expect(toolComplete).toBeDefined();
    expect(toolComplete).toMatchObject({
      type: 'tool_complete',
      toolCallId: 'msg-2',
    });
  });

  it('tool.failed → StreamError(带 toolCallId,Constitution Principle IV)', async () => {
    const stream = toReadableStream(makeStream(toolFailedFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    // tool.failed → error(非 tool_complete),关联 toolCallId
    const failed = chunks.find(
      (c) => c.type === 'error' && 'toolCallId' in c && c.toolCallId,
    );
    expect(failed).toBeDefined();
    expect((failed as { message: string }).message).toContain('文件不存在');
    expect((failed as { toolCallId?: string }).toolCallId).toBe('msg-3');
  });

  it('error 事件 → StreamError', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = toReadableStream(makeStream(errorFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toBe('内部错误');
    warnSpy.mockRestore();
  });

  it('JSON 解析失败:跳过坏帧 + console.warn,不中断流', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = toReadableStream(makeStream(malformedFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    // 坏帧跳过,正常 delta 保留
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('正常');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('未知事件:跳过 + console.warn,不中断流', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = toReadableStream(makeStream(unknownEventFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    // 未知事件跳过,正常 delta 保留
    const delta = chunks.find((c) => c.type === 'delta');
    expect(delta).toBeDefined();
    expect((delta as { content: string }).content).toBe('ok');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('流提前断开(无 done)→ 产出 error chunk', async () => {
    const stream = toReadableStream(
      makeStream(streamClosedPrematurelyFrames),
    );
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    // 已产出的 delta 保留
    expect(chunks.find((c) => c.type === 'delta')).toBeDefined();
    // 最后产出 error(流未正常 done)
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
  });

  it('run.started / message.started 不产出 StreamChunk(内部状态)', async () => {
    const stream = toReadableStream(makeStream(fullConversationFrames));
    const chunks = await collect(parseIntellectEnterpriseSSE(stream));
    // 第一个产出应是 reasoning(run.started/message.started 被跳过)
    expect(chunks[0].type).not.toBe('done');
    expect(chunks.length).toBeLessThan(fullConversationFrames.length);
  });
});
