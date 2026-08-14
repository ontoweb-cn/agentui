import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { backendContextMiddleware } from './middleware/backend-context';
import { errorHandler } from './middleware/error';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { bffAgentRoutes } from './routes/bff-agents';
import { capabilitiesRoutes } from './routes/capabilities';
import { harnessAdminRoutes } from './routes/harness-admin';
import { sessionRoutes } from './routes/session';
import { healthRoutes } from './routes/health';
import { proxyRoutes } from './routes/proxy';
import { llmProxyRoutes } from './routes/llm-proxy';
import { teamRoutes } from './routes/teams';
import { projectRoutes } from './routes/projects';
import { tenantBindingRoutes } from './routes/tenant-bindings';
import { authSessionMiddleware } from './middleware/auth-session';
import { JSONFileHarnessStore } from './services/harness-store';
import { JSONFileBackendStore } from './services/backend-store';
import { AdapterRegistry } from './services/adapter-registry';
import { CanvasService } from './services/canvas-service';
import { validateTenantConfigs } from './services/tenant-validator';
import { EncryptedFileTokenVault } from './services/token-vault';
import { IntellectRagAdapter } from './services/adapters/intellect-rag/intellect-rag-adapter';
import { IntellectEnterpriseAdapter } from './services/adapters/intellect-enterprise/intellect-enterprise-adapter';
// spec-010 v8 Phase C-P1/P2/P3 (2026-07-30): 3 个 OpenAI 兼容后端 Adapter 工厂注册
import { IntellectCommunityAdapter } from './services/adapters/intellect-community/intellect-community-adapter';
import { HermesAdapter } from './services/adapters/hermes/hermes-adapter';
import { AgentScopeAdapter } from './services/adapters/agent-scope/agent-scope-adapter';
// spec-012 Phase 1 (C-P4, 2026-07-30): KAG MCP Adapter 工厂注册
import { KagAdapter } from './services/adapters/kag/kag-adapter';
import { canvasRoutes } from './routes/canvas';
import { wizardRoutes } from './routes/wizard';
// spec-010 v8 B-1 (B1 修复): BootstrapTokenManager 单例,供 wizard setup 鉴权
import { BootstrapTokenManager } from './services/bootstrap-token';
const bootstrapTokenManager = new BootstrapTokenManager();
import type { HarnessStore, BackendStore } from './types';
import type { BackendContext } from './types/tenant';
import type { AuthSession } from './types/auth';

// Hono context variables type (for c.set / c.get)
interface AppVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: AdapterRegistry;
  canvasService: CanvasService;
  backendContext?: BackendContext;
  authSession?: AuthSession;
}

const app = new Hono<{ Variables: AppVariables }>();

// Multi-Harness P0 Phase 5 + P1 US3:启动时初始化 Store + Registry。
// Constitution Principle V (Tenant Isolation) + Principle II (Adapter Abstraction)。
// 必须在所有路由注册之前,确保 context 注入中间件先于路由处理执行。
// spec-010 v8 A3-5: TokenVault — Wizard setup 时存储凭据,store.load() 时读取,
// 使后端在创建后立即就绪(无需手动设置 env var 重启)。
// EncryptedFileTokenVault 在 HARNESS_TOKEN_ENCRYPTION_KEY 未设置时自动生成并持久化密钥(dev 模式)。
const tokenVault = new EncryptedFileTokenVault();
const harnessStore: HarnessStore = new JSONFileHarnessStore(tokenVault);
const backendStore: BackendStore = new JSONFileBackendStore(harnessStore);
const adapterRegistry = new AdapterRegistry(harnessStore, backendStore);
// 工厂注册:仅 intellect-rag 和 intellect-enterprise 注册 Adapter 工厂。
// intellect-llm 故意不注册(legacy,走 llm-proxy.ts 透传路由,不经 AdapterRegistry 解析)。
// spec-010 v8 A3-8: 防御性约束,避免后续误加。
adapterRegistry.registerFactory(
  'intellect-rag',
  (backend) => new IntellectRagAdapter(backend),
);
// Multi-Harness P3 (Constitution Principle II + VIII):注册企业版 Adapter 工厂。
adapterRegistry.registerFactory(
  'intellect-enterprise',
  (backend) => new IntellectEnterpriseAdapter(backend),
);
// spec-010 v8 Phase C-P1/P2/P3 (2026-07-30): 3 个 OpenAI 兼容后端 Adapter 工厂注册。
// 协议族: openai-compatible;继承 OpenAICompatibleBaseAdapter;默认端口见 research.md。
adapterRegistry.registerFactory(
  'intellect-community',
  (backend) => new IntellectCommunityAdapter(backend),
);
adapterRegistry.registerFactory('hermes', (backend) => new HermesAdapter(backend));
adapterRegistry.registerFactory(
  'agent-scope',
  (backend) => new AgentScopeAdapter(backend),
);
// spec-012 Phase 1 (C-P4, 2026-07-30): KAG MCP Adapter 工厂注册
adapterRegistry.registerFactory('kag', (backend) => new KagAdapter(backend));

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:9391'],
  credentials: true,
}));
app.use('*', errorHandler);

