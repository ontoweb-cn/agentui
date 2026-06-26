import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authSessionMiddleware, AUTH_SESSION_KEY } from './auth-session';
import type { AuthSession } from '../types/auth';
import { AUTH_COOKIE_NAME } from '../types/auth';

interface MockContext {
  req: {
    header: (name: string) => string | undefined;
  };
  set: (key: string, value: unknown) => void;
  get: (key: string) => unknown;
  json: (body: unknown, status?: number) => { body: unknown; status: number };
  storedSession?: AuthSession;
  // Hono getCookie 读取的字段
  _cookie?: string;
}

function createMockContext(
  headers: Record<string, string>,
  cookieValue: string | undefined,
  tenantStore?: unknown,
): MockContext {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  const ctx: MockContext = {
    req: {
      header: (name: string) => normalized[name.toLowerCase()],
    },
    set: (key, value) => {
      if (key === AUTH_SESSION_KEY) {
        ctx.storedSession = value as AuthSession;
      }
    },
    get: (key: string) => (key === 'tenantStore' ? tenantStore : undefined),
    json: (body, status) => ({ body, status: status ?? 200 }),
    _cookie: cookieValue,
  };
  // 模拟 Hono getCookie(c, name) 读取 c.req 上的 cookie
  // auth-session.ts 用 getCookie(c, AUTH_COOKIE_NAME)
  // 我们在 mock 中通过覆盖 req.header 的方式不适用,改用注入 __cookieHeader
  if (cookieValue !== undefined) {
    normalized.cookie = `${AUTH_COOKIE_NAME}=${cookieValue}`;
  }
  return ctx;
}

// 覆盖 hono/cookie 的 getCookie mock
vi.mock('hono/cookie', () => ({
  getCookie: (c: MockContext, name: string) => {
    if (name !== AUTH_COOKIE_NAME) return undefined;
    // 从 mock context 的 _cookie 字段读取(模拟 cookie 提取)
    return c._cookie;
  },
}));

describe('authSessionMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 cookie imt_token 时提取 token 并注入 AuthSession', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'tenant-enterprise' },
      'imt_abc123',
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedSession).toBeDefined();
    expect(ctx.storedSession?.token).toBe('imt_abc123');
    expect(ctx.storedSession?.tenantId).toBe('tenant-enterprise');
    expect(ctx.storedSession?.authMode).toBe('intellect-rag'); // 默认
  });

  it('有 cookie + BffTenant.authMode=intellect-enterprise 时注入正确 authMode', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'tenant-enterprise' },
      'imt_xyz789',
      {
        getTenant: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, authMode: 'intellect-enterprise' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(ctx.storedSession?.authMode).toBe('intellect-enterprise');
    expect(ctx.storedSession?.token).toBe('imt_xyz789');
  });

  it('无 cookie 时不阻塞,不注入 AuthSession', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'tenant-enterprise' },
      undefined,
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedSession).toBeUndefined();
  });

  it('cookie 值为空字符串时忽略,等同于无 cookie', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'tenant-enterprise' },
      '',
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedSession).toBeUndefined();
  });

  it('有 cookie 但无 X-Tenant-Id 时不注入,不阻塞', async () => {
    const ctx = createMockContext({}, 'imt_abc123');
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedSession).toBeUndefined();
  });

  it('无 tenantStore 时不报错,authMode 默认 intellect-rag', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'tenant-001' },
      'imt_token1',
      undefined,
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(ctx.storedSession?.authMode).toBe('intellect-rag');
    expect(ctx.storedSession?.token).toBe('imt_token1');
  });

  it('tenantStore 无对应 tenant 时 authMode 默认 intellect-rag(向后兼容)', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'unknown-tenant' },
      'imt_token2',
      { getTenant: () => undefined },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(ctx.storedSession?.authMode).toBe('intellect-rag');
  });

  it('BffTenant.authMode 未设置时默认 intellect-rag(向后兼容旧配置)', async () => {
    const ctx = createMockContext(
      { 'X-Tenant-Id': 'tenant-001' },
      'imt_token3',
      {
        getTenant: (id: string) =>
          id === 'tenant-001' ? { id, /* 无 authMode 字段 */ } : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await authSessionMiddleware(ctx as never, next);

    expect(ctx.storedSession?.authMode).toBe('intellect-rag');
  });
});
