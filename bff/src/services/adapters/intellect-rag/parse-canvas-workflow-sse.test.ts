import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCanvasWorkflowSSE } from './parse-canvas-workflow-sse';
import type { StreamChunk } from '../../../types/stream';

function toUint8Array(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(toUint8Array(text));
      controller.close();
    },
  });
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'canvas-workflow-sse.txt');

describe('parseCanvasWorkflowSSE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fixture 文件存在且非空', () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf-8');
    expect(fixture.length).toBeGreaterThan(0);
    expect(fixture).toContain('workflow_started');
    expect(fixture).toContain('workflow_finished');
  });

  it('workflow_started 不产出 StreamChunk(内部状态)', async () => {
    const sse = toReadableStream(
      'data: {"event":"workflow_started","message_id":"m1","session_id":"s1","created_at":1,"data":{"inputs":{}}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    // 无 workflow_finished,流自然结束,无 chunk 产出
    expect(chunks).toEqual([]);
  });

  it('message + data.content 产出 StreamDelta', async () => {
    const sse = toReadableStream(
      'data: {"event":"message","message_id":"m1","session_id":"s1","created_at":1,"data":{"content":"Hello"}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'delta', content: 'Hello' });
  });

  it('message + start_to_think 产出 StreamReasoning', async () => {
    const sse = toReadableStream(
      'data: {"event":"message","message_id":"m1","session_id":"s1","created_at":1,"data":{"content":"thinking...","start_to_think":true}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'reasoning', content: 'thinking...' });
  });

  it('message + end_to_think 产出 StreamReasoning', async () => {
    const sse = toReadableStream(
      'data: {"event":"message","message_id":"m1","session_id":"s1","created_at":1,"data":{"content":"","end_to_think":true}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('reasoning');
  });

  it('message_end 产出 StreamDelta(空 content)+ reference metadata', async () => {
    const sse = toReadableStream(
      'data: {"event":"message_end","message_id":"m1","session_id":"s1","created_at":1,"data":{"reference":{"chunks":[{"id":"c1"}],"doc_aggs":[{"id":"d1"}]}}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('delta');
    expect((chunks[0] as { content: string }).content).toBe('');
    // reference 透传到 metadata(Layer 3)
    expect((chunks[0] as { metadata?: unknown }).metadata).toEqual({
      reference: { chunks: [{ id: 'c1' }], doc_aggs: [{ id: 'd1' }] },
    });
  });

  it('workflow_finished 产出 StreamDone(无 [DONE] 哨兵)', async () => {
    const sse = toReadableStream(
      'data: {"event":"workflow_finished","message_id":"m1","session_id":"s1","created_at":1,"data":{}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'done' });
  });

  it('workflow_finished 后终止迭代,不消费后续 chunk', async () => {
    const sse = toReadableStream(
      'data: {"event":"workflow_finished","message_id":"m1","session_id":"s1","created_at":1,"data":{}}\n\n' +
        'data: {"event":"message","message_id":"m1","session_id":"s1","created_at":2,"data":{"content":"after done"}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('done');
  });

  it('node_started / node_finished 不产出 StreamChunk(内部状态)', async () => {
    const sse = toReadableStream(
      'data: {"event":"node_started","message_id":"m1","session_id":"s1","created_at":1,"data":{"component_id":"begin","component_name":"Begin","component_type":"begin"}}\n\n' +
        'data: {"event":"node_finished","message_id":"m1","session_id":"s1","created_at":2,"data":{"component_id":"begin","elapsed_time":5}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toEqual([]);
  });

  it('非 JSON 的 data 行产出 StreamError,不中断流', async () => {
    const sse = toReadableStream(
      'data: {invalid json\n\n' +
        'data: {"event":"message","message_id":"m1","session_id":"s1","created_at":1,"data":{"content":"valid"}}\n\n',
    );
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe('error');
    expect(chunks[1]).toEqual({ type: 'delta', content: 'valid' });
  });

  it('完整 fixture 解析:产出 delta×3 + reasoning(start) + reasoning(end) + delta(reference) + done', async () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf-8');
    const sse = toReadableStream(fixture);
    const chunks = await collect(parseCanvasWorkflowSSE(sse));
    const types = chunks.map((c) => c.type);
    // "Hello" → delta(content,无 thinking 标记)
    // ", world!" → delta(content,无 thinking 标记)
    // "" + start_to_think → reasoning(标记思考链开始)
    // "Let me think..." → delta(content,无 thinking 标记 — 此 chunk 是思考链内容但无标记,
    //   constitution 映射规则:无 start_to_think/end_to_think 的 message → delta)
    // "" + end_to_think → reasoning(标记思考链结束)
    // message_end → delta(empty) + metadata.reference
    // workflow_finished → done
    expect(types).toEqual([
      'delta',
      'delta',
      'reasoning',
      'delta',
      'reasoning',
      'delta',
      'done',
    ]);
  });
});
