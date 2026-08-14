// 方案 A 阶段一组合测试:锁住「authSessionMiddleware 必须先于 backendContextMiddleware 挂载」
// 这一关键顺序假设 —— 只有 authSessionMiddleware 先写入 AUTH_SESSION_KEY,
// backendContextMiddleware 才能读到 session 并注入 ctx.sessionToken,
// 使企业版画布/agents 以 imt_(而非 RAG 超管 JWT)访问 intellect-rag。
// 见 docs/enterprise-rag-admin-credential-analysis.md 方案 A (C1)。

import { describe, it, expect, vi } from 'vitest';
import { authSessionMiddleware, AUTH_SESSION_KEY } from './auth-session';
import { backendContextMiddleware, BACKEND_CONTEXT_KEY } from './backend-context';
import { AUTH_COOKIE_NAME } from '../types/auth';
import type { BackendContext } from '../types/tenant';

interface MockContext {
  req: {
    header: (name: string) => string | undefined;
    path: string;
  };
  set: (key: string, value: unknown) => void;
  get: (key: string) => unknown;
  stored: Record<string, unknown>;
  _cookie?: string;
}

function createMockContext(
  headers: Record<string, string>,
  cookieValue: string | undefined,
): MockContext {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  const ctx: MockContext = {
    req: {
      header: (name: string) => normalized[name.toLowerCase()],
      path: '/canvas',
    },
    // 按 key 存取,使 authSessionMiddleware 写入的 AUTH_SESSION_KEY
    // 能被 backendContextMiddleware 的 getAuthSession(c) 读回。
    set: (key, value) => {
      ctx.stored[key] = value;
    },
    get: (key: string) => ctx.stored[key],
    stored: {},
    _cookie: cookieValue,
  };
  return ctx;
}

// 复用 auth-session.test.ts 的 mock 手法:模拟 hono/cookie 的 getCookie 读取 mock context 的 _cookie。
vi.mock('hono/cookie', () => ({
  getCookie: (c: MockContext, name: string) =>
    name === AUTH_COOKIE_NAME ? c._cookie : undefined,
}));

describe('authSessionMiddleware → backendContextMiddleware 组合(方案 A C1)', () => {
  it('有 imt_ cookie 时,先挂 session 中间件后 backendContext 注入 sessionToken', async () => {
    const ctx = createMockContext(
      { 'X-Backend-Id': 'tenant-enterprise', 'X-User-Id': 'user-001' },
      'imt_abc123',
    );
    const next = vi.fn().mockResolvedValue(undefined);

    // 顺序即 index.ts 的挂载顺序:authSessionMiddleware 先,backendContextMiddleware 后
    await authSessionMiddleware(ctx as never, next);
    await backendContextMiddleware(ctx as never, next);

    expect(ctx.stored[AUTH_SESSION_KEY]).toBeDefined();
    const stored = ctx.stored[BACKEND_CONTEXT_KEY] as BackendContext | undefined;
    expect(stored).toBeDefined();
    expect(stored?.sessionToken).toBe('imt_abc123');
    expect(stored?.backendId).toBe('tenant-enterprise');
  });

  it('无 cookie 时不注入 sessionToken(现行为,避免误注入超管兜底之外的身份)', async () => {
    const ctx = createMockContext(
      { 'X-Backend-Id': 'tenant-enterprise', 'X-User-Id': 'user-001' },
      undefined,
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);
    await backendContextMiddleware(ctx as never, next);

    const stored = ctx.stored[BACKEND_CONTEXT_KEY] as BackendContext | undefined;
    expect(stored).toBeDefined();
    expect(stored?.sessionToken).toBeUndefined();
  });
});
