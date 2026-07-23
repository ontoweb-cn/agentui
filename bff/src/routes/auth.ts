// @see specs/005-bff-auth-default-tenant/contracts/auth-api.ts (authority source)
/**
 * BFF 统一认证路由 — Multi-Harness P4b。
 *
 * v7:authMode 已固定为企业版(intellect-rag 独立认证模式不再支持)。
 * 所有路由直接走 intellect-team /api/members/* + /api/oauth/*。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端认证经 BFF,不直连 intellect-team
 * - Principle V (Tenant Isolation): 缺省 TenantID=0 不注入 X-Intellect-Team 头
 * - Principle VIII: 企业版认证用 member token(imt_*),BFF 管理操作用 API_SERVER_KEY
 * - Principle VII (YAGNI + Test-First): 路由必有单元测试,不实现 token 刷新
 *
 * Cookie 规则(企业版):
 * - 登录成功:setCookie(imt_token, token, {httpOnly, sameSite:'lax', path:'/', maxAge:86400})
 * - 登出:setCookie(imt_token, '', {maxAge:0}) 清除
 *
 * 错误响应模式(P1-3 统一):
 * 所有响应(含错误)均返回 HTTP 200,错误信息通过 envelope 中的 code(非零)+ message 传递。
 * 与 sessions.ts / chats.ts / llm.ts 等其他路由保持一致。
 * 前端 umi-request / axios 拦截器统一处理 code !== 0 的 envelope 错误。
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { BackendStore, HarnessStore } from '../types/stores';
import type { AuthSession } from '../types/auth';
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../types/auth';
import { getAuthSession, AUTH_SESSION_KEY } from '../middleware/auth-session';
import { memberIdCache } from '../services/member-id-cache';
import { membershipCache } from '../services/membership-cache';

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
  email?: string | null;
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
 * 获取企业版后端 baseUrl + apiServerKey。
 * 从 HarnessStore 按 tenant.intellectBackendId 读取对应 intellect-team 实例的 endpoint。
 * 多租户隔离:不同 BffBackend 绑定不同 intellectBackendId,即不同 intellect-team 实例。
 * Constitution Principle V (Tenant Isolation via multi-instance)。
 *
 * @returns null 表示 tenant 不存在或 backend 未配置(调用方应返回 502)
 */
