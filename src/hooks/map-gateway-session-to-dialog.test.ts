import { mapGatewaySessionToDialog } from './map-gateway-session-to-dialog';

describe('mapGatewaySessionToDialog (review fix)', () => {
  it('reads prompt_config/kb_ids from metadata (T4.1a BFF shape)', () => {
    const dialog = mapGatewaySessionToDialog({
      id: 'sess-1',
      title: 'Demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      metadata: {
        prompt_config: {
          web_search_provider: 'exa',
          exa_api_key: 'exa-1',
          system: 'sys',
        },
        kb_ids: ['kb-a', 'kb-b'],
      },
    });
    expect(dialog.id).toBe('sess-1');
    expect(dialog.name).toBe('Demo');
    expect(dialog.dataset_ids).toEqual(['kb-a', 'kb-b']);
    expect(dialog.prompt_config).toMatchObject({
      web_search_provider: 'exa',
      exa_api_key: 'exa-1',
      system: 'sys',
    });
  });

  it('falls back to top-level prompt_config/kb_ids for legacy shapes', () => {
    const dialog = mapGatewaySessionToDialog({
      id: 'sess-2',
      title: 'Legacy',
      prompt_config: { system: 'top' },
      kb_ids: ['kb-top'],
    });
    expect(dialog.prompt_config).toMatchObject({ system: 'top' });
    expect(dialog.dataset_ids).toEqual(['kb-top']);
  });
});
