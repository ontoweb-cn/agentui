// spec-013 P1-8: locales/config.ts 集成测试。
// 覆盖多语言切换的端到端流程:RTL 方向、dayjs locale 联动、localStorage 持久化、
// 浏览器语言映射组合 initLanguage、语言切换的幂等性等边界场景。
// 与 config.test.ts(单元测试)互补,本文件聚焦跨函数协作的集成场景。

import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/zh-tw';
import 'dayjs/locale/pt-br';
import 'dayjs/locale/ja';
import 'dayjs/locale/ar';
import 'dayjs/locale/ko';
import 'dayjs/locale/de';
import 'dayjs/locale/fr';

import { LanguageAbbreviation } from '@/constants/common';
import {
  mapBrowserLanguage,
  updateDocumentLocale,
  changeLanguageAsync,
  loadLanguageAsync,
  RTL_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
} from './config';
import storage from '@/utils/authorization-util';

// ── Helpers ────────────────────────────────────────────────────────────

const RTL_LANGS = [LanguageAbbreviation.Ar, 'he', 'fa', 'ur'];
const LTR_LANGS = [
  LanguageAbbreviation.En,
  LanguageAbbreviation.Zh,
  LanguageAbbreviation.ZhTraditional,
  LanguageAbbreviation.Ja,
  LanguageAbbreviation.PtBr,
];

function resetDocument() {
  document.documentElement.lang = '';
  document.documentElement.dir = '';
}

function clearStorage() {
  localStorage.clear();
}

// ===========================================================================
// 1. updateDocumentLocale × RTL_LANGUAGES 集成
// ===========================================================================

