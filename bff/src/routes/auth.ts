// @see specs/005-bff-auth-default-tenant/contracts/auth-api.ts (authority source)
/**
 * BFF 统一认证路由 — Multi-Harness P4b。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端认证经 BFF,不直连 intellect-team/intellect-rag
 * - Principle V (Tenant Isolation): 缺省 TenantID=0 不注入 X-Intellect-Team 头
 * - Principle VIII: 企业版认证用 member token(imt_*),BFF 管理操作用 API_SERVER_KEY
 * - Principle VII (YAGNI + Test-First): 路由必有单元测试,不实现 token 刷新
 *
 * 路径映射(按 BffTenant.authMode 分发):
 * - authMode=intellect-rag(默认):透传到 intellect-rag /api/v1/auth/* + /api/v1/users/*
 * - authMode=intellect-enterprise:调 intellect-team /api/members/* + /api/oauth/*
 *
 * Cookie 规则(企业版):
 * - 登录成功:setCookie(imt_token, token, {httpOnly, sameSite:'lax', path:'/', maxAge:86400})
 * - 登出:setCookie(imt_token, '', {maxAge:0}) 清除
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { TenantStore, HarnessStore } from '../types/stores';
import type { AuthSession } from '../types/auth';
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../types/auth';
import { getAuthSession, AUTH_SESSION_KEY } from '../middleware/auth-session';

/**
 * OAuth state cookie 名(用于 CSRF 防护,在 /auth/login/:channel 时写入,
 * /auth/oauth/callback 时校验)。
 */
const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
/** OAuth state cookie 有效期(10 分钟,覆盖 OAuth 跳转时间) */
const OAUTH_STATE_COOKIE_MAX_AGE = 600;

// ---------------------------------------------------------------------------
// intellect-team API 响应类型(企业版模式用)
// ---------------------------------------------------------------------------

interface MemberLoginResponse {
  member_id: string;
  display_name: string;
  role: string;
  token: string;
  permissions: string[];
}

interface MemberInfoResponse {
  member_id: string;
  display_name: string;
  role: string;
  email?: string;
  permissions: string[];
}

// ---------------------------------------------------------------------------
// intellect-rag 透传类型(社区版模式用)
// ---------------------------------------------------------------------------

interface RagLoginResponse {
  access_token?: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  role?: string;
}

