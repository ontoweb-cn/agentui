// @see specs/005-bff-auth-default-tenant/contracts/auth-api.ts
/**
 * AuthSession 中间件 — 从 HttpOnly cookie 提取 member token,注入 AuthSession。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend):token 存 cookie,前端不接触明文
 * - Principle V (Tenant Isolation):AuthSession 携带 tenantId/authMode
 * - Principle VIII:企业版用 member token(imt_*),非 API_SERVER_KEY
 *
 * 行为:
 * - 从 cookie 提取 imt_token(AUTH_COOKIE_NAME)
 * - 结合 X-Tenant-Id header + BffTenant.authMode 构造 AuthSession
 * - 无 cookie 时不阻塞(仅 /auth/me 等需认证端点自行检查)
 * - cookie 格式错误(空值)忽略,等同于无 cookie
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AuthSession } from '../types/auth';
import { AUTH_COOKIE_NAME } from '../types/auth';

/** Hono context key for injected AuthSession */
export const AUTH_SESSION_KEY = 'authSession';

/**
 * AuthSession 中间件。
 *
 * 不阻塞:无 cookie 或 cookie 无效时,不注入 AuthSession(留空),
 * 由需认证的路由(如 GET /auth/me)自行检查 c.get('authSession') 是否存在。
 */
export const authSessionMiddleware: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, AUTH_COOKIE_NAME);

  // 无 cookie 或空值:不注入,继续(不阻塞)
  if (!token) {
    await next();
    return;
  }

  // 缺省 TenantID="0"(与 auth.ts 公开端点策略一致,未传 header 时用缺省租户)
  const tenantId = c.req.header('X-Tenant-Id') || '0';

  // 从 TenantStore 读取 BffTenant.authMode(默认 intellect-rag,向后兼容)
  const tenantStore = c.get('tenantStore');
  let authMode: 'intellect-rag' | 'intellect-enterprise' = 'intellect-rag';
  if (tenantStore) {
    const bffTenant = tenantStore.getTenant(tenantId);
    if (bffTenant?.authMode) {
      authMode = bffTenant.authMode;
    }
  }

  const session: AuthSession = {
    token,
    tenantId,
    authMode,
  };

  c.set(AUTH_SESSION_KEY, session);
  await next();
};

/**
 * 从 Hono context 获取 AuthSession。
 * 需认证的路由用此 helper 取出中间件注入的 session。
 */
export function getAuthSession(c: {
  get: (key: string) => unknown;
}): AuthSession | undefined {
  return c.get(AUTH_SESSION_KEY) as AuthSession | undefined;
}
