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
 * - authMode=intellect-community(默认)/intellect-rag:透传到 intellect-rag /api/v1/auth/* + /api/v1/users/*
 * - authMode=intellect-enterprise:调 intellect-team /api/members/* + /api/oauth/*
 *
 * Cookie 规则(企业版):
 * - 登录成功:setCookie(imt_token, token, {httpOnly, sameSite:'lax', path:'/', maxAge:86400})
 * - 登出:setCookie(imt_token, '', {maxAge:0}) 清除
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { BackendStore, HarnessStore } from '../types/stores';
import type { AuthSession } from '../types/auth';
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../types/auth';
import type { AuthMode } from '../types/tenant';
import { getAuthSession, AUTH_SESSION_KEY } from '../middleware/auth-session';
import { getRagBaseUrl } from '../utils/rag-base-url';
import {
  lookupImtSessions,
  recordImtSession,
  removeImtSessions,
} from '../services/imt-session-map';
import { verifyLogoutToken } from '../services/backchannel-logout';
import {
  getSsoRedirectUri,
  isSecureCookie,
  loadSsoConfig,
} from '../services/sso-config';
import {
  createSsoTransaction,
  readAndClearSsoStateCookie,
  readSsoProviderCookie,
  clearSsoProviderCookie,
  sanitizeReturnTo,
  ssoStateMatches,
  writeSsoProviderCookie,
  writeSsoStateCookie,
  SSO_STATE_COOKIE_NAME,
} from '../services/sso-state';
import { getLoginProviders } from '../services/sso-providers';
import {
  exchangeAuthorizationCode,
  exchangeIdTokenForMember,
} from '../services/sso-exchange';
import {
  isIdpPassthroughUsable,
  loadIdpPassthroughConfig,
} from '../services/idp-config';
import { exchangeCodeForIdpTokens } from '../services/idp-client';
import { idpSessionKey, putIdpTokens } from '../services/idp-token-store';

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
 * 获取 tenant 的 authMode,默认 intellect-community(向后兼容)。
 */
export function getAuthMode(backendStore: BackendStore | undefined, tenantId: string): AuthMode {
  if (!backendStore) return 'intellect-community';
  const tenant = backendStore.getBackend(tenantId);
  return tenant?.authMode ?? 'intellect-community';
}

/**
 * 获取企业版后端 baseUrl + apiServerKey。
 * 从 HarnessStore 按 tenant.intellectBackendId 读取对应 intellect-team 实例的 endpoint。
 * 多租户隔离:不同 BffTenant 绑定不同 intellectBackendId,即不同 intellect-team 实例。
 * Constitution Principle V (Tenant Isolation via multi-instance)。
 *
 * @returns null 表示 tenant 不存在或 backend 未配置(调用方应返回 502)
 */
