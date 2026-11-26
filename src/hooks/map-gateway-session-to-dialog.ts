import type { IDialog } from '@/interfaces/database/chat';

/**
 * 将 Gateway / BFF Session 响应映射为 IDialog 形状。
 * BFF Session 顶栏为 id/agentId/title/timestamps;T4.1a 起 prompt_config/kb_ids
 * 在 metadata 透传(评审修复:此前只读顶栏导致设置页永远回落默认空配置)。
 */
export function mapGatewaySessionToDialog(s: any): IDialog {
  const meta =
    s?.metadata && typeof s.metadata === 'object' ? s.metadata : undefined;
  const promptConfig =
    meta?.prompt_config ?? meta?.promptConfig ?? s?.prompt_config;
  const configuredProviders =
    meta?.web_search_configured_providers ??
    meta?.webSearchConfiguredProviders ??
    s?.web_search_configured_providers;
  const rawKbIds = meta?.kb_ids ?? meta?.kbIds ?? s?.kb_ids;
  const datasetIds = Array.isArray(rawKbIds)
    ? rawKbIds
    : (() => {
        try {
          return JSON.parse(rawKbIds || '[]');
        } catch {
          return [];
        }
      })();
  return {
    id: String(s.id ?? ''),
    name: s.title || s.name || 'New Chat',
    description: '',
    icon: '',
    dataset_ids: datasetIds,
    kb_names: [],
    language: 'English',
    llm_id: '',
    llm_setting: {},
    web_search_configured_providers: Array.isArray(configuredProviders)
      ? configuredProviders.filter(
          (value: unknown): value is string => typeof value === 'string',
        )
      : [],
    prompt_config: promptConfig || {
      empty_response: '',
      parameters: [],
      prologue: '',
      system: '',
      quote: false,
      keyword: false,
      refine_multiturn: false,
      use_kg: false,
    },
    prompt_type: 'simple',
    status: 'VALID',
    tenant_id: '',
    create_date: s.createdAt || s.created_at || '',
    update_date: s.updatedAt || s.updated_at || '',
    create_time: 0,
    update_time: 0,
    vector_similarity_weight: 0,
    similarity_threshold: 0,
    top_k: 0,
    top_n: 0,
    meta_data_filter: { manual: [], method: '' },
    source: 'gateway' as const,
  };
}
