// P0-1: hiedu Ed25519 JWS 断言签发单元测试。
// 覆盖:header/claims 结构、exp ≤ 60、jti 唯一、kid 选择、env 解析(含 `\n` 转义)。

import { describe, it, expect } from 'vitest';
import {
  createPrivateKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';

import {
  DEFAULT_HIEDU_ASSERT_AUD,
  DEFAULT_HIEDU_ASSERT_ISS,
  DEFAULT_HIEDU_ORG_CODE,
  loadHieduConfig,
  selectHieduSigningKey,
  signHieduAssertion,
  type HieduAssertionConfig,
  type HieduAssertionClaims,
} from './hiedu-assertion';

interface Ed25519Pair {
  publicKey: string;
  privateKey: string;
}

function generateEd25519Pair(): Ed25519Pair {
  return generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

function makeConfig(
  pair: Ed25519Pair,
  overrides: Partial<HieduAssertionConfig> = {},
): HieduAssertionConfig {
  return {
    baseUrl: 'http://hiedu.test',
    iss: DEFAULT_HIEDU_ASSERT_ISS,
    aud: DEFAULT_HIEDU_ASSERT_AUD,
    org: DEFAULT_HIEDU_ORG_CODE,
    keys: [
      {
        kid: 'primary-kid',
        privateKey: createPrivateKey(pair.privateKey),
      },
    ],
    ...overrides,
  };
}

function verifyAssertion(
  assertion: string,
  publicKeyPem: string,
): boolean {
  const [header, payload, signature] = assertion.split('.');
  return verify(
    null,
    Buffer.from(`${header}.${payload}`, 'utf8'),
    publicKeyPem,
    Buffer.from(signature, 'base64url'),
  );
}

describe('signHieduAssertion', () => {
  const pair = generateEd25519Pair();
  const config = makeConfig(pair);
  const nowMs = 1_700_000_000_000;

  it('header 为 {alg:"EdDSA", kid},claims 含完整身份字段', () => {
    const signed = signHieduAssertion({
      config,
      memberId: 'member-1',
      nowMs,
      jti: 'fixed-jti',
    });
    const [encodedHeader, encodedPayload] = signed.assertion.split('.');

    expect(decodePart(encodedHeader)).toEqual({ alg: 'EdDSA', kid: 'primary-kid' });
    const claims = decodePart<HieduAssertionClaims>(encodedPayload);
    expect(claims).toEqual({
      iss: DEFAULT_HIEDU_ASSERT_ISS,
      aud: DEFAULT_HIEDU_ASSERT_AUD,
      sub: 'intellect:member-1',
      org: DEFAULT_HIEDU_ORG_CODE,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + 30,
      jti: 'fixed-jti',
    });
    // 返回值中的 claims 与 payload 一致
    expect(signed.claims).toEqual(claims);
  });

  it('exp 不超过 60 秒,超长 ttl 被 clamp', () => {
    const signed = signHieduAssertion({
      config,
      memberId: 'member-1',
      nowMs,
      ttlSeconds: 600,
    });
    expect(signed.claims.exp - signed.claims.iat).toBeLessThanOrEqual(60);
    expect(signed.claims.exp - signed.claims.iat).toBe(60);
  });

  it('签名可用 Ed25519 公钥验签', () => {
    const signed = signHieduAssertion({
      config,
      memberId: 'member-1',
      nowMs,
    });
    expect(verifyAssertion(signed.assertion, pair.publicKey)).toBe(true);
  });

  it('jti 每请求唯一(randomUUID)', () => {
    const first = signHieduAssertion({ config, memberId: 'member-1', nowMs });
    const second = signHieduAssertion({ config, memberId: 'member-1', nowMs });
    expect(first.claims.jti).not.toBe(second.claims.jti);
    expect(first.claims.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('kid 选择(双密钥轮换)', () => {
  const primaryPair = generateEd25519Pair();
  const nextPair = generateEd25519Pair();
  const config: HieduAssertionConfig = {
    baseUrl: 'http://hiedu.test',
    iss: DEFAULT_HIEDU_ASSERT_ISS,
    aud: DEFAULT_HIEDU_ASSERT_AUD,
    org: DEFAULT_HIEDU_ORG_CODE,
    keys: [
      { kid: 'primary-kid', privateKey: createPrivateKey(primaryPair.privateKey) },
      { kid: 'next-kid', privateKey: createPrivateKey(nextPair.privateKey) },
    ],
  };

  it('未指定 kid → 主密钥', () => {
    const signed = signHieduAssertion({ config, memberId: 'member-1' });
    expect(signed.kid).toBe('primary-kid');
    expect(verifyAssertion(signed.assertion, primaryPair.publicKey)).toBe(true);
  });

  it('指定次密钥 kid → 用次密钥签名', () => {
    const signed = signHieduAssertion({ config, memberId: 'member-1', kid: 'next-kid' });
    expect(signed.kid).toBe('next-kid');
    expect(verifyAssertion(signed.assertion, nextPair.publicKey)).toBe(true);
    // 主密钥无法验签次密钥签名
    expect(verifyAssertion(signed.assertion, primaryPair.publicKey)).toBe(false);
  });

  it('未知 kid → 抛错(不静默降级)', () => {
    expect(() => selectHieduSigningKey(config, 'missing-kid')).toThrow(
      /unknown hiedu signing kid/,
    );
    expect(() =>
      signHieduAssertion({ config, memberId: 'member-1', kid: 'missing-kid' }),
    ).toThrow(/unknown hiedu signing kid/);
  });
});

describe('loadHieduConfig', () => {
  const pair = generateEd25519Pair();
  const nextPair = generateEd25519Pair();

  function baseEnv(): NodeJS.ProcessEnv {
    return {
      HIEDU_AUTH_MODE: 'gateway',
      HIEDU_BASE_URL: 'http://hiedu.test/',
      HIEDU_BFF_ASSERT_KID: 'primary-kid',
      HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM: pair.privateKey,
    };
  }

  it('HIEDU_AUTH_MODE 未设置 → disabled(503)', () => {
    const result = loadHieduConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(503);
      expect(result.error).toBe('HIEDU_PROXY_DISABLED');
    }
  });

  it('gateway 模式缺 HIEDU_BASE_URL → misconfigured(503)', () => {
    const env = baseEnv();
    delete env.HIEDU_BASE_URL;
    const result = loadHieduConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('HIEDU_PROXY_MISCONFIGURED');
      expect(result.message).toContain('HIEDU_BASE_URL');
    }
  });

  it('gateway 模式缺私钥 → misconfigured(503)', () => {
    const env = baseEnv();
    delete env.HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM;
    const result = loadHieduConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('HIEDU_PROXY_MISCONFIGURED');
    }
  });

  it('支持 PEM 中 `\\n` 转义,并应用默认 iss/aud/org', () => {
    const escapedPem = pair.privateKey.replace(/\n/g, '\\n');
    const result = loadHieduConfig({
      ...baseEnv(),
      HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM: escapedPem,
      HIEDU_BASE_URL: 'http://hiedu.test/',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.baseUrl).toBe('http://hiedu.test');
      expect(result.config.iss).toBe(DEFAULT_HIEDU_ASSERT_ISS);
      expect(result.config.aud).toBe(DEFAULT_HIEDU_ASSERT_AUD);
      expect(result.config.org).toBe(DEFAULT_HIEDU_ORG_CODE);
      expect(result.config.keys).toHaveLength(1);
      expect(result.config.keys[0].kid).toBe('primary-kid');
    }
  });

  it('可选次密钥成对配置 → keys 含两个', () => {
    const result = loadHieduConfig({
      ...baseEnv(),
      HIEDU_BFF_ASSERT_KID_NEXT: 'next-kid',
      HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM_NEXT: nextPair.privateKey,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.keys.map((k) => k.kid)).toEqual(['primary-kid', 'next-kid']);
    }
  });

  it('非 Ed25519 私钥(RSA)→ misconfigured(503)', () => {
    const rsa = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const result = loadHieduConfig({
      ...baseEnv(),
      HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM: rsa.privateKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('HIEDU_PROXY_MISCONFIGURED');
      expect(result.message).toContain('Ed25519');
    }
  });

  it('次密钥只配置一项 → misconfigured(503)', () => {
    const result = loadHieduConfig({
      ...baseEnv(),
      HIEDU_BFF_ASSERT_KID_NEXT: 'next-kid',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('HIEDU_PROXY_MISCONFIGURED');
      expect(result.message).toContain('HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM_NEXT');
    }
  });

  it('自定义 iss/aud/org 覆盖默认值', () => {
    const result = loadHieduConfig({
      ...baseEnv(),
      HIEDU_BFF_ASSERT_ISS: 'custom-iss',
      HIEDU_BFF_ASSERT_AUD: 'custom-aud',
      HIEDU_ORG_CODE: 'custom-org',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.iss).toBe('custom-iss');
      expect(result.config.aud).toBe('custom-aud');
      expect(result.config.org).toBe('custom-org');
    }
  });
});
