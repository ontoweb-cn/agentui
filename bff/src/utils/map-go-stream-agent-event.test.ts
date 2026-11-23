import { describe, expect, it } from 'vitest';
import { mapGoStreamAgentEventToChunks } from './map-go-stream-agent-event';

describe('mapGoStreamAgentEventToChunks (phase-b prep)', () => {
  it('message: answer → delta content; reference in metadata', () => {
    expect(
      mapGoStreamAgentEventToChunks('message', {
        answer: 'hi',
        reference: [{ id: 1 }],
      }),
    ).toEqual([
      {
        type: 'delta',
        content: 'hi',
        metadata: { reference: [{ id: 1 }] },
      },
    ]);
  });

  it('waiting_for_user → delta + metadata (cpn_id/inputs/tips)', () => {
    expect(
      mapGoStreamAgentEventToChunks('waiting_for_user', {
        cpn_id: 'node:1',
        tips: 'hi',
        inputs: { q: 1 },
      }),
    ).toEqual([
      {
        type: 'delta',
        content: '',
        metadata: {
          waiting_for_user: true,
          cpn_id: 'node:1',
          inputs: { q: 1 },
          tips: 'hi',
        },
      },
    ]);
  });

  it('error / done', () => {
    expect(mapGoStreamAgentEventToChunks('error', { error: 'boom' })).toEqual([
      { type: 'error', message: 'boom' },
    ]);
    expect(mapGoStreamAgentEventToChunks('done', {})).toEqual([
      { type: 'done' },
    ]);
  });

  it('unknown event → []', () => {
    expect(mapGoStreamAgentEventToChunks('node_started', {})).toEqual([]);
  });
});
