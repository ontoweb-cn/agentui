// spec-010 v8 B-3: Wizard 路由 — 首次安装向导。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
// Constitution Token Security: 请求可含 token 明文(经 HTTPS 传输),
//   响应不含 token 明文,只含 adminTokenEnvVar 引用 + envSnippet。
//
// 路径映射(Vite rewrite 去掉 /api/bff):
//   前端 /api/bff/admin/wizard/status        → BFF /admin/wizard/status
//   前端 /api/bff/admin/wizard/backend-types  → BFF /admin/wizard/backend-types
//   前端 /api/bff/admin/wizard/probe          → BFF /admin/wizard/probe
//   前端 /api/bff/admin/wizard/setup          → BFF /admin/wizard/setup
//
// 鉴权(B1 修复):
// - /admin/wizard/status        公开(authMiddleware.publicPrefixes)
// - /admin/wizard/backend-types 公开(authMiddleware.publicPrefixes)
// - /admin/wizard/probe         公开(authMiddleware.publicPrefixes,SSRF 防护 + IP 速率限制)
// - /admin/wizard/setup         admin OR bootstrap token(wizardSetupAuth 中间件;
//                               方案 A 下 admin 凭据须为经 checkImtSession 真实校验的 imt cookie)
// 非租户隔离:Wizard 是运维全局操作,无 backendContextMiddleware。

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { ITokenVault } from '../services/token-vault';
import { safeFetch, isUrlSafe, SSRF_PRIVATE_IP_HINT } from '../services/ssrf-guard';
import { validateTenantConfigs, fetchTenantInfo } from '../services/tenant-validator';
import { BootstrapTokenManager } from '../services/bootstrap-token';
// wizard-sso(P2):渠道拉取与 SSO 配置加载(仅结构校验用;https 强制仍由 sso-config 启动 fail-fast 裁决)
import { getLoginProviders } from '../services/sso-providers';
import { loadSsoConfig } from '../services/sso-config';
import { checkImtSession } from '../middleware/imt-session-guard';
import { isImtCanvasAgentsEnabled } from '../utils/feature-flags';
import type { HarnessStoreListConfigs } from '../types/harness-admin';
import type { HarnessBackendConfig, BackendType, HarnessCapabilities } from '../types/harness';
import type { AuthMode } from '../types/tenant';
import { AUTH_COOKIE_NAME } from '../types/auth';
import type {
  WizardStatusResponse,
  WizardBackendTypesResponse,
  WizardBackendTypeOption,
  WizardProbeRequest,
  WizardProbeResponse,
  WizardSetupRequest,
  WizardSetupResponse,
  WizardSetupProfile,
  WizardSsoProvidersResponse,
} from '../types/wizard';

interface WizardVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  tokenVault?: ITokenVault;
  bootstrapTokenManager: BootstrapTokenManager;
}

export const wizardRoutes = new Hono<{ Variables: WizardVariables }>();

// 共享 BootstrapTokenManager 实例(与 index.ts 共用)
// index.ts 通过 c.set 注入;此处保留兜底实例,供单元测试独立运行
const DEFAULT_BOOTSTRAP_MANAGER = new BootstrapTokenManager();

// ---------------------------------------------------------------------------
// Backend type options (shared by /backend-types and /setup)
// ---------------------------------------------------------------------------

const ENTERPRISE_CAPABILITIES = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: true,
  multiTenant: true,
  modelManagement: true,
} as const;

