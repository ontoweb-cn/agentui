import type { Context, Next } from 'hono';

export async function authMiddleware(c: Context, next: Next) {
  const auth = c.req.header('Authorization');

  if (!auth) {
    return c.json({ code: 401, message: 'Unauthorized: missing Authorization header' }, 401);
  }

  // Token is passed through to intellect-rag backend for validation
  await next();
}
