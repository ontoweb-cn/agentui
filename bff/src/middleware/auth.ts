import type { Context, Next } from 'hono';

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
  
  if (publicPaths.includes(path)) {
    await next();
    return;
  }

  const auth = c.req.header('Authorization');

  if (!auth) {
    return c.json({ code: 401, message: 'Unauthorized: missing Authorization header' }, 401);
  }

  // Token is passed through to intellect-rag backend for validation
  await next();
}
