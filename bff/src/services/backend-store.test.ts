// Multi-Harness P1:BackendStore 单元测试(research.md §4 P1 硬前置)
// 覆盖 load() 边界 + createTenant/setHarnessBinding/setCanvasBinding 校验逻辑。
// 重点关注 Constitution Principle III:canvasBackendId 必须是 intellect-rag 类型。
// 用 mock HarnessStore(实现 interface)避免真实 fs 依赖耦合。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { HarnessBackend, HarnessStore, HarnessBackendConfig } from '../types';

// vi.hoisted 保证 mock 对象在 vi.mock 工厂执行前已定义
const { mockFs } = vi.hoisted(() => ({
  mockFs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock('node:fs', () => mockFs);

import { JSONFileBackendStore } from './backend-store';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ragBackend: HarnessBackend = {
  id: 'intellect-rag-default',
  name: 'Default Intellect RAG',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  adminToken: 'rag-token',
  capabilities: {
    canvas: true,
    knowledgeBase: true,
    memory: true,
    mcp: false,
    multiTenant: false,
    modelManagement: false,
  },
  defaultForTenant: true,
};

const enterpriseBackend: HarnessBackend = {
  id: 'intellect-enterprise-1',
  name: 'Intellect Enterprise',
  type: 'intellect-enterprise',
  endpoint: 'http://localhost:9381',
  adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY',
  adminToken: 'enterprise-key',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: true,
    mcp: false,
    multiTenant: true,
    modelManagement: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockHarnessStore(backends: HarnessBackend[] = []): HarnessStore {
  return {
    list: vi.fn(() => backends),
    get: vi.fn((id: string) => backends.find((b) => b.id === id)),
    load: vi.fn(async () => undefined),
    saveConfig: vi.fn(async (_configs: HarnessBackendConfig[]) => undefined),
  };
}

function setTenantsFile(content: unknown): void {
  mockFs.existsSync.mockReturnValue(true);
  mockFs.readFileSync.mockReturnValue(typeof content === 'string' ? content : JSON.stringify(content));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JSONFileBackendStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mock 全局 console(Store 用全局 console,不是 node:console 模块)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // load() edge cases
  // -------------------------------------------------------------------------

  describe('load() edge cases', () => {
    it('文件不存在时返回空数组,不抛异常', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(store.load()).resolves.toBeUndefined();
      expect(store.listBackends()).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Tenants file not found'),
      );
    });

    it('JSON 解析失败时返回空数组,不抛异常', async () => {
      setTenantsFile('not a valid json {{{');
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(store.load()).resolves.toBeUndefined();
      expect(store.listBackends()).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse JSON'),
      );
    });

    it('schema 校验失败时返回空数组,不抛异常', async () => {
      // 缺少必填字段 intellectBackendId
      setTenantsFile({
        tenants: [{ id: 't1', name: 'T1', createdAt: 'x', updatedAt: 'x' }],
      });
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await store.load();
      expect(store.listBackends()).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid tenants schema'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // load() 绑定关系校验(Constitution Principle V + III)
  // -------------------------------------------------------------------------

  describe('load() 绑定关系校验', () => {
    it('intellectBackendId 引用不存在时抛出明确错误', async () => {
      setTenantsFile({
        tenants: [
          {
            id: 't1',
            name: 'T1',
            intellectBackendId: 'non-existent-backend',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      const harnessStore = createMockHarnessStore([ragBackend]); // 只有 rag,没有 non-existent
      const store = new JSONFileBackendStore(harnessStore);

      await expect(store.load()).rejects.toThrow(
        /Backend not configured: non-existent-backend/,
      );
    });

    it('canvasBackendId 引用不存在时抛出明确错误', async () => {
      setTenantsFile({
        tenants: [
          {
            id: 't1',
            name: 'T1',
            intellectBackendId: 'intellect-rag-default',
            canvasBackendId: 'non-existent-canvas',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(store.load()).rejects.toThrow(
        /Backend not configured: non-existent-canvas/,
      );
    });

    it('canvasBackendId 类型非 intellect-rag 时抛出明确错误(Principle III)', async () => {
      setTenantsFile({
        tenants: [
          {
            id: 't1',
            name: 'T1',
            intellectBackendId: 'intellect-rag-default',
            canvasBackendId: 'intellect-enterprise-1', // enterprise 不能当 canvas
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      const harnessStore = createMockHarnessStore([ragBackend, enterpriseBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(store.load()).rejects.toThrow(
        /has invalid type intellect-enterprise, expected intellect-rag/,
      );
    });

    it('canvasBackendId 是 intellect-rag 类型时正常加载', async () => {
      setTenantsFile({
        tenants: [
          {
            id: 't1',
            name: 'T1',
            intellectBackendId: 'intellect-rag-default',
            canvasBackendId: 'intellect-rag-default', // 同一个 rag 后端当 canvas
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await store.load();
      expect(store.listBackends()).toHaveLength(1);
      expect(store.getBackend('t1')?.canvasBackendId).toBe('intellect-rag-default');
    });
  });

  // -------------------------------------------------------------------------
  // load() 正常路径
  // -------------------------------------------------------------------------

  describe('load() 正常路径', () => {
    it('加载多个 tenant', async () => {
      setTenantsFile({
        tenants: [
          {
            id: 't1',
            name: 'Tenant 1',
            intellectBackendId: 'intellect-rag-default',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 't2',
            name: 'Tenant 2',
            intellectBackendId: 'intellect-enterprise-1',
            intellectTenantId: 'intellect-tenant-xyz',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      });
      const harnessStore = createMockHarnessStore([ragBackend, enterpriseBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await store.load();

      const tenants = store.listBackends();
      expect(tenants).toHaveLength(2);
      expect(tenants[0].name).toBe('Tenant 1');
      expect(tenants[1].intellectTenantId).toBe('intellect-tenant-xyz');
    });
  });

  // -------------------------------------------------------------------------
  // createTenant()
  // -------------------------------------------------------------------------

  describe('createTenant()', () => {
    it('backendId 不存在时抛出错误', async () => {
      mockFs.existsSync.mockReturnValue(false); // load 不读文件
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(
        store.createBackend('New Tenant', 'non-existent-backend'),
      ).rejects.toThrow(
        /Backend not configured: non-existent-backend/,
      );
    });

    it('正常创建 tenant,生成 UUID + 时间戳 + 持久化', async () => {
      mockFs.existsSync.mockReturnValue(true); // DATA_DIR 已存在
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      const before = new Date().toISOString();
      const tenant = await store.createBackend(
        'New Tenant',
        'intellect-rag-default',
        'intellect-tenant-001',
      );
      const after = new Date().toISOString();

      expect(tenant.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(tenant.name).toBe('New Tenant');
      expect(tenant.intellectBackendId).toBe('intellect-rag-default');
      expect(tenant.intellectTenantId).toBe('intellect-tenant-001');
      expect(tenant.createdAt).toBe(tenant.updatedAt);
      expect(tenant.createdAt >= before).toBe(true);
      expect(tenant.createdAt <= after).toBe(true);

      // 持久化被调用
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      // 新 tenant 已在内存中
      expect(store.getBackend(tenant.id)?.name).toBe('New Tenant');
    });

    it('不传 intellectTenantId 时该字段为 undefined', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      const tenant = await store.createBackend('T', 'intellect-rag-default');

      expect(tenant.intellectTenantId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // setHarnessBinding()
  // -------------------------------------------------------------------------

  describe('setHarnessBinding()', () => {
    it('tenant 不存在时抛出错误', async () => {
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(
        store.setHarnessBinding('non-existent-tenant', 'intellect-rag-default'),
      ).rejects.toThrow(/Tenant not found: non-existent-tenant/);
    });

    it('backend 不存在时抛出错误', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      await expect(
        store.setHarnessBinding(tenant.id, 'non-existent-backend'),
      ).rejects.toThrow(/Backend not configured: non-existent-backend/);
    });

    it('正常更新 binding 并刷新 updatedAt', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend, enterpriseBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');
      const originalUpdatedAt = tenant.updatedAt;

      // 等待时间戳精度
      await new Promise((r) => setTimeout(r, 10));

      await store.setHarnessBinding(tenant.id, 'intellect-enterprise-1');

      const updated = store.getBackend(tenant.id);
      expect(updated?.intellectBackendId).toBe('intellect-enterprise-1');
      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
      expect(mockFs.writeFileSync).toHaveBeenCalled(); // persist 被调用
    });
  });

  // -------------------------------------------------------------------------
  // setCanvasBinding() - Constitution Principle III 强制校验
  // -------------------------------------------------------------------------

  describe('setCanvasBinding() Principle III 强制校验', () => {
    it('tenant 不存在时抛出错误', async () => {
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(
        store.setCanvasBinding('non-existent-tenant', 'intellect-rag-default'),
      ).rejects.toThrow(/Tenant not found: non-existent-tenant/);
    });

    it('backend 不存在时抛出错误', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      await expect(
        store.setCanvasBinding(tenant.id, 'non-existent-canvas'),
      ).rejects.toThrow(/Backend not configured: non-existent-canvas/);
    });

    it('backend 类型非 intellect-rag 时抛出错误(Principle III)', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend, enterpriseBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      await expect(
        store.setCanvasBinding(tenant.id, 'intellect-enterprise-1'),
      ).rejects.toThrow(
        /has invalid type intellect-enterprise, expected intellect-rag/,
      );
    });

    it('backend 类型是 intellect-rag 时正常更新 canvas binding', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      await store.setCanvasBinding(tenant.id, 'intellect-rag-default');

      expect(store.getCanvasBinding(tenant.id)).toBe('intellect-rag-default');
    });
  });

  // -------------------------------------------------------------------------
  // setIntellectBinding() - P5 Team/Project 绑定
  // -------------------------------------------------------------------------

  describe('setIntellectBinding() P5 Team/Project 绑定', () => {
    it('tenant 不存在时抛出错误', async () => {
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await expect(
        store.setIntellectBinding('non-existent-tenant', 'team-1'),
      ).rejects.toThrow(/Tenant not found: non-existent-tenant/);
    });

    it('设置真实 team_id + project_id 正常更新绑定', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      await store.setIntellectBinding(tenant.id, 'team-abc', 'project-xyz');

      expect(store.getIntellectTeamId(tenant.id)).toBe('team-abc');
      expect(store.getIntellectProjectId(tenant.id)).toBe('project-xyz');
    });

    it('intellectTenantId=undefined → 回退缺省 "0"(不注入 X-Intellect-Team)', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default', 'team-old');

      await store.setIntellectBinding(tenant.id, undefined);

      // getIntellectTeamId 对 "0" 返回 undefined(中间件据此不注入头)
      expect(store.getIntellectTeamId(tenant.id)).toBeUndefined();
    });

    it('intellectProjectId=undefined → 清除 project 绑定', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');
      await store.setIntellectBinding(tenant.id, 'team-1', 'project-1');

      // 解绑 project
      await store.setIntellectBinding(tenant.id, 'team-1', undefined);

      expect(store.getIntellectProjectId(tenant.id)).toBeUndefined();
    });

    it('getIntellectTeamId 对未绑定 tenant 返回 undefined', () => {
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      expect(store.getIntellectTeamId('non-existent')).toBeUndefined();
      expect(store.getIntellectProjectId('non-existent')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getHarnessBinding / getCanvasBinding 查询
  // -------------------------------------------------------------------------

  describe('getHarnessBinding / getCanvasBinding 查询', () => {
    it('getHarnessBinding 返回 tenant.intellectBackendId', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      expect(store.getHarnessBinding(tenant.id)).toBe('intellect-rag-default');
    });

    it('未设置 canvas binding 时 getCanvasBinding 返回 undefined', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);
      const tenant = await store.createBackend('T', 'intellect-rag-default');

      expect(store.getCanvasBinding(tenant.id)).toBeUndefined();
    });

    it('tenant 不存在时 getHarnessBinding/getCanvasBinding 返回 undefined', () => {
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      expect(store.getHarnessBinding('non-existent')).toBeUndefined();
      expect(store.getCanvasBinding('non-existent')).toBeUndefined();
    });

    it('未调用 load() 时 listBackends 返回空数组', () => {
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      expect(store.listBackends()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // persist() - DATA_DIR 不存在时创建目录
  // -------------------------------------------------------------------------

  describe('persist() 目录创建', () => {
    it('DATA_DIR 不存在时先创建目录再写文件', async () => {
      mockFs.existsSync.mockReturnValue(false); // DATA_DIR 不存在
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await store.createBackend('T', 'intellect-rag-default');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('持久化内容包含 tenants 数组结构', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const harnessStore = createMockHarnessStore([ragBackend]);
      const store = new JSONFileBackendStore(harnessStore);

      await store.createBackend('T', 'intellect-rag-default');

      const [, content] = (mockFs.writeFileSync as Mock).mock.calls[0];
      const parsed = JSON.parse(content as string);
      expect(parsed).toHaveProperty('tenants');
      expect(parsed.tenants).toHaveLength(1);
      expect(parsed.tenants[0].name).toBe('T');
    });
  });
});
