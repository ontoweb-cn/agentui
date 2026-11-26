/**
 * Phase B 预备:Go StreamAgent 事件名 → 画布 MessageEventType 序列。
 * 真源:agent-go-port-design §11 + docs/phase-bc-frontend-alignment-prep.md。
 *
 * **未接线** useSendMessageBySSE / canvas-plugin live 路径(L-PHASEB-01)。
 */

import { MessageEventType } from '@/hooks/use-send-message';

export type GoCanvasMappedEvent = {
  event: MessageEventType;
  data: Record<string, unknown>;
};

export type GoCanvasSseMapResult = {
  events: GoCanvasMappedEvent[];
  /**
   * Go `error` 事件无 MessageEventType 对应项;合入 live 时调用方必须走
   * 流错误通道(toast / StreamError),不得忽略本字段。
   */
  streamError?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Prefer Go payload inputs; accept aliases used in fillup / design drafts. */
function resolveUserInputs(payload: Record<string, unknown>): Record<string, unknown> {
  const direct = asRecord(payload.inputs);
  if (direct) return direct;
  const alias = asRecord(payload.user_inputs) ?? asRecord(payload.fields);
  return alias ?? {};
}

function resolveTips(payload: Record<string, unknown>): string {
  if (typeof payload.tips === 'string') return payload.tips;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.tip === 'string') return payload.tip;
  return '';
}

function resolveStreamErrorMessage(payload: Record<string, unknown>): string {
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return 'Go stream error';
}

/**
 * Expand one Go SSE event into RAGFlow-style message events plus optional
 * streamError for the error channel.
 */
export function mapGoCanvasSseEvent(
  goEvent: string,
  payload: Record<string, unknown> = {},
): GoCanvasSseMapResult {
  switch (goEvent) {
    case 'message': {
      const content =
        (typeof payload.answer === 'string' && payload.answer) ||
        (typeof payload.content === 'string' && payload.content) ||
        '';
      return {
        events: [
          {
            event: MessageEventType.Message,
            data: {
              content,
              audio_binary: '',
              outputs: payload.outputs ?? {},
            },
          },
        ],
      };
    }

    case 'waiting_for_user': {
      const inputs = resolveUserInputs(payload);
      const tips = resolveTips(payload);
      const content =
        typeof payload.content === 'string' ? payload.content : '';
      return {
        events: [
          {
            event: MessageEventType.UserInputs,
            data: {
              content,
              inputs,
              tips,
              cpn_id: payload.cpn_id,
            },
          },
        ],
      };
    }

    case 'workflow_started':
    case 'node_started':
    case 'node_finished':
    case 'message_end':
    case 'workflow_finished':
      return {
        events: [
          {
            event: goEvent as MessageEventType,
            data: payload,
          },
        ],
      };

    case 'cancelled':
      return {
        events: [
          {
            event: MessageEventType.WorkflowFinished,
            data: { ...payload, cancelled: true },
          },
        ],
      };

    case 'done': {
      return {
        events: [
          {
            event: MessageEventType.MessageEnd,
            data: {
              reference: payload.reference ?? {},
            },
          },
          {
            event: MessageEventType.WorkflowFinished,
            data: {},
          },
        ],
      };
    }

    case 'error':
      return {
        events: [],
        streamError: resolveStreamErrorMessage(payload),
      };

    default:
      return { events: [] };
  }
}

/**
 * @deprecated Prefer `mapGoCanvasSseEvent` (preserves streamError). Kept for
 * call sites that only need the event list; **drops** error channel — do not
 * use for live wiring without handling `streamError`.
 */
export function mapGoCanvasSseEventToMessageEvents(
  goEvent: string,
  payload: Record<string, unknown> = {},
): GoCanvasMappedEvent[] {
  return mapGoCanvasSseEvent(goEvent, payload).events;
}
