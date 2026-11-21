import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetIdpTokenStoreForTest,
  deleteIdpTokens,
  getIdpTokens,
  idpSessionKey,
  putIdpTokens,
} from './idp-token-store';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idp-token-store-'));
  process.env.BFF_IDP_TOKEN_STORE_FILE = join(dir, 'map.json');
  __resetIdpTokenStoreForTest();
});

afterEach(() => {
  delete process.env.BFF_IDP_TOKEN_STORE_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe('D2 IdP token 服务端存储', () => {
  it('put/get/delete 按 tenant:subject 存取', () => {
    const key = idpSessionKey('0', 'e2epwd001');
    putIdpTokens(key, {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 900_000,
      issuer: 'https://ai.example/auth',
      sid: 'sid-1',
      subject: 'e2epwd001',
      updatedAt: new Date().toISOString(),
    });
    expect(getIdpTokens(key)?.accessToken).toBe('access-1');
    expect(getIdpTokens(key)?.sid).toBe('sid-1');
    deleteIdpTokens(key);
    expect(getIdpTokens(key)).toBeNull();
  });

  it('空 accessToken 不写入', () => {
    const key = idpSessionKey('0', 'x');
    putIdpTokens(key, {
      accessToken: '',
      expiresAt: Date.now(),
      issuer: 'i',
      subject: 'x',
      updatedAt: '',
    });
    expect(getIdpTokens(key)).toBeNull();
  });
});
