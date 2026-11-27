// Canvas SSE wire-format compatibility layer.
//
// Python (rag-python) and Go (dsl-service) engines emit the same six-field
// envelope in principle. This layer enforces that at the BFF so the front end
// never has to care which engine served the run:
//
//   1. Frame-shape probe — a JSON payload carrying all six envelope fields is
//      passed through BYTE-FOR-BYTE. Event names alone are not a safe signal;
//      only the shape is.
//   2. Fallback mappings for the differences the engines really have:
//        - `cancelled`           → `workflow_finished{outputs:"Task has been canceled"}`
//        - `waiting_for_user`    → `user_inputs{inputs,tips}`
//        - duplicate `[DONE]`    → collapsed to exactly one terminator
//   3. Malformed frames are forwarded untouched and counted; nothing is ever
//      invented.
//
// Everything here is pure stream transformation: no I/O, no engine knowledge,
// no state beyond a frame counter.

/** The six fields every engine envelope carries. */
export const ENVELOPE_FIELDS = [
  'event',
  'message_id',
  'created_at',
  'session_id',
  'task_id',
  'data',
] as const;

/** Python's cancel wording, verbatim (intellect_dsl/canvas.py:1458-1466). */
export const CANCELLED_OUTPUTS = 'Task has been canceled';

/** Cap on a single un-terminated frame; beyond it the bytes are forwarded raw. */
const MAX_PENDING_FRAME_BYTES = 4 * 1024 * 1024;

export interface SseCompatStats {
  /** Frames forwarded without modification. */
  passthrough: number;
  /** Frames rewritten by a fallback mapping. */
  rewritten: number;
  /** Frames that were not usable envelopes (forwarded untouched). */
  malformed: number;
  /** Extra `[DONE]` terminators dropped. */
  droppedDone: number;
}

interface Envelope {
  event?: unknown;
  message_id?: unknown;
  created_at?: unknown;
  session_id?: unknown;
  task_id?: unknown;
  data?: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ENVELOPE_FIELDS.every((field) => field in record);
}

function envelopeOf(value: Envelope): Envelope {
  return {
    event: value.event,
    message_id: value.message_id,
    created_at: value.created_at,
    session_id: value.session_id,
    task_id: value.task_id,
    data: value.data,
  };
}

/**
 * Rewrite one decoded payload if it needs a fallback mapping. Returns the
 * payload to emit, or `null` when the frame should be dropped.
 */
function mapPayload(
  payload: unknown,
  stats: SseCompatStats,
): unknown | null {
  if (!isEnvelope(payload)) {
    // Not an envelope: forward as-is, but remember that it happened.
    stats.malformed += 1;
    return payload;
  }
  const envelope = envelopeOf(payload);

  if (envelope.event === 'cancelled') {
    stats.rewritten += 1;
    return { ...envelope, event: 'workflow_finished', data: { outputs: CANCELLED_OUTPUTS } };
  }

  if (envelope.event === 'waiting_for_user') {
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    stats.rewritten += 1;
    return {
      ...envelope,
      event: 'user_inputs',
      data: {
        ...(data.cpn_id !== undefined ? { cpn_id: data.cpn_id } : {}),
        ...(data.inputs !== undefined ? { inputs: data.inputs } : {}),
        ...(data.tips !== undefined ? { tips: data.tips } : {}),
      },
    };
  }

  stats.passthrough += 1;
  return payload;
}

/**
 * Split a raw SSE byte stream into frames, transform each payload, and
 * re-serialise. `[DONE]` terminators are normalised to exactly one.
 */
export function createSseCompatTransform(stats: SseCompatStats): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let sawDone = false;

  const flushFrame = (frame: string): string[] => {
    const lines = frame.split('\n').map((line) => line.replace(/\r$/, ''));
    const out: string[] = [];
    // SSE allows several `data:` lines per event; they concatenate with "\n"
    // (WHATWG EventSource). Only the first is trimmed of its leading space, per
    // the spec's "one leading space after the colon" rule.
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        // Every data line drops at most ONE leading space (spec rule).
        dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
        continue;
      }
      // Comments / event: / id: / retry: lines are preserved verbatim.
      out.push(line);
    }
    if (dataLines.length === 0) {
      return [frame];
    }
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') {
      if (sawDone) {
        stats.droppedDone += 1;
        return [];
      }
      sawDone = true;
      return ['data:[DONE]'];
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      stats.malformed += 1;
      return [frame];
    }
    const mapped = mapPayload(decoded, stats);
    if (mapped === null) return [];
    const serialised = JSON.stringify(mapped);
    const tail = out.length > 0 ? out.join('\n') + '\n' : '';
    return [tail + 'data: ' + serialised];
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      // A stream that never produces a frame delimiter would otherwise grow
      // without bound (upstream bug or hostile peer). Bound it: past the cap the
      // remainder is forwarded verbatim as one frame so the client still sees
      // every byte, and nothing is silently dropped.
      if (buffer.length > MAX_PENDING_FRAME_BYTES) {
        stats.malformed += 1;
        const overlong = buffer;
        buffer = '';
        controller.enqueue(encoder.encode(overlong + '\n\n'));
        return;
      }
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const emitted = flushFrame(frame);
        if (emitted.length > 0) {
          controller.enqueue(encoder.encode(emitted.join('\n\n') + '\n\n'));
        }
        boundary = buffer.indexOf('\n\n');
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      const rest = buffer.trim();
      if (rest === '') return;
      const emitted = flushFrame(rest);
      if (emitted.length > 0) {
        controller.enqueue(encoder.encode(emitted.join('\n\n') + '\n\n'));
      }
    },
  });
}

/** Convenience wrapper: pipe an upstream SSE Response through the layer. */
export function withSseCompat(upstream: Response, stats: SseCompatStats): Response {
  if (!upstream.body) return upstream;
  const headers = new Headers(upstream.headers);
  // The transform re-serialises frames (rewrites payloads, drops duplicate
  // terminators), so any upstream length is wrong by construction. Forwarding it
  // would truncate or hang the client response.
  headers.delete('content-length');
  return new Response(upstream.body.pipeThrough(createSseCompatTransform(stats)), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
