/**
 * T4.1a:从 prompt_config 计算公开联网能力位(分享页 / external-info)。
 *
 * 语义对齐前端 `hasWebSearchProvider`(web-search-api-key.ts):
 * - keyless provider(anysearch/youcom)选中即可用;
 * - 其余需非空对应 `*_api_key`;
 * - legacy:**仅当 provider 字段缺省(undefined)** 且有非空 tavily_api_key → Tavily;
 * - 显式 `''` 或非法/非允许列表值均不回落 Tavily(与前端 getWebSearchProvider 一致)。
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

/**
 * Resolve active provider (mirrors frontend `getWebSearchProvider`).
 * Legacy Tavily fallback **only** when the field is absent (`undefined`).
 * Explicit `''` = cleared; non-empty unknown values are not Tavily.
 */
export function resolveWebSearchProvider(
  promptConfig: unknown,
): string | undefined {
  const pc = asRecord(promptConfig);
  const raw = readString(pc, ['web_search_provider', 'webSearchProvider']);
  if (raw !== undefined && raw !== '' && WEB_SEARCH_PROVIDERS.has(raw)) {
    return raw;
  }
  // Explicit clear or invalid/non-allowlist value: do not fall back.
  if (raw !== undefined) {
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

/**
 * listSessions 宽面脱敏:剥顶层与 metadata 内 prompt_config / promptConfig 的密钥。
 * 不修改入参;getSession 详情路径不要调用(设置页仍需明文回填,见 T4.2)。
 */
export function redactSessionWebSearchSecrets<T extends object>(session: T): T {
  const src = session as Record<string, unknown>;
  const next: Record<string, unknown> = { ...src };

  if ('prompt_config' in next) {
    next.prompt_config = redactWebSearchSecretsFromPromptConfig(
      next.prompt_config,
    );
  }
  if ('promptConfig' in next) {
    next.promptConfig = redactWebSearchSecretsFromPromptConfig(
      next.promptConfig,
    );
  }

  const meta = asRecord(next.metadata);
  if (meta) {
    const metaOut: Record<string, unknown> = { ...meta };
    if ('prompt_config' in metaOut) {
      metaOut.prompt_config = redactWebSearchSecretsFromPromptConfig(
        metaOut.prompt_config,
      );
    }
    if ('promptConfig' in metaOut) {
      metaOut.promptConfig = redactWebSearchSecretsFromPromptConfig(
        metaOut.promptConfig,
      );
    }
    next.metadata = metaOut;
  }

  return next as T;
}
