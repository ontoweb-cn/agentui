// Multi-Harness P2 (US2):capabilities 路由单元测试
// Constitution Principle VII (Test-First):测试先于实现。
// 覆盖:合法 tenant 返回能力、tenant 不存在 404、缺失 header 400、Registry 未就绪 503。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { capabilitiesRoutes } from './capabilities';
import { backendContextMiddleware } from '../middleware/backend-context';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { IHarnessAdapter } from '../types/adapter';
import type { HarnessBackend, HarnessCapabilities } from '../types/harness';
import type { BffTenant } from '../types/tenant';
import {
  TenantNotFoundError,
  BackendNotConfiguredError,
} from '../services/adapter-registry-errors';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ragCapabilities: HarnessCapabilities = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: false,
  multiTenant: false,
  modelManagement: false,
};

const ragBackend: HarnessBackend = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG Default',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: ragCapabilities,
  adminToken: 'rag-token-secret',
};

const tenant1: BffTenant = {
  id: 'tenant-1',
  name: 'T1',
  intellectBackendId: 'intellect-rag-default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createFakeAdapter(backend: HarnessBackend): IHarnessAdapter {
  return {
    backendId: backend.id,
    adapterKind: 'multi-tenant' as const,
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    updateSession: vi.fn(),
    getSessionMessages: vi.fn(),
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    discoverCapabilities: vi.fn().mockResolvedValue(backend.capabilities),
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

interface MockSetup {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  registry: IAdapterRegistry;
  adapter: IHarnessAdapter;
}

function createMocks(
  options: {
    ready?: boolean;
    tenant?: BffTenant;
    backend?: HarnessBackend;
    adapter?: IHarnessAdapter;
  } = {},
): MockSetup {
  const ready = options.ready ?? true;
  const tenant = options.tenant ?? tenant1;
  const backend = options.backend ?? ragBackend;
  const adapter = options.adapter ?? createFakeAdapter(backend);

  const harnessStore: HarnessStore = {
    load: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(() => (ready ? [backend] : [])),
    get: vi.fn((id: string) => (id === backend.id ? backend : undefined)),
    saveConfig: vi.fn(),
  };

  const backendStore: BackendStore = {
    load: vi.fn().mockResolvedValue(undefined),
    getBackend: vi.fn((id: string) => (id === tenant.id ? tenant : undefined)),
    listBackends: vi.fn(() => (tenant ? [tenant] : [])),
    createBackend: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setAuthMode: vi.fn(),
    setCanvasBinding: vi.fn(),
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };

  const registry: IAdapterRegistry = {
    getAdapterForBackend: vi.fn(() => adapter),
    registerFactory: vi.fn(),
    isReady: vi.fn(() => ready),
    invalidate: vi.fn(),
    getCanvasBackendForBackend: vi.fn(() => adapter) as unknown as IAdapterRegistry['getCanvasBackendForBackend'],
  };

  return { harnessStore, backendStore, registry, adapter };
}

interface TestVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  backendContext?: { backendId: string; userId: string };
}

function createApp(mocks: MockSetup): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  // 模拟 index.ts 的中间件链:context 注入 → authMiddleware → backendContextMiddleware → route
  app.use('*', async (c, next) => {
    c.set('harnessStore', mocks.harnessStore);
    c.set('backendStore', mocks.backendStore);
    c.set('adapterRegistry', mocks.registry);
    await next();
  });
  app.use('/capabilities/*', backendContextMiddleware);
  // Cast:route 模块自带的 Variables 类型与测试 app 不完全一致(测试只读不写)。
  app.route('/', capabilitiesRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('capabilities 路由 (P2 US2)', () => {
  let mocks: MockSetup;
  let app: Hono<{ Variables: TestVariables }>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    app = createApp(mocks);
  });

  describe('GET /capabilities', () => {
    it('合法 tenant 返回 CapabilitiesResponse', async () => {
      const res = await app.request('/capabilities', {
        headers: {
          Authorization: 'Bearer test',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(body.data).toEqual({
        backendId: 'intellect-rag-default',
        backendName: 'Intellect RAG Default',
        backendType: 'intellect-rag',
        capabilities: ragCapabilities,
      });
      // Registry.getAdapterForBackend 被调用
      expect(mocks.registry.getAdapterForBackend).toHaveBeenCalledWith('tenant-1');
      // adapter.discoverCapabilities 被调用
      expect(mocks.adapter.discoverCapabilities).toHaveBeenCalled();
    });

    it('缺失 X-Backend-Id header 降级使用默认 tenant 并返回 200(P1 兼容)', async () => {
      const res = await app.request('/capabilities', {
        headers: {
          Authorization: 'Bearer test',
          'X-User-Id': 'user-1',
          // 缺 X-Backend-Id → 中间件降级到 '0'
        },
      });
      // P1 兼容:backendContextMiddleware 降级到默认 backendId='0',
      // mock registry 对任意 tenantId 返回 adapter,故返回 200。
      // 实际生产中 '0' tenant 不存在会返回 404,但中间件不阻断是设计意图。
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      // registry 传入降级后的 '0'(非 'tenant-1')
      expect(mocks.registry.getAdapterForBackend).toHaveBeenCalledWith('0');
    });

    it('缺失 X-User-Id header 降级使用默认 user 并返回 200(P1 兼容)', async () => {
      const res = await app.request('/capabilities', {
        headers: {
          Authorization: 'Bearer test',
          'X-Backend-Id': 'tenant-1',
          // 缺 X-User-Id → 中间件降级到 'bff-default'
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      // tenantId 仍为 'tenant-1'(X-Backend-Id 已传)
      expect(mocks.registry.getAdapterForBackend).toHaveBeenCalledWith('tenant-1');
    });

    it('tenant 不存在返回 404', async () => {
      // 让 registry.getAdapterForBackend 在 tenantId='nonexistent' 时抛 TenantNotFoundError
      mocks.registry.getAdapterForBackend = vi.fn((tid: string) => {
        if (tid === 'nonexistent') {
          throw new TenantNotFoundError(tid);
        }
        return mocks.adapter;
      });
      app = createApp(mocks);

      const res = await app.request('/capabilities', {
        headers: {
          Authorization: 'Bearer test',
          'X-Backend-Id': 'nonexistent',
          'X-User-Id': 'user-1',
        },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(404);
      // case-insensitive contains 'tenant'
      expect(body.message.toLowerCase()).toContain('tenant');
    });

    it('Registry 未就绪返回 503', async () => {
      mocks = createMocks({ ready: false });
      app = createApp(mocks);

      const res = await app.request('/capabilities', {
        headers: {
          Authorization: 'Bearer test',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe(503);
      expect(body.message).toContain('Registry');
    });

    it('tenant 绑定的 backendId 不存在返回 503(配置不一致)', async () => {
      // tenant 存在,但 backendId 在 HarnessStore 中找不到
      const tenantWithBadBackend: BffTenant = {
        ...tenant1,
        intellectBackendId: 'missing-backend',
      };
      mocks = createMocks({ tenant: tenantWithBadBackend });
      // getAdapterForBackend 抛 BackendNotConfiguredError(实际错误类)
      mocks.registry.getAdapterForBackend = vi.fn(() => {
        throw new BackendNotConfiguredError('missing-backend');
      });
      app = createApp(mocks);

      const res = await app.request('/capabilities', {
        headers: {
          Authorization: 'Bearer test',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
      });
      // 503:配置/基础设施问题(与 canvas.ts 保持一致)
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe(503);
    });
  });
});