export function getEnterpriseBackend(
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

/** BFF 公开 OAuth 回调路径(F-CB-01;与 IdP redirectUris 白名单登记值一一对应) */
export const BFF_OAUTH_CALLBACK_PATH = '/api/bff/auth/oauth/callback';

/** 配置告警只发一次(env 读取发生在每请求,避免刷屏;测试可经 resetOAuthConfigWarning 重置) */
let oauthConfigWarned = false;

/** 重置配置告警状态(单测用) */
export function resetOAuthConfigWarning(): void {
  oauthConfigWarned = false;
}

/**
 * 解析本 BFF 的公开 origin（SSO 登出回跳/错误回跳共用；多级代理取第一跳）。
 *
 * 信任边界:X-Forwarded-Host 不在 nginx proxy.conf 的注入清单内,客户端可注入
 * 任意值 —— 伪造回调会被 IdP 应用 redirectUris 白名单拒绝(fail-closed),不会产生
 * 授权码。
 */
export function resolvePublicOrigin(c: {
  req: { header(name: string): string | undefined; url: string };
}): string {
  // 多级代理链:X-Forwarded-* 形如 "a,b" — 取第一跳,避免拼出 "https,http://..." 非法 URL
  const firstForwarded = (v: string | undefined) => v?.split(',')[0]?.trim() || undefined;
  const proto =
    firstForwarded(c.req.header('X-Forwarded-Proto')) ||
    new URL(c.req.url).protocol.replace(/:$/, '');
  const host =
    firstForwarded(c.req.header('X-Forwarded-Host')) ||
    c.req.header('Host') ||
    new URL(c.req.url).host;
  return `${proto}://${host}`;
}

/**
 * 解析本 BFF 的公开 OAuth 回调 URL(F-CB-01 修复)。
 *
 * intellect-team 的 GET /api/oauth/login/{provider} 仅在显式携带 `?redirect_uri=`
 * 时使用传入值,否则按请求 Host 推导为 intellect-team 自身回调 —— 导致 IdP 回调
 * 落不到 BFF,/auth/oauth/callback 处理器永不触发。因此 BFF 发起时必须显式传。
 *
 * 取值顺序:
 * 1. env `BFF_OAUTH_REDIRECT_URI`(完整回调 URL;生产推荐,防 Host 伪造);
 * 2. 转发头(X-Forwarded-Proto/X-Forwarded-Host)或请求自身 proto/Host 推导。
 */
export function resolveOAuthRedirectUri(c: {
  req: { header(name: string): string | undefined; url: string };
}): string {
  const configured = process.env.BFF_OAUTH_REDIRECT_URI?.trim();
  if (configured) {
    // 配置形态自检(评审 F-Q4):env 应是本 BFF 的完整回调 URL;形态不符大概率是
    // 配置错误(如填成了站点根或别的服务回调),告警提示 —— 最终仍由 IdP 白名单
    // fail-closed,这里只做可观测性提示,不改变行为。
    if (!configured.endsWith(BFF_OAUTH_CALLBACK_PATH) && !oauthConfigWarned) {
      oauthConfigWarned = true;
      console.warn(
        `[auth] BFF_OAUTH_REDIRECT_URI 未以 ${BFF_OAUTH_CALLBACK_PATH} 结尾,请确认是否为本 BFF 公开回调: ${configured}`,
      );
    }
    return configured;
  }
  return `${resolvePublicOrigin(c)}${BFF_OAUTH_CALLBACK_PATH}`;
}

/** 登出链 IdP（A2）/back-channel 接收端（A1）的 env 读取。 */
const getIdpLogoutUrl = () => process.env.BFF_OAUTH_IDP_LOGOUT_URL?.trim() || '';
const getIdpIssuer = () => process.env.BFF_OAUTH_IDP_ISSUER?.trim() || '';
const getExpectedAud = () => process.env.BFF_OAUTH_EXPECTED_AUD?.trim() || 'ia-intellect-team';

/**
 * 登录流程失败回登录页+错误参数（B1）：浏览器导航 302，前端 login-next 读取
 * ssoError 展示提示——替换原 502 裸 JSON（UX-01）。
 */
function ssoErrorRedirect(
  // 评审修复(L-RP1-03):结构桩类型缺 redirect——改用既有 Hono Context 泛型
  // (与 L269/L290/L325 的既有口径一致)。
  c: Context<{ Variables: AuthVariables }>,
  code: string,
) {
  return c.redirect(`${resolvePublicOrigin(c)}/login-next?ssoError=${encodeURIComponent(code)}`, 302);
}

/**
 * 向 intellect-team 后端发起请求,自动注入 Authorization header。
 * 消除各路由中重复的 header 构造和 URL 拼接。
 */
export async function enterpriseFetch(
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

/**
 * 解析 SSO 租户对应的企业版网关；tenant 不存在或非企业版返回 null。
 * 浏览器导航无法携带 X-Backend-Id，故 SSO 路由通过 query.tenant 显式传入。
 */
function resolveSsoTenantBackend(
  c: Context<{ Variables: AuthVariables }>,
  tenantId: string,
): { baseUrl: string; apiServerKey: string } | null {
  const backendStore = c.get('backendStore');
  const tenant = backendStore?.getBackend(tenantId);
  if (!tenant || tenant.authMode !== 'intellect-enterprise') return null;
  return getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
}

/** 前端基路径（支持子目录部署）；非法值回落根路径。 */
function getFrontendBase(): string {
  const raw = (process.env.BFF_FRONTEND_BASE ?? '').trim().replace(/\/+$/, '');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw;
}

function loginPagePath(): string {
  return `${getFrontendBase()}/login`;
}

/** 浏览器可见的 SSO 失败统一回登录页，带可读错误码。 */
function redirectToLoginError(c: Context<{ Variables: AuthVariables }>, code: string): Response {
  c.header('Cache-Control', 'no-store');
  return c.redirect(`${loginPagePath()}?error=${encodeURIComponent(code)}`, 302);
}

/** 网关 exchange 错误 → 前端错误码。 */
function mapExchangeError(status: number, code: string): string {
  switch (code) {
    case 'too_many_requests':
      return 'sso_rate_limited';
    case 'account_disabled':
      return 'account_disabled';
    case 'member_not_provisioned':
      return 'member_not_provisioned';
    case 'identity_conflict':
    case 'tenant_mismatch':
      return 'sso_forbidden';
    case 'unknown_provider':
    case 'provider_disabled':
    case 'invalid_provider':
      return 'unknown_provider';
    case 'timeout':
    case 'network_error':
    case 'invalid_response':
      return 'sso_unavailable';
    default:
      return status >= 500 || status === 429 ? 'sso_unavailable' : 'sso_code_invalid';
  }
}

/**
 * 构造并跳转 OIDC 授权请求（BFF 作为 RP）。
 * 开关关闭时返回 404；tenant/provider 异常统一 302 回登录页。
 */
async function handleSsoAuthorize(
  c: Context<{ Variables: AuthVariables }>,
  providerId: string,
  tenantId: string,
  returnTo: string | undefined,
  silent: boolean,
): Promise<Response> {
  const config = loadSsoConfig();
  if (!config.enabled) {
    // 关闭态被直接访问时回登录页，避免浏览器看到 JSON 404。
    c.header('Cache-Control', 'no-store');
    return c.redirect(loginPagePath(), 302);
  }

  const backend = resolveSsoTenantBackend(c, tenantId);
  if (!backend) {
    return redirectToLoginError(c, 'tenant_not_found');
  }

  let selection: Awaited<ReturnType<typeof getLoginProviders>>;
  try {
    selection = await getLoginProviders(backend.baseUrl, tenantId, config);
  } catch (err) {
    console.error('[auth] sso provider list failed:', (err as Error).message);
    return redirectToLoginError(c, 'sso_unavailable');
  }

  const provider = selection.providers.find((item) => item.id === providerId);
  if (!provider) {
    return redirectToLoginError(
      c,
      selection.misconfigured.includes(providerId) ? 'sso_misconfigured' : 'unknown_provider',
    );
  }

  const transaction = createSsoTransaction();
  const nowSeconds = Math.floor(Date.now() / 1000);

  await writeSsoStateCookie(
    c,
    {
      state: transaction.state,
      code_verifier: transaction.codeVerifier,
      nonce: transaction.nonce,
      provider_id: provider.id,
      tenant_id: tenantId,
      return_to: sanitizeReturnTo(returnTo),
      issued_at: nowSeconds,
      silent,
    },
    config.stateSecret,
    isSecureCookie(config),
  );

  let authorizeUrl: URL;
  try {
    authorizeUrl = new URL(provider.authorizeUrl);
  } catch {
    console.error(`[auth] provider ${provider.id} has invalid authorize_url`);
    return redirectToLoginError(c, 'sso_misconfigured');
  }

  authorizeUrl.searchParams.set('response_type', 'code');
  // D2 option A: BFF 作为 IdP RP 时使用自有 client（ia-agentui），
  // 回调后自行兑换 token，再把 id_token 交给网关换 member token。
  const idpConfig = loadIdpPassthroughConfig();
  const useIdpPassthrough = isIdpPassthroughUsable(idpConfig);
  authorizeUrl.searchParams.set(
    'client_id',
    useIdpPassthrough ? idpConfig.clientId : provider.clientId,
  );
  authorizeUrl.searchParams.set('redirect_uri', getSsoRedirectUri(config));
  authorizeUrl.searchParams.set(
    'scope',
    useIdpPassthrough ? 'openid profile' : provider.scopes,
  );
  authorizeUrl.searchParams.set('state', transaction.state);
  authorizeUrl.searchParams.set('nonce', transaction.nonce);
  authorizeUrl.searchParams.set('code_challenge', transaction.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('response_mode', 'query');
  if (silent) authorizeUrl.searchParams.set('prompt', 'none');

  c.header('Cache-Control', 'no-store');
  return c.redirect(authorizeUrl.toString(), 302);
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

  if (authMode !== 'intellect-enterprise') {
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
    const { login_name, email, password, display_name, nickname, invite_code } = body as {
      login_name?: string;
      email?: string;
      password?: string;
      display_name?: string;
      nickname?: string;
      /** 邀请码(网关侧已实现该契约,生产部署要求时必填;是否必填由网关裁决) */
      invite_code?: string;
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
          // 邀请码透传:是否必填由网关部署裁决(生产环境要求时前端表单提供),
          // BFF 不做硬校验,缺省不下发该字段
          ...(typeof invite_code === 'string' && invite_code.trim() !== ''
            ? { invite_code: invite_code.trim() }
            : {}),
        }),
      });
    } catch (err) {
      console.error('[auth] intellect-team register fetch error:', (err as Error).message);
      return c.json(fail(502, 'intellect-team unreachable'), 502);
    }

    if (resp.status === 409) {
      return c.json(fail(409, 'Registration conflict: login_name already exists'), 409);
    }
    if (resp.status === 400) {
      // 400 细分:网关(≥2026-10 邀请码版)返回结构化 code(D6 契约),按 code
      // 转译为可自助修复的文案;/invite/i 正则兜底兼容旧网关文案形态。
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-team register failed: 400`, text);
      let code: string | null = null;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string } };
        code = parsed?.error?.code ?? null;
      } catch {
        /* 非 JSON,走正则兜底 */
      }
      const inviteMessages: Record<string, string> = {
        invite_required: '注册需要邀请码,请向管理员获取后重试',
        invite_invalid: '邀请码无效(可能已撤销或填写有误)',
        invite_revoked: '邀请码已被管理员撤销,请向管理员重新获取',
        invite_used: '邀请码已被使用',
        invite_expired: '邀请码已过期,请向管理员重新获取',
        invite_email_mismatch: '注册邮箱与邀请码指定的邮箱不一致',
        display_name_taken: '显示名已被占用,请更换后重试',
      };
      if (code && inviteMessages[code]) {
        return c.json(fail(400, inviteMessages[code]), 400);
      }
      if (!code && /invite/i.test(text)) {
        // 旧网关兜底:文案提及 invite 时给出笼统邀请码指引。
        return c.json(
          fail(400, '邀请码缺失或无效(Registration requires a valid invite code)'),
          400,
        );
      }
      return c.json(fail(400, 'intellect-team register failed'), 400);
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

  // spec-014 P2:清除最近登录渠道，抑制登出后的静默重登（无 SLO 时的登出语义保障）。
  clearSsoProviderCookie(c);

  const backendStore = c.get('backendStore');
  const authMode = getAuthMode(backendStore, tenantId);

  // 企业版 token 在 HttpOnly cookie(由 authSessionMiddleware 注入 session);
  // 社区版 token 在前端 localStorage(由 Authorization header 传入)。
  // 不能只依赖 session:社区版无 cookie 时 session 为 undefined,会误判为未登录。
  const session = getAuthSession(c);
  const enterpriseToken = session?.token;
  const communityAuthHeader = c.req.header('Authorization');

  // 社区版模式:用前端 Authorization header 调 intellect-rag /api/v1/auth/logout
  if (authMode !== 'intellect-enterprise') {
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
    return respondLogout(c);
  }

  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
  if (!backend) {
    // backend 未配置也清 cookie(本地登出)
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return respondLogout(c);
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
  return respondLogout(c);
});

/**
 * 登出最终响应(A2)：配置 BFF_OAUTH_IDP_LOGOUT_URL 时在响应中附 `idp_logout_url`
 * （前端拿到后**顶层跳转** `window.location.href` —— 不能用 BFF 302：登出是 XHR，
 * fetch 会跟随 302 且不带 IdP cookie，IdP 会话清不掉。IdP 以 redirectUris 前缀
 * 白名单校验回跳，application_util.go:524）；未配置时维持旧行为（仅本地登出）。
 */
function respondLogout(c: Context<{ Variables: AuthVariables }>) {
  const idpLogoutUrl = getIdpLogoutUrl();
  if (!idpLogoutUrl) {
    return c.json(ok({ logged_out: true }));
  }
  // 回跳 origin 优先取 BFF_OAUTH_REDIRECT_URI 的 origin（env 显式；dev 代理链下
  // 请求 Host 是 BFF 端口 9390，与浏览器可达的 9391 不一致——评审发现）。
  const configuredCallback = process.env.BFF_OAUTH_REDIRECT_URI?.trim();
  const origin = configuredCallback
    ? new URL(configuredCallback).origin
    : resolvePublicOrigin(c);
  const redirectTarget = `${origin}/login-next`;
  const sep = idpLogoutUrl.includes('?') ? '&' : '?';
  const idpLogoutRedirect = `${idpLogoutUrl}${sep}post_logout_redirect_uri=${encodeURIComponent(redirectTarget)}&client_id=${encodeURIComponent(getExpectedAud())}`;
  return c.json(ok({ logged_out: true, idp_logout_url: idpLogoutRedirect }));
}

// ---------------------------------------------------------------------------
// POST /api/bff/auth/backchannel-logout — OIDC Back-Channel Logout 接收端(A1)
// ---------------------------------------------------------------------------

const backchannelLogoutHandler = async (
  // 评审修复(L-RP1-03):结构桩缺 req.get/json 与类型化 Variables——改用
  // Hono Context 泛型;双挂载路径(Context 默认 P=string)对具体路径参数可赋值。
  c: Context<{ Variables: AuthVariables }>,
) => {
  const idpIssuer = getIdpIssuer();
  if (!idpIssuer) {
    // 未启用：503（IdP outbox 按退避重试；运维未配置时明确可见）
    return c.json(fail(503, 'back-channel logout not configured (BFF_OAUTH_IDP_ISSUER missing)'), 503);
  }

  const bodyText = await c.req.text().catch(() => '');
  const logoutToken = new URLSearchParams(bodyText).get('logout_token') || '';
  if (!logoutToken) {
    return c.json(fail(400, 'missing logout_token'), 400);
  }

  let sub: string;
  try {
    const claims = await verifyLogoutToken(logoutToken, {
      issuer: idpIssuer,
      audience: getExpectedAud(),
    });
    sub = typeof claims.sub === 'string' ? claims.sub : '';
  } catch (err) {
    console.error('[auth] back-channel logout token rejected:', (err as Error).message);
    return c.json(fail(400, 'invalid logout_token'), 400);
  }
  if (!sub) {
    return c.json(fail(400, 'logout_token missing sub'), 400);
  }

  // 撤销该用户全部 imt_token（经 intellect-team 幂等吊销）。
  // 评审 F-R1：先撤销、成功后才移除映射——撤销失败返回 503 让 IdP 重试，
  // 映射保留（原实现先清映射、失败即丢通知 → 会话残留至 TTL）。
  const tokens = lookupImtSessions(sub);
  console.error(`[auth] back-channel logout: sub=${sub} tokens=${tokens.length}`);
  const backendStore = c.get('backendStore');
  const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), '0');
  if (!backend) {
    console.error('[auth] back-channel logout: enterprise backend not configured → 503 retryable');
    return c.json(fail(503, 'enterprise backend not configured'), 503);
  }

  const failed: string[] = [];
  for (const token of tokens) {
    try {
      const resp = await fetch(`${backend.baseUrl}/api/members/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      // 401 = 令牌已失效（幂等成功）；其它失败进入 IdP 重试
      if (!resp.ok && resp.status !== 401) {
        failed.push(token);
        console.error(`[auth] back-channel revoke failed: ${resp.status}`);
      }
    } catch (err) {
      failed.push(token);
      console.error('[auth] back-channel revoke fetch error:', (err as Error).message);
    }
  }
  if (failed.length > 0) {
    removeImtSessions(sub, tokens.filter((t) => !failed.includes(t)));
    return c.json(fail(503, `revocation failed for ${failed.length} token(s)`), 503);
  }
  removeImtSessions(sub, tokens);
  return c.json(ok({ revoked: tokens.length }));
};

