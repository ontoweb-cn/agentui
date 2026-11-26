/**
 * Provenance: ported from upstream RAGFlow web/ (base 91c702e)。
 * T2.2 适配:字段映射由手写字面量改为枚举派生(webSearchProviderBaseKey),
 * 与表单语言键同源;其余逻辑与上游零漂移。
 * 同步策略见 docs/ragflow-ui-improvement-recommendations.md;T3.6 子树同步机制落地后随上游自动跟进。
 */
import {
  KEYLESS_WEB_SEARCH_PROVIDERS,
  WebSearchProvider,
} from '@/constants/chat';

/**
 * The subset of a dialog's prompt_config these helpers read — the web-search
 * provider and its per-provider key slots.
 *
 * Structural rather than PromptConfig because the save-time form schema allows
 * web_search_provider to be '' (a cleared select), which PromptConfig does not;
 * with this shape the schema can call the helpers without casting.
 */
export type WebSearchKeyConfig = {
  web_search_provider?: WebSearchProvider | '';
  tavily_api_key?: string;
};

const WEB_SEARCH_PROVIDERS: WebSearchProvider[] =
  Object.values(WebSearchProvider);

export function getWebSearchProvider(promptConfig?: WebSearchKeyConfig) {
  const provider = promptConfig?.web_search_provider;

  // Derived from the enum instead of a hand-written union: a provider added to the
  // enum — and therefore to the dropdown — used to be silently treated as
  // unconfigured here until someone remembered to extend the list too, which
  // disabled its Internet switch with no error.
  if (
    provider !== undefined &&
    provider !== '' &&
    WEB_SEARCH_PROVIDERS.includes(provider)
  ) {
    return provider;
  }

  // undefined means the dialog predates provider selection, which is where the
  // legacy Tavily key comes in. '' is an explicit "no provider" (cleared select)
  // and must NOT fall back to Tavily.
  if (
    provider === undefined &&
    typeof promptConfig?.tavily_api_key === 'string' &&
    promptConfig.tavily_api_key.trim()
  ) {
    return WebSearchProvider.Tavily;
  }

  return undefined;
}

// Enum value → 键基元:首字母小写化。14 个 provider 全部符合该模式——
// Search1API→search1api、SearchApi→searchapi、YouCom→youcom(T2.2 派生规律,
// 上游 catalog/语言键均按此命名,故可用派生替代三份手写映射)。
export function webSearchProviderBaseKey(provider: WebSearchProvider): string {
  return provider.charAt(0).toLowerCase() + provider.slice(1);
}

// The prompt_config field each provider reads its key from. T2.2 单一来源:
// 字段名不再手写——由枚举值派生(base key + '_api_key'),与表单语言键共用
// 同一派生规律;新增 provider 只需改 枚举 + web-search-catalog + locale 三处。
// 消费方:表单字段名/必填标记/读取器三处此前各自手写,现同源于此。
const webSearchApiKeyFields: Record<WebSearchProvider, string> =
  Object.fromEntries(
    Object.values(WebSearchProvider).map((provider) => [
      provider,
      `${webSearchProviderBaseKey(provider)}_api_key`,
    ]),
  ) as Record<WebSearchProvider, string>;

// A cleared SelectWithSearch emits '' rather than undefined (the schema accepts
// both), so normalise it here: the field lookup and the required marker have to
// agree on what "no provider selected" means.
function normalizeProvider(provider?: WebSearchProvider | '') {
  return provider === '' ? undefined : provider;
}

// Reads a prompt_config field the app names at runtime (the per-provider key
// slots), which no static type can enumerate.
function fieldValue(
  promptConfig: WebSearchKeyConfig | undefined,
  field: string,
) {
  return (promptConfig as unknown as Record<string, unknown> | undefined)?.[
    field
  ];
}

export function getWebSearchApiKeyField(provider?: WebSearchProvider | '') {
  const normalized = normalizeProvider(provider);
  return normalized ? webSearchApiKeyFields[normalized] : undefined;
}

// Whether the selected provider must have a key before it can be used. A
// keyless provider answers on its own endpoint/tier and stays usable blank.
export function isWebSearchApiKeyRequired(provider?: WebSearchProvider | '') {
  const normalized = normalizeProvider(provider);
  return (
    normalized !== undefined &&
    !KEYLESS_WEB_SEARCH_PROVIDERS.includes(normalized)
  );
}

export function getWebSearchApiKey(promptConfig?: WebSearchKeyConfig) {
  const keyField = getWebSearchApiKeyField(getWebSearchProvider(promptConfig));
  if (!keyField) {
    return undefined;
  }

  const apiKey = fieldValue(promptConfig, keyField);
  return typeof apiKey === 'string' ? apiKey.trim() : undefined;
}

/**
 * Returns the prompt_config field of the selected provider's API key when the
 * provider requires one and it is missing or blank — the reason a save has to be
 * rejected. A keyed provider without a key fails SILENTLY at runtime (the Internet
 * switch never appears), which is why the form blocks it up front. undefined means
 * the configuration is acceptable.
 *
 * Pure and exported so the save-time rule is testable without rendering the form.
 */
export function missingWebSearchApiKeyField(
  promptConfig?: WebSearchKeyConfig,
  configuredProviders: Iterable<string> = [],
) {
  const provider = getWebSearchProvider(promptConfig);
  const keyField = getWebSearchApiKeyField(provider);
  if (!keyField || !isWebSearchApiKeyRequired(provider)) {
    return undefined;
  }
  // M3: Gateway already holds a secret for this provider; blank input means
  // "keep existing" rather than "missing".
  if (new Set(configuredProviders).has(provider!)) {
    return undefined;
  }

  const apiKey = fieldValue(promptConfig, keyField);
  return typeof apiKey === 'string' && apiKey.trim() ? undefined : keyField;
}

/**
 * Whether web search is usable as configured. Most providers need a key; a
 * keyless provider is usable as soon as it is selected.
 */
export function hasWebSearchProvider(
  promptConfig?: WebSearchKeyConfig,
  configuredProviders: Iterable<string> = [],
) {
  const provider = getWebSearchProvider(promptConfig);

  if (provider === undefined) {
    return false;
  }
  if (KEYLESS_WEB_SEARCH_PROVIDERS.includes(provider)) {
    return true;
  }
  if (new Set(configuredProviders).has(provider)) {
    return true;
  }

  return Boolean(getWebSearchApiKey(promptConfig));
}
