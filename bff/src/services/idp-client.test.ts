import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IdpPassthroughConfig } from './idp-config';
import {
  __resetIdpRefreshInflightForTest,
  decodeJwtPayloadUnsafe,
  exchangeCodeForIdpTokens,
  refreshIdpTokens,
} from './idp-client';

const config: IdpPassthroughConfig = {
  enabled: true,
  issuer: 'https://ai.example/auth',
  clientId: 'ia-agentui',
  clientSecret: 'secret',
  tokenUrl: 'https://ai.example/auth/api/login/oauth/access_token',
  audiences: ['ia-agentui'],
  refreshSingleflight: true,
  exchangeTimeoutMs: 5000,
  tokenSkewMs: 30_000,
};

function b64(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  __resetIdpRefreshInflightForTest();
  vi.restoreAllMocks();
});

describe('D2 IdP OIDC client', () => {
  it('无信任解码 JWT payload', () => {
    expect(decodeJwtPayloadUnsafe(fakeJwt({ sub: 'u1', sid: 's1' }))).toEqual({
      sub: 'u1',
      sid: 's1',
    });
    expect(decodeJwtPayloadUnsafe('not-a-jwt')).toBeNull();
  });

  it('授权码交换：解析 access/refresh/sid/sub/expires', async () => {
    const access = fakeJwt({ sub: 'e2epwd001', sid: 'sid-1', exp: 999 });
    const idToken = fakeJwt({ sub: 'e2epwd001', sid: 'sid-1' });
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: access, id_token: idToken, refresh_token: 'r1', expires_in: 900 }),
    ) as unknown as typeof fetch;

    const result = await exchangeCodeForIdpTokens(
      config,
      { code: 'c', codeVerifier: 'v', redirectUri: 'https://app/cb' },
      fetchImpl,
      1_000_000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.accessToken).toBe(access);
      expect(result.idToken).toBe(idToken);
      expect(result.tokens.refreshToken).toBe('r1');
      expect(result.tokens.subject).toBe('e2epwd001');
      expect(result.tokens.sid).toBe('sid-1');
      expect(result.tokens.expiresAt).toBe(1_000_000 + 900_000);
    }
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code_verifier=v');
  });

  it('IdP 错误响应 → 结构化失败（不抛异常）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400),
    ) as unknown as typeof fetch;
    const result = await exchangeCodeForIdpTokens(
      config,
      { code: 'c', codeVerifier: 'v', redirectUri: 'x' },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('invalid_grant');
    }
  });

  it('并发 refresh 单飞：5 并发只请求 IdP 一次', async () => {
    let calls = 0;
    const access = fakeJwt({ sub: 'u1' });
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({ access_token: access, expires_in: 900 });
    }) as unknown as typeof fetch;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => refreshIdpTokens(config, 'r1', fetchImpl)),
    );
    expect(calls).toBe(1);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('单飞关闭时每次 refresh 都请求（回滚开关）', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return jsonResponse({ access_token: fakeJwt({ sub: 'u1' }), expires_in: 900 });
    }) as unknown as typeof fetch;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        refreshIdpTokens({ ...config, refreshSingleflight: false }, 'r1', fetchImpl),
      ),
    );
    expect(calls).toBe(3);
  });
});