// 双挂载：浏览器/代理后为 /auth/...；IdP 服务端直连 BFF 端口（不经 vite/nginx 剥
// /api/bff 前缀）为完整登记路径（两种形态均在 authMiddleware publicPaths 白名单）。
authRoutes.post('/auth/backchannel-logout', backchannelLogoutHandler);
authRoutes.post('/api/bff/auth/backchannel-logout', backchannelLogoutHandler);

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
    // spec-014 P2:开关开启时走公开 provider 端点（不携带 API_SERVER_KEY）。
    const ssoConfig = loadSsoConfig();
    if (ssoConfig.enabled) {
      const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
      if (!backend) {
        return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
      }
      try {
        const { providers } = await getLoginProviders(backend.baseUrl, tenantId, ssoConfig);
        return c.json(
          ok(
            providers.map((provider) => ({
              channel: provider.id,
              display_name: provider.displayName,
              icon: provider.icon,
            })),
          ),
        );
      } catch (err) {
        console.error('[auth] sso provider list fetch error:', (err as Error).message);
        return c.json(fail(502, 'SSO provider list unavailable'), 502);
      }
    }

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
      // 审计缺陷 D 修复:上游鉴权失败原样透传(401),与"网关不可达"(502)区分
      if (resp.status === 401 || resp.status === 403) {
        return c.json(
          fail(401, 'intellect-team rejected BFF credentials (check gateway token)'),
          401,
        );
      }
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
// GET /api/bff/auth/sso/authorize/:provider — BFF 作为 OIDC RP 发起授权
// ---------------------------------------------------------------------------