const BACKEND_TYPE_OPTIONS: WizardBackendTypeOption[] = [
  // wizard-ent-sso-mode:企业双卡置顶(设计 docs/wizard-enterprise-sso-mode-design.md §3.1 / §8 R1)
  // D-02/X-01(P1):kag 已从向导选项下架;类型联合与 Adapter 保留。
  {
    optionId: 'enterprise-sso',
    type: 'intellect-enterprise',
    setupProfile: 'enterprise-sso',
    label: 'Enterprise (SSO mode)',
    description: 'Sign in with SSO; configure BFF SSO during setup',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: { ...ENTERPRISE_CAPABILITIES },
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'enterprise-password',
    type: 'intellect-enterprise',
    setupProfile: 'enterprise-password',
    label: 'Enterprise (non-SSO mode)',
    description: 'Sign in with member password; enable SSO later if needed',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: { ...ENTERPRISE_CAPABILITIES },
    credentialKind: 'bearer-token',
  },
  // intellect-rag 不作为独立向导类型:它是 intellect-enterprise 的 RAG 插件。
  {
    optionId: 'intellect-community',
    type: 'intellect-community',
    label: 'Intellect Community',
    description: 'Pure Agent runtime (OpenAI-compatible)',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: { canvas: false, knowledgeBase: false, memory: false, mcp: false, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'hermes',
    type: 'hermes',
    label: 'HERMES',
    description: 'HERMES protocol backend',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: { canvas: false, knowledgeBase: false, memory: true, mcp: true, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'agent-scope',
    type: 'agent-scope',
    label: 'AgentScope',
    description: 'AgentScope multi-agent framework',
    defaultEndpoint: 'http://localhost:5000',
    capabilities: { canvas: false, knowledgeBase: false, memory: true, mcp: true, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
];

// P3(wizard-sso):RAG 不再以"伴生插件"形态在向导创建。RAG 与登录链路解耦,
// 不阻塞首装;enterprise 首装后由管理端(PUT /admin/harness-backends/:id needsCreate
// 分支)补配,capabilities 端点对未绑定 RAG 的租户自动降级(capabilities.ts L119-129)。
// intellect-rag 仍不是独立向导类型(setup 保留显式拒绝,给出可读文案)。

function getOptionForType(type: BackendType): WizardBackendTypeOption | undefined {
  return BACKEND_TYPE_OPTIONS.find((o) => o.type === type);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore(c: Context): HarnessStore & HarnessStoreListConfigs {
  const store = c.get('harnessStore');
  return store as HarnessStore & HarnessStoreListConfigs;
}

// ---------------------------------------------------------------------------
// GET /admin/wizard/status — Wizard 状态
// ---------------------------------------------------------------------------

wizardRoutes.get('/admin/wizard/status', (c) => {
  const store = getStore(c);
  // 修复:以"就绪后端"(token 已加载)为准判断 needsSetup,而非 listConfigs()(含 token 未就绪的纯配置条目)。
  // 这样当 harness-backends.json 残留配置但对应 env var 未设置时,仍能正确触发向导,
  // 避免出现"Backend 实际未配置却进入登录页"的逻辑错误。
  const readyBackends = store.list();
  const needsSetup = readyBackends.length === 0;
  return c.json({
    needsSetup,
    bootstrapEnabled: process.env.BOOTSTRAP_ENABLED !== 'false',
    backendCount: readyBackends.length,
  } satisfies WizardStatusResponse);
});

// ---------------------------------------------------------------------------
// GET /admin/wizard/backend-types — 可用后端类型列表
// ---------------------------------------------------------------------------

wizardRoutes.get('/admin/wizard/backend-types', (c) => {
  return c.json({ options: BACKEND_TYPE_OPTIONS } satisfies WizardBackendTypesResponse);
});

// ---------------------------------------------------------------------------
// GET /admin/wizard/sso/providers — 拉取网关已配置的 SSO 登录渠道(wizard-sso P2)
// 公开端点(与 probe 同级防护):SSRF 预校验 + IP 限流 + 超时控制。
// 评审 R2:响应字段裁剪为 id/displayName/icon —— clientId/authorizeUrl/scopes
// 仅由 BFF 内部构造授权 URL 使用,不向浏览器透出。
// ---------------------------------------------------------------------------
wizardRoutes.get('/admin/wizard/sso/providers', async (c) => {
  const endpoint = (c.req.query('endpoint') ?? '').trim();
  if (!endpoint) {
    return c.json(
      { providers: [], misconfigured: [], error: 'endpoint is required' } satisfies WizardSsoProvidersResponse,
      400,
    );
  }

  const clientIp = getClientIp(c);
  if (!checkProbeRateLimit(clientIp)) {
    return c.json(
      { providers: [], misconfigured: [], error: '请求过于频繁,请稍后再试' } satisfies WizardSsoProvidersResponse,
      429,
    );
  }

  const safe = await isUrlSafe(endpoint);
  if (!safe) {
    return c.json(
      {
        providers: [],
        misconfigured: [],
        error: `URL 不安全(可能指向私有 IP)。${SSRF_PRIVATE_IP_HINT}`,
      } satisfies WizardSsoProvidersResponse,
      400,
    );
  }

  try {
    // tenantId 仅作 sso-providers 缓存键;向导探测态与具体租户无关
    const selection = await getLoginProviders(endpoint.replace(/\/$/, ''), 'wizard-probe', loadSsoConfig());
    return c.json({
      providers: selection.providers.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        icon: p.icon,
      })),
      misconfigured: selection.misconfigured,
    } satisfies WizardSsoProvidersResponse);
  } catch (err) {
    console.error('[wizard] sso providers fetch failed:', (err as Error).message);
    return c.json(
      { providers: [], misconfigured: [], error: '统一认证服务不可达,请稍后再试' } satisfies WizardSsoProvidersResponse,
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// probe 速率限制(公开端点防护)
// 基于 IP 的滑动窗口限流,避免被滥用探测公网目标可达性。
// BFF 单实例部署下使用内存 Map 即可;多实例需替换为 Redis。
// ---------------------------------------------------------------------------
const PROBE_RATE_LIMIT = 10; // 每分钟最多 10 次
const PROBE_RATE_WINDOW_MS = 60 * 1000;
const probeRateMap = new Map<string, { count: number; resetAt: number }>();

function checkProbeRateLimit(clientIp: string): boolean {
  const now = Date.now();
  const entry = probeRateMap.get(clientIp);
  if (!entry || now > entry.resetAt) {
    probeRateMap.set(clientIp, { count: 1, resetAt: now + PROBE_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= PROBE_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

function getClientIp(c: Context): string {
  // X-Forwarded-For / X-Real-IP 可被客户端伪造,直连形态下用作限流键
  // 等于允许轮换头绕过限流;仅在显式声明前置可信反代(nginx)时采用。
  if (process.env.BFF_TRUST_PROXY === 'true') {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return c.req.header('x-real-ip') || 'unknown';
  }
  // @hono/node-server 注入的原始 socket 地址,客户端不可伪造
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------------------
// POST /admin/wizard/probe — 探测后端连接
// 公开端点(首次安装时无 admin token),IP 速率限制 + SSRF 防护
// M3 修复:按 credentialKind 区分鉴权头
// M4 修复:intellect-enterprise 类型额外探测 /api/tenant/info
// ---------------------------------------------------------------------------

wizardRoutes.post('/admin/wizard/probe', async (c) => {
  // 速率限制
  const clientIp = getClientIp(c);
  if (!checkProbeRateLimit(clientIp)) {
    return c.json(
      { healthy: false, error: '请求过于频繁,请稍后再试' } satisfies WizardProbeResponse,
      429,
    );
  }

  const body = await c.req.json<WizardProbeRequest>().catch(() => null);
  if (!body || !body.endpoint) {
    return c.json(
      { healthy: false, error: 'endpoint is required' } satisfies WizardProbeResponse,
      400,
    );
  }

  // SSRF 预校验
  const safe = await isUrlSafe(body.endpoint);
  if (!safe) {
    return c.json(
      { healthy: false, error: `URL 不安全(可能指向私有 IP)。${SSRF_PRIVATE_IP_HINT}` } satisfies WizardProbeResponse,
      400,
    );
  }

  const endpoint = body.endpoint.replace(/\/$/, '');
  const option = getOptionForType(body.type);
  // D-02 修复(P1):未知/已下架类型(如 kag)显式拒绝,不再误走 /v1/models 探测。
  // 此前 option 仅用于回填 capabilities,未知 type 仍会探测并可"假成功"。
  if (!option) {
    return c.json(
      { healthy: false, error: `Unsupported backend type: ${body.type}` } satisfies WizardProbeResponse,
      400,
    );
  }

  try {
    // M4 修复:intellect-enterprise 类型优先探测 /api/tenant/info(spec-011 端点)
    // 该端点公开,返回 tenant_id 用于校验配置一致性
    if (body.type === 'intellect-enterprise') {
      const tenantInfo = await fetchTenantInfo(endpoint);
      if (!tenantInfo) {
        // 防呆提示(生产联调实测坑):WebUI 地址(如 …/intellect)与网关基址
        // (如 …/intellect-gateway)都会通过 URL 安全校验,但前者没有
        // /api/tenant/info——探测失败时显式引导,避免运维在错误基址上排查凭据
        return c.json(
          {
            healthy: false,
            error:
              '无法访问 /api/tenant/info 端点(请确认 endpoint 填写的是网关基址,如 https://<host>/intellect-gateway,而非 WebUI 页面地址)',
          } satisfies WizardProbeResponse,
        );
      }
      if (!tenantInfo.tenant_id) {
        return c.json(
          { healthy: false, error: '/api/tenant/info 返回空 tenant_id' } satisfies WizardProbeResponse,
        );
      }
      // P3(wizard-sso):RAG 插件探测随向导 RAG 区块一并移除——RAG 由管理端补配,不阻塞首装。
      return c.json({
        healthy: true,
        capabilities: option?.capabilities,
      } satisfies WizardProbeResponse);
    }

    // 其他类型:探测 /v1/models(OpenAI 兼容端点)
    // M3 修复:按 credentialKind 构造鉴权头
    const headers: Record<string, string> = {};
    if (body.token) {
      headers['Authorization'] = `Bearer ${body.token}`;
    }
    // 注:email-password 模式(intellect-rag)在此处不登录获取 JWT,
    // 仅做端口可达性探测。完整鉴权由 setup 后的 RagTokenProvider 接管。

    const resp = await safeFetch(`${endpoint}/v1/models`, {
      headers,
      timeoutMs: 5000,
    });

    if (resp.ok) {
      return c.json({
        healthy: true,
        capabilities: option?.capabilities,
      } satisfies WizardProbeResponse);
    }
    return c.json(
      { healthy: false, error: `上游返回 ${resp.status}` } satisfies WizardProbeResponse,
    );
  } catch (e) {
    return c.json(
      { healthy: false, error: (e as Error).message } satisfies WizardProbeResponse,
    );
  }
});

// ---------------------------------------------------------------------------
// wizardSetupAuth:admin OR bootstrap token 鉴权(B1 修复)
// ---------------------------------------------------------------------------

function getBootstrapManager(c: Context): BootstrapTokenManager {
  // 优先从 context 获取(生产路径,index.ts 注入)
  // 兜底使用模块级实例(单元测试场景)
  return (c.get('bootstrapTokenManager') as BootstrapTokenManager) ?? DEFAULT_BOOTSTRAP_MANAGER;
}

type AdminAuthVerdict =
  | { authorized: true }
  | {
      authorized: false;
      // checkImtSession 给出的具体失败(401/502/503),透传给调用方以便区分
      // "未授权"与"认证源不可用/未配置";纯无凭据时缺省,走统一 401 文案
      failure?: { status: 401 | 502 | 503; message: string };
    };

/**
 * admin 鉴权(方案 A 修复 2026-10:真实校验,不再信任凭据"存在即 admin")。
 *
 * authMiddleware 将 /admin/wizard/setup 列入 publicPrefixes 跳过校验,
 * 鉴权完全由本函数负责——原先"Authorization 头存在即放行"的假设
 * ("authMiddleware 已校验")在该路径不成立,任意 Bearer 串均可绕过。
 * - 方案 A(默认,flag 开):与 authMiddleware 一致只认 imt_token cookie,
 *   且经 checkImtSession 真实校验(gateway /api/members/me,60s 缓存,fail-closed);
 * - 社区模式(flag='false'):沿用 authMiddleware 社区契约,Authorization 头 /
 *   cookie 存在即放行,JWT 由 RAG 上游验证(setup 无上游调用,维持原契约)。
 */
async function authorizeAdmin(c: Context): Promise<AdminAuthVerdict> {
  if (isImtCanvasAgentsEnabled()) {
    const cookie = getCookie(c, AUTH_COOKIE_NAME);
    if (!cookie) {
      return { authorized: false };
    }
    const check = await checkImtSession(c, cookie);
    return check.ok ? { authorized: true } : { authorized: false, failure: check };
  }
  if (c.req.header('Authorization') || getCookie(c, AUTH_COOKIE_NAME)) {
    return { authorized: true };
  }
  return { authorized: false };
}

/**
 * spec-010 v8 §9.4 (B1 修复):Wizard setup 端点鉴权中间件。
 * 接受 admin 会话(方案 A:已验证的 imt cookie;社区模式:Authorization/cookie)
 * 或 bootstrap token(首次安装专用)。
 */
async function wizardSetupAuth(
  c: Context,
  next: () => Promise<void>,
): Promise<void | Response> {
  // 1. admin 鉴权通过则放行
  const admin = await authorizeAdmin(c);
  if (admin.authorized) {
    await next();
    return;
  }

  // 2. 尝试 bootstrap token 鉴权。
  //    matches() 为非消耗式校验:作废延迟到 handler 成功创建后(step 8 invalidate),
  //    避免 handler 因 400/409 拒绝时把一次性 token 烧掉、首装半途需重启 BFF。
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ') && getBootstrapManager(c).matches(auth.slice(7))) {
    await next();
    return;
  }

  // 3. 首次安装放行(spec §9.4):当 bootstrap 模式启用且尚无就绪后端时,
  // 允许无凭据完成 setup。这是 wizard 面向终端用户的首次安装场景;
  // bootstrap token 机制本身即为此场景的授权,前端 wizard 无需手动传递 token。
  // 多实例部署(BOOTSTRAP_ENABLED=false)仍强制 admin/bootstrap token 鉴权。
  if (process.env.BOOTSTRAP_ENABLED !== 'false') {
    const store = getStore(c);
    if (store.list().length === 0) {
      await next();
      return;
    }
  }

  // 4. 拒绝。认证源不可达(502)/未配置(503)时透传具体状态(fail-closed 可观测),
  // 其余(无凭据/凭据无效)统一 401 文案。
  // 修复(Bug1):必须 return——中间件 void 返回值下裸调 c.json() 会使
  // Hono 报 "Context is not finalized",未授权请求得到 500 而非 401
  if (admin.failure) {
    return c.json({ code: admin.failure.status, message: admin.failure.message }, admin.failure.status);
  }
  return c.json(
    { code: 401, message: 'Unauthorized: admin token or bootstrap token required' },
    401,
  );
}

// ---------------------------------------------------------------------------
// POST /admin/wizard/setup — 创建第一个 backend
// ---------------------------------------------------------------------------

wizardRoutes.post('/admin/wizard/setup', wizardSetupAuth, async (c) => {
  const rawBody = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!rawBody) {
    return c.json(
      { success: false, error: 'Request body must be JSON' } satisfies WizardSetupResponse,
      400,
    );
  }

  // 兼容前端 request 拦截器的 snake_case 转换(next-request.ts convertTheKeysOfTheObjectToSnake)。
  // 前端向导经共享 axios 实例发送请求,键名会被转为 snake_case(credentialKind → credential_kind 等)。
  // BFF wizard 契约为 camelCase,此处做归一化,同时接受 camelCase 和 snake_case。
  // wizard-sso(P2):嵌套对象(如 sso.public_origin)同样需要归一化,故改为深度转换。
  const toCamel = (s: string): string =>
    s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  const toCamelDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(toCamelDeep);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [toCamel(k), toCamelDeep(v)]),
      );
    }
    return value;
  };
  const body = toCamelDeep(rawBody) as Record<string, unknown>;
  const req = body as unknown as WizardSetupRequest;

  // 基本校验
  if (!req.name || !req.type || !req.endpoint || !req.credentialKind) {
    return c.json(
      {
        success: false,
        error: 'name, type, endpoint, credentialKind are required',
      } satisfies WizardSetupResponse,
      400,
    );
  }

  // SSRF 预校验(与 probe 路由一致,防止持久化恶意 URL)
  const endpointSafe = await isUrlSafe(req.endpoint);
  if (!endpointSafe) {
    return c.json(
      { success: false, error: `URL 不安全(可能指向私有 IP)。${SSRF_PRIVATE_IP_HINT}` } satisfies WizardSetupResponse,
      400,
    );
  }

  // m4 修复(P3):intellect-enterprise 的 intellectTenantId 校验(32 位 hex)
  // P3(wizard-sso):RAG 插件必填校验移除——RAG 由管理端补配,不再阻塞首装向导。
  if (req.type === 'intellect-enterprise') {
    if (!req.intellectTenantId) {
      return c.json(
        { success: false, error: 'intellect-enterprise 类型必须提供 intellectTenantId' } satisfies WizardSetupResponse,
        400,
      );
    }
    if (!/^[0-9a-fA-F]{32}$/.test(req.intellectTenantId)) {
      return c.json(
        { success: false, error: 'intellectTenantId 必须为 32 位 hex(Rust 版本要求)' } satisfies WizardSetupResponse,
        400,
      );
    }
  }

  // RAG 是 enterprise 插件,不接受独立向导接入(登录也不走 RAG 社区版账号)。
  if (req.type === 'intellect-rag') {
    return c.json(
      {
        success: false,
        error:
          'intellect-rag is not a standalone wizard type; configure it as the RAG plugin of intellect-enterprise',
      } satisfies WizardSetupResponse,
      400,
    );
  }

  const option = getOptionForType(req.type);
  if (!option) {
    return c.json(
      { success: false, error: `Unsupported backend type: ${req.type}` } satisfies WizardSetupResponse,
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // wizard-ent-sso-mode + wizard-sso(P2):setupProfile + SSO 结构校验
  // https 强制仍由 sso-config 启动 fail-fast 裁决 —— 设计 §3.4 / §8 R4–R5
  // ---------------------------------------------------------------------------
  const ssoWarnings: string[] = [];
  let resolvedSetupProfile: WizardSetupProfile | undefined;

  if (req.setupProfile != null && req.type !== 'intellect-enterprise') {
    return c.json(
      {
        success: false,
        error: 'setupProfile 仅支持 intellect-enterprise 类型',
      } satisfies WizardSetupResponse,
      400,
    );
  }

  if (req.type === 'intellect-enterprise') {
    const rawProfile = req.setupProfile;
    if (rawProfile === 'enterprise-sso' || rawProfile === 'enterprise-password') {
      resolvedSetupProfile = rawProfile;
    } else if (rawProfile != null && rawProfile !== '') {
      return c.json(
        {
          success: false,
          error: `未知 setupProfile: ${String(rawProfile)}`,
        } satisfies WizardSetupResponse,
        400,
      );
    } else if (req.sso?.enabled) {
      // §8 R5:缺省时按 sso.enabled 推断,兼容旧客户端
      resolvedSetupProfile = 'enterprise-sso';
      ssoWarnings.push(
        '未传 setupProfile:已按 sso.enabled 推断为 enterprise-sso;请显式传 setupProfile',
      );
    } else {
      resolvedSetupProfile = 'enterprise-password';
      ssoWarnings.push(
        '未传 setupProfile:已默认 enterprise-password;请显式传 setupProfile',
      );
    }
  }

  if (resolvedSetupProfile === 'enterprise-password' && req.sso?.enabled) {
    return c.json(
      {
        success: false,
        error: 'enterprise-password 模式不允许 sso.enabled=true',
      } satisfies WizardSetupResponse,
      400,
    );
  }

  if (resolvedSetupProfile === 'enterprise-sso') {
    if (!req.sso?.enabled) {
      return c.json(
        {
          success: false,
          error: 'enterprise-sso 模式必须提供 sso.enabled=true',
        } satisfies WizardSetupResponse,
        400,
      );
    }
  }

  if (req.sso?.enabled) {
    // X-10:非 enterprise 类型携带 sso → 400
    if (req.type !== 'intellect-enterprise') {
      return c.json(
        { success: false, error: 'sso 配置仅支持 intellect-enterprise 类型' } satisfies WizardSetupResponse,
        400,
      );
    }
    const publicOrigin = (req.sso.publicOrigin ?? '').trim();
    if (!publicOrigin) {
      return c.json(
        { success: false, error: '启用 sso 时 sso.publicOrigin 必填' } satisfies WizardSetupResponse,
        400,
      );
    }
    try {
      const origin = new URL(publicOrigin);
      if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
        return c.json(
          { success: false, error: 'sso.publicOrigin 必须为 http(s) URL' } satisfies WizardSetupResponse,
          400,
        );
      }
    } catch {
      return c.json(
        { success: false, error: `sso.publicOrigin 不是合法 URL: ${publicOrigin}` } satisfies WizardSetupResponse,
        400,
      );
    }
    if (!req.sso.stateSecret || req.sso.stateSecret.length < 32) {
      return c.json(
        {
          success: false,
          error: 'sso.stateSecret 至少 32 字符(与 BFF_SSO_STATE_SECRET 启动校验一致)',
        } satisfies WizardSetupResponse,
        400,
      );
    }
    const providerIds = Array.isArray(req.sso.providers)
      ? req.sso.providers.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      : null;
    if (providerIds && providerIds.length > 0) {
      try {
        const selection = await getLoginProviders(req.endpoint.replace(/\/$/, ''), 'wizard-probe', loadSsoConfig());
        const known = new Set(selection.providers.map((p) => p.id));
        const unknown = providerIds.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          ssoWarnings.push(
            `sso 渠道白名单包含未知或不可用渠道: ${unknown.join(', ')};` +
              '运行期将仅展示白名单内渠道,若全部未知则登录页不展示任何 SSO 渠道(密码登录不受影响)。',
          );
        }
      } catch (err) {
        ssoWarnings.push(
          `sso 渠道白名单校验跳过(统一认证服务不可达): ${(err as Error).message}`,
        );
      }
    }
  }

  const store = getStore(c);
  const registry = c.get('adapterRegistry');
  const vault = c.get('tokenVault');

  // 1. 生成 backendId(kebab-case) + adminTokenEnvVar
  // P1-4 修复:严格清洗,仅保留 [a-z0-9-],防止非法字符导致 env var/路径问题
  const backendId = req.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!backendId) {
    return c.json(
      { success: false, error: 'name 清洗后为空,需包含至少一个字母或数字' } satisfies WizardSetupResponse,
      400,
    );
  }
  // adminTokenEnvVar 始终由 BFF 自动生成,命名规则升级为 HARNESS_<ID>_TOKEN。
  // 前端传入的 adminTokenEnvVar 会被忽略并记录 warn(防止前端污染命名空间)。
  // 向后兼容:已持久化的 config 不变,只有新建 backend 用新规则。
  if (req.adminTokenEnvVar !== undefined) {
    console.warn(
      `[wizard] Ignoring frontend-provided adminTokenEnvVar="${req.adminTokenEnvVar}" ` +
        `for backend "${backendId}"; BFF auto-generates HARNESS_<ID>_TOKEN.`,
    );
  }
  const adminTokenEnvVar = `HARNESS_${backendId.toUpperCase().replace(/-/g, '_')}_TOKEN`;

  // 2. 唯一性校验
  const existing = store.listConfigs?.() ?? [];
  const existingConfig = existing.find((cfg) => cfg.id === backendId);
  if (existingConfig) {
    // 配置已存在:仅当后端未就绪(token 缺失)时允许重新 setup(修复 token),
    // 已就绪则拒绝(防止重复创建)。
    const isReady = store.list().some((b) => b.id === backendId);
    if (isReady) {
      return c.json(
        { success: false, error: `Backend id "${backendId}" 已存在且已就绪` } satisfies WizardSetupResponse,
        409,
      );
    }
    console.warn(
      `[wizard] Backend "${backendId}" config exists but token is missing, allowing re-setup to fix credentials`,
    );
  }

  // 3. spec-010 v8 修改 3 (B2 修复):若 type='intellect-enterprise',
  //    在持久化**之前**触发 validateTenantConfigs 校验,失败则不创建。
  //    注:此处 store 尚未含新 backend,需构造临时校验对象。
  if (req.type === 'intellect-enterprise' && req.intellectTenantId) {
    // 调用 intellect-team /api/tenant/info 校验 tenant_id 一致性
    const tenantInfo = await fetchTenantInfo(req.endpoint);
    if (tenantInfo && tenantInfo.tenant_id) {
      if (tenantInfo.tenant_id !== req.intellectTenantId) {
        return c.json(
          {
            success: false,
            error:
              `tenant_id mismatch: 配置的 intellectTenantId="${req.intellectTenantId}" ` +
              `与 intellect-team 实际 tenant_id="${tenantInfo.tenant_id}" 不一致`,
          } satisfies WizardSetupResponse,
          400,
        );
      }
    }
    // tenantInfo 不可达时降级放行(与启动校验行为一致),由后续运行时校验兜底
  }

  // 4. 如果有 vault 且提供了凭据,存储到 vault
  // P1-5 修复:email-password 模式必须有 vault,否则凭据会丢失(无 env var 回退)
  if (req.credentialKind === 'email-password') {
    if (!req.email || !req.password) {
      return c.json(
        { success: false, error: 'email-password 模式必须提供 email 和 password' } satisfies WizardSetupResponse,
        400,
      );
    }
    if (!vault) {
      return c.json(
        { success: false, error: 'email-password 模式需要 Token Vault 支持,当前环境未配置 vault' } satisfies WizardSetupResponse,
        500,
      );
    }
    await vault.setCredentials(backendId, {
      kind: 'email-password',
      email: req.email,
      password: req.password,
    });
  } else if (vault && req.credentialKind === 'bearer-token' && req.token) {
    await vault.setCredentials(backendId, { kind: 'bearer-token', token: req.token });
  }

  // 5. 构造 HarnessBackendConfig(不含 token 明文)
  const newConfig: HarnessBackendConfig = {
    id: backendId,
    name: req.name,
    type: req.type,
    endpoint: req.endpoint,
    adminTokenEnvVar,
    capabilities: option.capabilities,
    credentialKind: req.credentialKind,
    ...(req.intellectTenantId ? { intellectTenantId: req.intellectTenantId } : {}),
    ...(req.defaultForTenant !== undefined ? { defaultForTenant: req.defaultForTenant } : {}),
  };

  // P3(wizard-sso):移除向导内伴生 RAG 创建。RAG 由管理端补配(PUT needsCreate 分支),
  // capabilities 端点对未绑定 RAG 的租户自动降级;setup 响应以 warnings 非阻断提示。

  // 6. 持久化 + 热加载 + 缓存失效
  //    若 existingConfig 存在(重新 setup 场景),用 newConfig 覆盖;否则追加。
  const configsToUpsert = [newConfig];
  const byId = new Map(existing.map((cfg) => [cfg.id, cfg]));
  for (const cfg of configsToUpsert) {
    byId.set(cfg.id, cfg);
  }
  const nextConfigs = [...byId.values()];
  try {
    await store.saveConfig(nextConfigs);
    await store.load();
  } catch (err) {
    return c.json(
      {
        success: false,
        error: `Failed to persist config: ${(err as Error).message}`,
      } satisfies WizardSetupResponse,
      500,
    );
  }
  registry.invalidate(backendId);

  // 7. spec-010 v8 修改 3:持久化后再触发一次 validateTenantConfigs(确保 load() 后状态正确)
  //    若校验失败,执行回滚:删除刚创建的 config(防止脏状态导致下次启动 fail-fast)
  if (body.type === 'intellect-enterprise') {
    const ok = await validateTenantConfigs(store);
    if (!ok) {
      // B2 修复:回滚持久化
      try {
        await store.saveConfig(existing);
        await store.load();
        registry.invalidate(backendId);
        // 凭据一并回收:vault 已写入的企业版凭据不能遗留为孤儿条目
        await vault?.deleteCredentials(backendId);
      } catch (rollbackErr) {
        console.error(
          `[wizard] Rollback failed after tenant validation failure: ${(rollbackErr as Error).message}`,
        );
      }
      return c.json(
        {
          success: false,
          error:
            'tenant_id mismatch: 配置的 intellectTenantId 与 intellect-team 实际 tenant_id 不一致,已回滚',
        } satisfies WizardSetupResponse,
        400,
      );
    }
  }

  // 7.5. 创建/更新默认 tenant '0',确保 X-Backend-Id: '0' 的请求能路由到新创建的 backend。
  //      Wizard 创建第一个 backend 时,需同步更新 BffTenant 记录,否则 authMode 会使用
  //      默认值(可能导致企业版后端显示社区版登录界面)。
  const wizardAuthMode: AuthMode =
    req.type === 'intellect-enterprise' ? 'intellect-enterprise' : 'intellect-community';
  const defaultTenantId = '0';
  const bStore = c.get('backendStore');
  const existingDefaultTenant = bStore.getBackend(defaultTenantId);
  // 新后端是否"就绪"(token 已加载):未就绪时 HarnessStore.get 返回 undefined,
  // setHarnessBinding 会抛 BackendNotConfiguredError → 500,而此时配置已落盘。
  const newBackendReady = store.list().some((b) => b.id === backendId);
  const warnings: string[] = [];
  if (existingDefaultTenant) {
    if (!newBackendReady) {
      // env-var 模式(token 后置)的合法场景:保持现有绑定不动,等 token 设置并
      // 重启加载后由 Admin 重新绑定;不能让 500 留下"配置已落盘 + 绑定半更新"的脏状态
      warnings.push(
        `Backend "${backendId}" 未就绪(token 未设置),本次未更新默认租户绑定;` +
          'token 设置并重启 BFF 加载后,请在 Admin 中重新绑定。',
      );
    } else {
      // 更新现有默认 tenant 的绑定
      if (existingDefaultTenant.intellectBackendId !== backendId) {
        await bStore.setHarnessBinding(defaultTenantId, backendId);
      }
      await bStore.setAuthMode(defaultTenantId, wizardAuthMode);
      if (req.type === 'intellect-enterprise' && req.intellectTenantId) {
        await bStore.setIntellectBinding(defaultTenantId, req.intellectTenantId);
      }
    }
  } else {
    // 全新安装(无 bff-tenants.json 或文件中无 tenant '0'):创建默认 tenant
    // 传入 defaultTenantId='0',确保后续 X-Backend-Id: '0' 的请求能路由到此 tenant
    await bStore.createBackend(
      req.name || 'Default',
      backendId,
      req.intellectTenantId,
      wizardAuthMode,
      defaultTenantId,
    );
    if (!newBackendReady) {
      warnings.push(
        `Backend "${backendId}" 未就绪(token 未设置),默认租户已先指向该后端;` +
          'token 设置并重启 BFF 加载后生效(期间该租户请求将降级)。',
      );
    }
  }
  // P3(wizard-sso/X-04):RAG 未随向导配置 → 非阻断提示能力降级与补配路径。
  // capabilities 端点对未绑定 RAG 的租户自动置 false(前端隐藏入口),此提示告知恢复路径。
  if (req.type === 'intellect-enterprise') {
    warnings.push(
      'RAG 插件未配置:画布/知识库/记忆/模型管理在管理端补配 RAG 前不可用(Admin → Harness Backends)。',
    );
  }

  // 8. 首个 backend 创建成功后,失效 bootstrap token(spec §9.4)
  const manager = getBootstrapManager(c);
  manager.invalidate();

  // 9. 生成 env snippet(展示 .env 片段,用户手动设置或作为 vault 回退参考)
  // P1-3 修复:响应不含 token 明文,始终使用占位符
  // wizard-sso(P2/X-08):启用 SSO 时追加统一认证配置;stateSecret 永以占位符输出,
  // 真实密钥仅存在于向导 UI(用户复制到 .env),任何响应/落盘均不含明文。
  // P3(wizard-sso):RAG 不再随向导配置,snippet 无 RAG key 行。
  const baseSnippet = `# 添加到 .env 文件\n${adminTokenEnvVar}=<your-token>`;
  const ssoSnippetLines: string[] = [];
  if (req.sso?.enabled && req.type === 'intellect-enterprise') {
    const providerIds = Array.isArray(req.sso.providers)
      ? req.sso.providers.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      : [];
    ssoSnippetLines.push('# 统一认证(SSO)');
    ssoSnippetLines.push('BFF_SSO_ENABLED=true');
    ssoSnippetLines.push(`BFF_PUBLIC_ORIGIN=${(req.sso.publicOrigin ?? '').trim()}`);
    ssoSnippetLines.push('BFF_SSO_STATE_SECRET=<your-secret>');
    ssoSnippetLines.push(
      providerIds.length > 0
        ? `BFF_SSO_PROVIDERS=${providerIds.join(',')}`
        : '# BFF_SSO_PROVIDERS= 渠道白名单(留空=不过滤)',
    );
    ssoSnippetLines.push(`BFF_SSO_SILENT_RELOGIN=${req.sso.silentRelogin === false ? 'false' : 'true'}`);
    // §8 R8:完成页须明示「待写入 env 前渠道不会出现」
    ssoWarnings.push(
      '统一认证尚未生效:请将上方 BFF_SSO_* 写入部署 .env 并重启 BFF 后,登录页才会出现统一认证渠道。',
    );
  }
  const envSnippet = ssoSnippetLines.length > 0 ? `${baseSnippet}\n${ssoSnippetLines.join('\n')}` : baseSnippet;

  const allWarnings = [...warnings, ...ssoWarnings];
  return c.json({
    success: true,
    backendId,
    envSnippet,
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
  } satisfies WizardSetupResponse);
});
