/**
 * T2.7:agent session PATCH 的 prompt_config 联网搜索校验(服务端镜像)。
 *
 * 语义与前端 src/pages/next-chats/chat/web-search-api-key.ts 的
 * missingWebSearchApiKeyField 对齐——前端 zod superRefine 可被直接 HTTP 调用
 * 绕过(质量评审"中"项),BFF 在透传 Gateway 前叠加同一规则:
 * 1. web_search_provider 必须是合法枚举值或 ''/缺失(清除态);
 * 2. 选了需 key 的 provider 却没有非空 key → 拒绝;
 * 3. keyless provider(anysearch/youcom)与 legacy 数据(无 provider 仅
 *    tavily_api_key)不受影响。
 *
 * 键名兼容:与 PATCH 路由同口径,snake_case 为主形态、camelCase 兼容
 * (前端 axios 拦截器有 camel→snake 转换,防御性双读)。
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

// 无凭据可用模式的 provider:无 key 也合法(AnySearch 匿名端点 / You.com
// keyless 端点),与前端 KEYLESS_WEB_SEARCH_PROVIDERS 保持一致。
const KEYLESS_WEB_SEARCH_PROVIDERS = new Set<string>(['anysearch', 'youcom']);

function readString(obj: unknown, keys: string[]): unknown {
  const record = obj as Record<string, unknown> | undefined;
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

export type WebSearchPromptConfigResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * 校验 prompt_config 中的联网搜索配置。非法返回 { ok:false, message }
 * (PATCH 路由据此返回 400);promptConfig 缺失/非对象一律放行(交由
 * 既有透传语义处理)。
 */
export function validateWebSearchPromptConfig(
  promptConfig: unknown,
): WebSearchPromptConfigResult {
  if (
    promptConfig === undefined ||
    promptConfig === null ||
    typeof promptConfig !== 'object'
  ) {
    return { ok: true };
  }

  const rawProvider = readString(promptConfig, [
    'web_search_provider',
    'webSearchProvider',
  ]);
  if (
    rawProvider !== undefined &&
    rawProvider !== '' &&
    (typeof rawProvider !== 'string' || !WEB_SEARCH_PROVIDERS.has(rawProvider))
  ) {
    return {
      ok: false,
      message: `unknown web_search_provider: ${String(rawProvider)}`,
    };
  }

  const provider =
    typeof rawProvider === 'string' && rawProvider !== ''
      ? rawProvider
      : undefined;
  if (!provider || KEYLESS_WEB_SEARCH_PROVIDERS.has(provider)) {
    return { ok: true };
  }

  const keyField = `${provider}_api_key`;
  const key = readString(promptConfig, [keyField, `${provider}ApiKey`]);
  if (typeof key !== 'string' || !key.trim()) {
    return {
      ok: false,
      message: `missing or empty API key field: ${keyField} for provider ${provider}`,
    };
  }
  return { ok: true };
}

/** snake / camel 形态的 provider key 字段名 */
function providerKeyFields(provider: string): string[] {
  const snake = `${provider}_api_key`;
  const camel =
    provider.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) + 'ApiKey';
  // search1api → search1apiApiKey(无下划线时 camel 与 `${provider}ApiKey` 相同)
  return Array.from(new Set([snake, `${provider}ApiKey`, camel]));
}

function isProviderKeyField(field: string): boolean {
  if (/_api_key$/i.test(field)) {
    const provider = field.slice(0, -'_api_key'.length).toLowerCase();
    return WEB_SEARCH_PROVIDERS.has(provider);
  }
  if (/ApiKey$/.test(field)) {
    const base = field.slice(0, -'ApiKey'.length).toLowerCase();
    return WEB_SEARCH_PROVIDERS.has(base);
  }
  return false;
}

/**
 * T4.1a / T2.4:存储侧按活动 provider 过滤联网搜索 key。
 * - 有活动 provider:仅保留该 provider 的 key 字段(keyless 则剥离全部 key)
 * - provider 为 ''(清除):剥离全部已知 provider key
 * - 无 provider 但有 legacy tavily_api_key:仅保留 tavily key
 * - 非 key 字段原样保留
 * 返回新对象,不修改入参。
 */
export function sanitizePromptConfigWebSearchKeys(
  promptConfig: unknown,
): unknown {
  if (
    promptConfig === undefined ||
    promptConfig === null ||
    typeof promptConfig !== 'object' ||
    Array.isArray(promptConfig)
  ) {
    return promptConfig;
  }

  const src = promptConfig as Record<string, unknown>;
  const rawProvider = readString(src, [
    'web_search_provider',
    'webSearchProvider',
  ]);

  let allowedKeyFields: Set<string> | null = null;
  if (rawProvider === '') {
    allowedKeyFields = new Set();
  } else if (typeof rawProvider === 'string' && WEB_SEARCH_PROVIDERS.has(rawProvider)) {
    allowedKeyFields = KEYLESS_WEB_SEARCH_PROVIDERS.has(rawProvider)
      ? new Set()
      : new Set(providerKeyFields(rawProvider));
  } else {
    // legacy:无 provider 时仅保留 tavily
    const hasTavily =
      typeof readString(src, ['tavily_api_key', 'tavilyApiKey']) === 'string';
    allowedKeyFields = hasTavily
      ? new Set(providerKeyFields('tavily'))
      : new Set();
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (isProviderKeyField(key)) {
      if (allowedKeyFields.has(key)) {
        out[key] = value;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * 分享页聚合位:任一可用 provider 配置即 true。
 * - keyless provider 已选 → true
 * - keyed provider 有非空 key → true
 * - legacy 仅 tavily_api_key → true
 */
export function computeHasWebSearchProvider(promptConfig: unknown): boolean {
  if (
    promptConfig === undefined ||
    promptConfig === null ||
    typeof promptConfig !== 'object'
  ) {
    return false;
  }
  const rawProvider = readString(promptConfig, [
    'web_search_provider',
    'webSearchProvider',
  ]);
  if (typeof rawProvider === 'string' && rawProvider !== '') {
    if (!WEB_SEARCH_PROVIDERS.has(rawProvider)) {
      return false;
    }
    if (KEYLESS_WEB_SEARCH_PROVIDERS.has(rawProvider)) {
      return true;
    }
    const key = readString(promptConfig, providerKeyFields(rawProvider));
    return typeof key === 'string' && key.trim().length > 0;
  }
  const tavily = readString(promptConfig, ['tavily_api_key', 'tavilyApiKey']);
  return typeof tavily === 'string' && tavily.trim().length > 0;
}
