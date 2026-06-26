import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterRegistry } from './adapter-registry';
import {
  TenantNotFoundError,
  BackendNotConfiguredError,
  AdapterFactoryNotRegisteredError,
  RegistryNotReadyError,
} from './adapter-registry-errors';
import type { HarnessStore } from '../types/stores';
import type { TenantStore } from '../types/stores';
import type { HarnessBackend, HarnessCapabilities } from '../types/harness';
import type { BffTenant } from '../types/tenant';
import type { IHarnessAdapter } from '../types/adapter';

const ragCapabilities: HarnessCapabilities = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: true,
  multiTenant: false,
  modelManagement: true,
};

const ragBackend: HarnessBackend = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: ragCapabilities,
  adminToken: 'token-1',
};

const tenant1: BffTenant = {
  id: 'tenant-1',
  name: 'T1',
  intellectBackendId: 'intellect-rag-default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createMockHarnessStore(backends: HarnessBackend[], loaded = true): HarnessStore {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(() => (loaded ? backends : [])),
    get: vi.fn((id: string) => backends.find((b) => b.id === id)),
    saveConfig: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTenantStore(
  tenants: BffTenant[],
  loaded = true,
): TenantStore {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getTenant: vi.fn((id: string) =>
      loaded ? tenants.find((t) => t.id === id) : undefined,
    ),
    listTenants: vi.fn(() => (loaded ? tenants : [])),
    createTenant: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn((id: string) =>
      loaded ? tenants.find((t) => t.id === id)?.intellectBackendId : undefined,
    ),
    setCanvasBinding: vi.fn(),
    getCanvasBinding: vi.fn(),
  };
}

// Fake adapter for testing (避免依赖真实 IntellectRagAdapter)
function createFakeAdapter(backend: HarnessBackend): IHarnessAdapter {
  return {
    backendId: backend.id,
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    healthCheck: vi.fn(),
    discoverCapabilities: vi.fn(),
  };
}

