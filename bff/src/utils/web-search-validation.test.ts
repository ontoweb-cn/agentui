// T2.7:prompt_config 联网搜索校验纯函数单元测试(服务端镜像)。
// 语义对齐前端 web-search-api-key.ts 的 missingWebSearchApiKeyField。
import { describe, it, expect } from 'vitest';
import {
  computeHasWebSearchProvider,
  sanitizePromptConfigWebSearchKeys,
  validateWebSearchPromptConfig,
} from './web-search-validation';

describe('validateWebSearchPromptConfig (T2.7)', () => {
  it('合法 keyed provider + key → 放行', () => {
    expect(
      validateWebSearchPromptConfig({
        web_search_provider: 'tavily',
        tavily_api_key: 'tvly-x',
      }),
    ).toEqual({ ok: true });
  });

  it('keyed provider 缺 key → 拒绝,message 含字段名', () => {
    const result = validateWebSearchPromptConfig({
      web_search_provider: 'search1api',
      tavily_api_key: 'other-key',
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).toContain('search1api_api_key');
    }
  });

  it('keyed provider 全空白 key → 拒绝', () => {
    const result = validateWebSearchPromptConfig({
      web_search_provider: 'brave',
      brave_api_key: '   ',
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('keyless provider(anysearch/youcom)无 key → 放行', () => {
    expect(
      validateWebSearchPromptConfig({ web_search_provider: 'anysearch' }),
    ).toEqual({ ok: true });
    expect(
      validateWebSearchPromptConfig({ web_search_provider: 'youcom' }),
    ).toEqual({ ok: true });
  });

  it("web_search_provider 为 ''(清除态)→ 放行", () => {
    expect(
      validateWebSearchPromptConfig({
        web_search_provider: '',
        anysearch_api_key: 'retained',
      }),
    ).toEqual({ ok: true });
  });

  it('无 provider 字段 → 放行', () => {
    expect(
      validateWebSearchPromptConfig({ system: 'x', parameters: [] }),
    ).toEqual({ ok: true });
  });

  it('未知 provider → 拒绝,message 含 unknown web_search_provider', () => {
    const result = validateWebSearchPromptConfig({
      web_search_provider: 'not-a-provider',
      tavily_api_key: 'tvly-x',
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).toContain('unknown web_search_provider');
    }
  });

  it('legacy 数据(仅 tavily_api_key,无 provider)→ 放行', () => {
    expect(
      validateWebSearchPromptConfig({ tavily_api_key: 'tvly-x' }),
    ).toEqual({ ok: true });
  });

  it('camelCase 键名(webSearchProvider/search1apiApiKey)同样识别', () => {
    expect(
      validateWebSearchPromptConfig({
        webSearchProvider: 'search1api',
        search1apiApiKey: 's1-x',
      }),
    ).toEqual({ ok: true });
    const missing = validateWebSearchPromptConfig({
      webSearchProvider: 'search1api',
    });
    expect(missing).toMatchObject({ ok: false });
  });

  it('promptConfig 缺失/null/非对象 → 放行(交由既有透传语义)', () => {
    expect(validateWebSearchPromptConfig(undefined)).toEqual({ ok: true });
    expect(validateWebSearchPromptConfig(null)).toEqual({ ok: true });
    expect(validateWebSearchPromptConfig('not-an-object')).toEqual({
      ok: true,
    });
    expect(validateWebSearchPromptConfig({})).toEqual({ ok: true });
  });
});

describe('sanitizePromptConfigWebSearchKeys (T4.1a)', () => {
  it('活动 provider 仅保留自身 key,剥离其他 provider key', () => {
    const out = sanitizePromptConfigWebSearchKeys({
      system: 's',
      web_search_provider: 'brave',
      brave_api_key: 'b-key',
      tavily_api_key: 't-key',
      search1api_api_key: 's1',
    }) as Record<string, unknown>;
    expect(out.system).toBe('s');
    expect(out.web_search_provider).toBe('brave');
    expect(out.brave_api_key).toBe('b-key');
    expect(out.tavily_api_key).toBeUndefined();
    expect(out.search1api_api_key).toBeUndefined();
  });

  it("provider '' 清除态剥离全部 provider key", () => {
    const out = sanitizePromptConfigWebSearchKeys({
      web_search_provider: '',
      tavily_api_key: 't',
      brave_api_key: 'b',
    }) as Record<string, unknown>;
    expect(out.web_search_provider).toBe('');
    expect(out.tavily_api_key).toBeUndefined();
    expect(out.brave_api_key).toBeUndefined();
  });

  it('keyless provider 剥离全部 key', () => {
    const out = sanitizePromptConfigWebSearchKeys({
      web_search_provider: 'anysearch',
      tavily_api_key: 't',
    }) as Record<string, unknown>;
    expect(out.web_search_provider).toBe('anysearch');
    expect(out.tavily_api_key).toBeUndefined();
  });

  it('legacy 仅 tavily_api_key → 仅保留 tavily', () => {
    const out = sanitizePromptConfigWebSearchKeys({
      system: 's',
      tavily_api_key: 'tvly',
      brave_api_key: 'b',
    }) as Record<string, unknown>;
    expect(out.tavily_api_key).toBe('tvly');
    expect(out.brave_api_key).toBeUndefined();
  });

  it('不修改入参对象', () => {
    const input = {
      web_search_provider: 'tavily',
      tavily_api_key: 'a',
      brave_api_key: 'b',
    };
    sanitizePromptConfigWebSearchKeys(input);
    expect(input.brave_api_key).toBe('b');
  });
});

describe('computeHasWebSearchProvider (T4.1a)', () => {
  it('keyed provider + key → true', () => {
    expect(
      computeHasWebSearchProvider({
        web_search_provider: 'tavily',
        tavily_api_key: 'x',
      }),
    ).toBe(true);
  });

  it('keyless provider → true', () => {
    expect(
      computeHasWebSearchProvider({ web_search_provider: 'youcom' }),
    ).toBe(true);
  });

  it('legacy tavily key → true', () => {
    expect(computeHasWebSearchProvider({ tavily_api_key: 'x' })).toBe(true);
  });

  it('无配置 → false', () => {
    expect(computeHasWebSearchProvider({ system: 's' })).toBe(false);
    expect(computeHasWebSearchProvider(null)).toBe(false);
  });
});
