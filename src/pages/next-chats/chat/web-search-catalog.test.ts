/**
 * TC-RP1-07(T2.2 验收):catalog 完备性 + 派生一致性守卫。
 * 保证"新增 provider 只需改 枚举 + catalog + locale 三处"的约定可执行——
 * 少改任何一处都会在这里红。
 */
import en from '@/locales/en';
import zh from '@/locales/zh';
import { WebSearchProvider } from '@/constants/chat';
import {
  getWebSearchApiKeyField,
  webSearchProviderBaseKey,
} from './web-search-api-key';
import {
  webSearchProviderCatalog,
  webSearchProviderPlaceholderKey,
  webSearchProviderTipKey,
} from './web-search-catalog';

const ALL_PROVIDERS = Object.values(WebSearchProvider);

const enChat = (en.translation as Record<string, unknown>).chat as Record<
  string,
  unknown
>;
const zhChat = (zh.translation as Record<string, unknown>).chat as Record<
  string,
  unknown
>;

describe('web-search catalog (T2.2 单一来源守卫)', () => {
  it('catalog 与 WebSearchProvider 枚举一一对应(不多不少)', () => {
    expect(new Set(webSearchProviderCatalog.map((e) => e.value))).toEqual(
      new Set(ALL_PROVIDERS),
    );
    expect(webSearchProviderCatalog).toHaveLength(ALL_PROVIDERS.length);
  });

  it('每个条目的 name/logo/helpUrl 非空', () => {
    for (const entry of webSearchProviderCatalog) {
      expect(entry.name.trim()).not.toBe('');
      expect(entry.logo).toBeTruthy();
      expect(entry.helpUrl.trim()).toMatch(/^https?:\/\//);
    }
  });

  it('枚举派生的 key 字段名与 getWebSearchApiKeyField 全量一致', () => {
    for (const provider of ALL_PROVIDERS) {
      expect(getWebSearchApiKeyField(provider)).toBe(
        `${webSearchProviderBaseKey(provider)}_api_key`,
      );
    }
  });

  it('派生的 Tip/Message 语言键在 zh 与 en 的 chat 命名空间全部存在', () => {
    for (const provider of ALL_PROVIDERS) {
      const tip = webSearchProviderTipKey(provider);
      const placeholder = webSearchProviderPlaceholderKey(provider);
      for (const chat of [enChat, zhChat]) {
        expect(chat[tip]).toBeTruthy();
        expect(chat[placeholder]).toBeTruthy();
      }
    }
  });

  it('键基元派生规律:Search1API/SearchApi/YouCom 等非常规大小写同样成立', () => {
    expect(webSearchProviderBaseKey(WebSearchProvider.Search1API)).toBe(
      'search1api',
    );
    expect(webSearchProviderBaseKey(WebSearchProvider.SearchApi)).toBe(
      'searchapi',
    );
    expect(webSearchProviderBaseKey(WebSearchProvider.YouCom)).toBe('youcom');
    expect(webSearchProviderBaseKey(WebSearchProvider.AnySearch)).toBe(
      'anysearch',
    );
  });
});
