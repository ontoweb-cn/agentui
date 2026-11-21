// Multi-Harness P4b (US1):auth 路由单元测试
// Constitution Principle VII (Test-First):测试先于/同步于实现。
// 覆盖:企业版登录成功/失败/502、社区版登录透传、/auth/me 企业版/社区版。
// Mock fetch + BackendStore,隔离路由层逻辑。

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authRoutes, resetOAuthConfigWarning } from './auth';
import type { BackendStore, HarnessStore } from '../types/stores';
import type { HarnessBackend } from '../types/harness';
import type { BffTenant } from '../types/tenant';
import type { AuthSession } from '../types/auth';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';
import { AUTH_COOKIE_NAME } from '../types/auth';
import { clearProviderCache } from '../services/sso-providers';
import { sanitizeReturnTo } from '../services/sso-state';
import { loadSsoConfig, validateSsoConfig } from '../services/sso-config';

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

const enterpriseBackend: HarnessBackend = {
  id: 'intellect-enterprise-default',
  name: 'Intellect Enterprise Default',
  type: 'intellect-enterprise',
  endpoint: 'http://mock-enterprise:9381',
  adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY',
  adminToken: 'test-api-server-key',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: true,
    mcp: true,
    multiTenant: true,
    modelManagement: false,
  },
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockBackendStore(tenants: BffTenant[]): BackendStore {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getBackend: vi.fn((id: string) => tenants.find((t) => t.id === id)),
    listBackends: vi.fn(() => tenants),
    createBackend: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setAuthMode: vi.fn(),
    setCanvasBinding: vi.fn(),
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };
}

function createMockHarnessStore(backends: HarnessBackend[]): HarnessStore {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    get: vi.fn((id: string) => backends.find((b) => b.id === id)),
    list: vi.fn(() => backends),
    saveConfig: vi.fn(),
  };
}

interface TestVariables {
  backendStore: BackendStore;
  harnessStore: HarnessStore;
  [AUTH_SESSION_KEY]?: AuthSession;
}

