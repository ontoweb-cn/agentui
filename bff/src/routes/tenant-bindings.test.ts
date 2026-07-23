// Multi-Harness P5 (US3):Tenant 绑定路由单元测试
// 覆盖 GET/PUT /admin/tenants/:id/binding,含绑定真实 team_id、回退缺省、解绑 project。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { tenantBindingRoutes } from './tenant-bindings';
import type { BackendStore } from '../types/stores';
import type { BffTenant } from '../types/tenant';

const tenantDefault: BffTenant = {
  id: 'tenant-default',
  name: 'Default',
  intellectTenantId: '0',
  intellectBackendId: 'intellect-enterprise-default',
  authMode: 'intellect-enterprise',
  createdAt: '2026-06-26T00:00:00Z',
  updatedAt: '2026-06-26T00:00:00Z',
};

const tenantBound: BffTenant = {
  id: 'tenant-bound',
  name: 'Bound',
  intellectTenantId: 'team-001',
  intellectProjectId: 'project-001',
  intellectBackendId: 'intellect-enterprise-default',
  authMode: 'intellect-enterprise',
  createdAt: '2026-06-26T00:00:00Z',
  updatedAt: '2026-06-26T00:00:00Z',
};

function createMockBackendStore(tenants: BffTenant[]): BackendStore {
  // 可变副本,模拟 setIntellectBinding 后的状态
  const store: BffTenant[] = tenants.map((t) => ({ ...t }));
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getBackend: vi.fn((id: string) => store.find((t) => t.id === id)),
    listBackends: vi.fn(() => store),
    createBackend: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setCanvasBinding: vi.fn(),
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(async (id, teamId, projectId) => {
      const t = store.find((x) => x.id === id);
      if (!t) throw new Error(`Tenant not found: ${id}`);
      t.intellectTenantId = teamId || '0';
      if (projectId) {
        t.intellectProjectId = projectId;
      } else {
        delete t.intellectProjectId;
      }
      t.updatedAt = new Date().toISOString();
    }),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };
}

interface TestVariables {
  backendStore: BackendStore;
}

function createApp(backendStore: BackendStore): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('backendStore', backendStore);
    await next();
  });
  app.route('/', tenantBindingRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

describe('Tenant 绑定路由 (P5 US3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /admin/tenants/:id/binding
  // -------------------------------------------------------------------------

  it('获取缺省 tenant 绑定状态 → is_default=true', async () => {
    const backendStore = createMockBackendStore([tenantDefault]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-default/binding', { method: 'GET' });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.is_default).toBe(true);
    expect(body.data.intellect_tenant_id).toBe('0');
    expect(body.data.intellect_project_id).toBeNull();
  });

  it('获取已绑定 tenant 状态 → is_default=false', async () => {
    const backendStore = createMockBackendStore([tenantBound]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-bound/binding', { method: 'GET' });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.is_default).toBe(false);
    expect(body.data.intellect_tenant_id).toBe('team-001');
    expect(body.data.intellect_project_id).toBe('project-001');
  });

  it('获取不存在的 tenant → 404', async () => {
    const backendStore = createMockBackendStore([tenantDefault]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/non-existent/binding', { method: 'GET' });

    expect(resp.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // PUT /admin/tenants/:id/binding
  // -------------------------------------------------------------------------

  it('绑定真实 team_id + project_id → 200, is_default=false', async () => {
    const backendStore = createMockBackendStore([tenantDefault]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-default/binding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intellect_tenant_id: 'team-new', intellect_project_id: 'project-new' }),
    });

    expect(resp.status).toBe(200);
    expect(backendStore.setIntellectBinding).toHaveBeenCalledWith(
      'tenant-default',
      'team-new',
      'project-new',
    );
    const body = await resp.json();
    expect(body.data.is_default).toBe(false);
  });

  it('intellect_tenant_id="0" → 回退缺省, is_default=true', async () => {
    const backendStore = createMockBackendStore([tenantBound]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-bound/binding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intellect_tenant_id: '0' }),
    });

    expect(resp.status).toBe(200);
    // setIntellectBinding 用 undefined(回退缺省)
    expect(backendStore.setIntellectBinding).toHaveBeenCalledWith(
      'tenant-bound',
      undefined,
      undefined,
    );
  });

  it('intellect_tenant_id 省略 → 回退缺省', async () => {
    const backendStore = createMockBackendStore([tenantBound]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-bound/binding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(resp.status).toBe(200);
    expect(backendStore.setIntellectBinding).toHaveBeenCalledWith(
      'tenant-bound',
      undefined,
      undefined,
    );
  });

  it('仅绑定 team_id(无 project)→ project 解绑', async () => {
    const backendStore = createMockBackendStore([tenantBound]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-bound/binding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intellect_tenant_id: 'team-002' }),
    });

    expect(resp.status).toBe(200);
    expect(backendStore.setIntellectBinding).toHaveBeenCalledWith(
      'tenant-bound',
      'team-002',
      undefined,
    );
  });

  it('绑定不存在的 tenant → 404', async () => {
    const backendStore = createMockBackendStore([tenantDefault]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/non-existent/binding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intellect_tenant_id: 'team-x' }),
    });

    expect(resp.status).toBe(404);
    expect(backendStore.setIntellectBinding).not.toHaveBeenCalled();
  });

  it('非 JSON body → 400', async () => {
    const backendStore = createMockBackendStore([tenantDefault]);
    const app = createApp(backendStore);

    const resp = await app.request('/admin/tenants/tenant-default/binding', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });

    expect(resp.status).toBe(400);
  });
});