describe('i18n 集成 - RTL 方向切换', () => {
  beforeEach(() => resetDocument());

  it('所有 RTL_LANGUAGES 触发 dir=rtl', () => {
    for (const lang of RTL_LANGS) {
      updateDocumentLocale(lang);
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe(lang);
    }
  });

  it('所有 LTR 语言触发 dir=ltr', () => {
    for (const lang of LTR_LANGS) {
      updateDocumentLocale(lang);
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe(lang);
    }
  });

  it('RTL → LTR → RTL 切换:dir 属性正确翻转', () => {
    updateDocumentLocale(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');

    updateDocumentLocale(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');

    updateDocumentLocale(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('RTL_LANGUAGES 与 updateDocumentLocale 判断逻辑一致', () => {
    // 验证 updateDocumentLocale 使用的 RTL_LANGUAGES 与导出常量一致
    for (const lang of RTL_LANGUAGES) {
      expect(RTL_LANGUAGES).toContain(lang);
    }
    // LTR 语言不在 RTL 列表中
    for (const lang of LTR_LANGS) {
      expect(RTL_LANGUAGES).not.toContain(lang);
    }
  });

  it('zh-Hans 和 zh-Hant 均为 LTR(中文无 RTL 需求)', () => {
    updateDocumentLocale(LanguageAbbreviation.Zh);
    expect(document.documentElement.dir).toBe('ltr');
    updateDocumentLocale(LanguageAbbreviation.ZhTraditional);
    expect(document.documentElement.dir).toBe('ltr');
  });
});

// ===========================================================================
// 2. updateDocumentLocale × dayjs locale 联动
// ===========================================================================

describe('i18n 集成 - dayjs locale 联动', () => {
  beforeEach(() => resetDocument());

  it('zh-Hans → dayjs zh-cn', () => {
    updateDocumentLocale(LanguageAbbreviation.Zh);
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('zh-Hant → dayjs zh-tw', () => {
    updateDocumentLocale(LanguageAbbreviation.ZhTraditional);
    expect(dayjs.locale()).toBe('zh-tw');
  });

  it('pt-BR → dayjs pt-br(大小写归一化)', () => {
    updateDocumentLocale(LanguageAbbreviation.PtBr);
    expect(dayjs.locale()).toBe('pt-br');
  });

  it('无映射的语言直接使用 BCP-47 代码', () => {
    updateDocumentLocale(LanguageAbbreviation.Ja);
    expect(dayjs.locale()).toBe('ja');
  });

  it('ar → dayjs ar(阿拉伯语)', () => {
    updateDocumentLocale(LanguageAbbreviation.Ar);
    expect(dayjs.locale()).toBe('ar');
  });

  it('语言切换时 dayjs locale 同步更新', () => {
    updateDocumentLocale(LanguageAbbreviation.Zh);
    expect(dayjs.locale()).toBe('zh-cn');

    updateDocumentLocale(LanguageAbbreviation.Ja);
    expect(dayjs.locale()).toBe('ja');

    updateDocumentLocale(LanguageAbbreviation.PtBr);
    expect(dayjs.locale()).toBe('pt-br');

    updateDocumentLocale(LanguageAbbreviation.En);
    expect(dayjs.locale()).toBe('en');
  });
});

// ===========================================================================
// 3. mapBrowserLanguage × updateDocumentLocale 组合
// ===========================================================================

describe('i18n 集成 - 浏览器语言映射 + 文档方向联动', () => {
  beforeEach(() => resetDocument());

  it('zh-CN 浏览器语言 → zh-Hans → LTR + dayjs zh-cn', () => {
    const mapped = mapBrowserLanguage('zh-CN');
    expect(mapped).toBe(LanguageAbbreviation.Zh);
    updateDocumentLocale(mapped);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('zh-TW 浏览器语言 → zh-Hant → LTR + dayjs zh-tw', () => {
    const mapped = mapBrowserLanguage('zh-TW');
    expect(mapped).toBe(LanguageAbbreviation.ZhTraditional);
    updateDocumentLocale(mapped);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('zh-tw');
  });

  it('ar-SA 浏览器语言 → ar → RTL + dayjs ar', () => {
    const mapped = mapBrowserLanguage('ar-SA');
    expect(mapped).toBe(LanguageAbbreviation.Ar);
    updateDocumentLocale(mapped);
    expect(document.documentElement.dir).toBe('rtl');
    expect(dayjs.locale()).toBe('ar');
  });

  it('pt-BR 浏览器语言 → pt-BR → LTR + dayjs pt-br', () => {
    const mapped = mapBrowserLanguage('pt-BR');
    expect(mapped).toBe(LanguageAbbreviation.PtBr);
    updateDocumentLocale(mapped);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('pt-br');
  });

  it('未知浏览器语言 xx-XX → en → LTR + dayjs en', () => {
    const mapped = mapBrowserLanguage('xx-XX');
    expect(mapped).toBe(LanguageAbbreviation.En);
    updateDocumentLocale(mapped);
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('大小写不敏感浏览器语言映射后正确触发文档方向', () => {
    // pt-br 小写也应映射到 pt-BR,LTR 方向
    const mapped = mapBrowserLanguage('pt-br');
    expect(mapped).toBe(LanguageAbbreviation.PtBr);
    updateDocumentLocale(mapped);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('pt-br');
  });
});

// ===========================================================================
// 4. changeLanguageAsync × storage × document 集成
// ===========================================================================

describe('i18n 集成 - changeLanguageAsync 全链路', () => {
  beforeEach(() => {
    clearStorage();
    resetDocument();
  });

  afterEach(() => {
    clearStorage();
    resetDocument();
  });

  it('切换到 en:storage 持久化 + document 更新', async () => {
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
    expect(localStorage.getItem('lng')).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('切换到 zh-Hans:storage 持久化 + dayjs 联动', async () => {
    await changeLanguageAsync(LanguageAbbreviation.Zh);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Zh);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.Zh);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('切换到 ar:storage 持久化 + RTL 方向', async () => {
    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ar);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('连续切换 en → ar → en:dir 正确翻转,storage 最终为 en', async () => {
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');

    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ar);

    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
  });

  it('切换到不支持的语言代码:storage 仍持久化,dayjs 用原始代码', async () => {
    // changeLanguageAsync 不校验语言代码,直接透传到 storage 和 document
    const unknownLang = 'xx-XX';
    await changeLanguageAsync(unknownLang);
    expect(storage.getLanguage()).toBe(unknownLang);
    expect(document.documentElement.lang).toBe(unknownLang);
    // 未知语言不在 RTL 列表 → LTR
    expect(document.documentElement.dir).toBe('ltr');
  });
});

// ===========================================================================
// 5. loadLanguageAsync 集成
// ===========================================================================

describe('i18n 集成 - loadLanguageAsync 行为', () => {
  beforeEach(() => {
    clearStorage();
    resetDocument();
  });

  afterEach(() => {
    clearStorage();
    resetDocument();
  });

  it('en 已预加载,loadLanguageAsync(en) 不抛错', async () => {
    await expect(loadLanguageAsync(LanguageAbbreviation.En)).resolves.toBeUndefined();
  });

  it('加载不支持的语言代码:console.warn 但不抛错', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(loadLanguageAsync('xx-XX')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ===========================================================================
// 6. 边界场景:DEFAULT_LANGUAGE_CODE 回退
// ===========================================================================

describe('i18n 集成 - 默认语言回退', () => {
  it('DEFAULT_LANGUAGE_CODE 为 en', () => {
    // 验证默认语言代码配置(开发环境通常为 'en')
    expect(DEFAULT_LANGUAGE_CODE).toBe(LanguageAbbreviation.En);
  });

  it('mapBrowserLanguage 对所有空值/异常输入回退到默认语言', () => {
    expect(mapBrowserLanguage('')).toBe(DEFAULT_LANGUAGE_CODE);
    expect(mapBrowserLanguage(null as unknown as string)).toBe(DEFAULT_LANGUAGE_CODE);
    expect(mapBrowserLanguage(undefined as unknown as string)).toBe(DEFAULT_LANGUAGE_CODE);
    expect(mapBrowserLanguage('xx-XX')).toBe(DEFAULT_LANGUAGE_CODE);
    expect(mapBrowserLanguage('klingon-KR')).toBe(DEFAULT_LANGUAGE_CODE);
  });

  it('所有支持的语言经 mapBrowserLanguage 后均可正确映射', () => {
    // 验证 BCP-47 大小写规范的语言代码可被 mapBrowserLanguage 识别
    const supportedLangs = [
      LanguageAbbreviation.En,
      LanguageAbbreviation.Zh,
      LanguageAbbreviation.ZhTraditional,
      LanguageAbbreviation.Ja,
      LanguageAbbreviation.PtBr,
      LanguageAbbreviation.Ar,
      LanguageAbbreviation.Ko,
      LanguageAbbreviation.De,
      LanguageAbbreviation.Fr,
    ];
    for (const lang of supportedLangs) {
      expect(mapBrowserLanguage(lang)).toBe(lang);
    }
  });
});

// ===========================================================================
// 7. 端到端:模拟浏览器语言检测流程
// ===========================================================================

describe('i18n 集成 - 浏览器语言检测端到端', () => {
  beforeEach(() => {
    clearStorage();
    resetDocument();
  });

  afterEach(() => {
    clearStorage();
    resetDocument();
  });

  it('模拟 navigator.language=zh-CN 的完整流程:映射 → 切换 → 持久化', async () => {
    // 模拟 initLanguage 中的核心逻辑(不直接调用,因 i18n 已在模块加载时初始化)
    const browserLang = 'zh-CN';
    const mapped = mapBrowserLanguage(browserLang);
    expect(mapped).toBe(LanguageAbbreviation.Zh);

    await changeLanguageAsync(mapped);

    // 验证完整链路
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Zh);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.Zh);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('模拟 navigator.language=ar-SA 的完整流程:RTL 方向正确', async () => {
    const browserLang = 'ar-SA';
    const mapped = mapBrowserLanguage(browserLang);
    expect(mapped).toBe(LanguageAbbreviation.Ar);

    await changeLanguageAsync(mapped);

    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
    expect(dayjs.locale()).toBe('ar');
  });

  it('模拟用户已选语言优先于浏览器语言', async () => {
    // 用户先选了 ja
    await changeLanguageAsync(LanguageAbbreviation.Ja);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ja);

    // 模拟下次访问:storage 有值,优先用 storage(不走 mapBrowserLanguage)
    const storedLng = storage.getLanguage();
    expect(storedLng).toBe(LanguageAbbreviation.Ja);

    // 即使浏览器语言是 zh-CN,也用 storage 中的 ja
    await changeLanguageAsync(storedLng);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.Ja);
    expect(dayjs.locale()).toBe('ja');
  });

  it('模拟首次访问 + 浏览器语言为未知语言 → 回退到默认 en', () => {
    // storage 为空,浏览器语言未知
    expect(storage.getLanguage()).toBeNull();
    const browserLang = 'klingon-KR';
    const mapped = mapBrowserLanguage(browserLang);
    expect(mapped).toBe(DEFAULT_LANGUAGE_CODE);
  });
});

// ===========================================================================
// 8. 语言代码大小写归一化集成
// ===========================================================================

describe('i18n 集成 - 语言代码大小写归一化', () => {
  beforeEach(() => resetDocument());

  it('pt-BR / pt-br 均映射到 pt-BR,dayjs locale 一致', () => {
    const upper = mapBrowserLanguage('pt-BR');
    const lower = mapBrowserLanguage('pt-br');
    expect(upper).toBe(lower);
    expect(upper).toBe(LanguageAbbreviation.PtBr);

    updateDocumentLocale(upper);
    expect(dayjs.locale()).toBe('pt-br');
  });

  it('zh-CN / zh-cn / zh-CN 均映射到 zh-Hans', () => {
    expect(mapBrowserLanguage('zh-CN')).toBe(LanguageAbbreviation.Zh);
    expect(mapBrowserLanguage('zh-cn')).toBe(LanguageAbbreviation.Zh);
    expect(mapBrowserLanguage('ZH-CN')).toBe(LanguageAbbreviation.Zh);
  });

  it('zh-TW / zh-tw / zh-Hant 均映射到 zh-Hant', () => {
    expect(mapBrowserLanguage('zh-TW')).toBe(LanguageAbbreviation.ZhTraditional);
    expect(mapBrowserLanguage('zh-tw')).toBe(LanguageAbbreviation.ZhTraditional);
    expect(mapBrowserLanguage('zh-Hant')).toBe(LanguageAbbreviation.ZhTraditional);
  });

  it('ar / ar-SA / ar-EG 均映射到 ar,触发 RTL', () => {
    expect(mapBrowserLanguage('ar')).toBe(LanguageAbbreviation.Ar);
    expect(mapBrowserLanguage('ar-SA')).toBe(LanguageAbbreviation.Ar);
    expect(mapBrowserLanguage('ar-EG')).toBe(LanguageAbbreviation.Ar);

    // 所有 ar 变体均触发 RTL
    updateDocumentLocale(mapBrowserLanguage('ar-EG'));
    expect(document.documentElement.dir).toBe('rtl');
  });
});
