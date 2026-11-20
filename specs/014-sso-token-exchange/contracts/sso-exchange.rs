//! SSO Token Exchange 契约 — 网关侧唯一权威源（spec-014）。
//!
//! 端点：`POST /api/members/oauth/exchange`
//! 错误体沿用 members API 的 `{error, message}`（`ErrorResp`），
//! 不要混用 `auth.rs` 的 `{error:{code,message}}`。

use serde::{Deserialize, Serialize};

/// 路由常量：注册到 members_api 的 Router，而非 `/api/oauth/*`。
pub const SSO_EXCHANGE_PATH: &str = "/api/members/oauth/exchange";

/// 请求体。v1 仅支持 `authorization_code`，其他值返回 400 `unsupported_grant`。
#[derive(Debug, Clone, Deserialize)]
pub struct SsoExchangeReq {
    pub grant: String,
    pub provider_id: String,
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    #[serde(default)]
    pub nonce: String,
}

/// 成员脱敏视图（与 `MemberPublic` 对齐）。
#[derive(Debug, Clone, Serialize)]
pub struct SsoExchangeMember {
    pub id: String,
    pub display_name: String,
    pub role: String,
    pub enabled: i32,
}

/// 响应体：`expires_at` / `tenant_id` 为本端点新增字段（向后兼容）。
#[derive(Debug, Clone, Serialize)]
pub struct SsoExchangeResp {
    /// `imt_*` member token，仅 BFF 可见。
    pub token: String,
    pub token_id: String,
    /// epoch 秒。
    pub expires_at: i64,
    pub member: SsoExchangeMember,
    pub email: Option<String>,
    pub tenant_id: String,
}

/// 错误码（与 spec §端点契约 一一对应）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SsoExchangeErrorCode {
    InvalidRequest,
    UnsupportedGrant,
    UnknownProvider,
    ProviderDisabled,
    InvalidProvider,
    RedirectUriNotAllowed,
    TokenExchangeFailed,
    InvalidToken,
    TokenExpired,
    NonceMismatch,
    AccountDisabled,
    IdentityConflict,
    TenantMismatch,
    MemberNotProvisioned,
    TooManyRequests,
    InternalError,
    ServiceUnavailable,
}

impl SsoExchangeErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::UnsupportedGrant => "unsupported_grant",
            Self::UnknownProvider => "unknown_provider",
            Self::ProviderDisabled => "provider_disabled",
            Self::InvalidProvider => "invalid_provider",
            Self::RedirectUriNotAllowed => "redirect_uri_not_allowed",
            Self::TokenExchangeFailed => "token_exchange_failed",
            Self::InvalidToken => "invalid_token",
            Self::TokenExpired => "token_expired",
            Self::NonceMismatch => "nonce_mismatch",
            Self::AccountDisabled => "account_disabled",
            Self::IdentityConflict => "identity_conflict",
            Self::TenantMismatch => "tenant_mismatch",
            Self::MemberNotProvisioned => "member_not_provisioned",
            Self::TooManyRequests => "too_many_requests",
            Self::InternalError => "internal_error",
            Self::ServiceUnavailable => "service_unavailable",
        }
    }

    pub fn status(self) -> u16 {
        match self {
            Self::InvalidRequest
            | Self::UnsupportedGrant
            | Self::UnknownProvider
            | Self::ProviderDisabled
            | Self::InvalidProvider
            | Self::RedirectUriNotAllowed
            | Self::TokenExchangeFailed => 400,
            Self::InvalidToken
            | Self::TokenExpired
            | Self::NonceMismatch
            | Self::AccountDisabled => 401,
            Self::TenantMismatch | Self::MemberNotProvisioned | Self::IdentityConflict => 403,
            Self::TooManyRequests => 429,
            Self::InternalError => 500,
            Self::ServiceUnavailable => 503,
        }
    }
}

/// 从 discovery URL 派生 issuer（`iss` 校验用）。
///
/// `.../.well-known/openid-configuration` → `...`；已是 issuer 时仅去尾斜杠。
pub fn issuer_from_discovery_url(discovery_url: &str) -> String {
    discovery_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/.well-known/openid-configuration")
        .trim_end_matches('/')
        .to_string()
}

/// `OAuthProvider.extra_metadata` 中的 exchange 扩展配置（v1.3 不新增 DB 列）。
#[derive(Debug, Clone)]
pub struct SsoProviderExt {
    /// JSON 数组；为空表示该 provider 不允许 exchange 模式。
    pub redirect_uris: Vec<String>,
    /// 0 = 关闭 JIT 建号（默认）；1 = 开启。
    pub auto_provision: i32,
    /// 覆盖全局 TTL（秒）；None 用 `INTELLECT_OAUTH_TOKEN_TTL_SECS`。
    pub token_ttl_secs: Option<i64>,
    /// 可选对账 claim（`cas` / `unified_id`）；空字符串表示关闭。
    /// 命中既有 member 时绑定 `(provider_id, sub)`，不新建账号。
    pub member_id_claim: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issuer_strips_well_known_suffix() {
        assert_eq!(
            issuer_from_discovery_url(
                "https://ai.wust.edu.cn/auth/.well-known/openid-configuration"
            ),
            "https://ai.wust.edu.cn/auth"
        );
        assert_eq!(
            issuer_from_discovery_url("https://ai.wust.edu.cn/auth/"),
            "https://ai.wust.edu.cn/auth"
        );
    }

    #[test]
    fn error_codes_map_to_expected_status() {
        assert_eq!(SsoExchangeErrorCode::RedirectUriNotAllowed.status(), 400);
        assert_eq!(SsoExchangeErrorCode::TenantMismatch.status(), 403);
        assert_eq!(SsoExchangeErrorCode::TooManyRequests.status(), 429);
        assert_eq!(
            SsoExchangeErrorCode::ServiceUnavailable.as_str(),
            "service_unavailable"
        );
    }
}