function createApp(
  backendStore: BackendStore,
  session?: AuthSession,
  harnessStore?: HarnessStore,
): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('backendStore', backendStore);
    c.set('harnessStore', harnessStore ?? createMockHarnessStore([enterpriseBackend]));
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
    process.env.INTELLECT_RAG_URL = 'http://mock-rag:9380';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /auth/config — 认证配置(公开端点)
  // -------------------------------------------------------------------------

  it('auth config:企业版 tenant → 返回 authMode=intellect-enterprise', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/config', {
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.authMode).toBe('intellect-enterprise');
  });

  it('auth config:社区版 tenant → 返回 authMode=intellect-rag', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/config', {
      headers: { 'X-Backend-Id': 'tenant-rag' },
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.authMode).toBe('intellect-rag');
  });

  it('auth config:无 X-Backend-Id → 默认 intellect-community', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/config');

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.authMode).toBe('intellect-community');
  });

  // -------------------------------------------------------------------------
  // POST /auth/login — 企业版
  // -------------------------------------------------------------------------

  it('US1:企业版登录成功 → 200 + Set-Cookie + 不含 token 的 body', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: 'imt_abc123',
          member: {
            id: 'm-001',
            display_name: 'Alice',
            enabled: 1,
            role: 'member',
          },
          email: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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
      email: null,
    });
    // 关键:token 不在 body(只在 cookie),email 透传(减少 /auth/me probe)
    expect(JSON.stringify(body)).not.toContain('imt_abc123');
  });

  it('US1:企业版登录支持 email → login_name 字段映射(前端社区版字段兼容)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: 'imt_xyz',
          member: {
            id: 'm-002',
            display_name: 'Bob',
            enabled: 1,
            role: 'member',
          },
          email: null,
        }),
        { status: 200 },
      ),
    );

    await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 }),
    );

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ login_name: 'alice', password: 'wrong' }),
    });

    expect(resp.status).toBe(401);
    expect(resp.headers.get('set-cookie')).toBeNull();
    const body = await resp.json();
    expect(body.code).toBe(401);
    expect(body.message).toContain('Invalid credentials');
  });

  it('US1:企业版登录失败(429 brute-force 锁定)→ 429 + 透传上游 message', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'too_many_attempts', message: 'Too many failed attempts. Try again later.' }),
        { status: 429 },
      ),
    );

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ login_name: 'alice', password: 'wrong' }),
    });

    expect(resp.status).toBe(429);
    expect(resp.headers.get('set-cookie')).toBeNull();
    const body = await resp.json();
    expect(body.code).toBe(429);
    expect(body.message).toContain('Too many failed attempts');
  });

  it('US1:企业版登录 intellect-team 不可达 → 502', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ login_name: 'alice', password: 'secret' }),
    });

    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.code).toBe(502);
    expect(body.message).toContain('intellect-team unreachable');
  });

  it('US1:企业版登录缺 login_name → 400', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ password: 'secret' }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('login_name');
  });

  it('US1:无 X-Backend-Id header → 缺省租户 "0" 走社区版分支(向后兼容)', async () => {
    // 公开端点缺省 TenantID="0",mock store 中无 id="0" 的 tenant → authMode=intellect-rag
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'rag-token', email: 'a@b.com' }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'secret' }),
    });

    // 缺省租户走社区版分支,透传到 intellect-rag
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(resp.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // POST /auth/login — 社区版透传
  // -------------------------------------------------------------------------

  it('US1:社区版登录(authMode=intellect-rag)透传到 intellect-rag /api/v1/auth/login', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            access_token: 'rag-token-xxx',
            email: 'alice@rag.com',
            nickname: 'Alice',
          },
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-rag',
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
    expect(body.code).toBe(0);
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
    const backendStore = createMockBackendStore([legacyTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
    );

    await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-legacy',
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
  // GET /auth/me — 企业版
  // -------------------------------------------------------------------------

  it('US1:企业版 /auth/me 有 cookie → 调 intellect-team /api/members/me', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_abc123',
      backendId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(backendStore, session);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'm-001',
          display_name: 'Alice',
          role: 'member',
          enabled: 1,
          email: 'alice@enterprise.com',
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore); // 不注入 session

    const resp = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.code).toBe(401);
    expect(body.message).toContain('no valid session');
  });

  it('US1:企业版 /auth/me token 无效(intellect-team 返回 401)→ 401', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_invalid',
      backendId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(backendStore, session);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'token expired' }), { status: 401 }),
    );

    const resp = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // GET /auth/me — 社区版
  // -------------------------------------------------------------------------

  it('US1:社区版 /auth/me 透传到 intellect-rag /api/v1/users/me(带 Authorization)', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            id: 'u-1',
            email: 'alice@rag.com',
            nickname: 'Alice',
            role: 'user',
          },
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/auth/me', {
      method: 'GET',
      headers: {
        'X-Backend-Id': 'tenant-rag',
        Authorization: 'Bearer rag-access-token',
      },
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
  // POST /auth/register — 企业版
  // -------------------------------------------------------------------------

  it('US2:企业版注册成功 → 201 + {member_id, registration_pending}', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ member_id: 'm-new', registration_pending: 0 }),
        { status: 201 },
      ),
    );

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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

  it('US2:企业版注册带 invite_code → 原样透传网关;网关 400 提及 invite 时返回可自助修复文案', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Missing invite code' }), { status: 400 }),
      );

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        login_name: 'invited',
        password: 'pw123',
        display_name: 'Invited User',
        invite_code: ' INVITE-2026 ',
      }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          login_name: 'invited',
          password: 'pw123',
          display_name: 'Invited User',
          invite_code: 'INVITE-2026',
        }),
      }),
    );
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.message).toContain('邀请码');
  });

  it('US2/D6:网关结构化 400 code=invite_required → 转译可自助修复文案(优先于正则兜底)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Registration requires a valid invite code', code: 'invite_required' } }),
        { status: 400 },
      ),
    );

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({
        login_name: 'invited',
        password: 'pw123',
        display_name: 'Invited User',
      }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.message).toBe('注册需要邀请码,请向管理员获取后重试');
  });

  it('US2/D6:结构化 400 code=invite_used / invite_expired → 分别转译', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);
    const cases: Array<[string, string]> = [
      ['invite_used', '邀请码已被使用'],
      ['invite_expired', '邀请码已过期,请向管理员重新获取'],
      ['invite_revoked', '邀请码已被管理员撤销,请向管理员重新获取'],
      ['display_name_taken', '显示名已被占用,请更换后重试'],
    ];
    for (const [code, expected] of cases) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: code, code } }), { status: 400 }),
      );
      const resp = await app.request('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Backend-Id': 'tenant-enterprise' },
        body: JSON.stringify({
          login_name: 'invited',
          password: 'pw123',
          display_name: 'Invited User',
          invite_code: 'IM-CH-XXXXXXXX',
        }),
      });
      expect(resp.status).toBe(400);
      expect((await resp.json()).message).toBe(expected);
    }
  });

  it('US2:企业版注册支持 nickname→display_name 字段映射', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ member_id: 'm-nick', registration_pending: 1 }),
        { status: 201 },
      ),
    );

    await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'login_name already in use' }), { status: 409 }),
    );

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'registration disabled' }), { status: 403 }),
    );

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
      },
      body: JSON.stringify({ password: 'p' }),
    });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.message).toContain('required');
  });

  // -------------------------------------------------------------------------
  // POST /auth/register — 社区版透传
  // -------------------------------------------------------------------------

  it('US2:社区版注册透传到 intellect-rag /api/v1/users', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'u-new' }), { status: 201 }),
    );

    const resp = await app.request('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-rag',
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
  // POST /auth/logout — 企业版
  // -------------------------------------------------------------------------

  it('US2:企业版登出成功 → 200 + 清 cookie + 调 intellect-team /api/members/logout', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_logout',
      backendId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(backendStore, session);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const resp = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    // 登出后 cookie 已清,auth-session 中间件无法提取 token → 无 session
    const app = createApp(backendStore); // 不注入 session

    const resp = await app.request('/auth/me', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(401);
  });

  it('US2:企业版登出 intellect-team 不可达 → 仍清 cookie + 200(本地登出成功)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_x',
      backendId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(backendStore, session);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    // 网络错误也清 cookie(本地登出),返回 200(用户视角已登出,与社区版行为一致)
    expect(resp.status).toBe(200);
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toMatch(/imt_token=;/);
    const body = await resp.json();
    expect(body.data.logged_out).toBe(true);
  });

  it('US2:企业版登出 token 已过期(intellect-team 返回 401)→ 仍清 cookie + 200(用户视角已登出)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const session: AuthSession = {
      token: 'imt_expired',
      backendId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    };
    const app = createApp(backendStore, session);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'token expired' }), { status: 401 }),
    );

    const resp = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    // 上游 401 但本地 cookie 已清,返回 200(用户视角已登出)
    expect(resp.status).toBe(200);
    const setCookie = resp.headers.get('set-cookie');
    expect(setCookie).toMatch(/imt_token=;/);
    const body = await resp.json();
    expect(body.data.logged_out).toBe(true);
  });

  it('US2:无 cookie 登出也清 cookie + 200(防御性,允许登出已过期会话)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore); // 不注入 session

    const resp = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('set-cookie')).toMatch(/imt_token=;/);
    const body = await resp.json();
    expect(body.data.logged_out).toBe(true);
  });

  // -------------------------------------------------------------------------
  // POST /auth/logout — 社区版透传
  // -------------------------------------------------------------------------

  it('US2:社区版登出透传到 intellect-rag /api/v1/auth/logout(带 Authorization)', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const resp = await app.request('/auth/logout', {
      method: 'POST',
      headers: {
        'X-Backend-Id': 'tenant-rag',
        Authorization: 'Bearer rag-token',
      },
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
  // GET /auth/login/channels — OAuth 渠道列表
  // -------------------------------------------------------------------------

  it('US3:企业版 channels 调 intellect-team /api/oauth/providers 并转换格式', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

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

    const resp = await app.request('/auth/login/channels', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/auth/login/channels', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(502);
  });

  it('US3:社区版 channels 透传到 intellect-rag', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ channel: 'github', display_name: 'GitHub' }]), { status: 200 }),
    );

    const resp = await app.request('/auth/login/channels', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-rag' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-rag:9380/api/v1/auth/login/channels',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(resp.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET /auth/login/:channel — OAuth 授权重定向
  // -------------------------------------------------------------------------

  it('US3:企业版 login/{channel} 调 intellect-team GET /api/oauth/login/{provider} 并透传 302', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // intellect-team P4a-4 返回 302 + Location(BFF 透传)
      new Response(null, {
        status: 302,
        headers: { Location: 'https://github.com/login/oauth/authorize?client_id=x&state=abc' },
      }),
    );

    const resp = await app.request('/auth/login/github', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    // 验证调 GET /api/oauth/login/github?usage=login&redirect_uri=...(redirect: manual 不跟随)
    // F-CB-01:BFF 必须显式传公开回调,否则 intellect-team 推导自身回调、IdP 回调落不到 BFF。
    // 无 env、无转发头时按请求推导:http://localhost/api/bff/auth/oauth/callback
    expect(fetchMock).toHaveBeenCalledWith(
      `http://mock-enterprise:9381/api/oauth/login/github?usage=login&redirect_uri=${encodeURIComponent('http://localhost/api/bff/auth/oauth/callback')}`,
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

  it('US3:企业版 login/{channel} 优先使用 BFF_OAUTH_REDIRECT_URI(env 显式回调)', async () => {
    process.env.BFF_OAUTH_REDIRECT_URI = 'https://agentui.example.edu.cn/api/bff/auth/oauth/callback';
    try {
      const backendStore = createMockBackendStore([enterpriseTenant]);
      const app = createApp(backendStore);

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://github.com/login/oauth/authorize?client_id=x&state=abc' },
        }),
      );

      await app.request('/auth/login/github', {
        method: 'GET',
        headers: { 'X-Backend-Id': 'tenant-enterprise' },
      });

      // env 显式回调优先于请求头推导(生产推荐,防 Host 伪造)
      expect(fetchMock).toHaveBeenCalledWith(
        `http://mock-enterprise:9381/api/oauth/login/github?usage=login&redirect_uri=${encodeURIComponent('https://agentui.example.edu.cn/api/bff/auth/oauth/callback')}`,
        expect.objectContaining({ method: 'GET', redirect: 'manual' }),
      );
    } finally {
      delete process.env.BFF_OAUTH_REDIRECT_URI;
    }
  });

  it('US3:企业版 login/{channel} env 回调形态异常时告警一次仍按配置使用(评审 F-Q4)', async () => {
    process.env.BFF_OAUTH_REDIRECT_URI = 'https://agentui.example.edu.cn/some/other/path';
    resetOAuthConfigWarning();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const backendStore = createMockBackendStore([enterpriseTenant]);
      const app = createApp(backendStore);
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: 'https://x/auth?state=s' } }),
      );

      // 第一次请求:触发告警,仍按配置值使用(最终由 IdP 白名单 fail-closed)
      await app.request('/auth/login/github', {
        method: 'GET',
        headers: { 'X-Backend-Id': 'tenant-enterprise' },
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('/api/bff/auth/oauth/callback');
      expect(fetchMock).toHaveBeenCalledWith(
        `http://mock-enterprise:9381/api/oauth/login/github?usage=login&redirect_uri=${encodeURIComponent('https://agentui.example.edu.cn/some/other/path')}`,
        expect.objectContaining({ method: 'GET', redirect: 'manual' }),
      );

      // 第二次请求:告警只发一次,不刷屏
      await app.request('/auth/login/github', {
        method: 'GET',
        headers: { 'X-Backend-Id': 'tenant-enterprise' },
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      delete process.env.BFF_OAUTH_REDIRECT_URI;
      resetOAuthConfigWarning();
    }
  });

  it('US3:企业版 login/{channel} 多级代理转发头取第一跳(评审 F-Q1)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://github.com/login/oauth/authorize?client_id=x&state=abc' },
      }),
    );

    await app.request('/auth/login/github', {
      method: 'GET',
      headers: {
        'X-Backend-Id': 'tenant-enterprise',
        // 多级代理链:逗号分隔 + 夹带空白
        'X-Forwarded-Proto': 'https, http',
        'X-Forwarded-Host': 'ai.wust.edu.cn, inner.example:9391',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://mock-enterprise:9381/api/oauth/login/github?usage=login&redirect_uri=${encodeURIComponent('https://ai.wust.edu.cn/api/bff/auth/oauth/callback')}`,
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('US3:企业版 login/{channel} intellect-team 返回非 302(错误)→ 302 回登录页+错误参数(agentui-sso-logout-loop B1)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // intellect-team 返回 400(provider 不存在)
      new Response(JSON.stringify({ error: 'provider not found' }), { status: 400 }),
    );

    const resp = await app.request('/auth/login/github', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    // B1:浏览器导航 302 到登录页并携带 ssoError（替换原 400 透传/裸 JSON）
    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toContain('/login-next?ssoError=idp_error');
  });

  it('US3:企业版 logout 配置 IDP_LOGOUT_URL → 响应携带 idp_logout_url(A2)', async () => {
    process.env.BFF_OAUTH_IDP_LOGOUT_URL = 'http://127.0.0.1:8000/api/logout';
    process.env.BFF_OAUTH_EXPECTED_AUD = 'ia-intellect-team';
    process.env.BFF_OAUTH_REDIRECT_URI = 'http://localhost:9391/api/bff/auth/oauth/callback';
    try {
      const backendStore = createMockBackendStore([enterpriseTenant]);
      const app = createApp(backendStore, createMockHarnessStore([enterpriseBackend]));

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 }),
      );

      const resp = await app.request('/auth/logout', {
        method: 'POST',
        headers: {
          'X-Backend-Id': 'tenant-enterprise',
          Cookie: 'imt_token=imt_fake',
        },
      });

      const body = (await resp.json()) as { data?: { logged_out?: boolean; idp_logout_url?: string } };
      expect(body.data?.logged_out).toBe(true);
      expect(body.data?.idp_logout_url).toContain('/api/logout');
      expect(body.data?.idp_logout_url).toContain('post_logout_redirect_uri=');
      expect(body.data?.idp_logout_url).toContain('client_id=ia-intellect-team');
      // 回跳 origin 取 env 回调的 origin（9391），而非代理链下失真的请求 Host（9390）
      expect(body.data?.idp_logout_url).toContain('post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A9391%2F');
    } finally {
      delete process.env.BFF_OAUTH_IDP_LOGOUT_URL;
      delete process.env.BFF_OAUTH_EXPECTED_AUD;
      delete process.env.BFF_OAUTH_REDIRECT_URI;
    }
  });

  it('US3:企业版 login/{channel} 302 但缺 Location 头 → 302 回登录页+错误参数(B1)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // 异常:302 但无 Location
      new Response(null, { status: 302 }),
    );

    const resp = await app.request('/auth/login/github', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toContain('/login-next?ssoError=idp_invalid_response');
  });

  it('US3:企业版 login/{channel} intellect-team 不可达 → 302 回登录页+错误参数(B1)', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/auth/login/github', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toContain('/login-next?ssoError=idp_unavailable');
  });

  it('US3:社区版 login/{channel} 302 重定向到 intellect-rag', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/login/github', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-rag' },
    });

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('http://mock-rag:9380/api/v1/auth/login/github');
  });

  // -------------------------------------------------------------------------
  // GET /auth/oauth/callback — OAuth 回调 + token 签发
  // -------------------------------------------------------------------------

  it('US3:企业版 callback 成功 → 302 + Set-Cookie（直接使用 callback 返回的 token）', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      // callback 已签发 token，无需二次调用 /api/members/{id}/token
      new Response(
        JSON.stringify({
          ok: true,
          provider_id: 'github',
          member_id: 'm-oauth-001',
          token: 'imt_oauth_token_xxx',
          claims: { sub: 'gh:123' },
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request(
      '/auth/oauth/callback?code=gh-code&state=gh-state',
      { method: 'GET', headers: { 'X-Backend-Id': 'tenant-enterprise' } },
    );

    // 仅调用一次 callback，不再调用 token 签发端点
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://mock-enterprise:9381/api/oauth/callback?code=gh-code&state=gh-state',
      expect.objectContaining({ method: 'GET' }),
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
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    const resp = await app.request('/auth/oauth/callback?state=abc', {
      method: 'GET',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(400);
  });

  it('US3:企业版 callback intellect-team callback 返回 ok=false → 502', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'invalid code' }), { status: 200 }),
    );

    const resp = await app.request(
      '/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Backend-Id': 'tenant-enterprise' } },
    );

    expect(resp.status).toBe(502);
  });

  it('US3:企业版 callback 未返回 token → 502', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, member_id: 'm-x', provider_id: 'github' }),
        { status: 200 },
      ),
    );

    const resp = await app.request(
      '/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Backend-Id': 'tenant-enterprise' } },
    );

    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.message).toContain('GATEWAY_INCOMPATIBLE');
  });

  it('US3:企业版 callback 不可达 → 502', async () => {
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request(
      '/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Backend-Id': 'tenant-enterprise' } },
    );

    expect(resp.status).toBe(502);
  });

  it('US3:社区版 callback 返回 400(社区版 OAuth 直连 intellect-rag,不走 BFF)', async () => {
    const backendStore = createMockBackendStore([ragTenant]);
    const app = createApp(backendStore);

    // 社区版 callback 不应调用 fetch — BFF /auth/oauth/callback 仅企业版使用
    // 社区版 OAuth 流程: /auth/login/:channel → 302 浏览器到 intellect-rag → provider 回调 intellect-rag → intellect-rag 302 到前端
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const resp = await app.request(
      '/auth/oauth/callback?code=x&state=y',
      { method: 'GET', headers: { 'X-Backend-Id': 'tenant-rag' } },
    );

    // 不调上游 — 直接返回 400(redirect_uri 配置错误)
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('enterprise mode');
  });
});

