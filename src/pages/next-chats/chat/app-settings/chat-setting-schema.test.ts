/**
 * Provenance: ported from upstream RAGFlow web/ chat-setting-schema.test.ts
 * (base 91c702e)。agentui 取舍:BaseValues 按本仓 schema 字段(use_kg/tts/
 * vector_similarity_weight/top_k),无 agentic_rag 断言(agentui 无该字段)。
 */
import { WebSearchProvider } from '@/constants/chat';
import { buildChatSettingFormSchema } from './use-chat-setting-schema';

const t = (key: string) => key;

const BaseValues = {
  name: 'assistant',
  icon: '',
  dataset_ids: [] as string[],
  prompt_config: {
    quote: true,
    keyword: false,
    tts: false,
    refine_multiturn: true,
    use_kg: false,
    system: 'Answer using {knowledge}',
    parameters: [] as Array<{ key: string; optional: boolean }>,
  },
  similarity_threshold: 0.2,
  vector_similarity_weight: 0.2,
  llm_setting: {},
  meta_data_filter: { method: 'disabled', manual: [] },
};

function parseSettings(
  promptConfig: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  const schema = buildChatSettingFormSchema(t);
  return schema.safeParse({
    ...BaseValues,
    ...overrides,
    prompt_config: { ...BaseValues.prompt_config, ...promptConfig },
  });
}

describe('buildChatSettingFormSchema', () => {
  it('rejects a blank system prompt', () => {
    const result = parseSettings({ system: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['prompt_config', 'system'],
        message: 'systemMessage',
      }),
    );
  });

  it('flags a system prompt missing {knowledge} when datasets are selected', () => {
    const result = parseSettings(
      { system: 'answer the question' },
      { dataset_ids: ['kb1'] },
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['prompt_config', 'system'],
        message: 'knowledgePlaceholderMessage',
      }),
    );
  });

  it('accepts the default KB-bound prompt that keeps {knowledge}', () => {
    const result = parseSettings({}, { dataset_ids: ['kb1'] });
    expect(result.success).toBe(true);
  });

  it('rejects blank variable keys', () => {
    const parameters = [{ key: '', optional: true }];
    const result = parseSettings({ parameters });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['prompt_config', 'parameters', 0, 'key'],
        message: 'variableKeyMessage',
      }),
    );
  });

  it('requires the web search API key', () => {
    const result = parseSettings({
      web_search_provider: WebSearchProvider.Tavily,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['prompt_config', 'tavily_api_key'],
        message: 'webSearchApiKeyRequired',
      }),
    );
  });

  it('rejects a blank assistant name', () => {
    const result = parseSettings({}, { name: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['name'],
        message: 'assistantNameMessage',
      }),
    );
  });
});
