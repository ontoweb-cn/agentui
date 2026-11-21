/**
 * D2-3：AgentUI BFF 自有 OIDC client（默认关闭）。
 *
 * - 授权码交换：`code + PKCE` → access/refresh token（服务端持有）
 * - 刷新：refresh_token grant，可选单飞（并发刷新只打一次 IdP）
 *
 * 本模块不校验 JWT 签名：签名/iss/aud 由 intellect-team 的用户 JWT 分支验证；
 * 这里只做无信任解码，用于提取 `sub`/`sid` 与过期时间。
 */
import type { IdpPassthroughConfig } from './idp-config';
import type { IdpTokenSet } from './idp-token-store';

export interface IdpTokenExchangeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export type IdpTokenResult =
  | { ok: true; tokens: IdpTokenSet; idToken?: string }
  | { ok: false; status: number; code: string; message: string };

/** 无信任解码 JWT payload（仅用于读取 sub/sid/exp，不做签名校验）。 */
export function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function buildTokenSet(
  config: IdpPassthroughConfig,
  body: RawTokenResponse,
  nowMs: number,
  previousRefreshToken?: string,
): IdpTokenSet | null {
  const accessToken = asString(body.access_token);
  if (!accessToken) return null;
  const idToken = asString(body.id_token);
  const idClaims = idToken ? decodeJwtPayloadUnsafe(idToken) : null;
  const accessClaims = decodeJwtPayloadUnsafe(accessToken);
  const subject =
    asString(idClaims?.sub) ?? asString(accessClaims?.sub) ?? '';
  if (!subject) return null;
  const sid = asString(idClaims?.sid) ?? asString(accessClaims?.sid);
  const expiresIn = Number(body.expires_in);
  const ttlSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900;

  return {
    accessToken,
    refreshToken: asString(body.refresh_token) ?? previousRefreshToken,
    expiresAt: nowMs + ttlSeconds * 1000,
    issuer: config.issuer,
    sid,
    subject,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

async function postTokenEndpoint(
  config: IdpPassthroughConfig,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: RawTokenResponse } | { ok: false; status: number; code: string; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.exchangeTimeoutMs);
  try {
    const params = new URLSearchParams(form);
    if (config.clientSecret) params.set('client_secret', config.clientSecret);
    const resp = await fetchImpl(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    const body = (await resp.json().catch(() => null)) as (RawTokenResponse & {
      error?: unknown;
      error_description?: unknown;
    }) | null;
    if (!resp.ok) {
      const code =
        asString(body?.error) ?? `http_${resp.status}`;
      return {
        ok: false,
        status: resp.status,
        code,
        message:
          asString(body?.error_description) ?? 'idp token request failed',
      };
    }
    return { ok: true, body: body ?? {} };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      ok: false,
      status: 502,
      code: aborted ? 'timeout' : 'network_error',
      message: aborted ? 'idp token request timed out' : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCodeForIdpTokens(
  config: IdpPassthroughConfig,
  params: IdpTokenExchangeParams,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<IdpTokenResult> {
  const result = await postTokenEndpoint(
    config,
    {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: config.clientId,
      code_verifier: params.codeVerifier,
    },
    fetchImpl,
  );
  if (!result.ok) return result;
  const tokens = buildTokenSet(config, result.body, nowMs);
  if (!tokens) {
    return { ok: false, status: 502, code: 'invalid_response', message: 'token response missing sub/access_token' };
  }
  return { ok: true, tokens, idToken: asString(result.body.id_token) };
}

const inflightRefresh = new Map<string, Promise<IdpTokenResult>>();

/** 单测用：清空单飞表。 */
export function __resetIdpRefreshInflightForTest(): void {
  inflightRefresh.clear();
}

export async function refreshIdpTokens(
  config: IdpPassthroughConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<IdpTokenResult> {
  if (!refreshToken) {
    return { ok: false, status: 400, code: 'missing_refresh_token', message: 'refresh token is empty' };
  }
  const key = `${config.tokenUrl}|${refreshToken}`;

  const run = async (): Promise<IdpTokenResult> => {
    const result = await postTokenEndpoint(
      config,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
      },
      fetchImpl,
    );
    if (!result.ok) return result;
    const tokens = buildTokenSet(config, result.body, nowMs, refreshToken);
    if (!tokens) {
      return { ok: false, status: 502, code: 'invalid_response', message: 'refresh response missing sub/access_token' };
    }
    return { ok: true, tokens, idToken: asString(result.body.id_token) };
  };

  if (!config.refreshSingleflight) {
    return run();
  }
  const existing = inflightRefresh.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    inflightRefresh.delete(key);
  });
  inflightRefresh.set(key, promise);
  return promise;
}