// ---------------------------------------------------------------------------
// spec-014 P2:SSO（BFF 作为 OIDC RP）
// 覆盖 plan-p2 §八 用例：渠道、授权、回调、错误映射、静默重登、登出、配置校验。
// ---------------------------------------------------------------------------

const PUBLIC_PROVIDERS = [
  {
    id: 'intellect-auth',
    name: '统一认证',
    usage: 'login',
    enabled: true,
    client_id: 'ia-agentui',
    authorize_url: 'https://idp.example.com/auth/login/oauth/authorize',
    scopes: 'openid profile email',
    pkce: true,
  },
  {
    id: 'broken-provider',
    name: '缺客户端',
    usage: 'login',
    enabled: true,
    authorize_url: 'https://idp.example.com/auth/login/oauth/authorize',
    pkce: true,
  },
  {
    id: 'disabled-provider',
    name: '停用',
    usage: 'login',
    enabled: false,
    client_id: 'ia-agentui',
    authorize_url: 'https://idp.example.com/auth/login/oauth/authorize',
    pkce: true,
  },
];

const EXCHANGE_OK = {
  token: 'imt_test_token',
  token_id: 'tok_1',
  expires_at: 1900000000,
  member: { id: 'mem_1', display_name: '张三', role: 'member', enabled: 1 },
  email: 'zhangsan@example.com',
  tenant_id: '0',
};

