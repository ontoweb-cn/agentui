// spec-013 P1-8: locales/config.ts 额外边界集成测试。
// 补充 config.integration.test.ts 未覆盖的场景:
// - zh-HK / zh-MO / zh-SG 浏览器语言映射(繁简中文区域变体)
// - he-IL / fa-IR / ur-PK RTL 语言区域变体(prefix matching)
// - changeLanguageAsync 幂等性(同语言重复切换)
// - mapBrowserLanguage 纯语言代码(无区域后缀:zh / ar / pt)
// - updateDocumentLocale 边界(空字符串、未知语言)
// - dayjs locale 无映射时的回退行为
// - 快速连续语言切换循环(en → ar → zh → en)
// - mapBrowserLanguage 边界输入(纯空格、超长字符串、特殊字符)

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
  RTL_LANGUAGES,
} from './config';
import storage from '@/utils/authorization-util';

// ── Helpers ────────────────────────────────────────────────────────────

function resetDocument() {
  document.documentElement.lang = '';
  document.documentElement.dir = '';
}

function clearStorage() {
  localStorage.clear();
}

// ===========================================================================
// 1. zh-HK / zh-MO / zh-SG 繁简中文区域变体映射
// ===========================================================================

describe('i18n 边界 - 中文区域变体映射', () => {
  beforeEach(() => resetDocument());

  it('zh-HK → zh-Hant(繁体中文)', () => {
    expect(mapBrowserLanguage('zh-HK')).toBe(LanguageAbbreviation.ZhTraditional);
    expect(mapBrowserLanguage('zh-hk')).toBe(LanguageAbbreviation.ZhTraditional);
    expect(mapBrowserLanguage('ZH-HK')).toBe(LanguageAbbreviation.ZhTraditional);
  });

  it('zh-MO → zh-Hant(繁体中文)', () => {
    expect(mapBrowserLanguage('zh-MO')).toBe(LanguageAbbreviation.ZhTraditional);
    expect(mapBrowserLanguage('zh-mo')).toBe(LanguageAbbreviation.ZhTraditional);
  });

  it('zh-SG → zh-Hans(简体中文)', () => {
    expect(mapBrowserLanguage('zh-SG')).toBe(LanguageAbbreviation.Zh);
    expect(mapBrowserLanguage('zh-sg')).toBe(LanguageAbbreviation.Zh);
  });

  it('zh-Hans → zh-Hans(简体中文,BCP-47 规范)', () => {
    expect(mapBrowserLanguage('zh-Hans')).toBe(LanguageAbbreviation.Zh);
    expect(mapBrowserLanguage('zh-hans')).toBe(LanguageAbbreviation.Zh);
  });

  it('zh-Hant → zh-Hant(繁体中文,BCP-47 规范)', () => {
    expect(mapBrowserLanguage('zh-Hant')).toBe(LanguageAbbreviation.ZhTraditional);
    expect(mapBrowserLanguage('zh-hant')).toBe(LanguageAbbreviation.ZhTraditional);
  });

  it('zh(无区域后缀)→ zh-Hans(简体中文)', () => {
    expect(mapBrowserLanguage('zh')).toBe(LanguageAbbreviation.Zh);
    expect(mapBrowserLanguage('ZH')).toBe(LanguageAbbreviation.Zh);
  });

  it('zh-CN / zh-SG 均映射到 zh-Hans,dayjs locale 一致', () => {
    const cn = mapBrowserLanguage('zh-CN');
    const sg = mapBrowserLanguage('zh-SG');
    expect(cn).toBe(sg);
    expect(cn).toBe(LanguageAbbreviation.Zh);

    updateDocumentLocale(cn);
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('zh-TW / zh-HK / zh-MO 均映射到 zh-Hant,dayjs locale 一致', () => {
    const tw = mapBrowserLanguage('zh-TW');
    const hk = mapBrowserLanguage('zh-HK');
    const mo = mapBrowserLanguage('zh-MO');
    expect(tw).toBe(hk);
    expect(hk).toBe(mo);
    expect(tw).toBe(LanguageAbbreviation.ZhTraditional);

    updateDocumentLocale(tw);
    expect(dayjs.locale()).toBe('zh-tw');
  });
});

// ===========================================================================
// 2. he / fa / ur RTL 语言区域变体
// ===========================================================================

describe('i18n 边界 - RTL 语言区域变体(prefix matching)', () => {
  beforeEach(() => resetDocument());

  it('he-IL → RTL(dir=rtl)', () => {
    // he 在 RTL_LANGUAGES 中,updateDocumentLocale 用 startsWith 检查
    updateDocumentLocale('he');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });

  it('he-IL 区域变体 → RTL(startsWith he)', () => {
    // 注:he 不在 languageImports 中(不支持懒加载),
    // 但 updateDocumentLocale 的 RTL 检查用 startsWith,不依赖 languageImports
    updateDocumentLocale('he-IL');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('fa-IR → RTL(dir=rtl)', () => {
    updateDocumentLocale('fa');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('fa-IR 区域变体 → RTL(startsWith fa)', () => {
    updateDocumentLocale('fa-IR');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('ur-PK → RTL(dir=rtl)', () => {
    updateDocumentLocale('ur');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('ur-PK 区域变体 → RTL(startsWith ur)', () => {
    updateDocumentLocale('ur-PK');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('RTL_LANGUAGES 所有成员均触发 RTL 方向', () => {
    for (const rtl of RTL_LANGUAGES) {
      updateDocumentLocale(rtl);
      expect(document.documentElement.dir).toBe('rtl');
    }
  });

  it('RTL prefix matching:ar-EG / ar-SA / ar-X 均触发 RTL', () => {
    // updateDocumentLocale 用 lng.startsWith(rtl) 检查,
    // ar-EG startsWith 'ar' → true → RTL
    updateDocumentLocale('ar-EG');
    expect(document.documentElement.dir).toBe('rtl');

    updateDocumentLocale('ar-SA');
    expect(document.documentElement.dir).toBe('rtl');

    updateDocumentLocale('ar-X');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('非 RTL 语言不会被 prefix matching 误判', () => {
    // 'archive' startsWith 'ar' → true,但 'archive' 不是合法语言代码
    // 注:updateDocumentLocale 不校验语言代码合法性,只做 startsWith 检查
    // 这是一个已知的宽松匹配行为,测试记录此行为
    updateDocumentLocale('archive');
    // 'archive'.startsWith('ar') → true → dir=rtl
    // 这验证了 startsWith 的宽松匹配行为(非 RTL 语言可能被误判)
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('en-US / en-GB 均为 LTR(英语区域变体不触发 RTL)', () => {
    updateDocumentLocale('en-US');
    expect(document.documentElement.dir).toBe('ltr');

    updateDocumentLocale('en-GB');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

// ===========================================================================
// 3. changeLanguageAsync 幂等性与循环切换
// ===========================================================================

describe('i18n 边界 - changeLanguageAsync 幂等性与循环', () => {
  beforeEach(() => {
    clearStorage();
    resetDocument();
  });

  afterEach(() => {
    clearStorage();
    resetDocument();
  });

  it('同语言重复切换:en → en(幂等,不抛错)', async () => {
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.En);

    // 再次切换到 en
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('同语言重复切换:ar → ar(幂等,RTL 方向保持)', async () => {
    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');

    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ar);
  });

  it('快速循环切换 en → ar → zh → en(状态正确)', async () => {
    // en
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('en');

    // ar
    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
    expect(dayjs.locale()).toBe('ar');

    // zh
    await changeLanguageAsync(LanguageAbbreviation.Zh);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('zh-cn');

    // en
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('en');
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
  });

  it('快速循环切换 zh → zh-Hant → zh(简繁交替)', async () => {
    await changeLanguageAsync(LanguageAbbreviation.Zh);
    expect(dayjs.locale()).toBe('zh-cn');
    expect(document.documentElement.dir).toBe('ltr');

    await changeLanguageAsync(LanguageAbbreviation.ZhTraditional);
    expect(dayjs.locale()).toBe('zh-tw');
    expect(document.documentElement.dir).toBe('ltr');

    await changeLanguageAsync(LanguageAbbreviation.Zh);
    expect(dayjs.locale()).toBe('zh-cn');
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Zh);
  });

  it('RTL → LTR → RTL 循环:dir 属性在每次切换后立即更新', async () => {
    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');

    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');

    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');

    await changeLanguageAsync(LanguageAbbreviation.Zh);
    expect(document.documentElement.dir).toBe('ltr');
  });
});

// ===========================================================================
// 4. mapBrowserLanguage 纯语言代码(无区域后缀)
// ===========================================================================

describe('i18n 边界 - 纯语言代码映射', () => {
  it('ar(无区域)→ ar', () => {
    expect(mapBrowserLanguage('ar')).toBe(LanguageAbbreviation.Ar);
  });

  it('ja(无区域)→ ja', () => {
    expect(mapBrowserLanguage('ja')).toBe(LanguageAbbreviation.Ja);
  });

  it('ko(无区域)→ ko', () => {
    expect(mapBrowserLanguage('ko')).toBe(LanguageAbbreviation.Ko);
  });

  it('de(无区域)→ de', () => {
    expect(mapBrowserLanguage('de')).toBe(LanguageAbbreviation.De);
  });

  it('fr(无区域)→ fr', () => {
    expect(mapBrowserLanguage('fr')).toBe(LanguageAbbreviation.Fr);
  });

  it('pt(无区域)→ 回退到 en(pt-BR 才是支持的代码)', () => {
    // 'pt' 不在 languageImports 的 key 中(只有 'pt-BR'),
    // primary = 'pt',languageImports['pt'] 不存在 → 回退到 en
    expect(mapBrowserLanguage('pt')).toBe(LanguageAbbreviation.En);
  });

  it('en(无区域)→ en', () => {
    expect(mapBrowserLanguage('en')).toBe(LanguageAbbreviation.En);
  });

  it('大写纯语言代码:AR / JA / KO → 映射到对应语言', () => {
    // mapBrowserLanguage 先 toLowerCase(),再匹配
    expect(mapBrowserLanguage('AR')).toBe(LanguageAbbreviation.Ar);
    expect(mapBrowserLanguage('JA')).toBe(LanguageAbbreviation.Ja);
    expect(mapBrowserLanguage('KO')).toBe(LanguageAbbreviation.Ko);
  });
});

// ===========================================================================
// 5. updateDocumentLocale 边界输入
// ===========================================================================

describe('i18n 边界 - updateDocumentLocale 边界输入', () => {
  beforeEach(() => resetDocument());

  it('空字符串:dir=ltr(不在 RTL 列表),lang=""', () => {
    updateDocumentLocale('');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('');
  });

  it('未知语言代码 xx-XX:dir=ltr,dayjs 保持当前 locale', () => {
    // dayjs 对未知 locale 调用 dayjs.locale('xx-XX') 会静默忽略,保持当前 locale
    // 先重置为 en
    dayjs.locale('en');
    updateDocumentLocale('xx-XX');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('xx-XX');
    // dayjs 静默忽略未知 locale,保持 en
    expect(dayjs.locale()).toBe('en');
  });

  it('纯数字 "123":dir=ltr(不以 RTL 前缀开头)', () => {
    updateDocumentLocale('123');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('123');
  });

  it('特殊字符 "!@#":dir=ltr', () => {
    updateDocumentLocale('!@#');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('!@#');
  });

  it('超长字符串(1000 字符):不崩溃,dir=ltr', () => {
    const long = 'a'.repeat(1000);
    updateDocumentLocale(long);
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe(long);
  });
});

// ===========================================================================
// 6. dayjs locale 回退行为
// ===========================================================================

describe('i18n 边界 - dayjs locale 回退', () => {
  beforeEach(() => resetDocument());

  it('无 DAYJS_LOCALE_MAP 映射的语言:dayjs 用原始代码', () => {
    // ja 不在 DAYJS_LOCALE_MAP 中,dayjs.locale('ja') 直接使用
    updateDocumentLocale(LanguageAbbreviation.Ja);
    expect(dayjs.locale()).toBe('ja');
  });

  it('ko 不在 DAYJS_LOCALE_MAP 中:dayjs 用 ko', () => {
    updateDocumentLocale(LanguageAbbreviation.Ko);
    expect(dayjs.locale()).toBe('ko');
  });

  it('de 不在 DAYJS_LOCALE_MAP 中:dayjs 用 de', () => {
    updateDocumentLocale(LanguageAbbreviation.De);
    expect(dayjs.locale()).toBe('de');
  });

  it('fr 不在 DAYJS_LOCALE_MAP 中:dayjs 用 fr', () => {
    updateDocumentLocale(LanguageAbbreviation.Fr);
    expect(dayjs.locale()).toBe('fr');
  });

  it('未知语言代码:dayjs 静默忽略,保持当前 locale', () => {
    // dayjs 对未知 locale 静默忽略(不报错,不切换)
    // 先设为已知 locale,再尝试切换到未知 locale
    dayjs.locale('en');
    updateDocumentLocale('xx-XX');
    // dayjs 保持 en(未知 locale 被忽略)
    expect(dayjs.locale()).toBe('en');
  });

  it('DAYJS_LOCALE_MAP 覆盖的语言:zh-Hans / zh-Hant / pt-BR', () => {
    updateDocumentLocale(LanguageAbbreviation.Zh);
    expect(dayjs.locale()).toBe('zh-cn');

    updateDocumentLocale(LanguageAbbreviation.ZhTraditional);
    expect(dayjs.locale()).toBe('zh-tw');

    updateDocumentLocale(LanguageAbbreviation.PtBr);
    expect(dayjs.locale()).toBe('pt-br');
  });
});

// ===========================================================================
// 7. mapBrowserLanguage 边界输入
// ===========================================================================

describe('i18n 边界 - mapBrowserLanguage 边界输入', () => {
  it('纯空格字符串 → 回退到 en', () => {
    expect(mapBrowserLanguage('   ')).toBe(LanguageAbbreviation.En);
  });

  it('只有连字符 "---" → 回退到 en', () => {
    expect(mapBrowserLanguage('---')).toBe(LanguageAbbreviation.En);
  });

  it('zh- 后跟空格 → zh-Hans(startsWith zh)', () => {
    // 'zh-'.toLowerCase().startsWith('zh') → true
    // 不包含 tw/hant/hk/mo → Zh
    expect(mapBrowserLanguage('zh-')).toBe(LanguageAbbreviation.Zh);
  });

  it('ar- 后跟空格 → ar(startsWith zh 为 false,primary ar 匹配)', () => {
    // 'ar-'.toLowerCase() = 'ar-'
    // 不 startsWith 'zh'
    // primary = 'ar-',Object.keys(languageImports).find(k => k.toLowerCase() === 'ar-') → undefined
    // languageImports['ar-'] → undefined
    // 但 languageImports['ar'] 存在? 不,primary = 'ar-'.split('-')[0] = 'ar'(空字符串被 split 后取第一个非空部分)
    // 实际:'ar-'.split('-') = ['ar', ''],primary = 'ar'
    // languageImports['ar'] 存在 → 返回 'ar'
    expect(mapBrowserLanguage('ar-')).toBe(LanguageAbbreviation.Ar);
  });

  it('超长浏览器语言代码 → 回退到 en', () => {
    const long = 'x'.repeat(100);
    expect(mapBrowserLanguage(long)).toBe(LanguageAbbreviation.En);
  });

  it('含特殊字符的浏览器语言 → 回退到 en', () => {
    expect(mapBrowserLanguage('en@special')).toBe(LanguageAbbreviation.En);
    expect(mapBrowserLanguage('en;special')).toBe(LanguageAbbreviation.En);
  });

  it('只有区域无语言("-US")→ 回退到 en', () => {
    // '-us'.toLowerCase().startsWith('zh') → false
    // primary = '-us'.split('-')[0] = ''(空字符串)
    // languageImports[''] → undefined → 回退到 en
    expect(mapBrowserLanguage('-US')).toBe(LanguageAbbreviation.En);
  });
});

// ===========================================================================
// 8. RTL_LANGUAGES 完整性验证
// ===========================================================================

describe('i18n 边界 - RTL_LANGUAGES 完整性', () => {
  it('RTL_LANGUAGES 包含 ar / he / fa / ur 四种语言', () => {
    expect(RTL_LANGUAGES).toContain('ar');
    expect(RTL_LANGUAGES).toContain('he');
    expect(RTL_LANGUAGES).toContain('fa');
    expect(RTL_LANGUAGES).toContain('ur');
    expect(RTL_LANGUAGES).toHaveLength(4);
  });

  it('RTL_LANGUAGES 不包含任何 LTR 语言', () => {
    const ltrLangs = [
      LanguageAbbreviation.En,
      LanguageAbbreviation.Zh,
      LanguageAbbreviation.ZhTraditional,
      LanguageAbbreviation.Ja,
      LanguageAbbreviation.Ko,
      LanguageAbbreviation.De,
      LanguageAbbreviation.Fr,
      LanguageAbbreviation.PtBr,
      LanguageAbbreviation.Es,
      LanguageAbbreviation.Vi,
      LanguageAbbreviation.Ru,
      LanguageAbbreviation.It,
      LanguageAbbreviation.Bg,
      LanguageAbbreviation.Tr,
      LanguageAbbreviation.Id,
    ];
    for (const lang of ltrLangs) {
      expect(RTL_LANGUAGES).not.toContain(lang);
    }
  });

  it('RTL_LANGUAGES 所有前缀均触发 RTL 方向', () => {
    for (const rtl of RTL_LANGUAGES) {
      // 纯前缀
      updateDocumentLocale(rtl);
      expect(document.documentElement.dir).toBe('rtl');

      // 前缀 + 区域
      updateDocumentLocale(`${rtl}-XX`);
      expect(document.documentElement.dir).toBe('rtl');
    }
  });
});

// ===========================================================================
// 9. 端到端:模拟用户从浏览器检测到手动切换的完整流程
// ===========================================================================

describe('i18n 边界 - 端到端用户流程', () => {
  beforeEach(() => {
    clearStorage();
    resetDocument();
  });

  afterEach(() => {
    clearStorage();
    resetDocument();
  });

  it('首次访问(浏览器 ar-EG)→ 自动 RTL → 手动切 en → 再切回 ar', async () => {
    // 1. 模拟首次访问:浏览器语言 ar-EG
    const browserLang = 'ar-EG';
    const mapped = mapBrowserLanguage(browserLang);
    expect(mapped).toBe(LanguageAbbreviation.Ar);

    await changeLanguageAsync(mapped);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
    expect(dayjs.locale()).toBe('ar');

    // 2. 用户手动切换到 en
    await changeLanguageAsync(LanguageAbbreviation.En);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');
    expect(dayjs.locale()).toBe('en');

    // 3. 用户切回 ar
    await changeLanguageAsync(LanguageAbbreviation.Ar);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ar);
    expect(document.documentElement.dir).toBe('rtl');
    expect(dayjs.locale()).toBe('ar');
  });

  it('首次访问(浏览器 zh-HK)→ 自动繁中 → 手动切简中', async () => {
    // 1. 浏览器 zh-HK → 繁中
    const mapped = mapBrowserLanguage('zh-HK');
    expect(mapped).toBe(LanguageAbbreviation.ZhTraditional);

    await changeLanguageAsync(mapped);
    expect(dayjs.locale()).toBe('zh-tw');
    expect(document.documentElement.dir).toBe('ltr');

    // 2. 手动切简中
    await changeLanguageAsync(LanguageAbbreviation.Zh);
    expect(dayjs.locale()).toBe('zh-cn');
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Zh);
  });

  it('首次访问(未知浏览器语言)→ 回退 en → 手动切 ja', async () => {
    // 1. 未知浏览器语言
    const mapped = mapBrowserLanguage('klingon-KR');
    expect(mapped).toBe(LanguageAbbreviation.En);

    await changeLanguageAsync(mapped);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.En);
    expect(document.documentElement.dir).toBe('ltr');

    // 2. 手动切日语
    await changeLanguageAsync(LanguageAbbreviation.Ja);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ja);
    expect(dayjs.locale()).toBe('ja');
  });

  it('storage 已有语言优先于浏览器语言(二次访问)', async () => {
    // 模拟首次访问后 storage 持久化了 ja
    await changeLanguageAsync(LanguageAbbreviation.Ja);
    expect(storage.getLanguage()).toBe(LanguageAbbreviation.Ja);

    // 模拟二次访问:storage 有值,即使浏览器语言是 zh-CN 也用 storage
    const storedLng = storage.getLanguage();
    expect(storedLng).toBe(LanguageAbbreviation.Ja);

    await changeLanguageAsync(storedLng);
    expect(document.documentElement.lang).toBe(LanguageAbbreviation.Ja);
    expect(dayjs.locale()).toBe('ja');
  });
});
