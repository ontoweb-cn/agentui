/**
 * Phase B 预备:Go StreamAgent SSE 事件 → BFF StreamChunk。
 * 真源:intellect-rag docs/develop/agent-go-port-design.md §11。
 *
 * **未接线** parseCanvasWorkflowSSE / 画布 live 路径。
 * 待 Go SSE 可探测且契约稳定后,由 phase-b-sse-adapter 批合入解析器。
 */

import type { StreamChunk, StreamDelta } from '../types/stream';

export type GoStreamAgentEventName =
  | 'message'
  | 'waiting_for_user'
  | 'error'
  | 'done';

/**
 * Map a single Go StreamAgent event (+ JSON data) to zero or more StreamChunks.
 * `waiting_for_user` → empty delta + metadata.waiting_for_user(cpn_id) for Layer 3 透传;
 * live UI 填表仍走前端 MessageEventType.UserInputs 适配(见 src/utils/go-canvas-sse-adapter.ts)。
 */
export function mapGoStreamAgentEventToChunks(
  event: string,
  data: Record<string, unknown> | undefined,
): StreamChunk[] {
  const payload = data ?? {};

  switch (event) {
    case 'message': {
      const content =
        (typeof payload.answer === 'string' && payload.answer) ||
        (typeof payload.content === 'string' && payload.content) ||
        '';
      const delta: StreamDelta & { metadata?: unknown } = {
        type: 'delta',
        content,
      };
      if (payload.reference !== undefined) {
        delta.metadata = { reference: payload.reference };
      }
      return [delta];
    }

    case 'waiting_for_user': {
      const cpnId =
        typeof payload.cpn_id === 'string' ? payload.cpn_id : undefined;
      const inputs =
        payload.inputs &&
        typeof payload.inputs === 'object' &&
        !Array.isArray(payload.inputs)
          ? payload.inputs
          : payload.user_inputs &&
              typeof payload.user_inputs === 'object' &&
              !Array.isArray(payload.user_inputs)
            ? payload.user_inputs
            : {};
      const tips =
        typeof payload.tips === 'string'
          ? payload.tips
          : typeof payload.message === 'string'
            ? payload.message
            : '';
      const delta: StreamDelta & { metadata?: unknown } = {
        type: 'delta',
        content: typeof payload.content === 'string' ? payload.content : '',
      };
      delta.metadata = {
        waiting_for_user: true,
        cpn_id: cpnId,
        inputs,
        tips,
      };
      return [delta];
    }

    case 'error': {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : typeof payload.message === 'string'
            ? payload.message
            : 'Go stream error';
      return [{ type: 'error', message }];
    }

    case 'done': {
      return [{ type: 'done' }];
    }

    default:
      return [];
  }
}