function readSetCookies(resp: Response): string[] {
  const headers = resp.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = resp.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function findCookie(cookies: string[], name: string): string | undefined {
  // 同一响应可能同时包含删除(空值)与新值，取最后一个匹配项。
  const matches = cookies.filter((cookie) => cookie.startsWith(`${name}=`));
  return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

describe('auth 路由 — SSO P2 (spec-014)', () => {
  beforeEach(() => {
    clearProviderCache();
    process.env.BFF_SSO_ENABLED = 'true';
    process.env.BFF_SSO_STATE_SECRET = 's'.repeat(32);
    process.env.BFF_PUBLIC_ORIGIN = 'https://agentui.test';
    process.env.BFF_SSO_SILENT_RELOGIN = 'true';
    process.env.BFF_SSO_EXCHANGE_TIMEOUT_MS = '2000';
    process.env.BFF_SSO_PROVIDER_CACHE_MS = '30000';
    delete process.env.BFF_SSO_PROVIDERS;
  });

  afterEach(() => {
    delete process.env.BFF_SSO_ENABLED;
    delete process.env.BFF_SSO_STATE_SECRET;
    delete process.env.BFF_PUBLIC_ORIGIN;
    delete process.env.BFF_SSO_SILENT_RELOGIN;
    delete process.env.BFF_SSO_EXCHANGE_TIMEOUT_MS;
    delete process.env.BFF_SSO_PROVIDER_CACHE_MS;
    delete process.env.BFF_FRONTEND_BASE;
    clearProviderCache();
    vi.restoreAllMocks();
  });

  function mockProviders(fetchMock: { mockResolvedValueOnce: (value: Response) => unknown }): void {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(PUBLIC_PROVIDERS), { status: 200 }),
    );
  }

  async function authorize(
    app: Hono<{ Variables: TestVariables }>,
    options: { provider?: string; returnTo?: string; tenant?: string } = {},
  ) {
    const provider = options.provider ?? 'intellect-auth';
    const tenant = options.tenant ?? 'tenant-enterprise';
    const returnTo = options.returnTo ?? '/chat';
    const resp = await app.request(
      `/auth/sso/authorize/${provider}?tenant=${tenant}&returnTo=${encodeURIComponent(returnTo)}`,
    );
    const location = resp.headers.get('location') ?? '';
    const cookies = readSetCookies(resp);
    const stateCookie = findCookie(cookies, 'sso_state') ?? '';
    let state = '';
    let nonce = '';
    try {
      const url = new URL(location);
      state = url.searchParams.get('state') ?? '';
      nonce = url.searchParams.get('nonce') ?? '';
    } catch {
      // location 不是绝对 URL 时保持空值（错误跳转场景）
    }
    return {
      resp,
      location,
      cookies,
      cookieHeader: stateCookie.split(';')[0],
      state,
      nonce,
    };
  }

  it('channels：开关开启 → 公开端点、不带 Authorization、过滤停用/缺字段', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/login/channels', {
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { data: { channel: string }[] };
    expect(body.data.map((item) => item.channel)).toEqual(['intellect-auth']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://mock-enterprise:9381/api/members/oauth/providers');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('channels：公开列表不可达 → 502，不影响密码登录', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/login/channels', {
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(502);
  });

  it('authorize：302 到 IdP，含 PKCE/nonce/response_mode 与 no-store', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const result = await authorize(app);
    const url = new URL(result.location);

    expect(result.resp.status).toBe(302);
    expect(url.origin + url.pathname).toBe(
      'https://idp.example.com/auth/login/oauth/authorize',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('ia-agentui');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://agentui.test/api/bff/auth/oauth/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')?.length).toBeGreaterThan(20);
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('prompt')).toBeNull();

    expect(result.resp.headers.get('cache-control')).toBe('no-store');
    const cookie = findCookie(result.cookies, 'sso_state');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('authorize：未知/非企业版租户 → 登录页 tenant_not_found', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request(
      '/auth/sso/authorize/intellect-auth?tenant=missing-tenant',
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login?error=tenant_not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callback：成功 → exchange 入参正确、写 imt_token + sso_provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const started = await authorize(app);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(EXCHANGE_OK), { status: 200 }));

    const resp = await app.request(
      `/auth/oauth/callback?code=auth-code&state=${started.state}`,
      { headers: { Cookie: started.cookieHeader } },
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/chat');

    const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(exchangeUrl).toBe('http://mock-enterprise:9381/api/members/oauth/exchange');
    const body = JSON.parse(String(exchangeInit.body)) as Record<string, string>;
    expect(body.grant).toBe('authorization_code');
    expect(body.provider_id).toBe('intellect-auth');
    expect(body.code).toBe('auth-code');
    expect(body.code_verifier).toBeTruthy();
    expect(body.nonce).toBe(started.nonce);
    expect(body.redirect_uri).toBe('https://agentui.test/api/bff/auth/oauth/callback');

    const cookies = readSetCookies(resp);
    expect(findCookie(cookies, 'imt_token')).toContain('imt_test_token');
    expect(findCookie(cookies, 'sso_provider')).toContain('intellect-auth');
  });

  it('callback：state 不匹配 → sso_state_invalid，且不调用 exchange', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const started = await authorize(app);

    const resp = await app.request(
      '/auth/oauth/callback?code=auth-code&state=wrong-state',
      { headers: { Cookie: started.cookieHeader } },
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login?error=sso_state_invalid');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 仅 provider 列表
  });

  it('callback：伪造/过期 state Cookie → sso_state_invalid，不调 exchange', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request(
      '/auth/oauth/callback?code=auth-code&state=abc',
      { headers: { Cookie: 'sso_state=not-a-signed-value' } },
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login?error=sso_state_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callback：网关 403 member_not_provisioned → 可读错误且不写 imt_token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const started = await authorize(app);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'member_not_provisioned', message: 'not provisioned' }),
        { status: 403 },
      ),
    );

    const resp = await app.request(
      `/auth/oauth/callback?code=auth-code&state=${started.state}`,
      { headers: { Cookie: started.cookieHeader } },
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login?error=member_not_provisioned');
    expect(findCookie(readSetCookies(resp), 'imt_token')).toBeUndefined();
  });

  it('callback：网关不可达 → sso_unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const started = await authorize(app);

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request(
      `/auth/oauth/callback?code=auth-code&state=${started.state}`,
      { headers: { Cookie: started.cookieHeader } },
    );

    expect(resp.headers.get('location')).toBe('/login?error=sso_unavailable');
  });

  async function completeLogin(
    app: Hono<{ Variables: TestVariables }>,
    fetchMock: { mockResolvedValueOnce: (value: Response) => unknown },
  ): Promise<{ providerCookie: string }> {
    const started = await authorize(app);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(EXCHANGE_OK), { status: 200 }));
    const loginResp = await app.request(
      `/auth/oauth/callback?code=auth-code&state=${started.state}`,
      { headers: { Cookie: started.cookieHeader } },
    );
    return {
      providerCookie: (findCookie(readSetCookies(loginResp), 'sso_provider') ?? '').split(';')[0],
    };
  }

  it('relogin：无 sso_provider（已登出）→ 直接回登录页', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/sso/relogin?tenant=tenant-enterprise&returnTo=/chat');

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('relogin：有签名 sso_provider → prompt=none 静默授权', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const { providerCookie } = await completeLogin(app, fetchMock);

    const resp = await app.request('/auth/sso/relogin?tenant=tenant-enterprise&returnTo=/chat', {
      headers: { Cookie: providerCookie },
    });

    const url = new URL(resp.headers.get('location') ?? '');
    expect(resp.status).toBe(302);
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('relogin：伪造 sso_provider → 回登录页', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/sso/relogin?tenant=tenant-enterprise', {
      headers: { Cookie: 'sso_provider=intellect-auth' },
    });

    expect(resp.headers.get('location')).toBe('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callback：开关开启但无 sso_state → 直接失败，不回落旧链路', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/oauth/callback?code=c&state=s');

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login?error=sso_state_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('静默重登失败一次 → 交互式重试；再失败回登录页', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const { providerCookie } = await completeLogin(app, fetchMock);

    const relogin = await app.request('/auth/sso/relogin?tenant=tenant-enterprise&returnTo=/chat', {
      headers: { Cookie: providerCookie },
    });
    const reloginUrl = new URL(relogin.headers.get('location') ?? '');
    expect(reloginUrl.searchParams.get('prompt')).toBe('none');
    const silentCookie = (findCookie(readSetCookies(relogin), 'sso_state') ?? '').split(';')[0];
    const silentState = reloginUrl.searchParams.get('state') ?? '';

    const retry = await app.request(
      `/auth/oauth/callback?error=login_required&state=${silentState}`,
      { headers: { Cookie: silentCookie } },
    );
    const retryUrl = new URL(retry.headers.get('location') ?? '');
    expect(retry.status).toBe(302);
    expect(retryUrl.searchParams.get('prompt')).toBeNull();
    const retryCookie = (findCookie(readSetCookies(retry), 'sso_state') ?? '').split(';')[0];
    const retryState = retryUrl.searchParams.get('state') ?? '';

    const finalResp = await app.request(
      `/auth/oauth/callback?error=login_required&state=${retryState}`,
      { headers: { Cookie: retryCookie } },
    );
    expect(finalResp.headers.get('location')).toBe('/login?error=sso_session_expired');
  });

  it('callback：exchange 超时 → sso_unavailable', async () => {
    process.env.BFF_SSO_EXCHANGE_TIMEOUT_MS = '20';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));
    const started = await authorize(app);

    fetchMock.mockImplementationOnce(
      ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })) as unknown as typeof fetch,
    );

    const resp = await app.request(
      `/auth/oauth/callback?code=auth-code&state=${started.state}`,
      { headers: { Cookie: started.cookieHeader } },
    );

    expect(resp.headers.get('location')).toBe('/login?error=sso_unavailable');
  });

  it('authorize：开关关闭 → 302 登录页（不返回 JSON）', async () => {
    delete process.env.BFF_SSO_ENABLED;
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/sso/authorize/intellect-auth?tenant=tenant-enterprise');

    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('BFF_FRONTEND_BASE 生效：错误回跳带子路径', async () => {
    process.env.BFF_FRONTEND_BASE = '/agentui';
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const resp = await app.request('/auth/oauth/callback?code=c&state=s');

    expect(resp.headers.get('location')).toBe('/agentui/login?error=sso_state_invalid');
  });

  it('旧入口：开关开启时转发到 BFF authorize；未知渠道 fail-closed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mockProviders(fetchMock);
    const app = createApp(createMockBackendStore([enterpriseTenant]));

    const okResp = await app.request(
      '/auth/login/intellect-auth?tenant=tenant-enterprise',
    );
    expect(okResp.status).toBe(302);
    expect(new URL(okResp.headers.get('location') ?? '').host).toBe('idp.example.com');

    const unknownResp = await app.request(
      '/auth/login/unknown-channel?tenant=tenant-enterprise',
    );
    expect(unknownResp.headers.get('location')).toBe('/login?error=unknown_provider');
  });

  it('登出：清除 imt_token 与 sso_provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const backendStore = createMockBackendStore([enterpriseTenant]);
    const app = createApp(backendStore, {
      token: 'imt_session_token',
      backendId: 'tenant-enterprise',
      authMode: 'intellect-enterprise',
    });

    const resp = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });

    expect(resp.status).toBe(200);
    const cookies = readSetCookies(resp);
    expect(findCookie(cookies, 'imt_token')).toContain('Max-Age=0');
    expect(findCookie(cookies, 'sso_provider')).toContain('Max-Age=0');
  });

  it('returnTo 白名单：拒绝开放重定向与非法字符', () => {
    expect(sanitizeReturnTo('/chat?x=1')).toBe('/chat?x=1');
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
    expect(sanitizeReturnTo('https://evil.com')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
    expect(sanitizeReturnTo('/ok\r\nSet-Cookie: x')).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });

  it('配置校验：启用时缺失/过短密钥与 http 生产源 → fail-fast；允许显式降级', () => {
    const config = loadSsoConfig({
      BFF_SSO_ENABLED: 'true',
      BFF_SSO_STATE_SECRET: 's'.repeat(32),
      BFF_PUBLIC_ORIGIN: 'https://agentui.test',
    } as NodeJS.ProcessEnv);

    expect(() => validateSsoConfig(config)).not.toThrow();
    expect(() =>
      validateSsoConfig({ ...config, stateSecret: 'short' }),
    ).toThrow(/BFF_SSO_STATE_SECRET/);
    expect(() => validateSsoConfig({ ...config, publicOrigin: '' })).toThrow(
      /BFF_PUBLIC_ORIGIN/,
    );
    expect(() => validateSsoConfig({ ...config, publicOrigin: 'http://a.test' }, 'production')).toThrow(
      /https/,
    );
    expect(() =>
      validateSsoConfig(
        { ...config, publicOrigin: 'http://a.test', allowInsecure: true },
        'production',
      ),
    ).not.toThrow();
  });
});
