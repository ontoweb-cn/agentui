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
import type { BackendStore, HarnessStore } from '../types/stores';
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
  // intellect-team /api/members/login 返回嵌套 member 对象
  // (不是扁平的 member_id/display_name/role)
  token: string;
  member: {
    id: string;
    display_name: string;
    enabled: number;
    role: string;
  };
  email?: string | null;
}

interface MemberInfoResponse {
  // intellect-team /api/members/me 返回扁平字段,id 即 member id
  id: string;
  display_name: string;
  role: string;
  enabled?: number;
  email?: string | null;
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

// ---------------------------------------------------------------------------
// 路由定义
// ---------------------------------------------------------------------------

interface AuthVariables {
  backendStore: BackendStore;
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
function getAuthMode(backendStore: BackendStore | undefined, tenantId: string): 'intellect-rag' | 'intellect-enterprise' {
  if (!backendStore) return 'intellect-rag';
  const tenant = backendStore.getBackend(tenantId);
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
  backendStore: BackendStore | undefined,
  harnessStore: HarnessStore | undefined,
  tenantId: string,
): { baseUrl: string; apiServerKey: string } | null {
  if (!backendStore || !harnessStore) return null;
  const tenant = backendStore.getBackend(tenantId);
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

/**
 * 向 intellect-team 后端发起请求,自动注入 Authorization header。
 * 消除各路由中重复的 header 构造和 URL 拼接。
 */
async function enterpriseFetch(
  backend: { baseUrl: string; apiServerKey: string },
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${backend.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${backend.apiServerKey}`,
      ...init?.headers,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/bff/auth/config — 认证配置(公开,无需登录)
// ---------------------------------------------------------------------------

authRoutes.get('/auth/config', (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容,未传 header 时返回 intellect-rag 默认模式)
  const tenantId = c.req.header('X-Backend-Id') || '0';
  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);
  return c.json(ok({ authMode }));
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/login — 登录
// ---------------------------------------------------------------------------

authRoutes.post('/auth/login', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Backend-Id') || '0';

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

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

    const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    let resp: Response;
    try {
      resp = await enterpriseFetch(backend, '/api/members/login', {
        method: 'POST',
        body: JSON.stringify({ login_name: resolvedLoginName, password }),
      });
    } catch (err) {
      console.error('[auth] intellect-team login fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (resp.status === 401) {
      return c.json(fail(401, 'Invalid credentials'), 401);
    }
    if (resp.status === 429) {
      // gateway brute-force 锁定:透传上游错误信息,避免前端误判为凭证错误
      const body = await resp.json().catch(() => ({ message: 'Too many failed attempts. Try again later.' })) as { message?: string };
      return c.json(fail(429, body.message ?? 'Too many failed attempts. Try again later.'), 429);
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
    // intellect-team /api/members/login 响应格式:{token, member:{id,...}, email}
    // 扁平化为前端期望的 {member_id, display_name, role, email} 结构。
    return c.json(
      ok({
        member_id: data.member?.id,
        display_name: data.member?.display_name,
        role: data.member?.role,
        email: data.email ?? null,
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

  // Intellect-RAG 响应已是 {code, data, message} 格式,直接透传,不再用 ok() 包装
  // (避免双层嵌套 {code:0, data:{code:0, data:{...}}})
  const data = (await resp.json()) as RagLoginResponse & { code?: number; data?: unknown; message?: string };
  const authorizationHeader = resp.headers.get('Authorization');

  // 若 Intellect-RAG 响应已是 {code:0, data:{...}} 格式,补充 access_token 到 data
  if (authorizationHeader && data.data && typeof data.data === 'object') {
    (data.data as Record<string, unknown>).access_token = authorizationHeader;
  } else if (authorizationHeader) {
    (data as RagLoginResponse).access_token = authorizationHeader;
  }

  const response = c.json(data);
  if (authorizationHeader) {
    response.headers.set('Authorization', authorizationHeader);
  }
  return response;
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/me — 获取当前用户信息
// ---------------------------------------------------------------------------

authRoutes.get('/auth/me', async (c) => {
  // 缺省 X-Backend-Id 默认为 '0'(向后兼容,与其他端点一致)
  const tenantId = c.req.header('X-Backend-Id') || '0';

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

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

    // Intellect-RAG 响应已是 {code, data, message} 格式,直接透传
    const data = await resp.json().catch(() => ({}));
    return c.json(data);
  }

  const session = getAuthSession(c);
  if (!session) {
    return c.json(fail(401, 'Unauthorized: no valid session cookie'), 401);
  }

  // 企业版模式:调 intellect-team GET /api/members/me(用 member token 鉴权)
  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
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
  // intellect-team /api/members/me 返回 {id, display_name, role, email}
  // 映射为前端期望的 {member_id, display_name, role, email}
  return c.json(
    ok({
      member_id: data.id,
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
  const tenantId = c.req.header('X-Backend-Id') || '0';

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

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

    const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    let resp: Response;
    try {
      resp = await enterpriseFetch(backend, '/api/members/register', {
        method: 'POST',
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

  // Intellect-RAG 响应已是 {code, data, message} 格式,直接透传
  const data = await resp.json().catch(() => ({}));
  return c.json(data, 201);
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/logout — 登出
// ---------------------------------------------------------------------------

authRoutes.post('/auth/logout', async (c) => {
  // 缺省 X-Backend-Id 默认为 '0'(向后兼容,与其他端点一致)
  const tenantId = c.req.header('X-Backend-Id') || '0';

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

  // 企业版 token 在 HttpOnly cookie(由 authSessionMiddleware 注入 session);
  // 社区版 token 在前端 localStorage(由 Authorization header 传入)。
  // 不能只依赖 session:社区版无 cookie 时 session 为 undefined,会误判为未登录。
  const session = getAuthSession(c);
  const enterpriseToken = session?.token;
  const communityAuthHeader = c.req.header('Authorization');

  // 社区版模式:用前端 Authorization header 调 intellect-rag /api/v1/auth/logout
  if (authMode === 'intellect-rag') {
    // 无 token 也清前端标记(防御性,允许登出已过期的会话)
    if (!communityAuthHeader) {
      return c.json(ok({ logged_out: true }));
    }

    const ragBaseUrl = getRagBaseUrl();
    let resp: Response;
    try {
      resp = await fetch(`${ragBaseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: communityAuthHeader },
      });
    } catch (err) {
      // 网络错误仍返回成功(本地登出,用户视角已登出)
      console.error('[auth] intellect-rag logout fetch error:', (err as Error).message);
      return c.json(ok({ logged_out: true }));
    }