function getEnterpriseBackend(
  backendStore: BackendStore | undefined,
  harnessStore: HarnessStore | undefined,
  backendId: string,
): { baseUrl: string; apiServerKey: string } | null {
  if (!backendStore || !harnessStore) return null;
  const tenant = backendStore.getBackend(backendId);
  if (!tenant) return null;
  const backend = harnessStore.get(tenant.intellectBackendId);
  if (!backend) return null;
  return {
    baseUrl: backend.endpoint,
    apiServerKey: backend.adminToken,
  };
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
// GET /api/bff/auth/config — 认证与运行时配置(公开,无需登录)
// ---------------------------------------------------------------------------

authRoutes.get('/auth/config', (c) => {
  // v7:authMode 固定为企业版,不再按 tenant 动态返回。
  // 保留此端点用于向后兼容(前端 useAuthMode hook 已简化为同步常量,不再调用此端点;
  // 但外部消费者或旧前端版本可能仍在调用)。
  return c.json(ok({ authMode: 'intellect-enterprise' }));
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/login — 登录
// ---------------------------------------------------------------------------

authRoutes.post('/auth/login', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const backendId = c.req.header('X-Backend-Id') || '0';

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'));
  }

  const backendStore = c.get('backendStore');

  // v7:企业版调 intellect-team POST /api/members/login。
  // 原 email fallback 已移除(身份混淆风险:email 与 login_name 在 intellect-team
  // 中含义不同,login_name 是登录用户名,email 是联系人邮箱)。
  const { login_name, password } = body as {
    login_name?: string;
    password?: string;
  };
  if (!login_name || !password) {
    return c.json(fail(400, 'login_name and password are required'));
  }

  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'));
  }

  let resp: Response;
  try {
    resp = await enterpriseFetch(backend, '/api/members/login', {
      method: 'POST',
      body: JSON.stringify({ login_name, password }),
    });
  } catch (err) {
    console.error('[auth] intellect-team login fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'));
  }

  if (resp.status === 401) {
    return c.json(fail(401, 'Invalid credentials'));
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-team login failed: ${resp.status}`, text);
    return c.json(
      fail(resp.status, 'intellect-team login failed'),
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
  // intellect-team /api/members/login 响应已包含 email 字段(P1 改进),
  // 透传给前端,减少后续 /auth/me probe 请求。
  return c.json(
    ok({
      member_id: data.member_id,
      display_name: data.display_name,
      role: data.role,
      email: data.email ?? null,
    }),
  );
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/me — 获取当前用户信息
// ---------------------------------------------------------------------------

authRoutes.get('/auth/me', async (c) => {
  // 需认证端点:严格校验 X-Backend-Id(登录后前端必然知道 backendId)
  const backendId = c.req.header('X-Backend-Id');
  if (!backendId) {
    return c.json(fail(400, 'Missing X-Backend-Id header'));
  }

  const backendStore = c.get('backendStore');

  const session = getAuthSession(c);
  if (!session) {
    return c.json(fail(401, 'Unauthorized: no valid session cookie'));
  }

  // 企业版模式:调 intellect-team GET /api/members/me(用 member token 鉴权)
  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'));
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
    return c.json(fail(502, 'intellect-team unreachable'));
  }

  if (resp.status === 401) {
    return c.json(fail(401, 'Unauthorized'));
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-team /me failed: ${resp.status}`, text);
    return c.json(fail(502, 'intellect-team /me failed'));
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
  const backendId = c.req.header('X-Backend-Id') || '0';

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'));
  }

  const backendStore = c.get('backendStore');

  // v7:企业版调 intellect-team POST /api/members/register。
  // 原 email/nickname fallback 已移除(身份混淆风险)。
  const { login_name, password, display_name, email } = body as {
    login_name?: string;
    password?: string;
    display_name?: string;
    email?: string;
  };
  if (!login_name || !password || !display_name) {
    return c.json(
      fail(400, 'login_name, password and display_name are required'),
    );
  }

  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'));
  }

  let resp: Response;
  try {
    resp = await enterpriseFetch(backend, '/api/members/register', {
      method: 'POST',
      body: JSON.stringify({
        login_name,
        password,
        display_name,
        // email 是可选的联系人邮箱(非登录名),透传给上游
        ...(email ? { email } : {}),
      }),
    });
  } catch (err) {
    console.error('[auth] intellect-team register fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'));
  }

  if (resp.status === 409) {
    return c.json(fail(409, 'Registration conflict: login_name already exists'));
  }
  if (resp.status === 403) {
    return c.json(fail(403, 'Registration disabled'));
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
});

// ---------------------------------------------------------------------------
// POST /api/bff/auth/logout — 登出
// ---------------------------------------------------------------------------

