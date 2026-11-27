// Canvas SSE audit layer — observes, never rewrites.
//
// Ownership split (decided 2026-11-27): the EVENT MAPPING belongs to the front
// end (`src/utils/go-canvas-sse-adapter.ts`, wired through
// useSendMessageBySSE). It sees the payload, owns the UI semantics, and is the
// only place that should turn an engine event name into a timeline event.
//
// An earlier version of this file did the mapping too. Two mapping layers on
// the same stream is actively harmful: the BFF rewrote `cancelled` into
// `workflow_finished` before the front end ever saw it, so the front end's
// `cancelled` branch became dead code, and the reverse ordering produced
// different results. Whichever layer ran first swallowed the other's work.
//
// So this layer only LOOKS:
//   - every byte is forwarded unchanged (no re-serialisation, so Content-Length
//     stays valid and nothing needs re-deriving);
//   - frames are parsed on the side purely to count what arrived and to flag
//     engine-only event names that the front end is expected to map.
//
// If the numbers look wrong — malformed frames, duplicate terminators, or an
// engine-only event the front end does not know about — the caller gets a
// summary to log. Nothing is repaired silently: a visibly broken stream is
// easier to diagnose than one that was quietly patched with an invented event.

/** Six fields every engine envelope carries. */
export const ENVELOPE_FIELDS = [
  'event',
  'message_id',
  'created_at',
  'session_id',
  'task_id',
  'data',
] as const;

/**
 * Event names that only the Go engine emits and that the front end maps to a
 * timeline event (`go-canvas-sse-adapter.ts`). Seeing them here is normal for a
 * Go backend; they are counted so an unexpected one stands out in the logs.
 */
export const ENGINE_ONLY_EVENTS = [
  'cancelled',
  'done',
  'error',
  'waiting_for_user',
] as const;

const ENGINE_ONLY = new Set<string>(ENGINE_ONLY_EVENTS);

export interface SseAuditStats {
  /** Complete payload frames seen. */
  frames: number;
  /** Frames that carried all six envelope fields. */
  envelopes: number;
  /** Frames that were not usable envelopes (non-JSON, missing fields). */
  malformed: number;
  /** `[DONE]` terminators seen. */
  doneFrames: number;
  /** `[DONE]` terminators beyond the first — a duplicate-terminator signal. */
  duplicateDone: number;
  /** Engine-only event names observed, with counts. */
  engineEvents: Record<string, number>;
}

export function createSseAuditStats(): SseAuditStats {
  return {
    frames: 0,
    envelopes: 0,
    malformed: 0,
    doneFrames: 0,
    duplicateDone: 0,
    engineEvents: {},
  };
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ENVELOPE_FIELDS.every((field) => field in record);
}

/** Inspect one frame's text and update the counters. Never returns a payload. */
function auditFrame(frame: string, stats: SseAuditStats): void {
  // SSE allows several `data:` lines per event; they concatenate with "\n".
  const dataLines = frame
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''));
  if (dataLines.length === 0) {
    // Comment-only / event-only frames are legal SSE and carry no payload.
    return;
  }
  stats.frames += 1;
  const payload = dataLines.join('\n');
  if (payload === '[DONE]') {
    stats.doneFrames += 1;
    if (stats.doneFrames > 1) stats.duplicateDone += 1;
    return;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    stats.malformed += 1;
    return;
  }
  if (!isEnvelope(decoded)) {
    stats.malformed += 1;
    return;
  }
  stats.envelopes += 1;
  const event = (decoded as Record<string, unknown>).event;
  if (typeof event === 'string' && ENGINE_ONLY.has(event)) {
    stats.engineEvents[event] = (stats.engineEvents[event] ?? 0) + 1;
  }
}

/** Cap on the parse buffer; bytes beyond it are forwarded but not audited. */
const MAX_PENDING_AUDIT_BYTES = 4 * 1024 * 1024;

/**
 * Forwards every chunk unchanged while auditing frames on the side.
 *
 * `onFinish` runs once when the stream closes, so the caller can log a summary.
 * Bytes are never modified: a transform that only observes must not change the
 * body, or it becomes a second mapper by accident.
 */
export function createSseAuditTransform(
  stats: SseAuditStats,
  onFinish?: (stats: SseAuditStats) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const drain = (): void => {
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      auditFrame(frame, stats);
      boundary = buffer.indexOf('\n\n');
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Forward first, unchanged: the audit must not alter bytes or timing.
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      // A stream that never emits a delimiter would grow this buffer forever.
      // Drop what has been buffered; the bytes themselves were already
      // forwarded, so only the audit loses detail.
      if (buffer.length > MAX_PENDING_AUDIT_BYTES) {
        buffer = '';
      }
      drain();
    },
    flush() {
      buffer += decoder.decode();
      const rest = buffer.trim();
      if (rest !== '') {
        auditFrame(rest, stats);
      }
      if (!finished) {
        finished = true;
        onFinish?.(stats);
      }
    },
  });
}

/** Pipe an upstream SSE body through the audit layer, keeping the headers. */
export function withSseAudit(
  upstream: Response,
  stats: SseAuditStats,
  onFinish?: (stats: SseAuditStats) => void,
): Response {
  if (!upstream.body) return upstream;
  return new Response(upstream.body.pipeThrough(createSseAuditTransform(stats, onFinish)), {
    status: upstream.status,
    statusText: upstream.statusText,
    // Headers are copied as-is: the body is byte-identical, so Content-Length
    // stays correct. (A rewriting layer would have to strip it.)
    headers: new Headers(upstream.headers),
  });
}