    if (!resp.ok) {
      // 上游登出失败(token 已过期等),返回成功(用户视角已登出)
      console.warn(`[auth] intellect-rag logout returned ${resp.status}, logged out locally anyway`);
    }
    return c.json(ok({ logged_out: true }));
  }

  // 企业版模式:用 cookie 中的 token 调 intellect-team POST /api/members/logout
  if (!enterpriseToken) {
    // 无 session 也清 cookie(防御性,允许登出已过期的会话)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.json(ok({ logged_out: true }));
  }

  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
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
        Authorization: `Bearer ${enterpriseToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    // 网络错误仍清 cookie(本地登出,与社区版行为一致:用户视角已登出)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    console.error('[auth] intellect-team logout fetch error:', (err as Error).message);
    return c.json(ok({ logged_out: true }));
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
  const tenantId = c.req.header('X-Backend-Id') || '0';
  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team GET /api/oauth/providers,转换格式
    const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    let resp: Response;
    try {
      resp = await enterpriseFetch(backend, '/api/oauth/providers', {
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

  // Intellect-RAG 响应已是 {code, data, message} 格式,直接透传(不用 ok() 包装)
  const data = await resp.json().catch(() => ({ code: 0, data: [], message: 'success' }));
  return c.json(data);
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/login/:channel — OAuth 授权重定向
// ---------------------------------------------------------------------------

authRoutes.get('/auth/login/:channel', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const tenantId = c.req.header('X-Backend-Id') || '0';

  const channel = c.req.param('channel');
  if (!channel) {
    return c.json(fail(400, 'Missing channel parameter'), 400);
  }

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team GET /api/oauth/login/{provider}(P4a-4,直接 302 重定向)
    // 比 POST /api/oauth/authorize 更简单:intellect-team 直接返回 302 + Location,
    // BFF 透传 302 即可,无需先 POST 拿 redirect_uri 再 302。
    const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    let resp: Response;
    try {
      resp = await enterpriseFetch(
        backend,
        `/api/oauth/login/${encodeURIComponent(channel)}?usage=login`,
        { method: 'GET', redirect: 'manual' },
      );
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
  const tenantId = c.req.header('X-Backend-Id') || '0';

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

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

  if (authMode === 'intellect-enterprise') {
    // 企业版:调 intellect-team callback + token 签发
    const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    const { baseUrl, apiServerKey } = backend;
    const frontendHome = process.env.BFF_OAUTH_FRONTEND_HOME || '/';

    // Step 1: 调 intellect-team GET /api/oauth/callback?code=&state=
    let cbResp: Response;
    try {
      cbResp = await enterpriseFetch(
        backend,
        `/api/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
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

  // 社区版 OAuth callback 不走 BFF:
  // /auth/login/:channel 社区版分支直接 302 浏览器到 intellect-rag /api/v1/auth/login/<channel>,
  // OAuth Provider 回调 intellect-rag /api/v1/auth/oauth/<channel>/callback,
  // intellect-rag 处理后 302 到前端 /?auth=<token>,前端 useOAuthCallback hook 读取 query param。
  // BFF /auth/oauth/callback 仅企业版使用(需 BFF 主动调 intellect-team 交换 token + Set-Cookie)。
  // 社区版请求若到达此端点,说明 OAuth Provider redirect_uri 配置错误。
  console.error('[auth] OAuth callback received in community mode — redirect_uri misconfigured');
  return c.json(fail(400, 'OAuth callback is only available for enterprise mode (community OAuth redirects go directly to intellect-rag)'), 400);
});
