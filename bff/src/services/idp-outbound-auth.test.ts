import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IdpPassthroughConfig } from './idp-config';
import { __resetIdpRefreshInflightForTest } from './idp-client';
import { idpSessionKey, putIdpTokens } from './idp-token-store';
import { resolveUserAuthorization } from './idp-outbound-auth';

const config: IdpPassthroughConfig = {
  enabled: true,
  issuer: 'https://ai.example/auth',
  clientId: 'ia-agentui',
  clientSecret: '',
  tokenUrl: 'https://ai.example/auth/api/login/oauth/access_token',
  audiences: ['ia-agentui'],
  refreshSingleflight: true,
  exchangeTimeoutMs: 5000,
  tokenSkewMs: 30_000,
};

let dir = '';
const KEY = idpSessionKey('0', 'e2epwd001');

function b64(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
const fakeJwt = (payload: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idp-outbound-'));
  process.env.BFF_IDP_TOKEN_STORE_FILE = join(dir, 'map.json');
  __resetIdpRefreshInflightForTest();
});

afterEach(() => {
  delete process.env.BFF_IDP_TOKEN_STORE_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe('D2 出站 Authorization 选择', () => {
  it('开关关闭 → 回退 imt_token', async () => {
    const auth = await resolveUserAuthorization({
      config: { ...config, enabled: false },
      sessionKey: KEY,
      imtToken: 'imt_abc',
    });
    expect(auth).toBe('Bearer imt_abc');
  });

  it('无 IdP 会话 → 回退 imt_token', async () => {
    const auth = await resolveUserAuthorization({
      config,
      sessionKey: KEY,
      imtToken: 'imt_abc',
    });
    expect(auth).toBe('Bearer imt_abc');
  });

  it('有效 JWT → 使用 IdP JWT', async () => {
    putIdpTokens(KEY, {
      accessToken: 'jwt-access',
      expiresAt: 1_000_000 + 900_000,
      issuer: config.issuer,
      subject: 'e2epwd001',
      updatedAt: '',
    });
    const auth = await resolveUserAuthorization({
      config,
      sessionKey: KEY,
      imtToken: 'imt_abc',
      nowMs: 1_000_000,
    });
    expect(auth).toBe('Bearer jwt-access');
  });

  it('即将过期 → 刷新成功后使用新 JWT', async () => {
    putIdpTokens(KEY, {
      accessToken: 'old-access',
      refreshToken: 'r1',
      expiresAt: 1_000_000 + 1_000,
      issuer: config.issuer,
      subject: 'e2epwd001',
      updatedAt: '',
    });
    const newAccess = fakeJwt({ sub: 'e2epwd001' });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: newAccess, expires_in: 900 }),
    })) as unknown as typeof fetch;

    const auth = await resolveUserAuthorization({
      config,
      sessionKey: KEY,
      imtToken: 'imt_abc',
      nowMs: 1_000_000,
      fetchImpl,
    });
    expect(auth).toBe(`Bearer ${newAccess}`);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('刷新失败 → fail-closed（空 Authorization）', async () => {
    putIdpTokens(KEY, {
      accessToken: 'old-access',
      refreshToken: 'r1',
      expiresAt: 1_000_000 + 1_000,
      issuer: config.issuer,
      subject: 'e2epwd001',
      updatedAt: '',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    })) as unknown as typeof fetch;

    const auth = await resolveUserAuthorization({
      config,
      sessionKey: KEY,
      imtToken: 'imt_abc',
      nowMs: 1_000_000,
      fetchImpl,
    });
    expect(auth).toBe('');
  });

  it('已过期且无 refresh token → fail-closed（不回退 imt_token）', async () => {
    putIdpTokens(KEY, {
      accessToken: 'old-access',
      expiresAt: 1_000_000,
      issuer: config.issuer,
      subject: 'e2epwd001',
      updatedAt: '',
    });
    const auth = await resolveUserAuthorization({
      config,
      sessionKey: KEY,
      imtToken: 'imt_abc',
      nowMs: 1_000_000,
    });
    expect(auth).toBe('');
  });
});
