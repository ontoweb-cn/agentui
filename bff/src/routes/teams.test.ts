// Multi-Harness P5 (US1):Team CRUD 路由单元测试
// 对齐 intellect-team 实际契约:slug/display_name/created_by 字段,DELETE 软删除,无 PUT。
// Mock fetch(intellect-team API)+ TenantStore,隔离路由层逻辑。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { teamRoutes } from './teams';
import type { TenantStore } from '../types/stores';
import type { BffTenant } from '../types/tenant';
import type { AuthSession } from '../types/auth';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tenantBoundToTeam: BffTenant = {
  id: 'tenant-bound',
  name: 'Bound Tenant',
  intellectTenantId: 'team-001',
  intellectBackendId: 'intellect-enterprise-default',
  authMode: 'intellect-enterprise',
  createdAt: '2026-06-26T00:00:00Z',
  updatedAt: '2026-06-26T00:00:00Z',
};

const tenantUnbound: BffTenant = {
  id: 'tenant-unbound',
  name: 'Unbound Tenant',
  intellectTenantId: '0',
  intellectBackendId: 'intellect-enterprise-default',
  authMode: 'intellect-enterprise',
  createdAt: '2026-06-26T00:00:00Z',
  updatedAt: '2026-06-26T00:00:00Z',
};

const memberSession: AuthSession = {
  token: 'imt_test_token',
  tenantId: 'tenant-unbound',
  authMode: 'intellect-enterprise',
  memberId: 'm-creator-001',
};

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
  app.route('/', teamRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

describe('Team CRUD 路由 (P5 US1, 对齐 intellect-team 实际契约)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTELLECT_ENTERPRISE_BASE_URL = 'http://mock-im:9381';
    process.env.HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY = 'test-api-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // POST /admin/teams
  // -------------------------------------------------------------------------

  it('创建 Team 成功 → 201,传 slug/display_name/created_by', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'team-new', slug: 'team-new', display_name: 'New Team', enabled: 1, created_at: 1782485500.0 }),
        { status: 201 },
      ),
    );

    const resp = await app.request('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'team-new', display_name: 'New Team' }),
    });

    // created_by 从 AuthSession.memberId 自动注入
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-im:9381/api/teams',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
        body: JSON.stringify({
          slug: 'team-new',
          display_name: 'New Team',
          created_by: 'm-creator-001',
        }),
      }),
    );
    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.data.slug).toBe('team-new');
    expect(body.data.display_name).toBe('New Team');
  });

  it('前端显式传 created_by 时优先使用', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 't', slug: 't', display_name: 'T', enabled: 1, created_at: 0 }),
        { status: 201 },
      ),
    );

    await app.request('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 't', display_name: 'T', created_by: 'm-explicit' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ slug: 't', display_name: 'T', created_by: 'm-explicit' }),
      }),
    );
  });

  it('无 session 且 body 无 created_by → 400', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore); // 无 session

    const resp = await app.request('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 't', display_name: 'T' }),
    });

    expect(resp.status).toBe(400);
  });

  it('创建 Team 缺 slug → 400', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    const resp = await app.request('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'T' }),
    });

    expect(resp.status).toBe(400);
  });

  it('创建 Team slug 重复 → 409', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'slug_taken' } }), { status: 409 }),
    );

    const resp = await app.request('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'dup', display_name: 'Dup' }),
    });

    expect(resp.status).toBe(409);
  });

  it('创建 Team intellect-team 不可达 → 502', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x', display_name: 'X' }),
    });

    expect(resp.status).toBe(502);
  });

  // -------------------------------------------------------------------------
  // GET /admin/teams
  // -------------------------------------------------------------------------

  it('列出 Team 成功 → 200, intellect-team 返回 {data: [...]}, BFF 提取数组', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'team-1', slug: 'team-1', display_name: 'Team 1', enabled: 1, created_at: 0 },
            { id: 'team-2', slug: 'team-2', display_name: 'Team 2', enabled: 1, created_at: 0 },
          ],
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/admin/teams', { method: 'GET' });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].slug).toBe('team-1');
  });

  // -------------------------------------------------------------------------
  // GET /admin/teams/:ref
  // -------------------------------------------------------------------------

  it('获取单个 Team(用 slug)→ 200', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'team-1', slug: 'team-1', display_name: 'Team 1', enabled: 1, created_at: 0 }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/admin/teams/team-1', { method: 'GET' });

    // 验证用 slug 作为 team_ref
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://mock-im:9381/api/teams/team-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(resp.status).toBe(200);
  });

  it('获取不存在的 Team → 404', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'team_not_found' } }), { status: 404 }),
    );

    const resp = await app.request('/admin/teams/non-existent', { method: 'GET' });

    expect(resp.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // DELETE /admin/teams/:ref (FR-011:绑定检查 + 软删除)
  // -------------------------------------------------------------------------

  it('归档未被绑定的 Team → 200 + {archived: true}', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const resp = await app.request('/admin/teams/team-unbound', { method: 'DELETE' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-im:9381/api/teams/team-unbound',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.archived).toBe(true);
  });

  it('归档被 BffTenant 绑定的 Team → 409(FR-011)', async () => {
    const tenantStore = createMockTenantStore([tenantBoundToTeam]);
    const app = createApp(tenantStore, memberSession);

    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const resp = await app.request('/admin/teams/team-001', { method: 'DELETE' });

    // 不应调用 fetch(绑定检查在调 intellect-team 之前)
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.message).toContain('bound to tenant');
    expect(body.message).toContain('tenant-bound');
  });

  it('归档 Team intellect-team 返回 403(非 profile key)→ 403', async () => {
    const tenantStore = createMockTenantStore([tenantUnbound]);
    const app = createApp(tenantStore, memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'profile_key_required' }), { status: 403 }),
    );

    const resp = await app.request('/admin/teams/team-x', { method: 'DELETE' });

    expect(resp.status).toBe(403);
  });
});
