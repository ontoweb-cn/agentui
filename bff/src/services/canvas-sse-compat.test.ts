// Canvas SSE wire-format compatibility layer — unit tests.
//
// Golden fixtures live in the engine repo (tests/e2e-tests/fixtures/p0p2-closeout)
// and are inlined here so the BFF suite stays self-contained.

import { describe, it, expect } from 'vitest';
import {
  createSseCompatTransform,
  withSseCompat,
  CANCELLED_OUTPUTS,
  type SseCompatStats,
} from './canvas-sse-compat';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function freshStats(): SseCompatStats {
  return { passthrough: 0, rewritten: 0, malformed: 0, droppedDone: 0 };
}

/** Run `input` through the layer and return the emitted text. */
async function pipe(input: string, stats: SseCompatStats): Promise<string> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const out = stream.pipeThrough(createSseCompatTransform(stats));
  const reader = out.getReader();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

const ENVELOPE_PREFIX =
  '{"event":"%s","message_id":"m-1","created_at":"2026-11-27T10:00:00Z",' +
  '"session_id":"e2e-pc-1","task_id":"e2e-pc-1","data":%s}';

function envelope(event: string, data: unknown): string {
  return 'data: ' + ENVELOPE_PREFIX.replace('%s', event).replace('%s', JSON.stringify(data));
}

describe('canvas-sse-compat', () => {
  it('passes a shape-compliant envelope through unchanged', async () => {
    const stats = freshStats();
    const input = envelope('workflow_started', { inputs: null }) + '\n\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    expect(stats.passthrough).toBe(1);
    expect(stats.rewritten).toBe(0);
    expect(stats.malformed).toBe(0);
  });

  it('maps cancelled to workflow_finished with the Python wording', async () => {
    const stats = freshStats();
    const out = await pipe(envelope('cancelled', {}) + '\n\n', stats);
    const payload = JSON.parse(out.trim().replace(/^data:\s*/, ''));
    expect(payload.event).toBe('workflow_finished');
    expect(payload.data).toEqual({ outputs: CANCELLED_OUTPUTS });
    // The six envelope fields survive the rewrite.
    for (const field of ['message_id', 'created_at', 'session_id', 'task_id']) {
      expect(payload[field]).toBeTruthy();
    }
    expect(stats.rewritten).toBe(1);
  });

  it('keeps exactly one [DONE] terminator', async () => {
    const stats = freshStats();
    const input =
      envelope('workflow_finished', { outputs: {} }) +
      '\n\ndata:[DONE]\n\ndata:[DONE]\n\n';
    const out = await pipe(input, stats);
    const doneCount = (out.match(/data:\[DONE\]/g) ?? []).length;
    expect(doneCount).toBe(1);
    expect(stats.droppedDone).toBe(1);
  });

  it('maps waiting_for_user to user_inputs preserving inputs and tips', async () => {
    const stats = freshStats();
    const data = {
      cpn_id: 'UserFillUp:x',
      tips: 'please fill',
      inputs: { jd: { type: 'line', name: 'Job Description' } },
    };
    const out = await pipe(envelope('waiting_for_user', data) + '\n\n', stats);
    const payload = JSON.parse(out.trim().replace(/^data:\s*/, ''));
    expect(payload.event).toBe('user_inputs');
    expect(payload.data.inputs).toEqual(data.inputs);
    expect(payload.data.tips).toBe('please fill');
    expect(stats.rewritten).toBe(1);
  });

  it('forwards malformed frames untouched and counts them', async () => {
    const stats = freshStats();
    const input =
      'data: not-json\n\n' +
      'data: {"event":"message"}\n\n' +
      'data:\n\n';
    const out = await pipe(input, stats);
    // Nothing invented: every frame is still present, byte-identical.
    expect(out).toContain('data: not-json');
    expect(out).toContain('data: {"event":"message"}');
    expect(stats.malformed).toBe(3);
    expect(stats.rewritten).toBe(0);
    expect(stats.passthrough).toBe(0);
  });

  it('joins multi-line data fields before decoding', async () => {
    const stats = freshStats();
    // SSE allows one event to span several data: lines; they concatenate with \n.
    const input =
      'data: {"event":"workflow_finished",\n' +
      'data: "message_id":"m-1","created_at":"t","session_id":"s","task_id":"s",\n' +
      'data: "data":{"outputs":{}}}\n\n';
    const out = await pipe(input, stats);
    const payload = JSON.parse(out.trim().replace(/^data:\s*/, ''));
    expect(payload.event).toBe('workflow_finished');
    expect(payload.data).toEqual({ outputs: {} });
    expect(stats.malformed).toBe(0);
  });

  it('tolerates CRLF frame separators', async () => {
    const stats = freshStats();
    const input = envelope('cancelled', {}).replace(/\n\n$/, '') + '\r\n\r\n';
    const out = await pipe(input, stats);
    expect(out).toContain('workflow_finished');
    expect(stats.rewritten).toBe(1);
  });

  it('strips content-length so a re-serialised body is not truncated', async () => {
    const stats = freshStats();
    const upstream = new Response(envelope('cancelled', {}) + '\n\n', {
      headers: {
        'Content-Type': 'text/event-stream',
        'Content-Length': '999',
      },
    });
    const out = withSseCompat(upstream, stats);
    expect(out.headers.get('content-length')).toBeNull();
  });

  it('forwards an over-long unterminated frame instead of buffering forever', async () => {
    const stats = freshStats();
    const huge = 'data: ' + 'x'.repeat(5 * 1024 * 1024);
    const out = await pipe(huge, stats);
    // Nothing invented and nothing dropped: the bytes come back, and the frame
    // is counted as malformed.
    expect(out).toContain('xxxx');
    expect(stats.malformed).toBeGreaterThan(0);
  });

  it('rewrites inside a piped Response (withSseCompat)', async () => {
    const stats = freshStats();
    const upstream = new Response(envelope('cancelled', {}) + '\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const out = await withSseCompat(upstream, stats).text();
    expect(out).toContain('workflow_finished');
    expect(out).toContain(CANCELLED_OUTPUTS);
    expect(stats.rewritten).toBe(1);
  });
});
