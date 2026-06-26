// Multi-Harness P5 (US2):Project CRUD 路由单元测试
// 对齐 intellect-team 实际契约:独立 /api/projects 路径,slug/display_name/team_ref/repo_url/created_by,DELETE 软删除,无 PUT。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { projectRoutes } from './projects';
import type { AuthSession } from '../types/auth';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';

const memberSession: AuthSession = {
  token: 'imt_test_token',
  tenantId: 'tenant-1',
  authMode: 'intellect-enterprise',
  memberId: 'm-creator-001',
};

interface TestVariables {
  [AUTH_SESSION_KEY]?: AuthSession;
}

function createApp(session?: AuthSession): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    if (session) {
      c.set(AUTH_SESSION_KEY, session);
    }
    await next();
  });
  app.route('/', projectRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

describe('Project CRUD 路由 (P5 US2, 对齐 intellect-team 实际契约)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTELLECT_ENTERPRISE_BASE_URL = 'http://mock-im:9381';
    process.env.HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY = 'test-api-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('创建 Project 成功 → 201, 传 slug/display_name/created_by[/team_ref/repo_url]', async () => {
    const app = createApp(memberSession);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'proj-1', slug: 'proj-1', display_name: 'P1', team_id: 'team-1', repo_url: 'https://x.git', status: 'active', created_at: 0 }),
        { status: 201 },
      ),
    );

    const resp = await app.request('/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'proj-1', display_name: 'P1', team_ref: 'team-1', repo_url: 'https://x.git' }),
    });

    // created_by 从 AuthSession.memberId 自动注入
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock-im:9381/api/projects',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
        body: JSON.stringify({
          slug: 'proj-1',
          display_name: 'P1',
          created_by: 'm-creator-001',
          team_ref: 'team-1',
          repo_url: 'https://x.git',
        }),
      }),
    );
    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.data.slug).toBe('proj-1');
  });

  it('创建 Project 缺 slug → 400', async () => {
    const app = createApp(memberSession);

    const resp = await app.request('/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'P1' }),
    });

    expect(resp.status).toBe(400);
  });

  it('无 session 且 body 无 created_by → 400', async () => {
    const app = createApp(); // 无 session

    const resp = await app.request('/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'p', display_name: 'P' }),
    });

    expect(resp.status).toBe(400);
  });

  it('创建 Project team_ref 指向不存在的 team → 404', async () => {
    const app = createApp(memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'team_not_found' } }), { status: 404 }),
    );

    const resp = await app.request('/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'p', display_name: 'P', team_ref: 'ghost-team' }),
    });

    expect(resp.status).toBe(404);
  });

  it('创建 Project slug 重复 → 409', async () => {
    const app = createApp(memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'slug_taken' } }), { status: 409 }),
    );

    const resp = await app.request('/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'dup', display_name: 'Dup' }),
    });

    expect(resp.status).toBe(409);
  });

  it('列出 Project → 200, 提取 {data: [...]} 数组', async () => {
    const app = createApp(memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'p1', slug: 'p1', display_name: 'P1', status: 'active', created_at: 0 },
          ],
        }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/admin/projects', { method: 'GET' });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data).toHaveLength(1);
  });

  it('获取单个 Project(用 slug)→ 200', async () => {
    const app = createApp(memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'p1', slug: 'p1', display_name: 'P1', status: 'active', created_at: 0 }),
        { status: 200 },
      ),
    );

    const resp = await app.request('/admin/projects/p1', { method: 'GET' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://mock-im:9381/api/projects/p1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(resp.status).toBe(200);
  });

  it('归档 Project → 200 + {archived: true}', async () => {
    const app = createApp(memberSession);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const resp = await app.request('/admin/projects/p1', { method: 'DELETE' });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.archived).toBe(true);
  });

  it('intellect-team 不可达 → 502', async () => {
    const app = createApp(memberSession);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resp = await app.request('/admin/projects', { method: 'GET' });

    expect(resp.status).toBe(502);
  });
});
