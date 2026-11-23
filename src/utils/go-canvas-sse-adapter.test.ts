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

  it('unknown → empty', () => {
    expect(mapGoCanvasSseEvent('node_started', {})).toEqual({ events: [] });
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
