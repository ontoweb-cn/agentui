import { MessageEventType } from '@/hooks/use-send-message';
import {
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
