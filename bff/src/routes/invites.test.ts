// 邀请码管理代理路由单元测试(D8/Phase 3.3,2026-10-14)。
// 覆盖:租户后端缺失 502、列表透传(含 status query)、生成透传 201、
// 撤销透传、网关 403 语义透传。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { inviteRoutes } from './invites';
import type { BackendStore, HarnessStore } from '../types/stores';
import type { HarnessBackend } from '../types/harness';
import type { BffTenant } from '../types/tenant';

const enterpriseTenant: BffTenant = {
  id: 'tenant-enterprise',
  name: 'Enterprise',
  intellectTenantId: '0',
  intellectBackendId: 'intellect-enterprise-default',
  authMode: 'intellect-enterprise',
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
  } as unknown as BackendStore;
}

function createMockHarnessStore(backends: HarnessBackend[]): HarnessStore {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    get: vi.fn((id: string) => backends.find((b) => b.id === id)),
    list: vi.fn(() => backends),
    upsert: vi.fn(),
    remove: vi.fn(),
  } as unknown as HarnessStore;
}

function createApp(backendStore: BackendStore, harnessStore: HarnessStore) {
  const app = new Hono<{ Variables: { backendStore: BackendStore; harnessStore: HarnessStore } }>();
  app.use('*', async (c, next) => {
    c.set('backendStore', backendStore);
    c.set('harnessStore', harnessStore);
    await next();
  });
  app.route('/admin', inviteRoutes);
  return app;
}

describe('invites 管理代理(企业版)', () => {
  let fetchMock: any;
  // (类型断言:vi.spyOn 全局 fetch 的精确泛型在本 tsconfig 下不可表达)

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P0:无 member cookie → 401(代理不注入 profile key,拒绝匿名/服务级调用)', async () => {
    const app = createApp(
      createMockBackendStore([enterpriseTenant]),
      createMockHarnessStore([enterpriseBackend]),
    );
    const resp = await app.request('/admin/invites', {
      headers: { 'X-Backend-Id': 'tenant-enterprise' },
    });
    expect(resp.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('后端未配置 → 502', async () => {
    const app = createApp(createMockBackendStore([]), createMockHarnessStore([]));
    const resp = await app.request('/admin/invites', {
      headers: { 'X-Backend-Id': 'tenant-x', Cookie: 'imt_token=imt_someone' },
    });
    expect(resp.status).toBe(502);
  });

  it('GET /invites?status=pending → 透传 query 并包装信封', async () => {
    const app = createApp(
      createMockBackendStore([enterpriseTenant]),
      createMockHarnessStore([enterpriseBackend]),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ invites: [], count: 0 }), { status: 200 }),
    );
    const resp = await app.request('/admin/invites?status=pending', {
      headers: { 'X-Backend-Id': 'tenant-enterprise', Cookie: 'imt_token=imt_admin' },
    });
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/invites?status=pending',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer imt_admin' }),
      }),
    );
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data).toEqual({ invites: [], count: 0 });
  });

  it('POST /invites → 透传 body,201 包装', async () => {
    const app = createApp(
      createMockBackendStore([enterpriseTenant]),
      createMockHarnessStore([enterpriseBackend]),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'IM-CH-ABCD1234', expires_at: 1792000000 }), { status: 201 }),
    );
    const resp = await app.request('/admin/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
        Cookie: 'imt_token=imt_admin',
      },
      body: JSON.stringify({ email: 'new@example.com', ttl_seconds: 3600 }),
    });
    expect(resp.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-enterprise:9381/api/members/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', ttl_seconds: 3600 }),
      }),
    );
    const body = await resp.json();
    expect(body.data.code).toBe('IM-CH-ABCD1234');
  });

  it('DELETE /invites/:code → 透传;网关 404 → 404 语义保留', async () => {
    const app = createApp(
      createMockBackendStore([enterpriseTenant]),
      createMockHarnessStore([enterpriseBackend]),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'invite not found', code: 'invite_invalid' } }), { status: 404 }),
    );
    const resp = await app.request('/admin/invites/IM-CH-GONE0001', {
      method: 'DELETE',
      headers: { 'X-Backend-Id': 'tenant-enterprise', Cookie: 'imt_token=imt_admin' },
    });
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.message).toBe('invite not found');
  });

  it('网关 403(RBAC)→ 原样透传 message', async () => {
    const app = createApp(
      createMockBackendStore([enterpriseTenant]),
      createMockHarnessStore([enterpriseBackend]),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Admin privileges required for invite management', code: 'forbidden' } }),
        { status: 403 },
      ),
    );
    const resp = await app.request('/admin/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-enterprise',
        Cookie: 'imt_token=imt_regular_member',
      },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(403);
    expect((await resp.json()).message).toContain('Admin privileges');
  });
});
