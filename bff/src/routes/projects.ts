// @see specs/007-team-project-management/spec.md (FR-002, FR-009)
// @see intellect-team/docs/agentui-integration/teams-projects-api.md (实际契约)
/**
 * BFF Project CRUD 路由 — Multi-Harness P5 US2。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF 透传 intellect-team Project CRUD
 * - Principle V (Tenant Isolation): Project 通过 team_ref 关联 Team,绑定到 BffTenant 后注入 X-Intellect-Project
 * - Principle VIII: 管理操作用 API_SERVER_KEY 鉴权
 * - Principle VII (YAGNI): P5 仅透传 CRUD
 *
 * 路径映射(Vite proxy rewrite 去掉 /api/bff):
 * - 前端 /api/bff/admin/projects        → BFF /admin/projects
 * - 前端 /api/bff/admin/projects/:ref   → BFF /admin/projects/:ref(project_ref 为 slug 或 id)
 *
 * 端点(对齐 intellect-team 实际实现,独立路径非嵌套):
 * - POST   /admin/projects         创建(body: slug/display_name/created_by[/team_ref/repo_url])
 * - GET    /admin/projects         列表
 * - GET    /admin/projects/:ref    详情
 * - DELETE /admin/projects/:ref    归档(软删除,archived=1)
 *
 * 注意:intellect-team 未实现 PUT(更新 Project),BFF 不暴露 PUT 路由。
 * Project 通过 team_ref 关联 Team(非路径嵌套),与 intellect-team 实际契约一致。
 */

import { Hono } from 'hono';
import { IntellectTeamAdminClient, IntellectAdminError } from '../services/intellect-team-admin-client';
import type { AuthSession } from '../types/auth';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';
import type { CreateProjectRequest } from '../types/team';

interface ProjectAppVariables {
  [AUTH_SESSION_KEY]?: AuthSession;
}

export const projectRoutes = new Hono<{ Variables: ProjectAppVariables }>();

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

// ---------------------------------------------------------------------------
// POST /admin/projects — 创建 Project
// ---------------------------------------------------------------------------

projectRoutes.post('/admin/projects', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const req = body as Partial<CreateProjectRequest>;
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
    const project = await client.createProject({
      slug: req.slug,
      display_name: req.display_name,
      created_by: createdBy,
      team_ref: req.team_ref,
      repo_url: req.repo_url,
    });
    return c.json(ok(project), 201);
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 400 | 404 | 409 | 500 | 502 | 503);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/projects — 列出所有 Project
// ---------------------------------------------------------------------------

projectRoutes.get('/admin/projects', async (c) => {
  const client = createAdminClient();
  try {
    const projects = await client.listProjects();
    return c.json(ok(projects));
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 401 | 500 | 502 | 503);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/projects/:ref — 获取单个 Project
// ---------------------------------------------------------------------------

projectRoutes.get('/admin/projects/:ref', async (c) => {
  const ref = c.req.param('ref');
  const client = createAdminClient();
  try {
    const project = await client.getProject(ref);
    return c.json(ok(project));
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 404 | 500 | 502);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/projects/:ref — 归档 Project(软删除,archived=1)
// ---------------------------------------------------------------------------

projectRoutes.delete('/admin/projects/:ref', async (c) => {
  const ref = c.req.param('ref');
  const client = createAdminClient();
  try {
    await client.deleteProject(ref);
    return c.json(ok({ archived: true }));
  } catch (err) {
    if (err instanceof IntellectAdminError) {
      return c.json(fail(err.status, err.message), err.status as 403 | 404 | 500 | 502 | 503);
    }
    return c.json(fail(500, `Unexpected error: ${(err as Error).message}`), 500);
  }
});
