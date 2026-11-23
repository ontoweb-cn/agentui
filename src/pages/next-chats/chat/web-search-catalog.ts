/**
 * 联网搜索 provider 目录(T2.2 单一来源)。
 *
 * 只承载"真实数据"——品牌名(不翻译,key 标签插值用)、图标、帮助链接。
 * 其余一律派生:prompt_config 字段名(`{base}_api_key`,见 web-search-api-key.ts)
 * 与语言键(`{base}ApiKeyTip`/`{base}ApiKeyMessage`)均由枚举值经
 * webSearchProviderBaseKey 派生。新增一个 provider 只需改三处:
 * `constants/chat.ts` 枚举 + 本 catalog + zh/en locale。
 */
import anysearchLogo from '@/assets/anysearch.webp';
import braveLogo from '@/assets/svg/brave.svg';
import exaLogo from '@/assets/exa.png';
import firecrawlLogo from '@/assets/firecrawl.png';
import keirolabsLogo from '@/assets/keirolabs.png';
import linkupLogo from '@/assets/linkup.png';
import parallelLogo from '@/assets/svg/parallel.svg';
import perplexityLogo from '@/assets/svg/perplexity.svg';
import queritLogo from '@/assets/querit.png';
import search1apiLogo from '@/assets/search1api.png';
import searchapiLogo from '@/assets/searchapi.png';
import serplyLogo from '@/assets/serply.png';
import tavilyLogo from '@/assets/svg/tavily.svg';
import youcomLogo from '@/assets/svg/youcom.svg';
import { WebSearchProvider } from '@/constants/chat';
import { webSearchProviderBaseKey } from './web-search-api-key';

export interface WebSearchProviderCatalogEntry {
  value: WebSearchProvider;
  /** 品牌名,保持原文不翻译(key 字段标签插值 provider 用)。 */
  name: string;
  logo: string;
  helpUrl: string;
}

export const webSearchProviderCatalog: WebSearchProviderCatalogEntry[] = [
  {
    value: WebSearchProvider.AnySearch,
    name: 'AnySearch',
    logo: anysearchLogo,
    helpUrl: 'https://anysearch.com/console/api-keys',
  },
  {
    value: WebSearchProvider.Brave,
    name: 'Brave Search',
    logo: braveLogo,
    helpUrl: 'https://brave.com/search/api/',
  },
  {
    value: WebSearchProvider.Exa,
    name: 'Exa',
    logo: exaLogo,
    helpUrl: 'https://dashboard.exa.ai/api-keys',
  },
  {
    value: WebSearchProvider.Firecrawl,
    name: 'Firecrawl',
    logo: firecrawlLogo,
    helpUrl: 'https://www.firecrawl.dev/app/api-keys',
  },
  {
    value: WebSearchProvider.Keirolabs,
    name: 'Keirolabs',
    logo: keirolabsLogo,
    helpUrl: 'https://www.keirolabs.cloud',
  },
  {
    value: WebSearchProvider.Linkup,
    name: 'Linkup',
    logo: linkupLogo,
    helpUrl: 'https://app.linkup.so',
  },
  {
    value: WebSearchProvider.Parallel,
    name: 'Parallel',
    logo: parallelLogo,
    helpUrl: 'https://platform.parallel.ai',
  },
  {
    value: WebSearchProvider.Perplexity,
    name: 'Perplexity',
    logo: perplexityLogo,
    helpUrl: 'https://www.perplexity.ai/account/api/keys',
  },
  {
    value: WebSearchProvider.Querit,
    name: 'Querit',
    logo: queritLogo,
    helpUrl: 'https://querit.ai',
  },
  {
    value: WebSearchProvider.Search1API,
    name: 'Search1API',
    logo: search1apiLogo,
    helpUrl: 'https://app.s1.dev',
  },
  {
    value: WebSearchProvider.SearchApi,
    name: 'SearchApi',
    logo: searchapiLogo,
    helpUrl: 'https://www.searchapi.io',
  },
  {
    value: WebSearchProvider.Serply,
    name: 'Serply',
    logo: serplyLogo,
    helpUrl: 'https://serply.io',
  },
  {
    value: WebSearchProvider.Tavily,
    name: 'Tavily',
    logo: tavilyLogo,
    helpUrl: 'https://app.tavily.com/home',
  },
  {
    value: WebSearchProvider.YouCom,
    name: 'You.com',
    logo: youcomLogo,
    helpUrl:
      'https://you.com/platform?utm_source=infiniflow-ragflow&utm_medium=oss_integration&utm_campaign=2026-08-oss-integrations&utm_content=app',
  },
];

const catalogByValue = new Map(
  webSearchProviderCatalog.map((entry) => [entry.value, entry]),
);

/** 按 provider 取目录条目;''(清除的选择)与 undefined 均视为未选。 */
export function getWebSearchProviderCatalogEntry(
  provider?: WebSearchProvider | '',
): WebSearchProviderCatalogEntry | undefined {
  const normalized = provider === '' ? undefined : provider;
  return normalized ? catalogByValue.get(normalized) : undefined;
}

/** 语言键派生:键名提示(anysearch → anysearchApiKeyTip)。 */
export function webSearchProviderTipKey(provider: WebSearchProvider): string {
  return `${webSearchProviderBaseKey(provider)}ApiKeyTip`;
}

/** 语言键派生:输入框占位(anysearch → anysearchApiKeyMessage)。 */
export function webSearchProviderPlaceholderKey(
  provider: WebSearchProvider,
): string {
  return `${webSearchProviderBaseKey(provider)}ApiKeyMessage`;
}
