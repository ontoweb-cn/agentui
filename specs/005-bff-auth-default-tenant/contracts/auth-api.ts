/**
 * Contract: BFF Auth API(P4b)
 *
 * Authority source: specs/005-bff-auth-default-tenant/contracts/auth-api.ts
 * Implementation: bff/src/routes/auth.ts (P4b)
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend):前端所有认证经 BFF,不直连后端
 * - Principle V (Tenant Isolation):缺省 TenantID=0 不注入 X-Intellect-Team 头
 * - Principle VIII:企业版认证用 member token(imt_*),BFF 管理操作用 API_SERVER_KEY
 *
 * 路由模式:按 BffTenant.authMode 分发
 * - authMode=intellect-rag:透传 intellect-rag /api/v1/auth/*(社区版,零回归)
 * - authMode=intellect-enterprise:调 intellect-team /api/members/* + /api/oauth/*(企业版)
 */

// ---------------------------------------------------------------------------
// BFF Auth 路由端点(前端调用)
// ---------------------------------------------------------------------------

export type BffAuthEndpoint =
  | { method: 'POST'; path: '/api/bff/auth/login'; body: LoginRequestBody }
  | { method: 'POST'; path: '/api/bff/auth/register'; body: RegisterRequestBody }
  | { method: 'POST'; path: '/api/bff/auth/logout' }
  | { method: 'GET'; path: '/api/bff/auth/me' }
  | { method: 'GET'; path: '/api/bff/auth/login/channels' }
  | { method: 'GET'; path: '/api/bff/auth/login/{channel}' }
  | { method: 'GET'; path: '/api/bff/auth/oauth/callback?code=&state=' };

// ---------------------------------------------------------------------------
// 请求/响应类型
// ---------------------------------------------------------------------------

export interface LoginRequestBody {
  /** 企业版:login_name;社区版:email。BFF 按 authMode 映射 */
  email?: string;
  login_name?: string;
  password: string;
}

export interface LoginResponseBody {
  member_id?: string;
  display_name?: string;
  role?: string;
  /** 社区版返回 access_token;企业版 token 存 cookie 不返回 body */
  access_token?: string;
  avatar?: string;
  nickname?: string;
  email?: string;
}

export interface RegisterRequestBody {
  login_name?: string;
  email?: string;
  password: string;
  nickname?: string;
  display_name?: string;
}

export interface UserInfoResponse {
  member_id?: string;
  display_name?: string;
  role?: string;
  email?: string;
  avatar?: string;
  nickname?: string;
}

export interface LoginChannel {
  channel: string;
  display_name: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// authMode 路由规则(BFF 内部实现依据)
// ---------------------------------------------------------------------------

export type AuthMode = 'intellect-rag' | 'intellect-enterprise';

/**
 * 路由规则表:
 *
 * | 端点                         | authMode=intellect-rag            | authMode=intellect-enterprise                          |
 * |-----------------------------|-----------------------------------|--------------------------------------------------------|
 * | POST /auth/login            | 透传 intellect-rag /auth/login    | 调 intellect-team /api/members/login,token 存 cookie   |
 * | POST /auth/register         | 透传 intellect-rag /users         | 调 intellect-team /api/members/register                |
 * | POST /auth/logout           | 透传 intellect-rag /auth/logout   | 调 intellect-team /api/members/logout,清 cookie        |
 * | GET  /auth/me               | 透传 intellect-rag /users/me      | 调 intellect-team /api/members/me(带 cookie token)    |
 * | GET  /auth/login/channels   | 透传 intellect-rag                | 调 intellect-team /api/oauth/providers,转换格式        |
 * | GET  /auth/login/{channel}  | 302 → intellect-rag /auth/login/{channel} | 调 intellect-team /api/oauth/authorize,302 → redirect_uri |
 * | GET  /auth/oauth/callback   | 透传 intellect-rag                | 调 intellect-team /api/oauth/callback + /api/members/{id}/token,Set-Cookie,302 → 首页 |
 *
 * Cookie 规则(企业版):
 * - 名称: imt_token
 * - 值: intellect-team 签发的 imt_* member token
 * - 属性: HttpOnly=true, SameSite=Lax, Path=/, Max-Age=86400(1 天)
 * - 登录成功: Set-Cookie
 * - 登出: Set-Cookie(值为空,Max-Age=0)清除
 */

export interface AuthRoutingRule {
  endpoint: BffAuthEndpoint['path'];
  intellectRagAction: 'passthrough' | 'n/a';
  intellectEnterpriseAction: 'call-members-api' | 'call-oauth-api' | 'call-both';
  cookieAction?: 'set' | 'clear' | 'none';
}

// ---------------------------------------------------------------------------
// Cookie 契约
// ---------------------------------------------------------------------------

export const AUTH_COOKIE_NAME = 'imt_token';

export interface AuthCookieOptions {
  httpOnly: true;
  sameSite: 'Lax';
  path: '/';
  maxAge: number;  // 86400 = 1 day
  secure?: boolean; // 生产环境 true,开发 localhost 豁免
}
