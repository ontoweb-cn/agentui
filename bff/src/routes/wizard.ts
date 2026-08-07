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
// - /admin/wizard/setup         admin OR bootstrap token(wizardSetupAuth 中间件)
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

const BACKEND_TYPE_OPTIONS: WizardBackendTypeOption[] = [
  {
    type: 'kag',
    label: 'KAG',
    description: 'Knowledge-Augmented Generation',
    // spec-010 v8.3:默认 endpoint 与 spec.md §9.2 对齐(MCP SSE 默认 :3000)
    defaultEndpoint: 'http://localhost:3000',
    // spec-010 v8.3 修订:knowledgeBase true→false, mcp false→true(基于 research.md R2)
    capabilities: { canvas: false, knowledgeBase: false, memory: false, mcp: true, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
  {
    type: 'intellect-enterprise',
    label: 'Intellect Enterprise',
    description: 'Team/Project + multi-tenant',
    defaultEndpoint: 'http://localhost:8642',
    // spec-010 v8.3:memory/mcp 能力与 spec.md §3.2 对齐
    capabilities: { canvas: false, knowledgeBase: false, memory: true, mcp: true, multiTenant: true, modelManagement: true },
    credentialKind: 'bearer-token',
  },
  {
    type: 'intellect-rag',
    label: 'Intellect RAG',
    description: 'Canvas engine + knowledge base',
    defaultEndpoint: 'http://localhost:9380',
    capabilities: { canvas: true, knowledgeBase: true, memory: true, mcp: false, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
  // spec-010 v8 新增(待 Phase C 实现 Adapter)
  {
    type: 'intellect-community',
    label: 'Intellect Community',
    description: 'Pure Agent runtime (OpenAI-compatible)',
    // spec-010 v8.3:默认 endpoint 与 spec.md §9.2 对齐(与 intellect-enterprise 同源)
    defaultEndpoint: 'http://localhost:8642',
    capabilities: { canvas: false, knowledgeBase: false, memory: false, mcp: false, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
  {
    type: 'hermes',
    label: 'HERMES',
    description: 'HERMES protocol backend',
    // spec-010 v8.3:默认 endpoint 与 spec.md §9.2 对齐(部署时需改端口,避免与 intellect-enterprise 冲突)
    defaultEndpoint: 'http://localhost:8642',
    capabilities: { canvas: false, knowledgeBase: false, memory: true, mcp: true, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
  {
    type: 'agent-scope',
    label: 'AgentScope',
    description: 'AgentScope multi-agent framework',
    defaultEndpoint: 'http://localhost:5000',
    // spec-010 v8.3:memory/mcp 能力与 spec.md §3.2 对齐
    capabilities: { canvas: false, knowledgeBase: false, memory: true, mcp: true, multiTenant: false, modelManagement: false },
    credentialKind: 'bearer-token',
  },
];

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
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return c.req.header('x-real-ip') || 'unknown';
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

  try {
    // M4 修复:intellect-enterprise 类型优先探测 /api/tenant/info(spec-011 端点)
    // 该端点公开,返回 tenant_id 用于校验配置一致性
    if (body.type === 'intellect-enterprise') {
      const tenantInfo = await fetchTenantInfo(endpoint);
      if (!tenantInfo) {
        return c.json(
          { healthy: false, error: '无法访问 /api/tenant/info 端点' } satisfies WizardProbeResponse,
        );
      }
      if (!tenantInfo.tenant_id) {
        return c.json(
          { healthy: false, error: '/api/tenant/info 返回空 tenant_id' } satisfies WizardProbeResponse,
        );
      }
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

function isAdminAuthorized(c: Context): boolean {
  // 社区版:Authorization header 存在即视为 admin 鉴权通过(authMiddleware 已校验)
  if (c.req.header('Authorization')) return true;
  // 企业版:imt_token cookie 存在即视为 admin 鉴权通过
  if (getCookie(c, AUTH_COOKIE_NAME)) return true;
  return false;
}

/**
 * spec-010 v8 §9.4 (B1 修复):Wizard setup 端点鉴权中间件。
 * 接受 admin token(JWT/cookie)或 bootstrap token(首次安装专用)。
 */
async function wizardSetupAuth(c: Context, next: () => Promise<void>): Promise<void> {
  // 1. admin 鉴权通过则放行
  if (isAdminAuthorized(c)) {
    await next();
    return;
  }

  // 2. 尝试 bootstrap token 鉴权
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const manager = getBootstrapManager(c);
    if (manager.verify(token)) {
      await next();
      return;
    }
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

  c.json(
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
  const toCamel = (s: string): string =>
    s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  const body = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawBody)) {
    body[toCamel(key)] = value;
  }
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

  const option = getOptionForType(req.type);
  if (!option) {
    return c.json(
      { success: false, error: `Unsupported backend type: ${req.type}` } satisfies WizardSetupResponse,
      400,
    );
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

  // 6. 持久化 + 热加载 + 缓存失效
  //    若 existingConfig 存在(重新 setup 场景),用 newConfig 覆盖;否则追加。
  const nextConfigs = existingConfig
    ? existing.map((cfg) => (cfg.id === backendId ? newConfig : cfg))
    : [...existing, newConfig];
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
  if (existingDefaultTenant) {
    // 更新现有默认 tenant 的绑定
    if (existingDefaultTenant.intellectBackendId !== backendId) {
      await bStore.setHarnessBinding(defaultTenantId, backendId);
    }
    await bStore.setAuthMode(defaultTenantId, wizardAuthMode);
    if (req.type === 'intellect-enterprise' && req.intellectTenantId) {
      await bStore.setIntellectBinding(defaultTenantId, req.intellectTenantId);
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
  }

  // 8. 首个 backend 创建成功后,失效 bootstrap token(spec §9.4)
  const manager = getBootstrapManager(c);
  manager.invalidate();

  // 9. 生成 env snippet(展示 .env 片段,用户手动设置或作为 vault 回退参考)
  // P1-3 修复:响应不含 token 明文,始终使用占位符
  const envSnippet = `# 添加到 .env 文件\n${adminTokenEnvVar}=<your-token>`;

  return c.json({ success: true, backendId, envSnippet } satisfies WizardSetupResponse);
});
