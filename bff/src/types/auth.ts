// @see specs/005-bff-auth-default-tenant/contracts/auth-api.ts (authority source)
/**
 * Contract: BFF Auth Session(P4b)
 *
 * Authority source: specs/005-bff-auth-default-tenant/contracts/auth-api.ts
 * Runtime copy: bff/src/types/auth.ts
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend):前端认证经 BFF,token 存 HttpOnly cookie
 * - Principle V (Tenant Isolation):AuthSession 携带 backendId/authMode 用于路由
 * - Principle VIII:企业版认证用 member token(imt_*),非 API_SERVER_KEY
 */

import type { AuthMode } from './tenant';

// ---------------------------------------------------------------------------
// AuthSession(BFF 内存,不持久化)
// ---------------------------------------------------------------------------

/**
 * 认证会话,单次请求生命周期(cookie 提取 → 注入 context → 请求结束丢弃)。
 * 由 auth-session 中间件从 cookie 提取 token 后构造。
 *
 * 注:memberId 可选 — 中间件仅从 cookie 提取 token,无法解析 memberId。
 * 需 memberId 的路由(如 /auth/me)通过 token 调 intellect-team /api/members/me 解析。
 */
export interface AuthSession {
  /** intellect-team member ID(可选,路由按需解析) */
  memberId?: string;
  /** imt_* member token(从 cookie 提取) */
  token: string;
  /** 当前租户 ID(从 X-Backend-Id header) */
  backendId: string;
  /** 认证模式(来自 BffTenant.authMode,默认 intellect-community) */
  authMode: AuthMode;
}

// ---------------------------------------------------------------------------
// Cookie 契约
// ---------------------------------------------------------------------------

/** member token 存储的 cookie 名称 */
export const AUTH_COOKIE_NAME = 'imt_token';

/** cookie 默认有效期:1 天(86400 秒) */
export const AUTH_COOKIE_MAX_AGE = 86400;