// 安全响应头中间件
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('X-XSS-Protection', '1; mode=block');
  c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

// spec-008: CanvasService 实例(依赖 adapterRegistry,需在路由注册前创建)
const canvasService = new CanvasService(adapterRegistry);

// 将 store + registry + canvasService 实例存到 Hono context(必须在路由注册之前挂载,
// 否则路由处理时 c.get('harnessStore') 等返回 undefined)
app.use('*', async (c, next) => {
  c.set('harnessStore', harnessStore);
  c.set('backendStore', backendStore);
  c.set('adapterRegistry', adapterRegistry);
  c.set('canvasService', canvasService);
  await next();
});

// Health check (no auth required)
app.route('/health', healthRoutes);

// Auth-protected routes
app.use('/api/*', authMiddleware);
app.route('/api/session', sessionRoutes);
// Admin routes (BFF-owned: whitelist, roles, resources — migrated from
// Intellect RAG Admin stubs/missing routes). Strongly-coupled admin features
// (users, services, sandbox, system settings) remain on Intellect RAG Admin :9381.
app.route('/api/admin', adminRoutes);

// Multi-Harness P0-前置:透明反向代理 /api/bff/proxy/v1/* → intellect-rag /api/v1/*
// Constitution Principle I (BFF-Mediated Frontend):前端所有 /api/v1/* 改经此代理。
// 未授权请求返回 401 不透传(Scenario 2)。
// 不删除/不改动现有 agent/session/admin/health 路由(SC-009 回归约束)。
//
// 路径映射:前端 /api/bff/proxy/v1/agents → Vite proxy rewrite 去掉 /api/bff
//         → BFF 收到 /proxy/v1/agents → proxyRoutes 匹配 /proxy/v1/*
//         → 透传到 intellect-rag /api/v1/agents
//
// authMiddleware 挂载到 /proxy/* (与 /api/* 并行,覆盖 proxy 路由)
// 但排除公开接口 /proxy/v1/system/config
app.use('/proxy/v1/system/config', async (c, next) => await next());
app.use('/proxy/*', authMiddleware);
// authSessionMiddleware:从 cookie 提取 imt_token 注入 AuthSession,供 proxy.ts
// 传递 sessionToken 给 fetchWithRagToken(优先于 admin JWT,实现真实身份透传)。
// 不阻塞:无 cookie 时仅不注入 session,不影响公开接口 /proxy/v1/system/config。
app.use('/proxy/*', authSessionMiddleware);
// LLM Gateway 代理:模型管理 /providers /models 等 → intellect-team :8642
// 必须在通用 proxyRoutes 之前注册,确保 LLM 路径优先匹配
app.route('/', llmProxyRoutes);
// 通用代理:其余 /proxy/v1/* → intellect-rag :9380
app.route('/', proxyRoutes);

// Multi-Harness P1 (US3): BFF Agent 原生路由 /agents/*
// Constitution Principle I + II: 前端经 BFF 原生路由调 Adapter,不直连 Intellect RAG。
// 路径:前端 /api/bff/agents → Vite proxy rewrite 去掉 /api/bff → BFF 收到 /agents
//       → bffAgentRoutes 匹配 /agents/* → adapter.listAgents / getAgent / sessions CRUD
// US3:通过 AdapterRegistry.getAdapterForBackend(tenantId) 选择 Adapter。
// Canvas DSL 编辑(POST/PUT/DELETE agents)保留透传(Principle III Layer 3)。
// BackendContext 中间件仅挂载到 /agents/* (US3),不影响 /proxy/v1/* 透传路由。
// 挂载点 '/' 与 proxyRoutes 并列,路径前缀不冲突(/agents/* vs /proxy/v1/*)。
// 方案 A 阶段一:企业版画布/agents 的 imt_ 透传开关。默认关闭(零行为变化)。
// RAG 侧验证清单 V1–V4 回填确认后置为 'true',使 /canvas/* /agents/* 挂上
// authSessionMiddleware,企业版已登录请求以 imt_(而非 RAG 超管 JWT)访问 intellect-rag。
// 见 docs/enterprise-rag-admin-credential-analysis.md 方案 A。
const enableImtCanvasAgents = process.env.BFF_ENABLE_IMT_CANVAS_AGENTS === 'true';

