import { buildUpdateChatPatch } from './build-update-chat-patch';

describe('buildUpdateChatPatch', () => {
  it('always includes name/title', () => {
    expect(buildUpdateChatPatch({ name: 'demo' })).toEqual({
      name: 'demo',
      title: 'demo',
    });
  });

  it('includes empty dataset_ids so kb clear can be saved', () => {
    expect(
      buildUpdateChatPatch({ name: 'demo', dataset_ids: [] }),
    ).toEqual({
      name: 'demo',
      title: 'demo',
      kb_ids: [],
    });
  });

  it('omits kb_ids when dataset_ids is undefined', () => {
    expect(
      buildUpdateChatPatch({ name: 'demo', prompt_config: { system: 'x' } }),
    ).toEqual({
      name: 'demo',
      title: 'demo',
      prompt_config: { system: 'x' },
    });
  });

  it('includes non-empty dataset_ids and prompt_config', () => {
    expect(
      buildUpdateChatPatch({
        name: 'demo',
        dataset_ids: ['kb1'],
        prompt_config: { system: 'hi' },
      }),
    ).toEqual({
      name: 'demo',
      title: 'demo',
      kb_ids: ['kb1'],
      prompt_config: { system: 'hi' },
    });
  });
});
