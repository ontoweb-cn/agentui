import { LanguageAbbreviation } from '@/constants/common';
import { collectI18nLazy } from '@/features/_registry';
import storage from '@/utils/authorization-util';
import dayjs from 'dayjs';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { upperFirst } from 'lodash';
import { initReactI18next } from 'react-i18next';
import translation_en from './en';

// 语言选择优先级:localStorage(用户已选)> 浏览器 navigator.language(手动映射)>
// VITE_DEFAULT_LANGUAGE_CODE(默认 'en')。
// 浏览器语言映射在 initLanguage() 中处理,因 i18next 默认不做 'zh-CN' → 'zh-Hans'
// 的模糊匹配,会导致中文浏览器 fallback 到 'en'。

const languageImports: Record<string, () => Promise<{ default: any }>> = {
  [LanguageAbbreviation.En]: () => import('./en'),
  [LanguageAbbreviation.Zh]: () => import('./zh'),
  [LanguageAbbreviation.ZhTraditional]: () => import('./zh-traditional'),
  [LanguageAbbreviation.Id]: () => import('./id'),
  [LanguageAbbreviation.Ja]: () => import('./ja'),
  [LanguageAbbreviation.Es]: () => import('./es'),
  [LanguageAbbreviation.Vi]: () => import('./vi'),
  [LanguageAbbreviation.Ru]: () => import('./ru'),
  [LanguageAbbreviation.PtBr]: () => import('./pt-br'),
  [LanguageAbbreviation.De]: () => import('./de'),
  [LanguageAbbreviation.Fr]: () => import('./fr'),
  [LanguageAbbreviation.It]: () => import('./it'),
  [LanguageAbbreviation.Bg]: () => import('./bg'),
  [LanguageAbbreviation.Ar]: () => import('./ar'),
  [LanguageAbbreviation.Tr]: () => import('./tr'),
  [LanguageAbbreviation.Ko]: () => import('./ko'),
};

const supportedLanguageCodes: Intl.UnicodeBCP47LocaleIdentifier[] =
  Object.keys(languageImports);

export const supportedLanguages = supportedLanguageCodes.map((code) => {
  const locale = new Intl.Locale(code);

  return {
    code,
    locale,
    displayName: upperFirst(
      new Intl.DisplayNames(locale, { type: 'language' }).of(code)!,
    ),
  };
});

export const DEFAULT_LANGUAGE_CODE =
  import.meta.env.VITE_DEFAULT_LANGUAGE_CODE || LanguageAbbreviation.En;

const resources = {
  [LanguageAbbreviation.En]: translation_en,
};

// dayjs locale 与 BCP-47 代码映射(dayjs 使用 POSIX 风格命名)
const DAYJS_LOCALE_MAP: Record<string, string> = {
  'zh-Hans': 'zh-cn',
  'zh-Hant': 'zh-tw',
  'pt-BR': 'pt-br',
};

// RTL 语言(文本方向从右到左)
export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

export const updateDocumentLocale = (lng: string) => {
  document.documentElement.lang = lng;
  const isRtl = RTL_LANGUAGES.some((rtl) => lng.startsWith(rtl));
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  dayjs.locale(DAYJS_LOCALE_MAP[lng] ?? lng);
};

i18n
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    detection: {
      lookupLocalStorage: 'lng',
      // 仅从 localStorage 读取用户已选语言;浏览器语言检测在 initLanguage() 中
      // 手动处理(避免 i18next 把 'zh-CN' 误匹配为 fallbackLng 'en' 并缓存)
      order: ['localStorage'],
      caches: [],
    },
    supportedLngs: supportedLanguageCodes,
    resources,
    fallbackLng: DEFAULT_LANGUAGE_CODE,
    interpolation: {
      escapeValue: false,
    },
  });

/**
 * 将浏览器 navigator.language 映射到 supportedLngs 中的 BCP-47 代码。
 * i18next 默认不做 'zh-CN' → 'zh-Hans' 的模糊匹配,需手动映射。
 * 大小写不敏感查找(languageImports 的 key 是 BCP-47 规范大小写,如 'pt-BR')。
 */
export function mapBrowserLanguage(lang: string): string {
  const lower = (lang || '').toLowerCase();
  if (lower.startsWith('zh')) {
    // 繁体中文:zh-TW / zh-Hant / zh-HK / zh-MO
    if (
      lower.includes('tw') ||
      lower.includes('hant') ||
      lower.includes('hk') ||
      lower.includes('mo')
    ) {
      return LanguageAbbreviation.ZhTraditional;
    }
    // 其余 zh-* (zh-CN / zh-Hans / zh-SG / zh) 统一映射到简体中文
    return LanguageAbbreviation.Zh;
  }
  // 其他语言:大小写不敏感精确匹配,再检查 primary 是否直接支持
  const primary = lower.split('-')[0];
  const matched = Object.keys(languageImports).find(
    (k) => k.toLowerCase() === lower,
  );
  if (matched) return matched;
  if (languageImports[primary]) return primary;
  return DEFAULT_LANGUAGE_CODE;
}

export const loadLanguageAsync = async (lng: string): Promise<void> => {
  if (i18n.hasResourceBundle(lng, 'translation')) {
    return;
  }

  const importFn = languageImports[lng];
  if (!importFn) {
    console.warn(`Language ${lng} is not supported for lazy loading`);
    return;
  }

  try {
    const module = await importFn();
    const translationData = module.default?.translation || module.default;
    i18n.addResourceBundle(lng, 'translation', translationData);

    const featureLazy = collectI18nLazy();
    const featureLoadersForLang = Object.entries(featureLazy).filter(
      ([key]) => key.endsWith(`:${lng}`),
    );
    await Promise.all(
      featureLoadersForLang.map(async ([key, loader]) => {
        try {
          const featureModule = await loader();
          const featureData = featureModule.default ?? {};
          i18n.addResourceBundle(
            lng,
            'translation',
            featureData,
            true,
            true,
          );
        } catch (error) {
          console.error(`Failed to load feature i18n ${key}:`, error);
        }
      }),
    );
  } catch (error) {
    console.error(`Failed to load language ${lng}:`, error);
  }
};

export const changeLanguageAsync = async (lng: string): Promise<void> => {
  if (
    lng !== LanguageAbbreviation.En &&
    !i18n.hasResourceBundle(lng, 'translation')
  ) {
    await loadLanguageAsync(lng);
  }

  storage.setLanguage(lng);

  updateDocumentLocale(lng);

  await i18n.changeLanguage(lng);
};

export const initLanguage = async (): Promise<void> => {
  // 1. 优先 localStorage(用户已选语言)
  // 2. 其次浏览器 navigator.language(手动映射到 supportedLngs)
  // 3. 最后回退到 DEFAULT_LANGUAGE_CODE
  // changeLanguageAsync 会将最终结果写入 localStorage,后续访问直接走 localStorage
  const storedLng = storage.getLanguage();
  const currentLng =
    storedLng ||
    (typeof navigator !== 'undefined'
      ? mapBrowserLanguage(navigator.language)
      : DEFAULT_LANGUAGE_CODE);

  await changeLanguageAsync(currentLng);
};

export default i18n;
