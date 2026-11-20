/**
 * SSO state / PKCE / Cookie 工具（spec-014 FR-021）。
 *
 * - state、nonce、code_verifier 均由 BFF 生成
 * - 通过签名 Cookie 跨副本保存，服务端 10 分钟二次过期校验
 * - 一次性消费：读取后立即删除
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';

export const SSO_STATE_COOKIE_NAME = 'sso_state';
export const SSO_STATE_COOKIE_MAX_AGE_SECONDS = 600;
export const SSO_PROVIDER_COOKIE_NAME = 'sso_provider';
export const SSO_PROVIDER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const payloadSchema = z.object({
  state: z.string().min(1),
  code_verifier: z.string().min(1),
  nonce: z.string().min(1),
  provider_id: z.string().min(1),
  tenant_id: z.string().min(1),
  return_to: z.string(),
  issued_at: z.number().int().positive(),
  silent: z.boolean(),
});

export type SsoStatePayload = z.infer<typeof payloadSchema>;

export interface SsoTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createSsoTransaction(): SsoTransaction {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, nonce, codeVerifier, codeChallenge };
}

export async function writeSsoStateCookie(
  c: Context,
  payload: SsoStatePayload,
  secret: string,
  secure: boolean,
): Promise<void> {
  await setSignedCookie(c, SSO_STATE_COOKIE_NAME, JSON.stringify(payload), secret, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SSO_STATE_COOKIE_MAX_AGE_SECONDS,
    secure,
  });
}

export type ReadSsoStateResult =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'ok'; payload: SsoStatePayload };

/**
 * 读取并立即删除 state Cookie。
 * - absent：没有 Cookie（走旧链路或直接访问）
 * - invalid：验签失败 / JSON 非法 / 过期
 */
export async function readAndClearSsoStateCookie(
  c: Context,
  secret: string,
): Promise<ReadSsoStateResult> {
  const raw = await getSignedCookie(c, secret, SSO_STATE_COOKIE_NAME);
  if (raw === undefined) return { status: 'absent' };

  deleteCookie(c, SSO_STATE_COOKIE_NAME, { path: '/' });

  if (raw === false || typeof raw !== 'string' || raw.length === 0) {
    return { status: 'invalid' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }

  const result = payloadSchema.safeParse(parsed);
  if (!result.success) return { status: 'invalid' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = nowSeconds - result.data.issued_at;
  // 允许 60s 时钟前偏，拒绝超过 10 分钟的历史载荷
  if (age > SSO_STATE_COOKIE_MAX_AGE_SECONDS || age < -60) return { status: 'invalid' };

  return { status: 'ok', payload: result.data };
}

export function ssoStateMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export interface SsoProviderCookiePayload {
  provider_id: string;
  tenant_id: string;
}

export async function writeSsoProviderCookie(
  c: Context,
  payload: SsoProviderCookiePayload,
  secret: string,
  secure: boolean,
): Promise<void> {
  await setSignedCookie(c, SSO_PROVIDER_COOKIE_NAME, JSON.stringify(payload), secret, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SSO_PROVIDER_COOKIE_MAX_AGE_SECONDS,
    secure,
  });
}

export async function readSsoProviderCookie(
  c: Context,
  secret: string,
): Promise<SsoProviderCookiePayload | undefined> {
  const raw = await getSignedCookie(c, secret, SSO_PROVIDER_COOKIE_NAME);
  if (typeof raw !== 'string') return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<SsoProviderCookiePayload>;
    if (typeof parsed.provider_id !== 'string' || typeof parsed.tenant_id !== 'string') {
      return undefined;
    }
    return { provider_id: parsed.provider_id, tenant_id: parsed.tenant_id };
  } catch {
    return undefined;
  }
}

export function clearSsoProviderCookie(c: Context): void {
  deleteCookie(c, SSO_PROVIDER_COOKIE_NAME, { path: '/' });
}

/**
 * returnTo 白名单：仅同源相对路径，拒绝协议相对、反斜杠、控制字符与超长值。
 */
export function sanitizeReturnTo(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value || value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  if (/[\u0000-\u001F\u007F]/.test(value)) return '/';
  return value;
}
