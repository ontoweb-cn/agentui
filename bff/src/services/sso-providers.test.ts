/**
 * §9 S1:providers 出站须经 safeFetch(非裸 fetch)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetch = vi.fn();

vi.mock('./ssrf-guard', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
}));

import { clearProviderCache, getLoginProviders } from './sso-providers';
import type { SsoConfig } from './sso-config';

const baseConfig: SsoConfig = {
  enabled: true,
  stateSecret: 'x'.repeat(32),
  publicOrigin: 'https://app.example',
  providers: null,
  silentRelogin: true,
  exchangeTimeoutMs: 5000,
  providerCacheMs: 0,
  allowInsecure: false,
};

describe('sso-providers (§9 S1 safeFetch)', () => {
  beforeEach(() => {
    clearProviderCache();
    safeFetch.mockReset();
  });

  afterEach(() => {
    clearProviderCache();
  });

  it('经 safeFetch 拉取公开 providers', async () => {
    safeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'intellect-auth',
          enabled: true,
          usage: 'login',
          client_id: 'ia-agentui',
          authorize_url: 'https://idp.example/authorize',
          scopes: 'openid',
          pkce: 'S256',
          name: '统一认证',
        },
      ],
    });

    const sel = await getLoginProviders('http://gateway.example:9091', 't0', baseConfig);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = safeFetch.mock.calls[0]!;
    expect(url).toBe('http://gateway.example:9091/api/members/oauth/providers');
    expect(opts).toMatchObject({ method: 'GET', timeoutMs: 5000 });
    expect(sel.providers).toHaveLength(1);
    expect(sel.providers[0]?.clientId).toBe('ia-agentui');
  });

  it('safeFetch 抛 SSRF → 向上抛出', async () => {
    safeFetch.mockRejectedValue(new Error('SSRF blocked: 127.0.0.1 is a private IP'));
    await expect(
      getLoginProviders('http://127.0.0.1:9091', 't0', baseConfig),
    ).rejects.toThrow(/SSRF blocked/);
  });
});
