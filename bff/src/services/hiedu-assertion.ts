/**
 * hiedu 门户断言(JWS)签发 — P0-1。
 *
 * 背景:
 * - AgentUI 前端通过 HttpOnly cookie `imt_token` 登录 BFF;
 * - hiedu 只接受网关注入的 Ed25519 JWS 断言头 `X-Hiedu-Assertion`;
 * - BFF 用本服务即时签发断言,claims 绑定 intellect member 身份。
 *
 * 设计:
 * - 不引第三方 JWT 库,直接用 Node 内置 crypto(`sign(null, ...)` for Ed25519);
 * - header `{alg:"EdDSA", kid}`,claims `{iss, aud, sub:"intellect:{memberId}", org, iat, exp, jti}`;
 * - `exp` 不超过 60 秒,`jti` 每请求唯一;
 * - 主密钥 + 可选次密钥(kid 轮换),按 kid 选择。
 *
 * 配置从 env 读取,缺省/不完整配置不抛进程级错误,由路由返回 503。
 */

import {
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';

/** 断言 header 固定算法(Ed25519 在 JWS 中记为 EdDSA) */
const JWS_ALG = 'EdDSA';
/** 断言最大有效期(秒),需求硬上限 60 */
const MAX_EXP_SECONDS = 60;
/** 默认有效期(秒):低于硬上限,为 BFF 与 hiedu 的时钟偏差留余量 */
const DEFAULT_EXP_SECONDS = 30;

export const DEFAULT_HIEDU_ASSERT_ISS = 'gateway';
export const DEFAULT_HIEDU_ASSERT_AUD = 'hiedu';
export const DEFAULT_HIEDU_ORG_CODE = 'wust';

export interface HieduSigningKey {
  /** JWS header.kid */
  kid: string;
  /** PKCS#8 Ed25519 私钥 */
  privateKey: KeyObject;
}

export interface HieduAssertionConfig {
  /** hiedu 服务基地址(已去掉尾部斜杠) */
  baseUrl: string;
  /** JWS claims.iss */
  iss: string;
  /** JWS claims.aud */
  aud: string;
  /** JWS claims.org(组织/高校编码) */
  org: string;
  /** 可用签名密钥:主密钥在首位,可选次密钥在后 */
  keys: HieduSigningKey[];
}

export interface HieduAssertionClaims {
  iss: string;
  aud: string;
  sub: string;
  org: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface SignedHieduAssertion {
  /** 完整 JWS(header.payload.signature) */
  assertion: string;
  /** 实际使用的 kid */
  kid: string;
  /** 已签名的 claims(便于审计/测试) */
  claims: HieduAssertionClaims;
}

export type HieduConfigFailureCode =
  | 'HIEDU_PROXY_DISABLED'
  | 'HIEDU_PROXY_MISCONFIGURED';

export type HieduConfigResult =
  | { ok: true; config: HieduAssertionConfig }
  | {
      ok: false;
      statusCode: 503;
      error: HieduConfigFailureCode;
      message: string;
    };

function misconfigured(message: string): HieduConfigResult {
  return {
    ok: false,
    statusCode: 503,
    error: 'HIEDU_PROXY_MISCONFIGURED',
    message,
  };
}

/**
 * 支持 env 中的转义换行:`\n` 字面量替换为真实换行。
 * (PEM 通过 docker/env 文件传递时常被写成单行 + `\n`)
 */
function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? '').trim();
}

/**
 * 解析 Ed25519 PKCS#8 私钥;失败返回 undefined(调用方转 503,不抛进程级错误)。
 * 拒绝非 Ed25519 密钥(RSA 等无法用 `sign(null, ...)` 生成 EdDSA 断言)。
 */
