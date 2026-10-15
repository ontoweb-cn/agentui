// 邀请码管理代理(企业版 admin 面板 → intellect-team /api/members/invites)。
// 设计:docs/invite-code-enterprise-design.md §4 Phase 3.3(2026-10-14);
// 评审修订(2026-10-15):鉴权模型变更 —— 本代理**转发登录用户的 imt_*
// member token**(从 HttpOnly cookie 读取),不再注入 apiServerKey。
// 网关侧 invites 管理已摘除 profile bypass,仅认 member admin/owner 角色;
// 若仍走 profile key,任意 BFF 登录用户即可借服务级密钥越权发码(P0 修复)。
// RBAC 由网关按真实用户身份裁决;BFF 仅做租户路由与 token 转发。
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AUTH_COOKIE_NAME } from '../types/auth';
import { getEnterpriseBackend } from './auth';
import type { BackendStore, HarnessStore } from '../types/stores';

export const inviteRoutes = new Hono<Env>();

type Env = {
  Variables: {
    backendStore?: BackendStore;
    harnessStore?: HarnessStore;
  };
};

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

// 网关状态码透传集合(诚实枚举:含上游可能的 404/409/429/500,不做窄化谎言)
type PassthroughStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;

async function inviteUpstreamFetch(
  c: Context<Env>,
  path: string,
  init?: RequestInit,
): Promise<
  | { kind: 'response'; resp: Response; memberToken: string }
  | { kind: 'json'; status: PassthroughStatus; body: ReturnType<typeof fail> }
> {
  const tenantId = c.req.header('X-Backend-Id') || '0';
  const backend = getEnterpriseBackend(
    c.get('backendStore'),
    c.get('harnessStore'),
    tenantId,
  );
  if (!backend) {
    return { kind: 'json', status: 502, body: fail(502, 'Enterprise backend not configured for tenant') };
  }
  // P0:转发登录用户本人的 member token(网关按其角色做 member:invite RBAC)。
  const memberToken = getCookie(c, AUTH_COOKIE_NAME);
  if (!memberToken) {
    return { kind: 'json', status: 401, body: fail(401, 'Member session required for invite management') };
  }
  const resp = await fetch(`${backend.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${memberToken}`,
    },
  });
  return { kind: 'response', resp, memberToken };
}

// GET /api/bff/admin/invites?status=pending|accepted|expired|revoked — 全量列表
// (不引分页,2026-10-14 定版;网关侧按派生状态过滤)。
inviteRoutes.get('/invites', async (c) => {
  const status = c.req.query('status');
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  let upstream: Awaited<ReturnType<typeof inviteUpstreamFetch>>;
  try {
    upstream = await inviteUpstreamFetch(c, `/api/members/invites${qs}`, { method: 'GET' });
  } catch (err) {
    console.error('[invites] list fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'), 502);
  }
  if (upstream.kind === 'json') {
    return c.json(upstream.body, upstream.status);
  }
  const body = await upstream.resp.json().catch(() => null);
  if (!upstream.resp.ok || !body) {
    const status = upstream.resp.status as PassthroughStatus;
    return c.json(
      fail(status, (body as { error?: { message?: string } })?.error?.message ?? 'list invites failed'),
      status,
    );
  }
  return c.json(ok(body));
});

// POST /api/bff/admin/invites — 生成邀请码
inviteRoutes.post('/invites', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body !== null && typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }
  let upstream: Awaited<ReturnType<typeof inviteUpstreamFetch>>;
  try {
    upstream = await inviteUpstreamFetch(c, '/api/members/invites', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    console.error('[invites] create fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'), 502);
  }
  if (upstream.kind === 'json') {
    return c.json(upstream.body, upstream.status);
  }
  const payload = await upstream.resp.json().catch(() => null);
  if (!upstream.resp.ok || !payload) {
    const status = upstream.resp.status as PassthroughStatus;
    return c.json(
      fail(status, (payload as { error?: { message?: string } })?.error?.message ?? 'create invite failed'),
      status,
    );
  }
  return c.json(ok(payload), 201);
});

// DELETE /api/bff/admin/invites/:code — 撤销未兑换邀请码
inviteRoutes.delete('/invites/:code', async (c) => {
  const code = c.req.param('code');
  if (!code) {
    return c.json(fail(400, 'code is required'), 400);
  }
  let upstream: Awaited<ReturnType<typeof inviteUpstreamFetch>>;
  try {
    upstream = await inviteUpstreamFetch(c, `/api/members/invites/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.error('[invites] revoke fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'), 502);
  }
  if (upstream.kind === 'json') {
    return c.json(upstream.body, upstream.status);
  }
  const payload = await upstream.resp.json().catch(() => null);
  if (!upstream.resp.ok || !payload) {
    const status = upstream.resp.status as PassthroughStatus;
    return c.json(
      fail(status, (payload as { error?: { message?: string } })?.error?.message ?? 'revoke invite failed'),
      status,
    );
  }
  return c.json(ok(payload));
});
