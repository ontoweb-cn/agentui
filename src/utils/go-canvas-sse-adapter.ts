/**
 * Phase B:Go StreamAgent 事件名 → 画布 MessageEventType 序列。
 * 真源:agent-go-port-design §11 + docs/phase-bc-frontend-alignment-prep.md。
 *
 * Live 入口:`adaptCanvasLiveSsePayload`,由 `useSendMessageBySSE` 调用。
 * Python 画布原事件名原样透传;只改写 Go 专有名(`waiting_for_user`/`done`/`error`/`cancelled`)
 * 以及仅带 `answer` 的 `message`。
 */

import { MessageEventType } from '@/hooks/message-event-type';

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

const NATIVE_CANVAS_EVENTS = new Set<string>([
  MessageEventType.WorkflowStarted,
  MessageEventType.NodeStarted,
  MessageEventType.NodeFinished,
  MessageEventType.Message,
  MessageEventType.MessageEnd,
  MessageEventType.WorkflowFinished,
  MessageEventType.UserInputs,
  MessageEventType.NodeLogs,
]);

export type AdaptCanvasLiveOptions = {
  /**
   * Go canvas appends `done` after `workflow_finished`. Expanding that
   * trailing `done` would emit a second end pair.
   */
  workflowFinishedSeen?: boolean;
};

/**
 * Normalize one canvas SSE JSON payload before it enters the live answer list.
 * Python event envelopes pass through. Go-only names expand into that envelope
 * (message_id / session_id / task_id kept). `error` is a toast, not a timeline event.
 * A `done` after `workflow_finished` is ignored.
 */
export function adaptCanvasLiveSsePayload(
  raw: unknown,
  options: AdaptCanvasLiveOptions = {},
): {
  events: unknown[];
  streamError?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { events: [raw] };
  }
  const record = raw as Record<string, unknown>;
  const eventName = typeof record.event === 'string' ? record.event : '';
  if (!eventName) {
    return { events: [raw] };
  }

  if (eventName === 'done' && options.workflowFinishedSeen) {
    return { events: [] };
  }

  if (eventName === MessageEventType.Message) {
    const data = asRecord(record.data) ?? {};
    if (typeof data.content !== 'string' && typeof data.answer === 'string') {
      return {
        events: [
          {
            ...record,
            data: {
              ...data,
              content: data.answer,
              audio_binary: data.audio_binary ?? '',
              outputs: data.outputs ?? {},
            },
          },
        ],
      };
    }
    return { events: [raw] };
  }

  if (NATIVE_CANVAS_EVENTS.has(eventName)) {
    return { events: [raw] };
  }

  const mapped = mapGoCanvasSseEvent(eventName, asRecord(record.data) ?? {});
  if (mapped.events.length === 0) {
    return mapped.streamError
      ? { events: [], streamError: mapped.streamError }
      : { events: [raw] };
  }
  return {
    events: mapped.events.map((ev) => ({
      ...record,
      event: ev.event,
      data: ev.data,
    })),
    streamError: mapped.streamError,
  };
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
