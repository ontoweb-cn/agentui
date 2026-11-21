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
