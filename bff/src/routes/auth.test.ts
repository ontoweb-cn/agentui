// Multi-Harness P4b (US1):auth 路由单元测试
// Constitution Principle VII (Test-First):测试先于/同步于实现。
// 覆盖:企业版登录成功/失败/502、社区版登录透传、/auth/me 企业版/社区版。
// Mock fetch + TenantStore,隔离路由层逻辑。

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from './auth';
import type { TenantStore } from '../types/stores';
import type { BffTenant } from '../types/tenant';
import type { AuthSession } from '../types/auth';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';
import { AUTH_COOKIE_NAME } from '../types/auth';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const enterpriseTenant: BffTenant = {
  id: 'tenant-enterprise',
  name: 'Enterprise',
  intellectTenantId: '0',
  intellectBackendId: 'intellect-enterprise-default',
  authMode: 'intellect-enterprise',
  createdAt: '2026-06-26T00:00:00Z',
  updatedAt: '2026-06-26T00:00:00Z',
};

const ragTenant: BffTenant = {
  id: 'tenant-rag',
  name: 'RAG',
  intellectBackendId: 'intellect-rag-default',
  authMode: 'intellect-rag',
  createdAt: '2026-06-26T00:00:00Z',
  updatedAt: '2026-06-26T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockTenantStore(tenants: BffTenant[]): TenantStore {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getTenant: vi.fn((id: string) => tenants.find((t) => t.id === id)),
    listTenants: vi.fn(() => tenants),
    createTenant: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setCanvasBinding: vi.fn(),
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };
}

interface TestVariables {
  tenantStore: TenantStore;
  [AUTH_SESSION_KEY]?: AuthSession;
}

