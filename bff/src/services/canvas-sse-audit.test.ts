// Canvas SSE audit layer — unit tests.
//
// The property that matters is negative: the layer must NOT change the stream.
// The front end owns event mapping (go-canvas-sse-adapter.ts), so any byte this
// layer rewrote would either duplicate that work or pre-empt it.

import { describe, it, expect } from 'vitest';
import {
  createSseAuditStats,
  createSseAuditTransform,
  withSseAudit,
  ENGINE_ONLY_EVENTS,
  type SseAuditStats,
} from './canvas-sse-audit';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function pipe(input: string, stats: SseAuditStats): Promise<string> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const reader = stream.pipeThrough(createSseAuditTransform(stats)).getReader();
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

describe('canvas-sse-audit', () => {
  it('forwards an envelope byte-for-byte', async () => {
    const stats = createSseAuditStats();
    const input = envelope('workflow_started', { inputs: null }) + '\n\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    expect(stats.envelopes).toBe(1);
    expect(stats.malformed).toBe(0);
  });

  it('does NOT rewrite cancelled — the front end maps it', async () => {
    const stats = createSseAuditStats();
    const input = envelope('cancelled', {}) + '\n\n';
    const out = await pipe(input, stats);
    // Byte-identical: still `cancelled`, still its original payload.
    expect(out).toBe(input);
    expect(out).not.toContain('workflow_finished');
    expect(out).not.toContain('Task has been canceled');
    // But it is recorded as an engine-only event the front end handles.
    expect(stats.engineEvents.cancelled).toBe(1);
  });

  it('does NOT rewrite waiting_for_user and keeps every payload field', async () => {
    const stats = createSseAuditStats();
    const data = {
      cpn_id: 'UserFillUp:x',
      tips: 'please fill',
      content: 'body text the UI shows',
      inputs: { jd: { type: 'line', name: 'Job Description' } },
    };
    const input = envelope('waiting_for_user', data) + '\n\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    // An earlier rewriting version dropped `content`; assert it survives.
    const payload = JSON.parse(out.trim().replace(/^data:\s*/, ''));
    expect(payload.event).toBe('waiting_for_user');
    expect(payload.data.content).toBe('body text the UI shows');
    expect(stats.engineEvents.waiting_for_user).toBe(1);
  });

  it('counts duplicate [DONE] without collapsing it', async () => {
    const stats = createSseAuditStats();
    const input =
      envelope('workflow_finished', { outputs: {} }) + '\n\ndata:[DONE]\n\ndata:[DONE]\n\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    expect((out.match(/data:\[DONE\]/g) ?? []).length).toBe(2);
    expect(stats.doneFrames).toBe(2);
    expect(stats.duplicateDone).toBe(1);
  });

  it('counts malformed frames and forwards them untouched', async () => {
    const stats = createSseAuditStats();
    const input =
      'data: not-json\n\n' +
      'data: {"event":"message"}\n\n' +
      'data:\n\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    // Non-JSON, missing six-field envelope, and empty payload: all three.
    expect(stats.malformed).toBe(3);
  });

  it('joins multi-line data fields before decoding', async () => {
    const stats = createSseAuditStats();
    const input =
      'data: {"event":"workflow_finished",\n' +
      'data: "message_id":"m-1","created_at":"t","session_id":"s","task_id":"s",\n' +
      'data: "data":{"outputs":{}}}\n\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    expect(stats.envelopes).toBe(1);
    expect(stats.malformed).toBe(0);
  });

  it('tolerates CRLF separators', async () => {
    const stats = createSseAuditStats();
    const input = envelope('cancelled', {}).replace(/\n\n$/, '') + '\r\n\r\n';
    const out = await pipe(input, stats);
    expect(out).toBe(input);
    expect(stats.engineEvents.cancelled).toBe(1);
  });

  it('keeps content-length because the body is unchanged', async () => {
    const stats = createSseAuditStats();
    const body = envelope('workflow_finished', { outputs: {} }) + '\n\n';
    const upstream = new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Content-Length': String(encoder.encode(body).length),
      },
    });
    const out = withSseAudit(upstream, stats);
    expect(out.headers.get('content-length')).toBe(String(encoder.encode(body).length));
    expect(await out.text()).toBe(body);
  });

  it('reports a summary once the stream closes', async () => {
    const stats = createSseAuditStats();
    const seen: SseAuditStats[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(envelope('done', {}) + '\n\n'));
        controller.close();
      },
    });
    const reader = stream
      .pipeThrough(createSseAuditTransform(stats, (s) => seen.push({ ...s })))
      .getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].envelopes).toBe(1);
    expect(seen[0].engineEvents.done).toBe(1);
  });

  it('documents the engine-only event set the front end owns', () => {
    expect([...ENGINE_ONLY_EVENTS].sort()).toEqual([
      'cancelled',
      'done',
      'error',
      'waiting_for_user',
    ]);
  });
});
