/**
 * D2-3：出站用户态调用的 Authorization 选择。
 *
 * 开关开启且存在有效的 IdP access token 时使用 `Bearer <IdP JWT>`；
 * 即将过期则先刷新（单飞）。已持有 IdP 会话但刷新失败时 **fail-closed**
 * （返回空 Authorization），避免回退长期 imt_token 弱化撤销与 TTL；
 * 仅在开关关闭、无会话键或该用户从未建立 IdP 会话时回退 imt_token。
 */
import { isIdpPassthroughUsable, type IdpPassthroughConfig } from './idp-config';
import { refreshIdpTokens } from './idp-client';
import { getIdpTokens, putIdpTokens } from './idp-token-store';

export interface ResolveUserAuthorizationOptions {
  config: IdpPassthroughConfig;
  sessionKey: string;
  /** 现有 BFF 会话中的 imt_token（回退凭证）。 */
  imtToken: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

function bearer(token: string): string {
  return token ? `Bearer ${token}` : '';
}

export async function resolveUserAuthorization(
  opts: ResolveUserAuthorizationOptions,
): Promise<string> {
  const fallback = bearer(opts.imtToken);
  if (!isIdpPassthroughUsable(opts.config) || !opts.sessionKey) {
    return fallback;
  }

  const tokens = getIdpTokens(opts.sessionKey);
  if (!tokens) {
    return fallback;
  }

  const now = opts.nowMs ?? Date.now();
  if (tokens.expiresAt - now > opts.config.tokenSkewMs) {
    return bearer(tokens.accessToken);
  }

  if (!tokens.refreshToken) {
    // Fail-closed: an expired IdP token must not silently fall back to the
    // long-lived imt_token, otherwise logout/TTL guarantees are weakened.
    console.warn('[idp-outbound-auth] access token expired without refresh token; denying request');
    return '';
  }

  const refreshed = await refreshIdpTokens(
    opts.config,
    tokens.refreshToken,
    opts.fetchImpl ?? fetch,
    now,
  );
  if (!refreshed.ok) {
    console.warn(
      `[idp-outbound-auth] refresh failed (${refreshed.code}); denying request (fail-closed)`,
    );
    return '';
  }

  putIdpTokens(opts.sessionKey, refreshed.tokens);
  return bearer(refreshed.tokens.accessToken);
}