function createApp(
  tenantStore: TenantStore,
  session?: AuthSession,
): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('tenantStore', tenantStore);
    if (session) {
      c.set(AUTH_SESSION_KEY, session);
    }
    await next();
  });
  app.route('/', authRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth 路由 (P4b US1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认环境变量
    process.env.INTELLECT_ENTERPRISE_BASE_URL = 'http://mock-enterprise:9381';
    process.env.INTELLECT_RAG_HOST = 'mock-rag';
    process.env.PYTHON_API_PORT = '9380';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /api/bff/auth/config — 认证配置(公开端点)
  // -------------------------------------------------------------------------

  it('auth config:企业版 tenant → 返回 authMode=intellect-enterprise', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/config', {
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.authMode).toBe('intellect-enterprise');
  });

  it('auth config:社区版 tenant → 返回 authMode=intellect-rag', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/config', {
      headers: { 'X-Tenant-Id': 'tenant-rag' },
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.authMode).toBe('intellect-rag');
  });

  it('auth config:无 X-Tenant-Id → 默认 intellect-rag', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/config');

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.authMode).toBe('intellect-rag');
  });

  // -------------------------------------------------------------------------
  // POST /api/bff/auth/login — 企业版
  // -------------------------------------------------------------------------

  it('US1:企业版登录成功 → 200 + Set-Cookie + 不含 token 的 body', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          member_id: 'm-001',
          display_name: 'Alice',
          role: 'member',
          token: 'imt_abc123',
          permissions: ['chat', 'read'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const resp = await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ login_name: 'alice', password: 'secret' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ login_name: 'alice', password: 'secret' }),
      }),
    );

    expect(resp.status).toBe(200);
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toContain('imt_token=imt_abc123');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');

    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data).toEqual({
      member_id: 'm-001',
      display_name: 'Alice',
      role: 'member',
    });
    // 关键:token 不在 body(只在 cookie)
    expect(JSON.stringify(body)).not.toContain('imt_abc123');
  });

  it('US1:企业版登录支持 email → login_name 字段映射(前端社区版字段兼容)', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          member_id: 'm-002',
          display_name: 'Bob',
          role: 'member',
          token: 'imt_xyz',
          permissions: [],
        }),
        { status: 200 },
      ),
    );

    await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ email: 'bob@example.com', password: 'pw' }),
    });

    // email 映射到 login_name
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ login_name: 'bob@example.com', password: 'pw' }),
      }),
    );
  });

  it('US1:企业版登录失败(401 无效凭据)→ 401 + 无 Set-Cookie', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 }),
    );

    const resp = await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ login_name: 'alice', password: 'wrong' }),
    });

    expect(resp.status).toBe(401);
    expect(resp.headers.get('set-cookie')).toBeNull();
    const body = await resp.json();
    expect(body.code).toBe(401);
    expect(body.message).toContain('Invalid credentials');
  });

  it('US1:企业版登录 intellect-team 不可达 → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ login_name: 'alice', password: 'secret' }),
    });

    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.code).toBe(502);
    expect(body.message).toContain('intellect-team unreachable');
  });

  it('US1:企业版登录缺 login_name → 400', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ password: 'secret' }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('login_name');
  });

  it('US1:无 X-Tenant-Id header → 400', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_name: 'alice', password: 'secret' }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.message).toContain('X-Tenant-Id');
  });

  // -------------------------------------------------------------------------
  // POST /api/bff/auth/login — 社区版透传
  // -------------------------------------------------------------------------

  it('US1:社区版登录(authMode=intellect-rag)透传到 intellect-rag /api/v1/auth/login', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'rag-token-xxx',
          email: 'alice@rag.com',
          nickname: 'Alice',
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-rag',
      },
      body: JSON.stringify({ email: 'alice@rag.com', password: 'secret' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'alice@rag.com', password: 'secret' }),
      }),
    );

    expect(resp.status).toBe(200);
    // 社区版:不设置 HttpOnly cookie(前端自己存 access_token)
    expect(resp.headers.get('set-cookie')).toBeNull();
    const body = await resp.json();
    expect(body.data.access_token).toBe('rag-token-xxx');
  });

  it('US1:authMode 未设置时默认走社区版透传(向后兼容)', async () => {
    const legacyTenant: BffTenant = {
      id: 'tenant-legacy',
      name: 'Legacy',
      intellectBackendId: 'intellect-rag-default',
      // 无 authMode 字段
      createdAt: '2026-06-26T00:00:00Z',
      updatedAt: '2026-06-26T00:00:00Z',
    };
    const tenantStore = createMockTenantStore([legacyTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
    );

    await app.request('/api/bff/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-legacy',
      },
      body: JSON.stringify({ email: 'a@b.com', password: 'p' }),
    });

    // 默认透传到 intellect-rag
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/login',
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/bff/auth/me — 企业版
  // -------------------------------------------------------------------------

  it('US1:企业版 /auth/me 有 cookie → 调 intellect-team /api/members/me', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_abc123',
      tenantId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(tenantStore, session);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          member_id: 'm-001',
          display_name: 'Alice',
          role: 'member',
          email: 'alice@enterprise.com',
          permissions: ['chat'],
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/api/bff/auth/me', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer imt_abc123',
        }),
      }),
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.member_id).toBe('m-001');
    expect(body.data.display_name).toBe('Alice');
    expect(body.data.email).toBe('alice@enterprise.com');
  });

  it('US1:企业版 /auth/me 无 cookie(session 缺失)→ 401', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore); // 不注入 session

    const resp = await app.request('/api/bff/auth/me', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.code).toBe(401);
    expect(body.message).toContain('no valid session');
  });

  it('US1:企业版 /auth/me token 无效(intellect-team 返回 401)→ 401', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_invalid',
      tenantId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(tenantStore, session);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'token expired' }), { status: 401 }),
    );

    const resp = await app.request('/api/bff/auth/me', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // GET /api/bff/auth/me — 社区版
  // -------------------------------------------------------------------------

  it('US1:社区版 /auth/me 透传到 intellect-rag /api/v1/users/me(带 Authorization)', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const session: AuthSession = {
      token: 'rag-access-token',
      tenantId: 'tenant-rag',
      authMode: 'intellect-rag',
    };
    const app = createApp(tenantStore, session);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-1',
          email: 'alice@rag.com',
          nickname: 'Alice',
          role: 'user',
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/api/bff/auth/me', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-rag' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/users/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer rag-access-token',
        }),
      }),
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.email).toBe('alice@rag.com');
  });

  // -------------------------------------------------------------------------
  // POST /api/bff/auth/register — 企业版
  // -------------------------------------------------------------------------

  it('US2:企业版注册成功 → 201 + {member_id, registration_pending}', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ member_id: 'm-new', registration_pending: 0 }),
        { status: 201 },
      ),
    );

    const resp = await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        login_name: 'newuser',
        password: 'pw123',
        display_name: 'New User',
        email: 'new@enterprise.com',
      }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          login_name: 'newuser',
          password: 'pw123',
          display_name: 'New User',
          email: 'new@enterprise.com',
        }),
      }),
    );

    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data.member_id).toBe('m-new');
    expect(body.data.registration_pending).toBe(0);
  });

  it('US2:企业版注册支持 nickname→display_name 字段映射', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ member_id: 'm-nick', registration_pending: 1 }),
        { status: 201 },
      ),
    );

    await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        email: 'nick@enterprise.com',
        password: 'pw',
        nickname: 'NickName',
      }),
    });

    // email→login_name, nickname→display_name
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          login_name: 'nick@enterprise.com',
          password: 'pw',
          display_name: 'NickName',
          email: 'nick@enterprise.com',
        }),
      }),
    );
  });

  it('US2:企业版注册冲突(login_name 已存在)→ 409', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'login_name already in use' }), { status: 409 }),
    );

    const resp = await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        login_name: 'existing',
        password: 'pw',
        display_name: 'Dup',
      }),
    });

    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.code).toBe(409);
    expect(body.message).toContain('Registration conflict');
  });

  it('US2:企业版注册开关关闭 → 403', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'registration disabled' }), { status: 403 }),
    );

    const resp = await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        login_name: 'x',
        password: 'p',
        display_name: 'X',
      }),
    });

    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body.message).toContain('Registration disabled');
  });

  it('US2:企业版注册 intellect-team 不可达 → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        login_name: 'x',
        password: 'p',
        display_name: 'X',
      }),
    });

    expect(resp.status).toBe(502);
  });

  it('US2:企业版注册缺必填字段 → 400', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ password: 'p' }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.message).toContain('required');
  });

  // -------------------------------------------------------------------------
  // POST /api/bff/auth/register — 社区版透传
  // -------------------------------------------------------------------------

  it('US2:社区版注册透传到 intellect-rag /api/v1/users', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'u-new' }), { status: 201 }),
    );

    const resp = await app.request('/api/bff/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-rag',
      },
      body: JSON.stringify({ email: 'a@b.com', password: 'p', nickname: 'A' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'p', nickname: 'A' }),
      }),
    );

    expect(resp.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // POST /api/bff/auth/logout — 企业版
  // -------------------------------------------------------------------------

  it('US2:企业版登出成功 → 200 + 清 cookie + 调 intellect-team /api/members/logout', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_logout',
      tenantId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(tenantStore, session);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const resp = await app.request('/api/bff/auth/logout', {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer imt_logout',
        }),
      }),
    );

    expect(resp.status).toBe(200);
    // cookie 应被清除(Max-Age=0 或空值)
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toMatch(/imt_token=;/);
    const body = await resp.json();
    expect(body.data.logged_out).toBe(true);
  });

  it('US2:企业版登出后 /auth/me 返回 401(无有效 session)', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    // 登出后 cookie 已清,auth-session 中间件无法提取 token → 无 session
    const app = createApp(tenantStore); // 不注入 session

    const resp = await app.request('/api/bff/auth/me', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(401);
  });

  it('US2:企业版登出 intellect-team 不可达 → 仍清 cookie + 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_x',
      tenantId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(tenantStore, session);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/api/bff/auth/logout', {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    // 网络错误也清 cookie(本地登出),但返回 502
    expect(resp.status).toBe(502);
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toMatch(/imt_token=;/);
  });

  it('US2:企业版登出 token 已过期(intellect-team 返回 401)→ 仍清 cookie + 200(用户视角已登出)', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_expired',
      tenantId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(tenantStore, session);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'token expired' }), { status: 401 }),
    );

    const resp = await app.request('/api/bff/auth/logout', {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    // 上游 401 但本地 cookie 已清,返回 200(用户视角已登出)
    expect(resp.status).toBe(200);
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toMatch(/imt_token=;/);
    const body = await resp.json();
    expect(body.data.logged_out).toBe(true);
  });

  it('US2:无 cookie 登出也清 cookie + 200(防御性,允许登出已过期会话)', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore); // 不注入 session

    const resp = await app.request('/api/bff/auth/logout', {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('set-cookie')).toMatch(/imt_token=;/);
    const body = await resp.json();
    expect(body.data.logged_out).toBe(true);
  });

  // -------------------------------------------------------------------------
  // POST /api/bff/auth/logout — 社区版透传
  // -------------------------------------------------------------------------

  it('US2:社区版登出透传到 intellect-rag /api/v1/auth/logout(带 Authorization)', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const session: AuthSession = {
      token: 'rag-token',
      tenantId: 'tenant-rag',
      authMode: 'intellect-rag',
    };
    const app = createApp(tenantStore, session);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const resp = await app.request('/api/bff/auth/logout', {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tenant-rag' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer rag-token',
        }),
      }),
    );

    expect(resp.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET /api/bff/auth/login/channels — OAuth 渠道列表
  // -------------------------------------------------------------------------

  it('US3:企业版 channels 调 intellect-team /api/oauth/providers 并转换格式', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'github',
            name: 'GitHub',
            usage: 'login,bind',
            auth_flow: 'oauth2',
            enabled: true,
            logo_svg: '<svg>gh</svg>',
            is_builtin: true,
            display_order: 1,
          },
          {
            id: 'google',
            name: 'Google',
            usage: 'login',
            auth_flow: 'oauth2',
            enabled: true,
            logo_svg: '',
            is_builtin: true,
            display_order: 2,
          },
          {
            id: 'disabled-one',
            name: 'Disabled',
            usage: 'login',
            auth_flow: 'oauth2',
            enabled: false,
            is_builtin: false,
            display_order: 3,
          },
          {
            id: 'bind-only',
            name: 'Bind Only',
            usage: 'bind',
            auth_flow: 'oauth2',
            enabled: true,
            is_builtin: false,
            display_order: 4,
          },
        ]),
        { status: 200 },
      ),
    );

    const resp = await app.request('/api/bff/auth/login/channels', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/oauth/providers',
      expect.objectContaining({ method: 'GET' }),
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    // 过滤掉 disabled 和 usage 不含 login 的
    expect(body.data).toHaveLength(2);
    const channels = body.data.map((c: { channel: string }) => c.channel).sort();
    expect(channels).toEqual(['github', 'google']);
    // 字段映射
    const github = body.data.find((c: { channel: string }) => c.channel === 'github');
    expect(github.display_name).toBe('GitHub');
    expect(github.icon).toBe('<svg>gh</svg>');
    // logo_svg 为空时回退 'sso'
    const google = body.data.find((c: { channel: string }) => c.channel === 'google');
    expect(google.icon).toBe('sso');
  });

  it('US3:企业版 channels intellect-team 不可达 → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/api/bff/auth/login/channels', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(502);
  });

  it('US3:社区版 channels 透传到 intellect-rag', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ channel: 'github', display_name: 'GitHub' }]), { status: 200 }),
    );

    const resp = await app.request('/api/bff/auth/login/channels', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-rag' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/login/channels',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(resp.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET /api/bff/auth/login/:channel — OAuth 授权重定向
  // -------------------------------------------------------------------------

  it('US3:企业版 login/{channel} 调 intellect-team GET /api/oauth/login/{provider} 并透传 302', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // intellect-team P4a-4 返回 302 + Location(BFF 透传)
      new Response(null, {
        status: 302,
        headers: { Location: 'https://github.com/login/oauth/authorize?client_id=x&state=abc' },
      }),
    );

    const resp = await app.request('/api/bff/auth/login/github', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    // 验证调 GET /api/oauth/login/github?usage=login(redirect: manual 不跟随)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/oauth/login/github?usage=login',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      }),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe(
      'https://github.com/login/oauth/authorize?client_id=x&state=abc',
    );
  });

  it('US3:企业版 login/{channel} intellect-team 返回非 302(错误)→ 透传错误状态', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // intellect-team 返回 400(provider 不存在)
      new Response(JSON.stringify({ error: 'provider not found' }), { status: 400 }),
    );

    const resp = await app.request('/api/bff/auth/login/github', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(400);
  });

  it('US3:企业版 login/{channel} 302 但缺 Location 头 → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // 异常:302 但无 Location
      new Response(null, { status: 302 }),
    );

    const resp = await app.request('/api/bff/auth/login/github', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(502);
  });

  it('US3:企业版 login/{channel} intellect-team 不可达 → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/api/bff/auth/login/github', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(502);
  });

  it('US3:社区版 login/{channel} 302 重定向到 intellect-rag', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/login/github', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-rag' },
    });

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('http://mock-rag:9380/api/v1/auth/login/github');
  });

  // -------------------------------------------------------------------------
  // GET /api/bff/auth/oauth/callback — OAuth 回调 + token 签发
  // -------------------------------------------------------------------------

  it('US3:企业版 callback 成功 → 200/302 + Set-Cookie + 调 callback + token 签发', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        // Step 1: callback
        new Response(
          JSON.stringify({
            ok: true,
            provider_id: 'github',
            member_id: 'm-oauth-001',
            claims: { sub: 'gh:123' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        // Step 2: token 签发
        new Response(
          JSON.stringify({ token_id: 'tk-1', token: 'imt_oauth_token_xxx' }),
          { status: 201 },
        ),
      );

    const resp = await app.request(
      '/api/bff/auth/oauth/callback?code=gh-code&state=gh-state',
      { method: 'GET', headers: { 'X-Tenant-Id': 'tenant-enterprise' } },
    );

    // 验证 Step 1: callback 调用
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://mock-enterprise:9381/api/oauth/callback?code=gh-code&state=gh-state',
      expect.objectContaining({ method: 'GET' }),
    );
    // 验证 Step 2: token 签发调用
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://mock-enterprise:9381/api/members/m-oauth-001/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ',  // API_SERVER_KEY 默认空
        }),
      }),
    );

    expect(resp.status).toBe(302);
    // 验证 Set-Cookie
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toContain('imt_token=imt_oauth_token_xxx');
    expect(setCookie).toContain('HttpOnly');
    // 验证重定向到前端首页
    expect(resp.headers.get('location')).toBe('/');
  });

  it('US3:企业版 callback 缺 code 参数 → 400', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    const resp = await app.request('/api/bff/auth/oauth/callback?state=abc', {
      method: 'GET',
      headers: { 'X-Tenant-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(400);
  });

  it('US3:企业版 callback intellect-team callback 返回 ok=false → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'invalid code' }), { status: 200 }),
    );

    const resp = await app.request(
      '/api/bff/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Tenant-Id': 'tenant-enterprise' } },
    );

    expect(resp.status).toBe(502);
  });

  it('US3:企业版 callback token 签发返回 403 → 403(API_SERVER_KEY 无效)', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, member_id: 'm-x', provider_id: 'github' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid api server key' }), { status: 403 }),
      );

    const resp = await app.request(
      '/api/bff/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Tenant-Id': 'tenant-enterprise' } },
    );

    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body.message).toContain('API_SERVER_KEY');
  });

  it('US3:企业版 callback 不可达 → 502', async () => {
    const tenantStore = createMockTenantStore([enterpriseTenant]);
    const app = createApp(tenantStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request(
      '/api/bff/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Tenant-Id': 'tenant-enterprise' } },
    );

    expect(resp.status).toBe(502);
  });

  it('US3:社区版 callback 透传到 intellect-rag', async () => {
    const tenantStore = createMockTenantStore([ragTenant]);
    const app = createApp(tenantStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'rag-token' }), { status: 200 }),
    );

    const resp = await app.request(
      '/api/bff/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Tenant-Id': 'tenant-rag' } },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/oauth/callback?code=x&state=y',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.access_token).toBe('rag-token');
  });
});