authRoutes.get('/auth/sso/authorize/:provider', async (c) => {
  // 浏览器导航无法携带 X-Backend-Id，租户经 query 传入（缺省 '0' 向后兼容）
  const tenantId = c.req.query('tenant') || c.req.header('X-Backend-Id') || '0';
  const silent = c.req.query('prompt') === 'none';
  return handleSsoAuthorize(
    c,
    c.req.param('provider') ?? '',
    tenantId,
    c.req.query('returnTo'),
    silent,
  );
});

// ---------------------------------------------------------------------------
// GET /api/bff/auth/sso/relogin — 静默重登（prompt=none）
// ---------------------------------------------------------------------------

authRoutes.get('/auth/sso/relogin', async (c) => {
  const config = loadSsoConfig();
  const tenantId = c.req.query('tenant') || c.req.header('X-Backend-Id') || '0';

  if (!config.enabled || !config.silentRelogin) {
    c.header('Cache-Control', 'no-store');
    return c.redirect(loginPagePath(), 302);
  }

  // 登出会清除 sso_provider；缺失/租户不匹配即视为「用户已主动登出」，不自动重登。
  const storedProvider = await readSsoProviderCookie(c, config.stateSecret);
  if (!storedProvider || storedProvider.tenant_id !== tenantId) {
    c.header('Cache-Control', 'no-store');
    return c.redirect(loginPagePath(), 302);
  }

  return handleSsoAuthorize(c, storedProvider.provider_id, tenantId, c.req.query('returnTo'), true);
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
  const ssoConfig = loadSsoConfig();
  // 开关开启时以导航参数 tenant 判定租户（浏览器无法携带 X-Backend-Id）；否则沿用 header。
  const ssoTenantId = c.req.query('tenant') || tenantId;
  const authMode = getAuthMode(backendStore, ssoConfig.enabled ? ssoTenantId : tenantId);

  if (authMode === 'intellect-enterprise') {
    // spec-014 P2:开关开启时由 BFF 作为 OIDC RP 发起授权；未知渠道 fail-closed。
    if (ssoConfig.enabled) {
      return handleSsoAuthorize(c, channel, ssoTenantId, c.req.query('returnTo'), false);
    }

    // 企业版:调 intellect-team GET /api/oauth/login/{provider}(P4a-4,直接 302 重定向)
    // 比 POST /api/oauth/authorize 更简单:intellect-team 直接返回 302 + Location,
    // BFF 透传 302 即可,无需先 POST 拿 redirect_uri 再 302。
    const backend = getEnterpriseBackend(backendStore, c.get('harnessStore'), tenantId);
    if (!backend) {
      return c.json(fail(502, 'Enterprise backend not configured for tenant'), 502);
    }
    let resp: Response;
    try {
      // D8:invite_code 透传(前端带 ?invite_code= 跳 OAuth 时随流携带,
      // 网关写入 state,callback 兑换注册;缺省不追加,保持 URL 干净)。
      const inviteCode = (c.req.query('invite_code') || '').trim();
      const inviteQuery = inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : '';
      // F-CB-01:显式声明 BFF 公开回调,使 IdP 回调落到本服务
      // (不传时 intellect-team 默认推导自身回调,SSO 无法闭环)。
      const redirectUri = resolveOAuthRedirectUri(c);
      resp = await enterpriseFetch(
        backend,
        `/api/oauth/login/${encodeURIComponent(channel)}?usage=login${inviteQuery}&redirect_uri=${encodeURIComponent(redirectUri)}`,
        { method: 'GET', redirect: 'manual' },
      );
    } catch (err) {
      console.error('[auth] intellect-team /oauth/login fetch error:', (err as Error).message);
      // agentui-sso-logout-loop(B1):浏览器导航失败回登录页+提示（原 502 裸 JSON）
      return ssoErrorRedirect(c, 'idp_unavailable');
    }

    // intellect-team 返回 302 + Location(BFF 透传)
    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get('location');
      if (!location) {
        return ssoErrorRedirect(c, 'idp_invalid_response');
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

    // 非 302 响应(intellect-team 返回错误 JSON,如 provider 禁用)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[auth] intellect-team /oauth/login/${channel} failed: ${resp.status}`, text);
      return ssoErrorRedirect(c, 'idp_error');
    }

    // 200 但非 302(异常,理论上不应发生)
    return ssoErrorRedirect(c, 'idp_invalid_response');
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

  // spec-014 P2:新链路以签名 state Cookie 判定（与全局开关无关，保证切换/滚动发布时在途授权可收尾）。
  const ssoConfig = loadSsoConfig();
  const rawSsoStateCookie = getCookie(c, SSO_STATE_COOKIE_NAME);
  const hasSsoStateCookie = Boolean(rawSsoStateCookie);
  if (ssoConfig.enabled || hasSsoStateCookie) {
    // 回滚场景：开关关闭且密钥已清空时，不再验签（空密钥会抛错），直接判定失效。
    if (hasSsoStateCookie && ssoConfig.stateSecret.length < 32) {
      deleteCookie(c, SSO_STATE_COOKIE_NAME, { path: '/' });
      return redirectToLoginError(c, 'sso_state_invalid');
    }

    const read = await readAndClearSsoStateCookie(c, ssoConfig.stateSecret);

    // 验签失败时 getSignedCookie 会退化为「无 Cookie」，需用原始 Cookie 存在性兜底判定。
    if (read.status === 'invalid' || (read.status === 'absent' && hasSsoStateCookie)) {
      deleteCookie(c, SSO_STATE_COOKIE_NAME, { path: '/' });
      return redirectToLoginError(c, 'sso_state_invalid');
    }

    if (read.status === 'ok') {
      const payload = read.payload;

      if (!state || !ssoStateMatches(payload.state, state)) {
        return redirectToLoginError(c, 'sso_state_invalid');
      }

      const idpError = c.req.query('error');
      if (idpError) {
        const isLoginRequired = idpError === 'login_required' || idpError === 'interaction_required';
        if (isLoginRequired && payload.silent) {
          // 最多一次交互式重试：新 state 的 silent=false，再次失败即回登录页。
          return handleSsoAuthorize(c, payload.provider_id, payload.tenant_id, payload.return_to, false);
        }
        return redirectToLoginError(c, isLoginRequired ? 'sso_session_expired' : 'sso_code_invalid');
      }

      if (!code) {
        return redirectToLoginError(c, 'sso_code_invalid');
      }

      const backend = resolveSsoTenantBackend(c, payload.tenant_id);
      if (!backend) {
        return redirectToLoginError(c, 'tenant_not_found');
      }

      // D2 option A: enabled → BFF 自行向 IdP 兑换 code，再用 id_token
      // 调网关换取 member token；关闭 → 保持原有网关 code 兑换链路。
      const idpConfig = loadIdpPassthroughConfig();
      let result: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
      if (isIdpPassthroughUsable(idpConfig)) {
        const idp = await exchangeCodeForIdpTokens(idpConfig, {
          code,
          codeVerifier: payload.code_verifier,
          redirectUri: getSsoRedirectUri(ssoConfig),
        });
        if (!idp.ok || !idp.idToken) {
          console.error(
            `[auth] idp direct exchange failed: tenant=${payload.tenant_id} provider=${payload.provider_id} ` +
              (idp.ok ? 'missing id_token' : `status=${idp.status} code=${idp.code}`),
          );
          return redirectToLoginError(c, 'sso_code_invalid');
        }

        const gateway = await exchangeIdTokenForMember(
          backend.baseUrl,
          {
            id_token: idp.idToken,
            provider_id: payload.provider_id,
            tenant_id: payload.tenant_id,
          },
          ssoConfig.exchangeTimeoutMs,
        );
        if (!gateway.ok) {
          console.error(
            `[auth] id_token exchange failed: tenant=${payload.tenant_id} provider=${payload.provider_id} status=${gateway.status} code=${gateway.code}`,
          );
          return redirectToLoginError(c, mapExchangeError(gateway.status, gateway.code));
        }
        // 服务端持有 IdP access/refresh（浏览器无感），供出站用户态调用使用。
        putIdpTokens(idpSessionKey(payload.tenant_id, idp.tokens.subject), idp.tokens);
        result = gateway;
      } else {
        result = await exchangeAuthorizationCode(
          backend.baseUrl,
          {
            grant: 'authorization_code',
            provider_id: payload.provider_id,
            code,
            code_verifier: payload.code_verifier,
            redirect_uri: getSsoRedirectUri(ssoConfig),
            nonce: payload.nonce,
          },
          ssoConfig.exchangeTimeoutMs,
        );
      }

      if (!result.ok) {
        console.error(
          `[auth] sso exchange failed: tenant=${payload.tenant_id} provider=${payload.provider_id} status=${result.status} code=${result.code}`,
        );
        return redirectToLoginError(c, mapExchangeError(result.status, result.code));
      }

      console.log(
        `[auth] sso login ok: tenant=${payload.tenant_id} provider=${payload.provider_id} member=${result.data.member?.id ?? 'unknown'}`,
      );

      const nowSeconds = Math.floor(Date.now() / 1000);
      const tokenTtlSeconds = Number.isFinite(result.data.expires_at)
        ? result.data.expires_at - nowSeconds
        : AUTH_COOKIE_MAX_AGE;
      const cookieMaxAge = Math.max(60, Math.min(AUTH_COOKIE_MAX_AGE, tokenTtlSeconds));

      setCookie(c, AUTH_COOKIE_NAME, result.data.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: cookieMaxAge,
        secure: isSecureCookie(ssoConfig),
      });
      await writeSsoProviderCookie(
        c,
        { provider_id: payload.provider_id, tenant_id: payload.tenant_id },
        ssoConfig.stateSecret,
        isSecureCookie(ssoConfig),
      );

      c.header('Cache-Control', 'no-store');
      return c.redirect(sanitizeReturnTo(payload.return_to), 302);
    }

    // 开关开启但无 state Cookie：不再回落旧链路（避免绕过 BFF 的 state 绑定）。
    if (ssoConfig.enabled) {
      return redirectToLoginError(c, 'sso_state_invalid');
    }
    // 开关关闭且无 Cookie：保留一个发布周期的旧链路。
  }

  // ---- 旧链路（FR-024 回滚保留一个发布周期）----
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
      /** 网关在 callback 内已签发 member token，BFF 直接使用。 */
      token?: string;
      claims?: Record<string, unknown>;
    };
    if (!cbData.ok || !cbData.member_id) {
      return c.json(fail(502, 'OAuth callback did not return valid member_id'), 502);
    }
    // 直接使用 callback 返回的 token：POST /api/members/{id}/token 要求 Member
    // 身份，API_SERVER_KEY(Profile 模式)会被 401 拒绝，且属多余往返。
    if (!cbData.token) {
      // 发布顺序：intellect-team 必须先于 agentui 升级（spec-014 P0）。
      console.error(
        '[auth] GATEWAY_INCOMPATIBLE: intellect-team did not return a member token from /api/oauth/callback — upgrade the gateway before agentui',
      );
      return c.json(
        fail(
          502,
          'GATEWAY_INCOMPATIBLE: intellect-team did not return a member token; upgrade gateway first',
        ),
        502,
      );
    }

    // Step 2: Set-Cookie + 302 重定向前端首页
    setCookie(c, AUTH_COOKIE_NAME, cbData.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });

    // agentui-sso-logout-loop(A1+A4)：记录 idpSub → imt_token 映射，
    // 供 back-channel 登出通知按 sub 撤销（issuer 未配置时不记录）。
    const idpIssuer = getIdpIssuer();
    const idpSub = typeof cbData.claims?.sub === 'string' ? cbData.claims.sub : '';
    if (idpIssuer && idpSub) {
      recordImtSession(idpSub, cbData.token);
    }

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