authRoutes.post('/auth/logout', async (c) => {
  // 需认证端点:严格校验 X-Backend-Id(登录后前端必然知道 backendId)
  const backendId = c.req.header('X-Backend-Id');
  if (!backendId) {
    return c.json(fail(400, 'Missing X-Backend-Id header'));
  }

  const backendStore = c.get('backendStore');
  const session = getAuthSession(c);
  const enterpriseToken = session?.token;

  // 企业版模式:用 cookie 中的 token 调 intellect-team POST /api/members/logout
  if (!enterpriseToken) {
    // 无 session 也清 cookie(防御性,允许登出已过期的会话)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.json(ok({ logged_out: true }));
  }

  // v6-followup:登出时主动失效 member_id 缓存,防止 token 复用
  // v9 BFF-P2-4:复合 key 含 backendId,需传 session.backendId 才能精确失效
  memberIdCache.invalidate(session.backendId, enterpriseToken);
  // v6-followup-3:登出时主动失效成员关系缓存,防止 token 复用
  // v9 BFF-P2-4-align:复合 key 含 backendId,需传 session.backendId 才能精确失效
  membershipCache.invalidate(session.backendId, enterpriseToken);

  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
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
    // 网络错误仍清 cookie(本地登出,用户视角已登出)
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
  const backendId = c.req.header('X-Backend-Id') || '0';
  const backendStore = c.get('backendStore');

  // 企业版:调 intellect-team GET /api/oauth/providers,转换格式
  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'));
  }

  let resp: Response;
  try {
    resp = await enterpriseFetch(backend, '/api/oauth/providers', {
      method: 'GET',
    });
  } catch (err) {
    console.error('[auth] intellect-team /oauth/providers fetch error:', (err as Error).message);
    return c.json(fail(502, 'intellect-team unreachable'));
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[auth] intellect-team /oauth/providers failed: ${resp.status}`, text);
    return c.json(fail(502, 'intellect-team /oauth/providers failed'));
  }

  const rawProviders = (await resp.json()) as OAuthProviderRaw[];
  // 转换格式 + 过滤 enabled=true + usage 含 login
  const channels: OAuthProviderConverted[] = rawProviders
    .filter((p) => p.enabled && p.usage.includes('login'))
    .sort((a, b) => {
      // 按 display_order 升序排序(数字小的在前,未定义的排最后)
      const aOrder = a.display_order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.display_order ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    })
    .map((p) => ({
      channel: p.id,
      display_name: p.name,
      icon: p.logo_svg || 'sso',
    }));

  return c.json(ok(channels));
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/login/:channel — OAuth 授权重定向
// ---------------------------------------------------------------------------

authRoutes.get('/auth/login/:channel', async (c) => {
  // 公开端点:缺省 TenantID="0"(向后兼容)
  const backendId = c.req.header('X-Backend-Id') || '0';

  const channel = c.req.param('channel');
  if (!channel) {
    return c.json(fail(400, 'Missing channel parameter'));
  }

  const backendStore = c.get('backendStore');

  // 企业版:调 intellect-team GET /api/oauth/login/{provider}(P4a-4,直接 302 重定向)
  // 比 POST /api/oauth/authorize 更简单:intellect-team 直接返回 302 + Location,
  // BFF 透传 302 即可,无需先 POST 拿 redirect_uri 再 302。
  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'));
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
    return c.json(fail(502, 'intellect-team unreachable'));
  }

  // intellect-team 返回 302 + Location(BFF 透传)
  if (resp.status === 302 || resp.status === 301) {
    const location = resp.headers.get('location');
    if (!location) {
      return c.json(fail(502, 'intellect-team login response missing Location header'));
    }

    // CSRF 防护:从 Location 中提取 state,存入短期 cookie,callback 时校验
    // P1-9:绑定 backendId 到 state cookie,格式 `${backendId}:${state}`,
    // 防止跨租户 OAuth 攻击( attacker 用 tenant A 的 state 在 tenant B 的 callback 中使用)
    const stateMatch = location.match(/[?&]state=([^&]+)/);
    const oauthState = stateMatch?.[1];
    if (oauthState) {
      setCookie(c, OAUTH_STATE_COOKIE_NAME, `${backendId}:${oauthState}`, {
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
  return c.json(fail(502, 'intellect-team login returned unexpected status'));
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/oauth/callback — OAuth 回调 + token 签发
// ---------------------------------------------------------------------------

authRoutes.get('/auth/oauth/callback', async (c) => {
  // P1-9:OAuth callback 是浏览器重定向(无 X-Backend-Id header),
  // backendId 从 state cookie 中提取(由 /auth/login/:channel 写入,格式 `${backendId}:${state}`)
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.json(fail(400, 'Missing code or state query parameter'));
  }

  // P1-8:state cookie 必须存在(由 /auth/login/:channel 写入),
  // 缺失说明 cookie 过期/被清除或直接访问 callback URL(CSRF 攻击向量)
  const savedStateRaw = getCookie(c, OAUTH_STATE_COOKIE_NAME);
  if (!savedStateRaw) {
    return c.json(fail(400, 'Missing OAuth state cookie (possible CSRF attack or session expired)'));
  }

  // P1-9:解析 `backendId:state` 格式,提取 backendId 和 savedState
  const separatorIdx = savedStateRaw.indexOf(':');
  if (separatorIdx < 0) {
    return c.json(fail(400, 'Invalid OAuth state cookie format'));
  }
  const backendId = savedStateRaw.substring(0, separatorIdx);
  const savedState = savedStateRaw.substring(separatorIdx + 1);

  // P1-8:state 必须匹配(原 savedState && ... 逻辑在 cookie 缺失时跳过校验,有 CSRF 风险)
  if (state !== savedState) {
    return c.json(fail(400, 'Invalid OAuth state (possible CSRF attack)'));
  }

  // 校验后清除 state cookie(一次性使用)
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: '/' });

  const backendStore = c.get('backendStore');

  // 企业版:调 intellect-team callback + token 签发
  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), backendId);
  if (!backend) {
    return c.json(fail(502, 'Enterprise backend not configured for tenant'));
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
    return c.json(fail(502, 'intellect-team unreachable'));
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
    return c.json(fail(502, 'OAuth callback did not return valid member_id'));
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
    return c.json(fail(502, 'intellect-team unreachable'));
  }

  if (tokenResp.status === 403) {
    console.error('[auth] intellect-team token issue 403 (API_SERVER_KEY invalid?)');
    return c.json(fail(403, 'Token issue forbidden'));
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
    return c.json(fail(502, 'Token issue response missing token'));
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
});
