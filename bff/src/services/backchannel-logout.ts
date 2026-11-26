/**
 * OIDC Back-Channel Logout 令牌验签（agentui-sso-logout-loop A1）。
 *
 * IdP（intellect-auth）outbox 以 `logout_token=<jwt>` 表单投递（logout_delivery_worker.go:262）；
 * 令牌 claims：iss=IdP origin、aud=[client_id]、sub=用户名、sid（可选）、
 * events 含 backchannel-logout、无 nonce（object/token_logout.go:53）。
 * 校验失败抛 LogoutTokenVerifyError（路由层映射 400，IdP 按退避重试）。
 */
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  // jose v6:注入面为 createLocalJWKSet / createRemoteJWKSet 返回类型
  type LocalJWKSet,
  type RemoteJWKSet,
} from 'jose';

export const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export class LogoutTokenVerifyError extends Error {}

export interface VerifyLogoutTokenOptions {
  issuer: string;
  audience: string;
  /**
   * 单测注入：默认按 issuer 发现文档拉取远程 JWKS（缓存）。
   * 评审修复(L-RP1-03):jose v6 注入面为 createLocalJWKSet/createRemoteJWKSet 返回类型。
   */
  jwks?: LocalJWKSet | RemoteJWKSet;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function getRemoteJwks(issuer: string) {
  const cached = jwksCache.get(issuer);
  if (cached) {
    return cached;
  }
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  // 评审 F-Q3:发现文档拉取加超时,防 IdP 半开连接挂住接收端
  const resp = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) {
    throw new LogoutTokenVerifyError(`IdP discovery unavailable: ${resp.status}`);
  }
  const discovery = (await resp.json()) as { issuer?: string; jwks_uri?: string };
  if (!discovery.jwks_uri) {
    throw new LogoutTokenVerifyError('IdP discovery missing jwks_uri');
  }
  // M6:discovery 自报的 issuer 必须与配置一致(OIDC Discovery §4.3 要求精确匹配;
  // 末尾斜杠按 auth 的口径归一化)。防止信任锚被指向一个自称别名的 JWKS 源。
  const normalize = (v: string) => v.trim().replace(/\/+$/, '');
  if (!discovery.issuer || normalize(discovery.issuer) !== normalize(issuer)) {
    throw new LogoutTokenVerifyError(
      `IdP discovery issuer mismatch: ${discovery.issuer ?? '(missing)'} != ${issuer}`,
    );
  }
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  jwksCache.set(issuer, jwks);
  return jwks;
}

export async function verifyLogoutToken(
  token: string,
  opts: VerifyLogoutTokenOptions,
): Promise<JWTPayload> {
  const key = opts.jwks ?? (await getRemoteJwks(opts.issuer));
  const { payload } = await jwtVerify(token, key, {
    issuer: opts.issuer,
    audience: opts.audience,
  });

  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || !(BACKCHANNEL_LOGOUT_EVENT in events)) {
    throw new LogoutTokenVerifyError('missing backchannel-logout event');
  }
  // OIDC Back-Channel Logout §2.4：登出令牌不得携带 nonce
  if (payload.nonce !== undefined) {
    throw new LogoutTokenVerifyError('nonce must not be present in a logout token');
  }
  // 评审 F-R2：iat 新鲜度窗口 ±10 分钟（投递时重新生成令牌，重试亦新鲜；
  // jose 默认不校验 iat——防历史令牌长期重放）
  if (typeof payload.iat !== 'number' || Math.abs(Date.now() / 1000 - payload.iat) > 600) {
    throw new LogoutTokenVerifyError('iat outside acceptance window');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new LogoutTokenVerifyError('sub required (sid-based targeting not supported yet)');
  }
  return payload;
}

/** 单测用：清空 JWKS 缓存。 */
export function __resetBackchannelJwksCacheForTest(): void {
  jwksCache.clear();
}
