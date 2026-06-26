import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { tenantContextMiddleware } from './middleware/tenant-context';
import { errorHandler } from './middleware/error';
import { adminRoutes } from './routes/admin';
import { agentRoutes } from './routes/agent';
import { bffAgentRoutes } from './routes/bff-agents';
import { capabilitiesRoutes } from './routes/capabilities';
import { harnessAdminRoutes } from './routes/harness-admin';
import { sessionRoutes } from './routes/session';
import { healthRoutes } from './routes/health';
import { proxyRoutes } from './routes/proxy';
import { JSONFileHarnessStore } from './services/harness-store';
import { JSONFileTenantStore } from './services/tenant-store';
import { AdapterRegistry } from './services/adapter-registry';
import { IntellectRagAdapter } from './services/adapters/intellect-rag/intellect-rag-adapter';
import type { HarnessStore, TenantStore } from './types';
import type { TenantContext } from './types/tenant';

// Hono context variables type (for c.set / c.get)
interface AppVariables {
  harnessStore: HarnessStore;
  tenantStore: TenantStore;
  adapterRegistry: AdapterRegistry;
  tenantContext?: TenantContext;
}

const app = new Hono<{ Variables: AppVariables }>();

// Multi-Harness P0 Phase 5 + P1 US3:启动时初始化 Store + Registry。
// Constitution Principle V (Tenant Isolation) + Principle II (Adapter Abstraction)。
// 必须在所有路由注册之前,确保 context 注入中间件先于路由处理执行。
const harnessStore: HarnessStore = new JSONFileHarnessStore();
const tenantStore: TenantStore = new JSONFileTenantStore(harnessStore);
const adapterRegistry = new AdapterRegistry(harnessStore, tenantStore);
adapterRegistry.registerFactory(
  'intellect-rag',
  (backend) => new IntellectRagAdapter(backend),
);

// Global middleware
app.use('*', logger());
app.use('*', cors());
app.use('*', errorHandler);

// 将 store + registry 实例存到 Hono context(必须在路由注册之前挂载,
// 否则路由处理时 c.get('harnessStore') 等返回 undefined)
app.use('*', async (c, next) => {
  c.set('harnessStore', harnessStore);
  c.set('tenantStore', tenantStore);
  c.set('adapterRegistry', adapterRegistry);
  await next();
});

// Health check (no auth required)
app.route('/health', healthRoutes);

// Auth-protected routes
app.use('/api/*', authMiddleware);
app.route('/api/agent', agentRoutes);
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
app.use('/proxy/*', authMiddleware);
app.route('/', proxyRoutes);

// Multi-Harness P1 (US3): BFF Agent 原生路由 /agents/*
// Constitution Principle I + II: 前端经 BFF 原生路由调 Adapter,不直连 Intellect RAG。
// 路径:前端 /api/bff/agents → Vite proxy rewrite 去掉 /api/bff → BFF 收到 /agents
//       → bffAgentRoutes 匹配 /agents/* → adapter.listAgents / getAgent / sessions CRUD
// US3:通过 AdapterRegistry.getAdapterForTenant(tenantId) 选择 Adapter。
// Canvas DSL 编辑(POST/PUT/DELETE agents)保留透传(Principle III Layer 3)。
// TenantContext 中间件仅挂载到 /agents/* (US3),不影响 /proxy/v1/* 透传路由。
// 挂载点 '/' 与 proxyRoutes 并列,路径前缀不冲突(/agents/* vs /proxy/v1/*)。
app.use('/agents/*', authMiddleware);
app.use('/agents/*', tenantContextMiddleware);
app.route('/', bffAgentRoutes);

// Multi-Harness P2 (US1): Harness Admin 路由 /admin/harness-backends/*
// Constitution Principle I + V (非租户隔离) + Token Security。
// 路径:前端 /api/bff/admin/harness-backends → Vite proxy rewrite 去掉 /api/bff
//       → BFF 收到 /admin/harness-backends → harnessAdminRoutes 匹配
// 鉴权:authMiddleware(运维操作,非租户隔离,无 tenantContextMiddleware)。
// 挂载点 '/' 与 bffAgentRoutes 并列,路径前缀不冲突(/admin/harness-backends vs /agents)。
app.use('/admin/harness-backends/*', authMiddleware);
app.route('/', harnessAdminRoutes);

// Multi-Harness P2 (US2): Capabilities 路由 /capabilities/*
// Constitution Principle I + II + V + VIII: 前端经 BFF 查询能力,按 tenant 隔离。
// 路径:前端 /api/bff/capabilities → Vite proxy rewrite 去掉 /api/bff
//       → BFF 收到 /capabilities → capabilitiesRoutes 匹配
// 中间件:authMiddleware + tenantContextMiddleware(注入 tenantId/userId)。
// 挂载点 '/' 与其他路由并列,路径前缀不冲突(/capabilities vs /agents vs /admin)。
app.use('/capabilities/*', authMiddleware);
app.use('/capabilities/*', tenantContextMiddleware);
app.route('/', capabilitiesRoutes);

const port = Number(process.env.BFF_PORT) || 9390;

// 启动 Store 加载(异步,不阻塞 serve 启动;加载完成前 list() 返回空数组)
harnessStore.load()
  .then(() => tenantStore.load())
  .then(() => {
    console.log(
      `[BFF] Stores loaded: ${harnessStore.list().length} backend(s), ${tenantStore.listTenants().length} tenant(s)`,
    );
  })
  .catch((err) => {
    console.error('[BFF] Failed to load stores:', err);
    // 不退出进程:Store 加载失败不应阻塞 BFF 启动(现有路由仍可用)
  });

serve(
  { fetch: app.fetch, port },
  (info) => {
    console.log(`[BFF] OpenKG AgentUI BFF running on http://localhost:${info.port}`);
  },
);

export default app;
