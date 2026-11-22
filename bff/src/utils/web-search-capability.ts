/**
 * T4.1a:从 prompt_config 计算公开联网能力位(分享页 / external-info)。
 *
 * 语义对齐前端 `hasWebSearchProvider`(web-search-api-key.ts):
 * - keyless provider(anysearch/youcom)选中即可用;
 * - 其余需非空对应 `*_api_key`;
 * - legacy:无 provider 字段但有非空 tavily_api_key → 视为 Tavily 可用;
 * - 显式 `web_search_provider: ''` 为清除态,不回落 Tavily。
 *
 * 本模块只产出布尔与公开元数据,绝不回传任何 API Key。
 */

const WEB_SEARCH_PROVIDERS = new Set<string>([
  'anysearch',
  'brave',
  'exa',
  'firecrawl',
  'keirolabs',
  'linkup',
  'parallel',
  'perplexity',
  'querit',
  'search1api',
  'searchapi',
  'serply',
  'tavily',
  'youcom',
]);

const KEYLESS_WEB_SEARCH_PROVIDERS = new Set<string>(['anysearch', 'youcom']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Resolve active provider (mirrors frontend getWebSearchProvider). */
export function resolveWebSearchProvider(
  promptConfig: unknown,
): string | undefined {
  const pc = asRecord(promptConfig);
  const raw = readString(pc, ['web_search_provider', 'webSearchProvider']);
  if (raw !== undefined && raw !== '' && WEB_SEARCH_PROVIDERS.has(raw)) {
    return raw;
  }
  // Explicit clear: do not fall back to legacy Tavily.
  if (raw === '') {
    return undefined;
  }
  const tavilyKey = readString(pc, ['tavily_api_key', 'tavilyApiKey']);
  if (typeof tavilyKey === 'string' && tavilyKey.trim()) {
    return 'tavily';
  }
  return undefined;
}

export function hasWebSearchProviderConfig(promptConfig: unknown): boolean {
  const provider = resolveWebSearchProvider(promptConfig);
  if (!provider) return false;
  if (KEYLESS_WEB_SEARCH_PROVIDERS.has(provider)) return true;
  const pc = asRecord(promptConfig);
  const keyField = `${provider}_api_key`;
  const camel =
    provider === 'search1api'
      ? 'search1apiApiKey'
      : `${provider}ApiKey`;
  const key = readString(pc, [keyField, camel]);
  return typeof key === 'string' && key.trim().length > 0;
}

export function hasTavilyKeyConfig(promptConfig: unknown): boolean {
  const pc = asRecord(promptConfig);
  const key = readString(pc, ['tavily_api_key', 'tavilyApiKey']);
  return typeof key === 'string' && key.trim().length > 0;
}

export type ExternalChatInfoData = {
  title: string;
  avatar?: string;
  prologue?: string;
  llm_id?: string;
  has_tavily_key: boolean;
  has_web_search_provider: boolean;
};

/**
 * Build the public chatbot/share info payload from session + prompt_config.
 * Never includes API keys.
 */
export function buildExternalChatInfoFromSession(input: {
  title?: string;
  promptConfig?: unknown;
  avatar?: string;
  prologue?: string;
  llmId?: string;
}): ExternalChatInfoData {
  const pc = asRecord(input.promptConfig);
  const prologue =
    input.prologue ??
    readString(pc, ['prologue']) ??
    '';
  return {
    title: input.title ?? '',
    avatar: input.avatar,
    prologue,
    llm_id: input.llmId ?? '',
    has_tavily_key: hasTavilyKeyConfig(input.promptConfig),
    has_web_search_provider: hasWebSearchProviderConfig(input.promptConfig),
  };
}

const WEB_SEARCH_SECRET_KEY_RE = /(_api_key|ApiKey)$/;

/**
 * 评审加固:从 prompt_config 去掉联网搜索密钥字段(含 snake/camel)。
 * 用于 listSessions 等宽面响应,降低批量泄漏面;getSession 详情仍可保留明文
 * 供设置页回填(T4.2 落地前过渡)。不修改入参对象。
 */
export function redactWebSearchSecretsFromPromptConfig(
  promptConfig: unknown,
): unknown {
  const pc = asRecord(promptConfig);
  if (!pc) return promptConfig;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pc)) {
    if (WEB_SEARCH_SECRET_KEY_RE.test(key)) continue;
    out[key] = value;
  }
  return out;
}
