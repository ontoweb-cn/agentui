/**
 * Ed25519 JWS 断言公共实现（hiedu / aihub 共用）。
 *
 * 仅负责：PEM 解析、base64url JSON、签名。
 * claims 结构与 aud/iss/header 名由各调用方决定，避免两套实现漂移。
 */

import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export const JWS_ALG = 'EdDSA';

/** 支持 env 中的转义换行：`\n` 字面量替换为真实换行。 */
export function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

/** 解析 Ed25519 PKCS#8 私钥；失败返回 undefined（调用方转 503）。 */
export function parseEd25519PrivateKey(pem: string): KeyObject | undefined {
  try {
    const key = createPrivateKey(normalizePem(pem));
    return key.asymmetricKeyType === 'ed25519' ? key : undefined;
  } catch {
    return undefined;
  }
}

export function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export interface SignEd25519JwsParams {
  kid: string;
  privateKey: KeyObject;
  claims: Record<string, unknown>;
}

/** 生成 compact JWS：`base64url(header).base64url(claims).base64url(sig)`。 */
export function signEd25519Jws(params: SignEd25519JwsParams): string {
  const header = { alg: JWS_ALG, kid: params.kid };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(params.claims)}`;
  const signature = sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    params.privateKey,
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}
