/**
 * 网关授权码兑换客户端（spec-014 FR-002 / plan-p2 §5.3）。
 *
 * POST /api/members/oauth/exchange —— 不携带 API_SERVER_KEY，
 * 由网关完成 IdP token 校验与 member token 签发。
 */

export interface SsoExchangeRequest {
  grant: 'authorization_code';
  provider_id: string;
  code: string;
  code_verifier: string;
  redirect_uri: string;
  nonce: string;
}

export interface SsoExchangeMember {
  id: string;
  display_name: string;
  role: string;
  enabled: number;
}

export interface SsoExchangeResponse {
  token: string;
  token_id: string;
  expires_at: number;
  member: SsoExchangeMember;
  email?: string | null;
  tenant_id: string;
}

export type SsoExchangeResult =
  | { ok: true; data: SsoExchangeResponse }
  | { ok: false; status: number; code: string; message: string };

export const SSO_EXCHANGE_PATH = '/api/members/oauth/exchange';

/** D2 option A: BFF 完成 IdP 兑换后，把 id_token 交给网关换取 member token。 */
export const ID_TOKEN_EXCHANGE_PATH = '/api/oauth/exchange-id-token';

export interface IdTokenExchangeRequest {
  id_token: string;
  provider_id: string;
  tenant_id?: string;
}

function extractErrorCode(body: unknown, status: number): string {
  const record = (body ?? {}) as Record<string, unknown>;
  const flat = record.error;
  if (typeof flat === 'string' && flat.trim()) return flat.trim();
  if (flat && typeof flat === 'object') {
    const nested = (flat as Record<string, unknown>).code;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return `http_${status}`;
}

async function postExchange(
  url: string,
  payload: unknown,
  timeoutMs: number,
): Promise<SsoExchangeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = (await resp.json().catch(() => null)) as unknown;

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        code: extractErrorCode(body, resp.status),
        message:
          ((body as { message?: string } | null)?.message ?? 'token exchange failed').slice(0, 300),
      };
    }

    const data = body as SsoExchangeResponse | null;
    if (!data || typeof data.token !== 'string' || !data.token) {
      return { ok: false, status: 502, code: 'invalid_response', message: 'exchange response missing token' };
    }

    return { ok: true, data };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      ok: false,
      status: 502,
      code: aborted ? 'timeout' : 'network_error',
      message: aborted ? 'exchange timed out' : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeAuthorizationCode(
  baseUrl: string,
  payload: SsoExchangeRequest,
  timeoutMs: number,
): Promise<SsoExchangeResult> {
  return postExchange(`${baseUrl}${SSO_EXCHANGE_PATH}`, payload, timeoutMs);
}

export async function exchangeIdTokenForMember(
  baseUrl: string,
  payload: IdTokenExchangeRequest,
  timeoutMs: number,
): Promise<SsoExchangeResult> {
  return postExchange(`${baseUrl}${ID_TOKEN_EXCHANGE_PATH}`, payload, timeoutMs);
}
