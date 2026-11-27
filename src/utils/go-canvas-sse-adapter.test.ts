import { MessageEventType } from '@/hooks/use-send-message';
import {
  adaptCanvasLiveSsePayload,
  mapGoCanvasSseEvent,
  mapGoCanvasSseEventToMessageEvents,
} from './go-canvas-sse-adapter';

describe('mapGoCanvasSseEvent (phase-b prep)', () => {
  it('maps message answer → Message', () => {
    expect(mapGoCanvasSseEvent('message', { answer: 'hi' })).toEqual({
      events: [
        {
          event: MessageEventType.Message,
          data: { content: 'hi', audio_binary: '', outputs: {} },
        },
      ],
    });
  });

  it('waiting_for_user passes through inputs/tips/cpn_id', () => {
    const out = mapGoCanvasSseEvent('waiting_for_user', {
      cpn_id: 'node:uf1',
      tips: 'fill me',
      inputs: { q1: { type: 'line', value: '' } },
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].event).toBe(MessageEventType.UserInputs);
    expect(out.events[0].data).toMatchObject({
      cpn_id: 'node:uf1',
      tips: 'fill me',
      inputs: { q1: { type: 'line', value: '' } },
    });
    expect(out.streamError).toBeUndefined();
  });

  it('keeps node and workflow events for the timeline', () => {
    for (const name of [
      'workflow_started',
      'node_started',
      'node_finished',
      'message_end',
      'workflow_finished',
    ] as const) {
      const out = mapGoCanvasSseEvent(name, { id: 'e2e-node' });
      expect(out.events).toEqual([
        { event: name, data: { id: 'e2e-node' } },
      ]);
      expect(out.streamError).toBeUndefined();
    }
  });

  it('maps cancelled to a finished timeline event', () => {
    const out = mapGoCanvasSseEvent('cancelled', { message: 'stopped' });
    expect(out.events[0].event).toBe(MessageEventType.WorkflowFinished);
    expect(out.events[0].data).toMatchObject({
      cancelled: true,
      message: 'stopped',
    });
  });

  it('waiting_for_user accepts user_inputs alias', () => {
    const out = mapGoCanvasSseEvent('waiting_for_user', {
      user_inputs: { a: 1 },
    });
    expect(out.events[0].data.inputs).toEqual({ a: 1 });
  });

  it('maps done → MessageEnd + WorkflowFinished', () => {
    const out = mapGoCanvasSseEvent('done', {});
    expect(out.events.map((x) => x.event)).toEqual([
      MessageEventType.MessageEnd,
      MessageEventType.WorkflowFinished,
    ]);
  });

  it('error → empty events + streamError (must use error channel)', () => {
    expect(mapGoCanvasSseEvent('error', { error: 'boom' })).toEqual({
      events: [],
      streamError: 'boom',
    });
    expect(mapGoCanvasSseEvent('error', {})).toEqual({
      events: [],
      streamError: 'Go stream error',
    });
  });

  it('unknown names stay empty', () => {
    expect(mapGoCanvasSseEvent('node_logs', {})).toEqual({ events: [] });
  });
});

describe('mapGoCanvasSseEventToMessageEvents (compat)', () => {
  it('returns events only (drops streamError — not for live error path)', () => {
    expect(
      mapGoCanvasSseEventToMessageEvents('error', { error: 'x' }),
    ).toEqual([]);
    expect(
      mapGoCanvasSseEventToMessageEvents('message', { content: 'c' })[0]
        .event,
    ).toBe(MessageEventType.Message);
  });
});

describe('adaptCanvasLiveSsePayload', () => {
  const envelope = {
    message_id: 'm1',
    session_id: 's1',
    created_at: 1,
    task_id: 't1',
  };

  it('passes Python node_started through unchanged', () => {
    const raw = {
      ...envelope,
      event: 'node_started',
      data: { component_id: 'begin' },
    };
    expect(adaptCanvasLiveSsePayload(raw)).toEqual({ events: [raw] });
  });

  it('copies Go message.answer into content and keeps the envelope', () => {
    const out = adaptCanvasLiveSsePayload({
      ...envelope,
      event: 'message',
      data: { answer: 'hi' },
    });
    expect(out.events).toEqual([
      {
        ...envelope,
        event: MessageEventType.Message,
        data: { answer: 'hi', content: 'hi', audio_binary: '', outputs: {} },
      },
    ]);
  });

  it('maps waiting_for_user onto the fill-up event', () => {
    const out = adaptCanvasLiveSsePayload({
      ...envelope,
      event: 'waiting_for_user',
      data: { cpn_id: 'n1', tips: 'fill', inputs: { q: 1 } },
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({
      message_id: 'm1',
      task_id: 't1',
      event: MessageEventType.UserInputs,
      data: { cpn_id: 'n1', tips: 'fill', inputs: { q: 1 } },
    });
  });

  it('expands done into message_end and workflow_finished', () => {
    const out = adaptCanvasLiveSsePayload({
      ...envelope,
      event: 'done',
      data: {},
    });
    expect(out.events.map((ev) => (ev as { event: string }).event)).toEqual([
      MessageEventType.MessageEnd,
      MessageEventType.WorkflowFinished,
    ]);
  });

  it('ignores trailing done after workflow_finished', () => {
    expect(
      adaptCanvasLiveSsePayload(
        { ...envelope, event: 'done', data: {} },
        { workflowFinishedSeen: true },
      ),
    ).toEqual({ events: [] });
  });

  it('maps cancelled to workflow_finished with cancelled=true', () => {
    const out = adaptCanvasLiveSsePayload({
      ...envelope,
      event: 'cancelled',
      data: { message: 'stopped' },
    });
    expect(out.events[0]).toMatchObject({
      event: MessageEventType.WorkflowFinished,
      data: { message: 'stopped', cancelled: true },
    });
  });

  it('sends Go error to the toast channel and not the timeline', () => {
    expect(
      adaptCanvasLiveSsePayload({
        ...envelope,
        event: 'error',
        data: { error: 'boom' },
      }),
    ).toEqual({ events: [], streamError: 'boom' });
  });
});
