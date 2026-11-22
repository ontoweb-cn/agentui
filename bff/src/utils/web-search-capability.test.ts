import { describe, expect, it } from 'vitest';
import {
  buildExternalChatInfoFromSession,
  hasTavilyKeyConfig,
  hasWebSearchProviderConfig,
  redactWebSearchSecretsFromPromptConfig,
  resolveWebSearchProvider,
} from './web-search-capability';

describe('hasWebSearchProviderConfig (TC-T41A-01)', () => {
  it('empty config → false', () => {
    expect(hasWebSearchProviderConfig({})).toBe(false);
    expect(hasWebSearchProviderConfig(undefined)).toBe(false);
  });

  it('keyless anysearch/youcom → true without key', () => {
    expect(
      hasWebSearchProviderConfig({ web_search_provider: 'anysearch' }),
    ).toBe(true);
    expect(hasWebSearchProviderConfig({ web_search_provider: 'youcom' })).toBe(
      true,
    );
  });

  it('tavily with non-empty key → true; empty key → false', () => {
    expect(
      hasWebSearchProviderConfig({
        web_search_provider: 'tavily',
        tavily_api_key: 'tvly-1',
      }),
    ).toBe(true);
    expect(
      hasWebSearchProviderConfig({
        web_search_provider: 'tavily',
        tavily_api_key: '  ',
      }),
    ).toBe(false);
  });

  it('legacy: no provider + tavily_api_key → true', () => {
    expect(hasWebSearchProviderConfig({ tavily_api_key: 'legacy' })).toBe(true);
    expect(resolveWebSearchProvider({ tavily_api_key: 'legacy' })).toBe(
      'tavily',
    );
  });

  it("explicit clear web_search_provider:'' does not fall back to tavily", () => {
    expect(
      hasWebSearchProviderConfig({
        web_search_provider: '',
        tavily_api_key: 'still-there',
      }),
    ).toBe(false);
  });

  it('exa with matching key → true; mismatched tavily-only → false', () => {
    expect(
      hasWebSearchProviderConfig({
        web_search_provider: 'exa',
        exa_api_key: 'exa-1',
      }),
    ).toBe(true);
    expect(
      hasWebSearchProviderConfig({
        web_search_provider: 'exa',
        tavily_api_key: 'tvly-1',
      }),
    ).toBe(false);
  });
});

describe('buildExternalChatInfoFromSession (TC-T41A-02/05)', () => {
  it('emits dual flags and never leaks api keys', () => {
    const info = buildExternalChatInfoFromSession({
      title: 'Demo',
      promptConfig: {
        web_search_provider: 'exa',
        exa_api_key: 'secret-exa',
        tavily_api_key: 'secret-tavily',
        prologue: 'hi',
      },
    });
    expect(info).toEqual({
      title: 'Demo',
      avatar: undefined,
      prologue: 'hi',
      llm_id: '',
      has_tavily_key: true,
      has_web_search_provider: true,
    });
    const serialized = JSON.stringify(info);
    expect(serialized).not.toMatch(/_api_key/);
    expect(serialized).not.toContain('secret');
  });

  it('has_tavily_key false when only other provider configured', () => {
    expect(hasTavilyKeyConfig({ exa_api_key: 'x' })).toBe(false);
    const info = buildExternalChatInfoFromSession({
      title: 'x',
      promptConfig: { web_search_provider: 'anysearch' },
    });
    expect(info.has_web_search_provider).toBe(true);
    expect(info.has_tavily_key).toBe(false);
  });
});

describe('redactWebSearchSecretsFromPromptConfig (review hardening)', () => {
  it('strips snake/camel key fields and keeps non-secret config', () => {
    const input = {
      web_search_provider: 'exa',
      exa_api_key: 'secret',
      tavilyApiKey: 'also-secret',
      system: 'sys',
      prologue: 'hi',
    };
    const out = redactWebSearchSecretsFromPromptConfig(input) as Record<
      string,
      unknown
    >;
    expect(out).toEqual({
      web_search_provider: 'exa',
      system: 'sys',
      prologue: 'hi',
    });
    expect(input.exa_api_key).toBe('secret'); // 不修改入参
  });
});