function parseEd25519PrivateKey(pem: string): KeyObject | undefined {
  try {
    const key = createPrivateKey(normalizePem(pem));
    return key.asymmetricKeyType === 'ed25519' ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从 env 解析 hiedu 断言配置。
 *
 * 启动安全:任何缺失/非法配置都返回结构化失败(不 throw),由路由返回 503。
 * 仅有 `HIEDU_AUTH_MODE=gateway` 时才启用断言代理。
 */
export function loadHieduConfig(
  env: NodeJS.ProcessEnv = process.env,
): HieduConfigResult {
  const mode = readEnv(env, 'HIEDU_AUTH_MODE').toLowerCase();
  if (mode !== 'gateway') {
    return {
      ok: false,
      statusCode: 503,
      error: 'HIEDU_PROXY_DISABLED',
      message:
        `hiedu assertion proxy is disabled: HIEDU_AUTH_MODE=${mode || '<unset>'} ` +
        '(set HIEDU_AUTH_MODE=gateway to enable)',
    };
  }

  const rawBaseUrl = readEnv(env, 'HIEDU_BASE_URL');
  if (!rawBaseUrl) {
    return misconfigured('HIEDU_BASE_URL is required when HIEDU_AUTH_MODE=gateway');
  }
  let baseUrl: string;
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`unsupported protocol ${parsed.protocol}`);
    }
    baseUrl = rawBaseUrl.replace(/\/+$/, '');
  } catch {
    return misconfigured('HIEDU_BASE_URL must be a valid http(s) URL');
  }

  const kid = readEnv(env, 'HIEDU_BFF_ASSERT_KID');
  const privateKeyPem = readEnv(env, 'HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM');
  if (!kid || !privateKeyPem) {
    return misconfigured(
      'HIEDU_BFF_ASSERT_KID and HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM are required when HIEDU_AUTH_MODE=gateway',
    );
  }

  const keys: HieduSigningKey[] = [];
  const primaryKey = parseEd25519PrivateKey(privateKeyPem);
  if (!primaryKey) {
    return misconfigured(
      `failed to parse HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM for kid "${kid}" (expect PKCS#8 Ed25519 PEM)`,
    );
  }
  keys.push({ kid, privateKey: primaryKey });

  const nextKid = readEnv(env, 'HIEDU_BFF_ASSERT_KID_NEXT');
  const nextPem = readEnv(env, 'HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM_NEXT');
  if (nextKid || nextPem) {
    if (!nextKid || !nextPem) {
      return misconfigured(
        'HIEDU_BFF_ASSERT_KID_NEXT and HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM_NEXT must be set together',
      );
    }
    const nextKey = parseEd25519PrivateKey(nextPem);
    if (!nextKey) {
      return misconfigured(
        `failed to parse HIEDU_BFF_ASSERT_PRIVATE_KEY_PEM_NEXT for kid "${nextKid}" (expect PKCS#8 Ed25519 PEM)`,
      );
    }
    keys.push({ kid: nextKid, privateKey: nextKey });
  }

  return {
    ok: true,
    config: {
      baseUrl,
      iss: readEnv(env, 'HIEDU_BFF_ASSERT_ISS') || DEFAULT_HIEDU_ASSERT_ISS,
      aud: readEnv(env, 'HIEDU_BFF_ASSERT_AUD') || DEFAULT_HIEDU_ASSERT_AUD,
      org: readEnv(env, 'HIEDU_ORG_CODE') || DEFAULT_HIEDU_ORG_CODE,
      keys,
    },
  };
}

/**
 * 按 kid 选择签名密钥;未指定时使用主密钥(keys[0])。
 * kid 不存在时抛错(配置期问题,不应静默降级到其它密钥)。
 */
export function selectHieduSigningKey(
  config: HieduAssertionConfig,
  kid?: string,
): HieduSigningKey {
  const primary = config.keys[0];
  if (!primary) {
    throw new Error('no hiedu signing key configured');
  }
  if (!kid) {
    return primary;
  }
  const found = config.keys.find((key) => key.kid === kid);
  if (!found) {
    throw new Error(`unknown hiedu signing kid: ${kid}`);
  }
  return found;
}

export interface SignHieduAssertionParams {
  config: HieduAssertionConfig;
  /** intellect member id;claims.sub = `intellect:{memberId}` */
  memberId: string;
  /** 当前时间(毫秒),测试可注入 */
  nowMs?: number;
  /** 有效期(秒),会被 clamp 到 (0, 60] */
  ttlSeconds?: number;
  /** 指定签名 kid(轮换/测试),缺省主密钥 */
  kid?: string;
  /** 指定 jti(测试),缺省 randomUUID() */
  jti?: string;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * 即时签发 hiedu Ed25519 JWS 断言。
 *
 * header: `{alg:"EdDSA", kid}`
 * claims: `{iss, aud, sub:"intellect:{memberId}", org, iat, exp, jti}`
 * 签名: `crypto.sign(null, Buffer.from(`${header}.${payload}`), privateKey)`
 */
export function signHieduAssertion(
  params: SignHieduAssertionParams,
): SignedHieduAssertion {
  const {
    config,
    memberId,
    nowMs = Date.now(),
    ttlSeconds = DEFAULT_EXP_SECONDS,
    jti = randomUUID(),
  } = params;

  const key = selectHieduSigningKey(config, params.kid);

  const iat = Math.floor(nowMs / 1000);
  const expSeconds = Math.min(
    Math.max(Math.floor(ttlSeconds), 1),
    MAX_EXP_SECONDS,
  );
  const claims: HieduAssertionClaims = {
    iss: config.iss,
    aud: config.aud,
    sub: `intellect:${memberId}`,
    org: config.org,
    iat,
    exp: iat + expSeconds,
    jti,
  };

  const header = { alg: JWS_ALG, kid: key.kid };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    key.privateKey,
  );

  return {
    assertion: `${signingInput}.${signature.toString('base64url')}`,
    kid: key.kid,
    claims,
  };
}
