import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { AUTH_COOKIE_NAME } from '../types/auth';

export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path;

  const publicPaths = [
    '/proxy/v1/system/config',
    '/auth/me',
    '/auth/login',
    '/auth/login/channels',
    '/auth/register',
    '/auth/config',
  ];

  // spec-010 v8 B-3 (B1 修复): Wizard 公开端点
  // - /admin/wizard/status: 查询是否需要向导(首次安装时无 admin token)
  // - /admin/wizard/backend-types: 可用后端类型列表(无敏感信息)
  // - /admin/wizard/probe: 探测后端连接(首次安装时无 admin token,SSRF 防护 + 速率限制已就位)
  const publicPrefixes = ['/admin/wizard/status', '/admin/wizard/backend-types', '/admin/wizard/probe'];

  if (publicPaths.includes(path) || publicPrefixes.includes(path)) {
    await next();
    return;
  }

  const auth = c.req.header('Authorization');

  // 社区版:前端传 JWT token 在 Authorization header 中
  if (auth) {
    await next();
    return;
  }

  // 企业版:cookie 模式 — 前端不传 Authorization header,用 imt_token cookie 鉴权
  const cookie = getCookie(c, AUTH_COOKIE_NAME);
  if (cookie) {
    await next();
    return;
  }

  return c.json({ code: 401, message: 'Unauthorized: missing Authorization header or session cookie' }, 401);
}