interface RagUserInfoResponse {
  id?: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// 路由定义
// ---------------------------------------------------------------------------

interface AuthVariables {
  tenantStore: TenantStore;
  harnessStore: HarnessStore;
  [AUTH_SESSION_KEY]?: AuthSession;
}

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

/**
 * 获取 tenant 的 authMode,默认 intellect-rag(向后兼容)。
 */
function getAuthMode(tenantStore: TenantStore | undefined, tenantId: string): 'intellect-rag' | 'intellect-enterprise' {
  if (!tenantStore) return 'intellect-rag';
  const tenant = tenantStore.getTenant(tenantId);
  return tenant?.authMode ?? 'intellect-rag';
}

/**
 * 获取企业版后端 baseUrl + apiServerKey。
 * 从 HarnessStore 按 tenant.intellectBackendId 读取对应 intellect-team 实例的 endpoint。
 * 多租户隔离:不同 BffTenant 绑定不同 intellectBackendId,即不同 intellect-team 实例。
 * Constitution Principle V (Tenant Isolation via multi-instance)。
 *
 * @returns null 表示 tenant 不存在或 backend 未配置(调用方应返回 502)
 */
function getEnterpriseBackend(
  tenantStore: TenantStore | undefined,
  harnessStore: HarnessStore | undefined,
  tenantId: string,
): { baseUrl: string; apiServerKey: string } | null {
  if (!tenantStore || !harnessStore) return null;
  const tenant = tenantStore.getTenant(tenantId);
  if (!tenant) return null;
  const backend = harnessStore.get(tenant.intellectBackendId);
  if (!backend) return null;
  return {
    baseUrl: backend.endpoint,
    apiServerKey: backend.adminToken,
  };
}

/**
 * 获取社区版后端 baseUrl。
 * intellect-rag 当前为单实例,从环境变量读取(保留向后兼容)。
 */
function getRagBaseUrl(): string {
  const ragHost = process.env.INTELLECT_RAG_HOST || 'localhost';
  const ragPort = process.env.PYTHON_API_PORT || '9380';
  return `http://${ragHost}:${ragPort}`;
}

// ---------------------------------------------------------------------------
// GET /api/bff/auth/config — 认证配置(公开,无需登录)
// ---------------------------------------------------------------------------

authRoutes.get('/auth/config', (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容,未传 header 时返回 intellect-rag 默认模式)
  const tenantId = c.req.header('X-Tenant-Id') || '0';
  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);
  return c.json(ok({ authMode }));
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/login — 登录
// ---------------------------------------------------------------------------

authRoutes.post('/auth/login', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Tenant-Id') || '0';

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team POST /api/members/login
    const { login_name, email, password } = body as {
      login_name?: string;
      email?: string;
      password?: string;
    };
    // email → login_name 映射(前端社区版字段兼容)
    const resolvedLoginName = login_name ?? email;
    if (!resolvedLoginName || !password) {
      return c.json(fail(400, 'login_name (or email) and password are required'), 400);
    }

    const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    const { baseUrl } = backend;

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/members/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_name: resolvedLoginName, password }),
      });
    } catch (err) {
      console.error('[auth] intellect-team login fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (resp.status === 401) {
      return c.json(fail(401, 'Invalid credentials'), 401);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-team login failed: ${resp.status}`, text);
      return c.json(
        fail(resp.status, 'intellect-team login failed'),
        resp.status as 400 | 403 | 423 | 500 | 502 | 503,
      );
    }

    const data = (await resp.json()) as MemberLoginResponse;

    // 设置 HttpOnly cookie(Principle I:token 不暴露给前端 JS)
    setCookie(c, AUTH_COOKIE_NAME, data.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });

    // 返回不含 token 的 body(token 只在 cookie)
    return c.json(
      ok({
        member_id: data.member_id,
        display_name: data.display_name,
        role: data.role,
      }),
    );
  }

  // 社区版:透传到 intellect-rag /api/v1/auth/login
  const ragBaseUrl = getRagBaseUrl();

  let resp: Response;
  try {
    resp = await fetch(`${ragBaseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[auth] intellect-rag login fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-rag unreachable'), 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-rag login failed: ${resp.status}`, text);
    return c.json(
      fail(resp.status, 'intellect-rag login failed'),
      resp.status as 400 | 401 | 500 | 502,
    );
  }

  const data = (await resp.json()) as RagLoginResponse;
  const authorizationHeader = resp.headers.get('Authorization');
  const responseData = { ...data };
  if (authorizationHeader) {
    responseData.access_token = authorizationHeader;
  }
  const response = c.json(ok(responseData));
  if (authorizationHeader) {
    response.headers.set('Authorization', authorizationHeader);
  }
  return response;
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/me — 获取当前用户信息
// ---------------------------------------------------------------------------

authRoutes.get('/auth/me', async (c) => {
  // 需认证端点:严格校验 X-Tenant-Id(登录后前端必然知道 tenantId)
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json(fail(400, 'Missing X-Tenant-Id header'), 400);
  }

  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);

  if (authMode === 'intellect-rag') {
    const ragBaseUrl = getRagBaseUrl();
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json(fail(401, 'Unauthorized: missing Authorization header'), 401);
    }

    let resp: Response;
    try {
      resp = await fetch(`${ragBaseUrl}/api/v1/users/me`, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
        },
      });
    } catch (err) {
      console.error('[auth] intellect-rag /me fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-rag unreachable'), 502);
    }

    if (resp.status === 401) {
      return c.json(fail(401, 'Unauthorized'), 401);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-rag /me failed: ${resp.status}`, text);
      return c.json(fail(502, 'intellect-rag /users/me failed'), 502);
    }

    const data = (await resp.json()) as RagUserInfoResponse;
    return c.json(ok(data));
  }

  const session = getAuthSession(c);
  if (!session) {
    return c.json(fail(401, 'Unauthorized: no valid session cookie'), 401);
  }

  // 企业版模式:调 intellect-team GET /api/members/me(用 member token 鉴权)
  const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
  }
  const { baseUrl } = backend;

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/api/members/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    console.error('[auth] intellect-team /me fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'), 502);
  }

  if (resp.status === 401) {
    return c.json(fail(401, 'Unauthorized'), 401);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-team /me failed: ${resp.status}`, text);
    return c.json(fail(502, 'intellect-team /me failed'), 502);
  }

  const data = (await resp.json()) as MemberInfoResponse;
  return c.json(
    ok({
      member_id: data.member_id,
      display_name: data.display_name,
      role: data.role,
      email: data.email,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/register — 注册
// ---------------------------------------------------------------------------

authRoutes.post('/auth/register', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Tenant-Id') || '0';

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team POST /api/members/register
    const { login_name, email, password, display_name, nickname } = body as {
      login_name?: string;
      email?: string;
      password?: string;
      display_name?: string;
      nickname?: string;
    };
    // 前端字段兼容:login_name 优先,其次 email;display_name 优先,其次 nickname
    const resolvedLoginName = login_name ?? email;
    const resolvedDisplayName = display_name ?? nickname;
    if (!resolvedLoginName || !password || !resolvedDisplayName) {
      return c.json(
        fail(400, 'login_name (or email), password and display_name (or nickname) are required'),
        400,
      );
    }

    const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    const { baseUrl } = backend;

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/members/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login_name: resolvedLoginName,
          password,
          display_name: resolvedDisplayName,
          email,
        }),
      });
    } catch (err) {
      console.error('[auth] intellect-team register fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (resp.status === 409) {
      return c.json(fail(409, 'Registration conflict: login_name already exists'), 409);
    }
    if (resp.status === 403) {
      return c.json(fail(403, 'Registration disabled'), 403);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-team register failed: ${resp.status}`, text);
      return c.json(
        fail(resp.status, 'intellect-team register failed'),
        resp.status as 400 | 500 | 502 | 503,
      );
    }

    const data = (await resp.json()) as { member_id: string; registration_pending: number };
    return c.json(ok(data), 201);
  }

  // 社区版:透传到 intellect-rag /api/v1/users
  const ragBaseUrl = getRagBaseUrl();

  let resp: Response;
  try {
    resp = await fetch(`${ragBaseUrl}/api/v1/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[auth] intellect-rag register fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-rag unreachable'), 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-rag register failed: ${resp.status}`, text);
    return c.json(
      fail(resp.status, 'intellect-rag register failed'),
      resp.status as 400 | 409 | 500 | 502,
    );
  }

  const data = await resp.json().catch(() => ({}));
  return c.json(ok(data), 201);
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/logout — 登出
// ---------------------------------------------------------------------------

authRoutes.post('/auth/logout', async (c) => {
  // 需认证端点:严格校验 X-Tenant-Id(登录后前端必然知道 tenantId)
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json(fail(400, 'Missing X-Tenant-Id header'), 400);
  }

  const session = getAuthSession(c);
  if (!session) {
    // 无 session 也清 cookie(防御性,允许登出已过期的会话)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.json(ok({ logged_out: true }));
  }

  const tenantStore = c.get('tenantStore');

  // 社区版模式:透传到 intellect-rag /api/v1/auth/logout
  if (session.authMode === 'intellect-rag') {
    const ragBaseUrl = getRagBaseUrl();
    const authHeader = c.req.header('Authorization') || `Bearer ${session.token}`;

    let resp: Response;
    try {
      resp = await fetch(`${ragBaseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: authHeader },
      });
    } catch (err) {
      // 网络错误仍清 cookie(本地登出)
      deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
      console.error('[auth] intellect-rag logout fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-rag unreachable'), 502);
    }

    // 无论上游返回什么,都清 cookie(本地登出)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });

    if (!resp.ok) {
      // 上游登出失败,但本地 cookie 已清,返回成功(用户视角已登出)
      console.warn(`[auth] intellect-rag logout returned ${resp.status}, cookie cleared anyway`);
    }
    return c.json(ok({ logged_out: true }));
  }

  // 企业版模式:调 intellect-team POST /api/members/logout(用 member token 鉴权)
  const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
  if (!backend) {
    // backend 未配置也清 cookie(本地登出)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.json(ok({ logged_out: true }));
  }
  const { baseUrl } = backend;

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/api/members/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    // 网络错误仍清 cookie(本地登出)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    console.error('[auth] intellect-team logout fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'), 502);
  }

  // 无论上游返回什么,都清 cookie(本地登出)
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });

  if (!resp.ok) {
    // 上游登出失败(token 已过期等),但本地 cookie 已清,返回成功(用户视角已登出)
    console.warn(`[auth] intellect-team logout returned ${resp.status}, cookie cleared anyway`);
  }
  return c.json(ok({ logged_out: true }));
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/login/channels — OAuth 渠道列表
// ---------------------------------------------------------------------------

interface OAuthProviderRaw {
  id: string;
  name: string;
  usage: string;
  auth_flow: string;
  enabled: boolean;
  logo_svg?: string;
  is_builtin: boolean;
  display_order: number;
  description?: string;
}

interface OAuthProviderConverted {
  channel: string;
  display_name: string;
  icon: string;
}

authRoutes.get('/auth/login/channels', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Tenant-Id') || '0';
  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team GET /api/oauth/providers,转换格式
    const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    const { baseUrl } = backend;

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/oauth/providers`, {
        method: 'GET',
      });
    } catch (err) {
      console.error('[auth] intellect-team /oauth/providers fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-team /oauth/providers failed: ${resp.status}`, text);
      return c.json(fail(502, 'intellect-team /oauth/providers failed'), 502);
    }

    const rawProviders = (await resp.json()) as OAuthProviderRaw[];
    // 转换格式 + 过滤 enabled=true + usage 含 login
    const channels: OAuthProviderConverted[] = rawProviders
      .filter((p) => p.enabled && p.usage.includes('login'))
      .map((p) => ({
        channel: p.id,
        display_name: p.name,
        icon: p.logo_svg || 'sso',
      }))
      .sort((a, b) => {
        // 按 display_order 排序(需回查原数组,简化:按 channel 字母序稳定)
        return a.channel.localeCompare(b.channel);
      });

    return c.json(ok(channels));
  }

  // 社区版:透传到 intellect-rag /api/v1/auth/login/channels
  const ragBaseUrl = getRagBaseUrl();

  let resp: Response;
  try {
    resp = await fetch(`${ragBaseUrl}/api/v1/auth/login/channels`, {
      method: 'GET',
    });
  } catch (err) {
    console.error('[auth] intellect-rag /login/channels fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-rag unreachable'), 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-rag /login/channels failed: ${resp.status}`, text);
    return c.json(fail(502, 'intellect-rag /login/channels failed'), 502);
  }

  const data = await resp.json().catch(() => []);
  return c.json(ok(data));
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/login/:channel — OAuth 授权重定向
// ---------------------------------------------------------------------------

authRoutes.get('/auth/login/:channel', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Tenant-Id') || '0';

  const channel = c.req.param('channel');
  if (!channel) {
    return c.json(fail(400, 'Missing channel parameter'), 400);
  }

  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team GET /api/oauth/login/{provider}(P4a-4,直接 302 重定向)
    // 比 POST /api/oauth/authorize 更简单:intellect-team 直接返回 302 + Location,
    // BFF 透传 302 即可,无需先 POST 拿 redirect_uri 再 302。
    const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    const { baseUrl } = backend;
    const targetUrl = `${baseUrl}/api/oauth/login/${encodeURIComponent(channel)}?usage=login`;

    let resp: Response;
    try {
      resp = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'manual', // 不自动跟随,获取 302 Location 透传
      });
    } catch (err) {
      console.error('[auth] intellect-team /oauth/login fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    // intellect-team 返回 302 + Location(BFF 透传)
    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get('location');
      if (!location) {
        return c.json(fail(502, 'intellect-team login response missing Location header'), 502);
      }

      // CSRF 防护:从 Location 中提取 state,存入短期 cookie,callback 时校验
      const stateMatch = location.match(/[?&]state=([^&]+)/);
      const oauthState = stateMatch?.[1];
      if (oauthState) {
        setCookie(c, OAUTH_STATE_COOKIE_NAME, oauthState, {
          httpOnly: true,
          sameSite: 'Lax',
          path: '/',
          maxAge: OAUTH_STATE_COOKIE_MAX_AGE,
          secure: process.env.NODE_ENV === 'production',
        });
      }

      return c.redirect(location, 302);
    }

    // 非 302 响应(intellect-team 返回错误 JSON)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-team /oauth/login/${channel} failed: ${resp.status}`, text);
      return c.json(
        fail(resp.status, `intellect-team /oauth/login/${channel} failed`),
        resp.status as 400 | 404 | 500 | 502,
      );
    }

    // 200 但非 302(异常,理论上不应发生)
    return c.json(fail(502, 'intellect-team login returned unexpected status'), 502);
  }

  // 社区版:302 重定向到 intellect-rag /api/v1/auth/login/{channel}
  const ragBaseUrl = getRagBaseUrl();
  // 社区版直接 302 透传(前端跟随重定向到 intellect-rag 的 OAuth 流程)
  return c.redirect(`${ragBaseUrl}/api/v1/auth/login/${channel}`, 302);
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/oauth/callback — OAuth 回调 + token 签发
// ---------------------------------------------------------------------------

authRoutes.get('/auth/oauth/callback', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Tenant-Id') || '0';

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.json(fail(400, 'Missing code or state query parameter'), 400);
  }

  // CSRF 防护:校验 state 与 cookie 中保存的一致(仅企业版在 /auth/login/:channel 时写入)
  const savedState = getCookie(c, OAUTH_STATE_COOKIE_NAME);
  if (savedState && state !== savedState) {
    return c.json(fail(400, 'Invalid OAuth state (possible CSRF attack)'), 400);
  }
  // 校验后清除 state cookie(一次性使用)
  if (savedState) {
    deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: '/' });
  }

  const tenantStore = c.get('tenantStore');
  const authMode = getAuthMode(tenantStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team callback + token 签发
    const backend = getEnterpriseBackend(tenantStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    const { baseUrl, apiServerKey } = backend;
    const frontendHome = process.env.BFF_OAUTH_FRONTEND_HOME || '/';

    // Step 1: 调 intellect-team GET /api/oauth/callback?code=&state=
    let cbResp: Response;
    try {
      cbResp = await fetch(
        `${baseUrl}/api/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        { method: 'GET' },
      );
    } catch (err) {
      console.error('[auth] intellect-team callback fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (!cbResp.ok) {
      const text = await cbResp.text().catch(() => '');
      console.error(`[auth] intellect-team callback failed: ${cbResp.status}`, text);
      return c.json(
        fail(cbResp.status, 'intellect-team callback failed'),
        cbResp.status as 400 | 401 | 500 | 502,
      );
    }

    const cbData = (await cbResp.json()) as {
      ok: boolean;
      provider_id: string;
      member_id: string;
      claims?: Record<string, unknown>;
    };
    if (!cbData.ok || !cbData.member_id) {
      return c.json(fail(502, 'OAuth callback did not return valid member_id'), 502);
    }

    // Step 2: 调 intellect-team POST /api/members/{member_id}/token 签发 token
    // 用 API_SERVER_KEY 鉴权(Principle VIII:BFF 内部管理操作)
    let tokenResp: Response;
    try {
      tokenResp = await fetch(`${baseUrl}/api/members/${cbData.member_id}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiServerKey}`,
        },
        body: JSON.stringify({
          name: `agentui-session-${Date.now()}`,
          permissions: ['chat', 'read'],
        }),
      });
    } catch (err) {
      console.error('[auth] intellect-team token issue fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (tokenResp.status === 403) {
      console.error('[auth] intellect-team token issue 403 (API_SERVER_KEY invalid?)');
      return c.json(fail(403, 'Token issue forbidden'), 403);
    }
    if (!tokenResp.ok) {
      const text = await tokenResp.text().catch(() => '');
      console.error(`[auth] intellect-team token issue failed: ${tokenResp.status}`, text);
      return c.json(
        fail(tokenResp.status, 'intellect-team token issue failed'),
        tokenResp.status as 400 | 500 | 502 | 503,
      );
    }

    const tokenData = (await tokenResp.json()) as { token_id: string; token: string };
    if (!tokenData.token) {
      return c.json(fail(502, 'Token issue response missing token'), 502);
    }

    // Step 3: Set-Cookie + 302 重定向前端首页
    setCookie(c, AUTH_COOKIE_NAME, tokenData.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });

    return c.redirect(frontendHome, 302);
  }

  // 社区版:透传到 intellect-rag /api/v1/auth/oauth/callback
  const ragBaseUrl = getRagBaseUrl();

  let resp: Response;
  try {
    resp = await fetch(
      `${ragBaseUrl}/api/v1/auth/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { method: 'GET' },
    );
  } catch (err) {
    console.error('[auth] intellect-rag oauth callback fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-rag unreachable'), 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-rag oauth callback failed: ${resp.status}`, text);
    return c.json(fail(502, 'intellect-rag oauth callback failed'), 502);
  }

  // 社区版透传上游响应(含可能的 access_token,前端自行处理)
  const data = await resp.json().catch(() => ({}));
  return c.json(ok(data));
});
