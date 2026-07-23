// @see specs/007-team-project-management/spec.md (FR-001, FR-009, FR-011)
// @see intellect-team/docs/agentui-integration/teams-projects-api.md (实际契约)
/**
 * BFF Team CRUD 路由 — Multi-Harness P5 US1。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF 透传 intellect-team Team CRUD
 * - Principle V (Tenant Isolation): Team 绑定到 BffTenant 后启用实例内 Team 数据隔离
 *   (真正的租户隔离通过多实例:不同 BffTenant 绑定不同 intellectBackendId)
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract):
 *   管理操作用 API_SERVER_KEY 鉴权(BFF 内部,前端不接触)
 * - Principle VII (YAGNI): P5 仅透传 CRUD,不实现复杂业务逻辑
 *
 * 路径映射(Vite proxy rewrite 去掉 /api/bff):
 * - 前端 /api/bff/admin/teams       → BFF /admin/teams
 * - 前端 /api/bff/admin/teams/:ref  → BFF /admin/teams/:ref(team_ref 为 slug 或 id)
 *
 * 端点(对齐 intellect-team 实际实现):
 * - POST   /admin/teams         创建(body: slug/display_name/created_by)
 * - GET    /admin/teams         列表
 * - GET    /admin/teams/:ref    详情(team_ref 为 slug 或内部 id)
 * - DELETE /admin/teams/:ref    归档(软删除,enabled=0)
 *
 * 注意:intellect-team 未实现 PUT(更新 Team),BFF 不暴露 PUT 路由。
 *
 * 鉴权:authMiddleware(全局,在 index.ts 挂载到 /admin/teams/*)
 * created_by:BFF 从 AuthSession.memberId 注入(若前端未传)
 */

import { Hono } from 'hono';
import { IntellectTeamAdminClient, IntellectAdminError } from '../services/intellect-team-admin-client';
import type { BackendStore } from '../types/stores';
import type { AuthSession } from '../types/auth';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';
import type { CreateTeamRequest } from '../types/team';

interface TeamAppVariables {
  backendStore?: BackendStore;
  [AUTH_SESSION_KEY]?: AuthSession;
}

export const teamRoutes = new Hono<{ Variables: TeamAppVariables }>();

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

function createAdminClient(): IntellectTeamAdminClient {
  const baseUrl = process.env.INTELLECT_ENTERPRISE_BASE_URL || 'http://localhost:9381';
  const apiServerKey = process.env.HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY || '';
  return new IntellectTeamAdminClient(baseUrl, apiServerKey);
}

/**
 * 检查 Team 是否被任意 BffTenant 绑定(FR-011:删除前检查)。
 * @returns 绑定该 team slug 的 BffTenant 数组(空数组表示未绑定)
 */
function findTenantsBoundToTeam(backendStore: BackendStore, teamRef: string) {
  // intellect-team 的 team_ref 可能是 slug 或内部 id;BffTenant.intellectTenantId 存的是 slug
  return backendStore.listBackends().filter((t) => t.intellectTenantId === teamRef);
}

// ---------------------------------------------------------------------------
// POST /admin/teams — 创建 Team
// ---------------------------------------------------------------------------

teamRoutes.post('/admin/teams', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const req = body as Partial<CreateTeamRequest>;
  // created_by 优先从 body 取,否则从 AuthSession 注入
  const createdBy = req.created_by || c.get(AUTH_SESSION_KEY)?.memberId;
  if (!req.slug || !req.display_name || !createdBy) {
    return c.json(
      fail(400, 'slug, display_name and created_by are required (created_by auto-injected from session if logged in)'),
      400,
    );
  }

  const client = createAdminClient();
  try {
    const team = await client.createTeam({
      slug: req.slug,
      display_name: req.display_name,
      created_by: createdBy,
    });
    return c.json(ok(team), 201);
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 400 | 409 | 500 | 502 | 503);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/teams — 列出所有 Team
// ---------------------------------------------------------------------------

teamRoutes.get('/admin/teams', async (c) => {
  const client = createAdminClient();
  try {
    const teams = await client.listTeams();
    return c.json(ok(teams));
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 401 | 500 | 502 | 503);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/teams/:ref — 获取单个 Team(team_ref 为 slug 或内部 id)
// ---------------------------------------------------------------------------

teamRoutes.get('/admin/teams/:ref', async (c) => {
  const ref = c.req.param('ref');
  const client = createAdminClient();
  try {
    const team = await client.getTeam(ref);
    return c.json(ok(team));
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 404 | 500 | 502);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/teams/:ref — 归档 Team(软删除,FR-011:检查 BffTenant 绑定)
// ---------------------------------------------------------------------------

teamRoutes.delete('/admin/teams/:ref', async (c) => {
  const ref = c.req.param('ref');
  const backendStore = c.get('backendStore');

  // FR-011:归档前检查是否有 BffTenant 绑定(绑定则拒绝,需先解绑)
  if (backendStore) {
    const boundTenants = findTenantsBoundToTeam(backendStore, ref);
    if (boundTenants.length > 0) {
      const tenantNames = boundTenants.map((t) => `${t.id}(${t.name})`).join(', ');
      return c.json(
        fail(409, `Team is bound to tenant(s): ${tenantNames}. Unbind before archiving.`),
        409,
      );
    }
  }

  const client = createAdminClient();
  try {
    await client.deleteTeam(ref);
    return c.json(ok({ archived: true }));
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 403 | 404 | 500 | 502 | 503);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});