app.use('/agents/*', authMiddleware);
if (enableImtCanvasAgents) app.use('/agents/*', authSessionMiddleware);
app.use('/agents/*', backendContextMiddleware);
app.route('/', bffAgentRoutes);

// Multi-Harness P2 (US1): Harness Admin 路由 /admin/harness-backends/*
// Constitution Principle I + V (非租户隔离) + Token Security。
// 路径:前端 /api/bff/admin/harness-backends → Vite proxy rewrite 去掉 /api/bff
//       → BFF 收到 /admin/harness-backends → harnessAdminRoutes 匹配
// 鉴权:authMiddleware(运维操作,非租户隔离,无 backendContextMiddleware)。
// 挂载点 '/' 与 bffAgentRoutes 并列,路径前缀不冲突(/admin/harness-backends vs /agents)。
app.use('/admin/harness-backends/*', authMiddleware);
app.route('/', harnessAdminRoutes);

// Multi-Harness P2 (US2): Capabilities 路由 /capabilities/*
// Constitution Principle I + II + V + VIII: 前端经 BFF 查询能力,按 tenant 隔离。
// 路径:前端 /api/bff/capabilities → Vite proxy rewrite 去掉 /api/bff
//       → BFF 收到 /capabilities → capabilitiesRoutes 匹配
// 中间件:authMiddleware + backendContextMiddleware(注入 tenantId/userId)。
// 挂载点 '/' 与其他路由并列,路径前缀不冲突(/capabilities vs /agents vs /admin)。
app.use('/capabilities/*', authMiddleware);
app.use('/capabilities/*', backendContextMiddleware);
app.route('/', capabilitiesRoutes);

// spec-008: Canvas 路由 — 画布脱离 Proxy 路由
// Constitution Principle I + III: 前端画布操作经 BFF /canvas/*,硬绑定 IntellectRagAdapter。
// Constitution Principle V: 按 BffTenant.canvasBackendId 路由,未绑定返回 503。
// 路径:前端 /api/bff/canvas/* → Vite proxy rewrite 去掉 /api/bff → BFF 收到 /canvas/*
// 中间件:authMiddleware(鉴权) + backendContextMiddleware(租户上下文注入,缺失回退 default)
// 挂载点 '/' 与其他路由并列,路径前缀不冲突(/canvas/* vs /agents/* / /admin/* / /capabilities/*)
app.use('/canvas/*', authMiddleware);
if (enableImtCanvasAgents) app.use('/canvas/*', authSessionMiddleware);
app.use('/canvas/*', backendContextMiddleware);
app.route('/', canvasRoutes);

// Multi-Harness P4b (US1/US2/US3): BFF 统一认证路由 /api/bff/auth/*
// Constitution Principle I + V + VIII: 前端认证经 BFF,企业版用 member token(imt_*)存 HttpOnly cookie。
// 路径:前端 /api/bff/auth/* → Vite proxy rewrite 去掉 /api/bff → BFF 收到 /auth/*
// 中间件策略:
//   - 公开端点(login/register/login/channels/login/{channel}/oauth/callback)无需鉴权
//   - 需认证端点(me/logout)挂 auth-session 中间件(从 cookie 提取 token)
// authMiddleware(全局 Authorization header 校验)不拦截 /auth/*,因社区版透传用前端自带 Authorization,
// 企业版用 cookie 而非 Authorization header。
app.use('/auth/me', authSessionMiddleware);
app.use('/auth/logout', authSessionMiddleware);
app.route('/', authRoutes);

// Multi-Harness P5 (US1/US2/US3): Team/Project CRUD + Tenant 绑定路由。
// Constitution Principle I + V + VIII: 前端经 BFF 管理 intellect-team Team/Project,
// BffTenant 绑定真实 team_id 后启用实例内 Team 数据隔离。
// 真正的租户隔离通过多实例:不同 BffTenant 绑定不同 intellectBackendId(intellect-team 实例)。
// 路径映射(Vite proxy rewrite 去掉 /api/bff):
//   前端 /api/bff/admin/teams/*                     → BFF /admin/teams/*
//   前端 /api/bff/admin/projects/*                  → BFF /admin/projects/*(独立路径,对齐 intellect-team)
//   前端 /api/bff/admin/tenants/:id/binding         → BFF /admin/tenants/:id/binding
// 鉴权:authMiddleware(运维操作,非租户隔离,无 backendContextMiddleware)。
// 挂载点 '/' 与其他路由并列,路径前缀不冲突。
app.use('/admin/teams/*', authMiddleware);
app.use('/admin/projects/*', authMiddleware);
app.use('/admin/tenants/*', authMiddleware);
app.route('/', teamRoutes);
app.route('/', projectRoutes);
app.route('/', tenantBindingRoutes);

