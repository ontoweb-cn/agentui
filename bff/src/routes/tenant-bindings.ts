// @see specs/007-team-project-management/spec.md (FR-003, FR-010)
/**
 * BFF Tenant 绑定路由 — Multi-Harness P5 US3。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF 管理 BffTenant ↔ Team/Project 绑定
 * - Principle V (Tenant Isolation): 绑定真实 team_id 后启用实例内 Team 数据隔离
 *   (真正的租户隔离通过多实例:intellectBackendId 绑定不同 intellect-team 实例)
 * - Principle VII (YAGNI): P5 仅实现绑定更新,不实现复杂权限校验
 *
 * 路径映射(Vite proxy rewrite 去掉 /api/bff):
 * - 前端 /api/bff/admin/tenants/:id/binding → BFF /admin/tenants/:id/binding
 *
 * 行为:
 * - PUT /admin/tenants/:id/binding { intellectTenantId, intellectProjectId? }
 *   - intellectTenantId="0" 或 undefined:回退缺省(不注入 X-Intellect-Team)
 *   - intellectTenantId=真实 team_id:启用实例内 Team 数据隔离
 *   - intellectProjectId 可选,设置后注入 X-Intellect-Project
 * - GET /admin/tenants/:id/binding:返回当前绑定状态
 */

import { Hono } from 'hono';
import type { BackendStore } from '../types/stores';

interface BindingAppVariables {
  backendStore?: BackendStore;
}

export const tenantBindingRoutes = new Hono<{ Variables: BindingAppVariables }>();

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

// ---------------------------------------------------------------------------
// GET /admin/tenants/:id/binding — 获取当前绑定状态
// ---------------------------------------------------------------------------

tenantBindingRoutes.get('/admin/tenants/:id/binding', async (c) => {
  const id = c.req.param('id');
  const backendStore = c.get('backendStore');
  if (!backendStore) {
    return c.json(fail(500, 'BackendStore not available'), 500);
  }

  const tenant = backendStore.getBackend(id);
  if (!tenant) {
    return c.json(fail(404, `Tenant not found: ${id}`), 404);
  }

  return c.json(
    ok({
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      intellect_tenant_id: tenant.intellectTenantId || '0',
      intellect_project_id: tenant.intellectProjectId || null,
      is_default: !tenant.intellectTenantId || tenant.intellectTenantId === '0',
    }),
  );
});

// ---------------------------------------------------------------------------
// PUT /admin/tenants/:id/binding — 更新绑定
// ---------------------------------------------------------------------------

tenantBindingRoutes.put('/admin/tenants/:id/binding', async (c) => {
  const id = c.req.param('id');
  const backendStore = c.get('backendStore');
  if (!backendStore) {
    return c.json(fail(500, 'BackendStore not available'), 500);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const { intellect_tenant_id, intellect_project_id } = body as {
    intellect_tenant_id?: string;
    intellect_project_id?: string;
  };

  // 校验 tenant 存在
  const tenant = backendStore.getBackend(id);
  if (!tenant) {
    return c.json(fail(404, `Tenant not found: ${id}`), 404);
  }

  // intellect_tenant_id 为空/"0"/undefined → 回退缺省
  const resolvedTeamId = intellect_tenant_id && intellect_tenant_id !== '0'
    ? intellect_tenant_id
    : undefined;
  // intellect_project_id 为空/undefined → 清除 project 绑定
  const resolvedProjectId = intellect_project_id || undefined;

  try {
    await backendStore.setIntellectBinding(id, resolvedTeamId, resolvedProjectId);
  } catch (err) {
    return c.json(fail(500, `Failed to update binding: ${(err as Error).message}`), 500);
  }

  // 返回更新后的绑定状态
  const updated = backendStore.getBackend(id);
  return c.json(
    ok({
      tenant_id: updated!.id,
      intellect_tenant_id: updated!.intellectTenantId || '0',
      intellect_project_id: updated!.intellectProjectId || null,
      is_default: !updated!.intellectTenantId || updated!.intellectTenantId === '0',
    }),
  );
});