describe('AdapterRegistry', () => {
  let harnessStore: HarnessStore;
  let tenantStore: TenantStore;
  let registry: AdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    harnessStore = createMockHarnessStore([ragBackend]);
    tenantStore = createMockTenantStore([tenant1]);
    registry = new AdapterRegistry(harnessStore, tenantStore);
    registry.registerFactory('intellect-rag', createFakeAdapter);
  });

  describe('isReady', () => {
    it('Store 已加载时返回 true', () => {
      expect(registry.isReady()).toBe(true);
    });

    it('Store 未加载(backends 为空)时返回 false', () => {
      const emptyStore = createMockHarnessStore([], false);
      const r = new AdapterRegistry(emptyStore, tenantStore);
      expect(r.isReady()).toBe(false);
    });
  });

  describe('getAdapterForTenant', () => {
    it('合法 tenantId 返回 Adapter 实例', () => {
      const adapter = registry.getAdapterForTenant('tenant-1');
      expect(adapter).toBeDefined();
      expect(adapter.backendId).toBe('intellect-rag-default');
    });

    it('同一 tenantId 多次调用返回同一 Adapter 实例(复用,===)', () => {
      const a1 = registry.getAdapterForTenant('tenant-1');
      const a2 = registry.getAdapterForTenant('tenant-1');
      expect(a1).toBe(a2);
    });

    it('不同 tenantId 绑定同一 backend 返回同一 Adapter 实例', () => {
      const tenant2: BffTenant = {
        id: 'tenant-2',
        name: 'T2',
        intellectBackendId: 'intellect-rag-default',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const ts = createMockTenantStore([tenant1, tenant2]);
      const r = new AdapterRegistry(harnessStore, ts);
      r.registerFactory('intellect-rag', createFakeAdapter);
      const a1 = r.getAdapterForTenant('tenant-1');
      const a2 = r.getAdapterForTenant('tenant-2');
      expect(a1).toBe(a2); // 同 backendId → 同实例
    });

    it('tenantId 不存在抛 TenantNotFoundError', () => {
      expect(() => registry.getAdapterForTenant('nonexistent')).toThrow(
        TenantNotFoundError,
      );
    });

    it('tenant 绑定的 backendId 不存在抛 BackendNotConfiguredError', () => {
      const tenantWithBadBackend: BffTenant = {
        id: 'tenant-bad',
        name: 'TBad',
        intellectBackendId: 'missing-backend',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const ts = createMockTenantStore([tenantWithBadBackend]);
      const r = new AdapterRegistry(harnessStore, ts);
      r.registerFactory('intellect-rag', createFakeAdapter);
      expect(() => r.getAdapterForTenant('tenant-bad')).toThrow(
        BackendNotConfiguredError,
      );
    });

    it('backendType 无对应 factory 抛 AdapterFactoryNotRegisteredError', () => {
      const enterpriseBackend: HarnessBackend = {
        ...ragBackend,
        id: 'intellect-enterprise-1',
        type: 'intellect-enterprise',
        capabilities: { ...ragCapabilities, canvas: false, multiTenant: true },
      };
      const hs = createMockHarnessStore([enterpriseBackend]);
      const tenantEnterprise: BffTenant = {
        id: 'tenant-ent',
        name: 'TEnt',
        intellectBackendId: 'intellect-enterprise-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const ts = createMockTenantStore([tenantEnterprise]);
      const r = new AdapterRegistry(hs, ts);
      // 不注册 intellect-enterprise factory
      r.registerFactory('intellect-rag', createFakeAdapter);
      expect(() => r.getAdapterForTenant('tenant-ent')).toThrow(
        AdapterFactoryNotRegisteredError,
      );
    });

    it('Store 未就绪抛 RegistryNotReadyError', () => {
      const emptyStore = createMockHarnessStore([], false);
      const r = new AdapterRegistry(emptyStore, tenantStore);
      r.registerFactory('intellect-rag', createFakeAdapter);
      expect(() => r.getAdapterForTenant('tenant-1')).toThrow(
        RegistryNotReadyError,
      );
    });
  });

  describe('getAdapterForBackend', () => {
    it('按 backendId 直接获取 Adapter(canvas 硬绑定场景,Principle III)', () => {
      const adapter = registry.getAdapterForBackend('intellect-rag-default');
      expect(adapter).toBeDefined();
      expect(adapter.backendId).toBe('intellect-rag-default');
    });

    it('同一 backendId 多次调用返回同一实例(复用)', () => {
      const a1 = registry.getAdapterForBackend('intellect-rag-default');
      const a2 = registry.getAdapterForBackend('intellect-rag-default');
      expect(a1).toBe(a2);
    });

    it('backendId 不存在抛 BackendNotConfiguredError', () => {
      expect(() => registry.getAdapterForBackend('missing')).toThrow(
        BackendNotConfiguredError,
      );
    });
  });

  describe('registerFactory', () => {
    it('注册后立即生效', () => {
      const r = new AdapterRegistry(harnessStore, tenantStore);
      r.registerFactory('intellect-rag', createFakeAdapter);
      expect(() => r.getAdapterForTenant('tenant-1')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // P2: invalidate() 缓存失效
  // -------------------------------------------------------------------------

  describe('invalidate (P2)', () => {
    it('invalidate(backendId) 移除单条缓存,下次 getAdapterForBackend 创建新实例', () => {
      const a1 = registry.getAdapterForBackend('intellect-rag-default');
      expect(a1).toBeDefined();

      registry.invalidate('intellect-rag-default');

      const a2 = registry.getAdapterForBackend('intellect-rag-default');
      expect(a2).toBeDefined();
      // 新实例,!== 旧实例(旧缓存已失效)
      expect(a2).not.toBe(a1);
    });

    it('invalidate(backendId) 不影响其他 backendId 的缓存', () => {
      const backend2: HarnessBackend = {
        ...ragBackend,
        id: 'intellect-rag-second',
      };
      const hs = createMockHarnessStore([ragBackend, backend2]);
      const r = new AdapterRegistry(hs, tenantStore);
      r.registerFactory('intellect-rag', createFakeAdapter);

      const a1Default = r.getAdapterForBackend('intellect-rag-default');
      const a1Second = r.getAdapterForBackend('intellect-rag-second');

      // 只失效 default
      r.invalidate('intellect-rag-default');

      const a2Default = r.getAdapterForBackend('intellect-rag-default');
      const a2Second = r.getAdapterForBackend('intellect-rag-second');

      // default 失效,新实例
      expect(a2Default).not.toBe(a1Default);
      // second 未失效,同实例
      expect(a2Second).toBe(a1Second);
    });

    it('invalidate() 不传参清空整个缓存', () => {
      const backend2: HarnessBackend = {
        ...ragBackend,
        id: 'intellect-rag-second',
      };
      const hs = createMockHarnessStore([ragBackend, backend2]);
      const r = new AdapterRegistry(hs, tenantStore);
      r.registerFactory('intellect-rag', createFakeAdapter);

      const a1Default = r.getAdapterForBackend('intellect-rag-default');
      const a1Second = r.getAdapterForBackend('intellect-rag-second');

      // 清空整个缓存
      r.invalidate();

      const a2Default = r.getAdapterForBackend('intellect-rag-default');
      const a2Second = r.getAdapterForBackend('intellect-rag-second');

      expect(a2Default).not.toBe(a1Default);
      expect(a2Second).not.toBe(a1Second);
    });

    it('invalidate(unknownBackendId) 无副作用,不抛异常', () => {
      expect(() => registry.invalidate('nonexistent')).not.toThrow();
      // 已缓存的实例仍可用
      const a1 = registry.getAdapterForBackend('intellect-rag-default');
      registry.invalidate('nonexistent');
      const a2 = registry.getAdapterForBackend('intellect-rag-default');
      expect(a2).toBe(a1); // 未被清掉
    });

    it('invalidate 后 getAdapterForTenant 也创建新实例', () => {
      const a1 = registry.getAdapterForTenant('tenant-1');
      registry.invalidate('intellect-rag-default');
      const a2 = registry.getAdapterForTenant('tenant-1');
      expect(a2).not.toBe(a1);
    });
  });
});