// spec-010 v8 B-3: Wizard 路由 /admin/wizard/*
// Constitution Principle I: 前端经 BFF Wizard 路由完成首次配置。
// 鉴权:
// - status/backend-types 公开(authMiddleware publicPrefixes)
// - probe/setup 走 authMiddleware(此处挂载)
// - setup 端点额外接受 bootstrap token(wizard.ts 内 wizardSetupAuth)
// 路径:前端 /api/bff/admin/wizard/* → Vite rewrite 去掉 /api/bff → BFF /admin/wizard/*
app.use('/admin/wizard/*', async (c, next) => {
  // 注入 BootstrapTokenManager 供 setup 端点使用
  c.set('bootstrapTokenManager' as never, bootstrapTokenManager as never);
  // 注入 TokenVault 供 setup 端点存储凭据(setCredentials)
  c.set('tokenVault' as never, tokenVault as never);
  await authMiddleware(c, next);
});
app.route('/', wizardRoutes);

const port = Number(process.env.BFF_PORT) || 9390;

// 启动 Store 加载(异步,不阻塞 serve 启动;加载完成前 list() 返回空数组)
harnessStore.load()
  .then(() => backendStore.load())
  .then(async () => {
    console.log(
      `[BFF] Stores loaded: ${harnessStore.list().length} backend(s), ${backendStore.listBackends().length} tenant(s)`,
    );

    // spec-010 v8 B-1 (B1 修复):首次安装检测到无后端配置时,生成 Bootstrap Token。
    // 供 /admin/wizard/setup 端点鉴权(无 admin token 时通过 bootstrap token 完成首个 backend 创建)。
    // 多实例部署(BOOTSTRAP_ENABLED=false)时不生成,强制要求 admin 鉴权。
    if (harnessStore.list().length === 0) {
      bootstrapTokenManager.generate();
    } else {
      // 已有后端配置时清理可能残留的 bootstrap token
      bootstrapTokenManager.invalidate();
    }

    // 改进 1 (P0):启动时校验 intellectTenantId 配置一致性。
    // 调用 intellect-team GET /api/tenant/info (改进 6 新增公开端点),
    // 比对 HarnessBackend.intellectTenantId 与实际 INTELLECT_TENANT_ID env var。
    // 不一致 → fail-fast (process.exit(1)),防止 TEAM/RAG 租户数据分裂。
    const ok = await validateTenantConfigs(harnessStore);
    if (!ok) {
      console.error('[BFF] FATAL: Tenant config validation failed, exiting.');
      process.exit(1);
    }

    // 方案 3 (P2):启动后台定期校验 tenant 配置(60s 周期)。
    // 与启动校验不同:后台校验不 fail-fast,仅更新 tenant-status 状态,
    // 由 /health/readiness 探针反映,K8s 摘除流量而非杀进程。
    // 立即执行一次,再 setInterval。
    const { validateTenantConfigsForStatus } = await import('./services/tenant-status-runner');
    validateTenantConfigsForStatus(harnessStore).catch(() => {});
    const tenantCheckTimer = setInterval(() => {
      validateTenantConfigsForStatus(harnessStore).catch(() => {});
    }, 60_000);
    tenantCheckTimer.unref(); // 不阻塞进程退出

    // 预热 RAG token(后台异步,失败不阻塞 BFF 启动)。
    // 方案 A (B6): 企业版(flag 开启)走 imt_,无需预热 RAG admin token。
    if (process.env.BFF_ENABLE_IMT_CANVAS_AGENTS !== 'true') {
      const { ragTokenProvider } = await import('./services/rag-token-provider');
      ragTokenProvider.login().catch(() => {});
    }
  })
  .catch((err) => {
    console.error('[BFF] FATAL: Failed to load stores, exiting:', err);
    // P1 改进:Store 加载失败应 fail-fast,避免 BFF 在半启动状态下接收请求
    // (所有依赖 stores 的路由会返回 500,浪费调试时间)
    process.exit(1);
  });

serve(
  { fetch: app.fetch, port },
  (info) => {
    console.log(`[BFF] OpenKG AgentUI BFF running on http://localhost:${info.port}`);
  },
);

export default app;
