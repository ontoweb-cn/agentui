// spec-013 P1-8: locales/config.ts 测试
// 覆盖 mapBrowserLanguage、updateDocumentLocale、RTL_LANGUAGES

import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/zh-tw';
import 'dayjs/locale/pt-br';
import 'dayjs/locale/ja';
import { LanguageAbbreviation } from '@/constants/common';
import {
  mapBrowserLanguage,
  updateDocumentLocale,
  RTL_LANGUAGES,
} from './config';

describe('locales/config', () => {
  describe('RTL_LANGUAGES', () => {
    it('包含阿拉伯语、希伯来语、波斯语、乌尔都语', () => {
      expect(RTL_LANGUAGES).toContain('ar');
      expect(RTL_LANGUAGES).toContain('he');
      expect(RTL_LANGUAGES).toContain('fa');
      expect(RTL_LANGUAGES).toContain('ur');
    });
  });

  describe('mapBrowserLanguage', () => {
    it('简体中文 zh-CN → zh-Hans', () => {
      expect(mapBrowserLanguage('zh-CN')).toBe(LanguageAbbreviation.Zh);
    });

    it('简体中文 zh-Hans → zh-Hans', () => {
      expect(mapBrowserLanguage('zh-Hans')).toBe(LanguageAbbreviation.Zh);
    });

    it('简体中文 zh → zh-Hans', () => {
      expect(mapBrowserLanguage('zh')).toBe(LanguageAbbreviation.Zh);
    });

    it('简体中文 zh-SG → zh-Hans', () => {
      expect(mapBrowserLanguage('zh-SG')).toBe(LanguageAbbreviation.Zh);
    });

    it('繁体中文 zh-TW → zh-Hant', () => {
      expect(mapBrowserLanguage('zh-TW')).toBe(LanguageAbbreviation.ZhTraditional);
    });

    it('繁体中文 zh-Hant → zh-Hant', () => {
      expect(mapBrowserLanguage('zh-Hant')).toBe(LanguageAbbreviation.ZhTraditional);
    });

    it('繁体中文 zh-HK → zh-Hant', () => {
      expect(mapBrowserLanguage('zh-HK')).toBe(LanguageAbbreviation.ZhTraditional);
    });

    it('繁体中文 zh-MO → zh-Hant', () => {
      expect(mapBrowserLanguage('zh-MO')).toBe(LanguageAbbreviation.ZhTraditional);
    });

    it('大小写不敏感:zh-cn → zh-Hans', () => {
      expect(mapBrowserLanguage('zh-cn')).toBe(LanguageAbbreviation.Zh);
    });

    it('大小写不敏感:zh-tw → zh-Hant', () => {
      expect(mapBrowserLanguage('zh-tw')).toBe(LanguageAbbreviation.ZhTraditional);
    });

    it('pt-BR 大小写不敏感匹配', () => {
      expect(mapBrowserLanguage('pt-BR')).toBe(LanguageAbbreviation.PtBr);
      expect(mapBrowserLanguage('pt-br')).toBe(LanguageAbbreviation.PtBr);
    });

    it('pt-PT 不匹配 pt-BR,回退到默认', () => {
      expect(mapBrowserLanguage('pt-PT')).toBe(LanguageAbbreviation.En);
    });

    it('en → en', () => {
      expect(mapBrowserLanguage('en')).toBe(LanguageAbbreviation.En);
    });

    it('en-US → en', () => {
      expect(mapBrowserLanguage('en-US')).toBe(LanguageAbbreviation.En);
    });

    it('ja → ja', () => {
      expect(mapBrowserLanguage('ja')).toBe(LanguageAbbreviation.Ja);
    });

    it('ja-JP → ja', () => {
      expect(mapBrowserLanguage('ja-JP')).toBe(LanguageAbbreviation.Ja);
    });

    it('ar → ar', () => {
      expect(mapBrowserLanguage('ar')).toBe(LanguageAbbreviation.Ar);
    });

    it('ar-SA → ar', () => {
      expect(mapBrowserLanguage('ar-SA')).toBe(LanguageAbbreviation.Ar);
    });

    it('未知语言回退到默认 (en)', () => {
      expect(mapBrowserLanguage('xx-XX')).toBe(LanguageAbbreviation.En);
    });

    it('空字符串回退到默认 (en)', () => {
      expect(mapBrowserLanguage('')).toBe(LanguageAbbreviation.En);
    });

    it('null/undefined 安全处理', () => {
      expect(mapBrowserLanguage(null as unknown as string)).toBe(LanguageAbbreviation.En);
      expect(mapBrowserLanguage(undefined as unknown as string)).toBe(LanguageAbbreviation.En);
    });
  });

  describe('updateDocumentLocale', () => {
    beforeEach(() => {
      document.documentElement.lang = '';
      document.documentElement.dir = '';
    });

    it('设置 document lang 属性', () => {
      updateDocumentLocale('ja');
      expect(document.documentElement.lang).toBe('ja');
    });

    it('LTR 语言设置 dir=ltr', () => {
      updateDocumentLocale('en');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('RTL 语言 ar 设置 dir=rtl', () => {
      updateDocumentLocale('ar');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('RTL 语言 he 设置 dir=rtl', () => {
      updateDocumentLocale('he');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('RTL 语言 fa 设置 dir=rtl', () => {
      updateDocumentLocale('fa');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('RTL 语言 ur 设置 dir=rtl', () => {
      updateDocumentLocale('ur');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('zh-Hans 不是 RTL', () => {
      updateDocumentLocale('zh-Hans');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('dayjs locale 映射:zh-Hans → zh-cn', () => {
      updateDocumentLocale('zh-Hans');
      expect(dayjs.locale()).toBe('zh-cn');
    });

    it('dayjs locale 映射:zh-Hant → zh-tw', () => {
      updateDocumentLocale('zh-Hant');
      expect(dayjs.locale()).toBe('zh-tw');
    });

    it('dayjs locale 映射:pt-BR → pt-br', () => {
      updateDocumentLocale('pt-BR');
      expect(dayjs.locale()).toBe('pt-br');
    });

    it('dayjs locale 无映射时直接使用语言代码', () => {
      updateDocumentLocale('ja');
      expect(dayjs.locale()).toBe('ja');
    });

    it('en 恢复为 LTR', () => {
      // 先设置为 RTL
      updateDocumentLocale('ar');
      expect(document.documentElement.dir).toBe('rtl');
      // 再切换回 en
      updateDocumentLocale('en');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });
});
