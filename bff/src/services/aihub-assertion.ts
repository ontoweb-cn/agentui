/**
 * aihub 断言（Ed25519 JWS）签发。
 *
 * 与 hiedu 断言同构但不共用密钥：
 * - header `{alg:"EdDSA", kid}`；
 * - claims `{iss,aud,sub:"intellect:{memberId}",iat,exp,jti}`；
 * - TTL ≤ 60s，默认 30s；
 * - 头名 `X-Aihub-Assertion`。
 */

import { randomUUID, type KeyObject } from 'node:crypto';

import {
  parseEd25519PrivateKey,
  signEd25519Jws,
} from './ed25519-jws';

const MAX_EXP_SECONDS = 60;
const DEFAULT_EXP_SECONDS = 30;

export const DEFAULT_AIHUB_ASSERT_ISS = 'gateway';
export const DEFAULT_AIHUB_ASSERT_AUD = 'aihub';

export interface AihubAssertionConfig {
  baseUrl: string;
  iss: string;
  aud: string;
  kid: string;
  privateKey: KeyObject;
}

export interface AihubAssertionClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export type AihubConfigFailureCode =
  | 'AIHUB_PROXY_DISABLED'
  | 'AIHUB_PROXY_MISCONFIGURED';

export type AihubConfigResult =
  | { ok: true; config: AihubAssertionConfig }
  | {
      ok: false;
      statusCode: 503;
      error: AihubConfigFailureCode;
      message: string;
    };

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? '').trim();
}

function misconfigured(message: string): AihubConfigResult {
  return {
    ok: false,
    statusCode: 503,
    error: 'AIHUB_PROXY_MISCONFIGURED',
    message,
  };
}

/** 解析 aihub 代理配置；缺失一律结构化失败，由路由返回 503。 */
export function loadAihubConfig(
  env: NodeJS.ProcessEnv = process.env,
): AihubConfigResult {
  const rawBaseUrl = readEnv(env, 'AIHUB_BASE_URL');
  if (!rawBaseUrl) {
    return misconfigured('AIHUB_BASE_URL is required for the aihub proxy');
  }
  let baseUrl: string;
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`unsupported protocol ${parsed.protocol}`);
    }
    baseUrl = rawBaseUrl.replace(/\/+$/, '');
  } catch {
    return misconfigured('AIHUB_BASE_URL must be a valid http(s) URL');
  }

  const kid = readEnv(env, 'AIHUB_BFF_ASSERT_KID');
  const privateKeyPem = readEnv(env, 'AIHUB_BFF_ASSERT_PRIVATE_KEY_PEM');
  if (!kid || !privateKeyPem) {
    return misconfigured(
      'AIHUB_BFF_ASSERT_KID and AIHUB_BFF_ASSERT_PRIVATE_KEY_PEM are required',
    );
  }
  const privateKey = parseEd25519PrivateKey(privateKeyPem);
  if (!privateKey) {
    return misconfigured(
      `failed to parse AIHUB_BFF_ASSERT_PRIVATE_KEY_PEM for kid "${kid}" (expect PKCS#8 Ed25519 PEM)`,
    );
  }

  return {
    ok: true,
    config: {
      baseUrl,
      iss: readEnv(env, 'AIHUB_BFF_ASSERT_ISS') || DEFAULT_AIHUB_ASSERT_ISS,
      aud: readEnv(env, 'AIHUB_BFF_ASSERT_AUD') || DEFAULT_AIHUB_ASSERT_AUD,
      kid,
      privateKey,
    },
  };
}

export interface SignedAihubAssertion {
  assertion: string;
  kid: string;
  claims: AihubAssertionClaims;
}

export function signAihubAssertion(params: {
  config: AihubAssertionConfig;
  memberId: string;
  nowMs?: number;
  ttlSeconds?: number;
  jti?: string;
}): SignedAihubAssertion {
  const {
    config,
    memberId,
    nowMs = Date.now(),
    ttlSeconds = DEFAULT_EXP_SECONDS,
    jti = randomUUID(),
  } = params;

  const iat = Math.floor(nowMs / 1000);
  const expSeconds = Math.min(
    Math.max(Math.floor(ttlSeconds), 1),
    MAX_EXP_SECONDS,
  );
  const claims: AihubAssertionClaims = {
    iss: config.iss,
    aud: config.aud,
    sub: `intellect:${memberId}`,
    iat,
    exp: iat + expSeconds,
    jti,
  };
  return {
    assertion: signEd25519Jws({
      kid: config.kid,
      privateKey: config.privateKey,
      claims: { ...claims },
    }),
    kid: config.kid,
    claims,
  };
}
