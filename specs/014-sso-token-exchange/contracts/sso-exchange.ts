/**
 * SSO Token Exchange 契约 — BFF 侧唯一权威源（spec-014）。
 *
 * 对应网关端点：POST /api/members/oauth/exchange
 * 错误结构沿用 members API 的 {error, message}（不是 auth.rs 的 {error:{code,message}}）。
 */

/** 网关兑换端点路径（BFF 侧不得硬编码他处）。 */
export const SSO_EXCHANGE_PATH = '/api/members/oauth/exchange';

/** BFF 保存 state/PKCE 的签名 Cookie 名与有效期。 */
export const SSO_STATE_COOKIE_NAME = 'sso_state';
export const SSO_STATE_COOKIE_MAX_AGE_SECONDS = 600;

/** BFF 的 OIDC 回调路径（须与 IdP client redirectUris、网关白名单一致）。 */
export const SSO_CALLBACK_PATH = '/api/bff/auth/oauth/callback';

/** authorize 请求使用的 scope：profile 是读取 unified_id 的前置。 */
export const SSO_OIDC_SCOPE = 'openid profile email';

/** 静默重登使用 prompt=none；IdP 无会话时返回 login_required。 */
export const SSO_SILENT_PROMPT = 'none';

/** v1 仅支持授权码模式；其他值网关返回 400 unsupported_grant。 */
export type SsoExchangeGrant = 'authorization_code';

export interface SsoExchangeRequest {
  grant: SsoExchangeGrant;
  /** 网关 oauth_providers.id，例如 "intellect-auth"。 */
  provider_id: string;
  /** IdP 回跳的授权码（一次性）。 */
  code: string;
  /** PKCE S256 code_verifier，与 authorize 请求一一对应。 */
  code_verifier: string;
  /** 必须命中 provider.redirect_uris 白名单，否则 400。 */
  redirect_uri: string;
  /** BFF 生成并在 id_token 中回显的 nonce。 */
  nonce: string;
}

export interface SsoExchangeMember {
  id: string;
  display_name: string;
  role: string;
  /** 1 = 启用；0 = 禁用（网关已在兑换时拒绝，正常不会返回 0）。 */
  enabled: number;
}

export interface SsoExchangeResponse {
  /** imt_* member token，仅 BFF 可见，写入 HttpOnly Cookie。 */
  token: string;
  token_id: string;
  /** epoch 秒。 */
  expires_at: number;
  member: SsoExchangeMember;
  email?: string | null;
  tenant_id: string;
}

export type SsoExchangeErrorCode =
  | 'invalid_request'
  | 'forbidden'
  | 'unsupported_grant'
  | 'unknown_provider'
  | 'provider_disabled'
  | 'invalid_provider'
  | 'redirect_uri_not_allowed'
  | 'token_exchange_failed'
  | 'invalid_token'
  | 'token_expired'
  | 'nonce_mismatch'
  | 'account_disabled'
  | 'identity_conflict'
  | 'tenant_mismatch'
  | 'member_not_provisioned'
  | 'too_many_requests'
  | 'internal_error'
  | 'service_unavailable';

export interface SsoExchangeError {
  error: SsoExchangeErrorCode;
  message: string;
}

/** HTTP 状态码映射（与 spec §端点契约 一致）。 */
export const SSO_ERROR_STATUS: Record<SsoExchangeErrorCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  unsupported_grant: 400,
  unknown_provider: 400,
  provider_disabled: 400,
  invalid_provider: 400,
  redirect_uri_not_allowed: 400,
  token_exchange_failed: 400,
  invalid_token: 401,
  token_expired: 401,
  nonce_mismatch: 401,
  account_disabled: 401,
  identity_conflict: 403,
  tenant_mismatch: 403,
  member_not_provisioned: 403,
  too_many_requests: 429,
  internal_error: 500,
  service_unavailable: 503,
};

/**
 * BFF 签名 Cookie 载荷：state/PKCE/nonce 必须跨副本可读，
 * 因此不能放在进程内 Map（spec FR-021）。
 */
export interface SsoStateCookiePayload {
  /** 与回调 query.state 做等值比较。 */
  state: string;
  /** PKCE S256 code_verifier 明文（Cookie 需加密或签名）。 */
  code_verifier: string;
  nonce: string;
  provider_id: string;
  /** BFF 租户 ID；回调按此解析网关实例，忽略 query 中的 tenant（防篡改）。 */
  tenant_id: string;
  /** 登录成功后的回跳路径，必须同源相对路径。 */
  return_to: string;
  /** 创建时间（epoch 秒），用于服务端二次过期校验。 */
  issued_at: number;
  /** true = 本次为 prompt=none 静默重登；失败后最多一次交互式重试。 */
  silent: boolean;
}
