// Multi-Harness P2 (US1):harness-admin 路由单元测试
// Constitution Principle VII (Test-First):测试先于实现。
// 覆盖 CRUD 全流程 + 校验规则 + Token Security + 热加载 + 缓存失效。
// Mock HarnessStore + BackendStore + AdapterRegistry,隔离路由层逻辑。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Hono } from 'hono';
import { harnessAdminRoutes } from './harness-admin';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type {
  HarnessBackend,
  HarnessBackendConfig,
  HarnessCapabilities,
} from '../types/harness';
import type { BffTenant } from '../types/tenant';
import type { HarnessStoreListConfigs } from '../types/harness-admin';
// spec-010 v8 修改 6 (D2):测试需要操作 RunRegistry 状态
import {
  registerRun,
  markRunCompleted,
  _clearRunRegistryForTests,
} from '../services/run-registry';

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

const ragConfig: HarnessBackendConfig = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG Default',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: ragCapabilities,
  defaultForTenant: true,
};

const ragBackend: HarnessBackend = {
  ...ragConfig,
  adminToken: 'rag-token-secret',
};

const tenant1: BffTenant = {
  id: 'tenant-1',
  name: 'T1',
  intellectBackendId: 'intellect-rag-default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validForm = {
  id: 'intellect-rag-new',
  name: 'New Backend',
  type: 'intellect-rag' as const,
  endpoint: 'http://localhost:9382',
  adminTokenEnvVar: 'HARNESS_NEW_TOKEN',
  capabilities: ragCapabilities,
  defaultForTenant: false,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

interface MockStores {
  harnessStore: HarnessStore & HarnessStoreListConfigs;
  backendStore: BackendStore;
  registry: IAdapterRegistry;
  loadMock: Mock;
  saveConfigMock: Mock;
  invalidateMock: Mock;
  setHarnessBindingMock: Mock;
  setCanvasBindingMock: Mock;
}

function createMockStores(
  configs: HarnessBackendConfig[] = [ragConfig],
  backends: HarnessBackend[] = [ragBackend],
  tenants: BffTenant[] = [tenant1],
): MockStores {
  const loadMock = vi.fn().mockResolvedValue(undefined);
  const saveConfigMock = vi.fn().mockResolvedValue(undefined);
  const invalidateMock = vi.fn();
  const setHarnessBindingMock = vi.fn().mockResolvedValue(undefined);
  const setCanvasBindingMock = vi.fn().mockResolvedValue(undefined);

  const harnessStore: HarnessStore & HarnessStoreListConfigs = {
    load: loadMock,
    list: vi.fn(() => backends),
    get: vi.fn((id: string) => backends.find((b) => b.id === id)),
    saveConfig: saveConfigMock,
    listConfigs: vi.fn(() => configs),
  };

  const backendStore: BackendStore = {
    load: vi.fn().mockResolvedValue(undefined),
    getBackend: vi.fn((id: string) => tenants.find((t) => t.id === id)),
    listBackends: vi.fn(() => tenants),
    createBackend: vi.fn(),
    setHarnessBinding: setHarnessBindingMock,
    getHarnessBinding: vi.fn((id: string) =>
      tenants.find((t) => t.id === id)?.intellectBackendId,
    ),
    setCanvasBinding: setCanvasBindingMock,
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };

  const registry: IAdapterRegistry = {
    getAdapterForBackend: vi.fn(),
    registerFactory: vi.fn(),
    isReady: vi.fn(() => true),
    invalidate: invalidateMock,
    getCanvasBackendForBackend: vi.fn() as unknown as IAdapterRegistry['getCanvasBackendForBackend'],
  };

  return {
    harnessStore,
    backendStore,
    registry,
    loadMock,
    saveConfigMock,
    invalidateMock,
    setHarnessBindingMock,
    setCanvasBindingMock,
  };
}

interface TestVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
}

function createApp(stores: MockStores): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('harnessStore', stores.harnessStore as HarnessStore);
    c.set('backendStore', stores.backendStore);
    c.set('adapterRegistry', stores.registry);
    await next();
  });
  app.route('/', harnessAdminRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('harness-admin 路由 (P2 US1)', () => {
  let stores: MockStores;
  let app: Hono<{ Variables: TestVariables }>;

  beforeEach(() => {
    vi.clearAllMocks();
    // spec-010 v8 修改 6 (D2):清空 RunRegistry,隔离测试
    _clearRunRegistryForTests();
    stores = createMockStores();
    app = createApp(stores);
  });

  // -------------------------------------------------------------------------
  // GET /admin/harness-backends (list)
  // -------------------------------------------------------------------------

  describe('GET /admin/harness-backends', () => {
    it('返回所有后端配置 + ready 状态', async () => {
      const res = await app.request('/admin/harness-backends', {
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: 'intellect-rag-default',
        ready: true,
      });
      // ready 字段存在
      expect(typeof body.data[0].ready).toBe('boolean');
    });

    it('ready 状态反映 env token 是否就绪(未就绪的也列出)', async () => {
      // 配置列表含 2 个,但 list()(就绪的)只有 1 个
      const unreadyConfig: HarnessBackendConfig = {
        id: 'intellect-enterprise-1',
        name: 'Enterprise (no env)',
        type: 'intellect-enterprise',
        endpoint: 'http://localhost:8642',
        adminTokenEnvVar: 'HARNESS_ENTERPRISE_KEY',
        capabilities: { ...ragCapabilities, canvas: false, multiTenant: true },
      };
      stores = createMockStores(
        [ragConfig, unreadyConfig],
        [ragBackend], // 只有 ragBackend 就绪
        [tenant1],
      );
      app = createApp(stores);

      const res = await app.request('/admin/harness-backends', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      const ready = body.data.find((b: { id: string }) => b.id === 'intellect-rag-default');
      const unready = body.data.find((b: { id: string }) => b.id === 'intellect-enterprise-1');
      expect(ready.ready).toBe(true);
      expect(unready.ready).toBe(false);
    });

    it('响应不含 adminToken 明文(Token Security)', async () => {
      const res = await app.request('/admin/harness-backends', {
        headers: { Authorization: 'Bearer test' },
      });
      const text = await res.text();
      expect(text).not.toContain('"adminToken":');
      expect(text).not.toContain('rag-token-secret');
      // 应含 adminTokenEnvVar 引用
      expect(text).toContain('"adminTokenEnvVar"');
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/harness-backends (create)
  // -------------------------------------------------------------------------

  describe('POST /admin/harness-backends', () => {
    it('合法表单新增成功,触发 saveConfig + load 热加载 + invalidate', async () => {
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validForm),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(body.data.id).toBe('intellect-rag-new');
      expect(body.data.ready).toBe(false); // env 未设置,未就绪

      // saveConfig 被调用,包含新配置
      expect(stores.saveConfigMock).toHaveBeenCalledTimes(1);
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0];
      expect(savedConfigs.find((c: HarnessBackendConfig) => c.id === 'intellect-rag-new')).toBeDefined();

      // load 被调用(热加载)
      expect(stores.loadMock).toHaveBeenCalledTimes(1);

      // invalidate 被调用(新后端 invalidate no-op,但调用统一接口)
      expect(stores.invalidateMock).toHaveBeenCalledWith('intellect-rag-new');
    });

    it('id 重复时返回 409', async () => {
      const duplicateForm = { ...validForm, id: 'intellect-rag-default' };
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(duplicateForm),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe(409);
      expect(body.message).toContain('已存在');
      // 不应触发 saveConfig
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('id 非 kebab-case 时返回 400', async () => {
      const badForm = { ...validForm, id: 'Invalid_ID' };
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(badForm),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(400);
      expect(body.message).toContain('kebab-case');
    });

    it('endpoint 非法 URL 时返回 400', async () => {
      const badForm = { ...validForm, endpoint: 'not-a-url' };
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(badForm),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(400);
      expect(body.message).toContain('endpoint');
    });

    // 注:原 "adminTokenEnvVar 非法格式时返回 400" 测试已删除(adminTokenEnvVar 不再必填,
    // BFF 自动生成 HARNESS_<ID>_TOKEN,前端传入的值会被路由层忽略,不再走校验)。

    it('type 非 intellect-rag/intellect-enterprise 时返回 400', async () => {
      const badForm = { ...validForm, type: 'invalid-type' };
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(badForm),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(400);
      expect(body.message).toContain('type');
    });

    it('响应不含 adminToken 明文(即使有也不暴露)', async () => {
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validForm),
      });
      const text = await res.text();
      expect(text).not.toContain('"adminToken":');
    });

    // -------------------------------------------------------------------------
    // adminTokenEnvVar 自动生成测试(任务:移除必填,BFF 自动生成 HARNESS_<ID>_TOKEN)
    // -------------------------------------------------------------------------

    it('POST 自动生成 adminTokenEnvVar = HARNESS_<ID>_TOKEN(忽略 body 中的值)', async () => {
      // validForm.adminTokenEnvVar='HARNESS_NEW_TOKEN',但 BFF 应忽略并生成 HARNESS_INTELLECT_RAG_NEW_TOKEN
      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validForm),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // 基于 form.id 自动生成,而非 body.adminTokenEnvVar
      expect(body.data.adminTokenEnvVar).toBe('HARNESS_INTELLECT_RAG_NEW_TOKEN');
      expect(body.data.adminTokenEnvVar).not.toBe('HARNESS_NEW_TOKEN');

      const savedConfigs = stores.saveConfigMock.mock.calls[0][0];
      const saved = savedConfigs.find((c: HarnessBackendConfig) => c.id === 'intellect-rag-new');
      expect(saved.adminTokenEnvVar).toBe('HARNESS_INTELLECT_RAG_NEW_TOKEN');
    });

    it('POST 前端传入 adminTokenEnvVar 时记录 warn 并覆盖为 HARNESS_<ID>_TOKEN', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const formWithVar = { ...validForm, adminTokenEnvVar: 'CUSTOM_FRONTEND_VAR' };

      const res = await app.request('/admin/harness-backends', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formWithVar),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.adminTokenEnvVar).toBe('HARNESS_INTELLECT_RAG_NEW_TOKEN');
      expect(body.data.adminTokenEnvVar).not.toBe('CUSTOM_FRONTEND_VAR');

      // warn 被记录
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('CUSTOM_FRONTEND_VAR');
      expect(warnSpy.mock.calls[0][0]).toContain('harness-admin:POST');

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // PUT /admin/harness-backends/:id (update)
  // -------------------------------------------------------------------------

  describe('PUT /admin/harness-backends/:id', () => {
    it('合法编辑成功,触发 saveConfig + load + invalidate', async () => {
      const updateForm = {
        ...validForm,
        id: undefined, // 编辑时 body 不传 id(用路径参数)
        name: 'Updated Name',
      };
      const res = await app.request('/admin/harness-backends/intellect-rag-default', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateForm),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(body.data.name).toBe('Updated Name');
      expect(body.data.id).toBe('intellect-rag-default'); // id 来自路径参数

      expect(stores.saveConfigMock).toHaveBeenCalledTimes(1);
      expect(stores.loadMock).toHaveBeenCalledTimes(1);
      expect(stores.invalidateMock).toHaveBeenCalledWith('intellect-rag-default');
    });

    it('编辑不存在的 id 返回 404', async () => {
      const res = await app.request('/admin/harness-backends/nonexistent', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...validForm, id: undefined }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(404);
    });

    it('编辑时 endpoint 非法返回 400', async () => {
      const res = await app.request('/admin/harness-backends/intellect-rag-default', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...validForm, id: undefined, endpoint: 'bad' }),
      });
      expect(res.status).toBe(400);
    });

    // -------------------------------------------------------------------------
    // adminTokenEnvVar 自动生成测试(任务:PUT 同样自动生成,基于路径 id)
    // -------------------------------------------------------------------------

    it('PUT 自动生成 adminTokenEnvVar = HARNESS_<ID>_TOKEN(基于路径 id,忽略 body)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      // body 中带一个前端尝试污染的 adminTokenEnvVar,应被忽略
      const updateForm = {
        ...validForm,
        id: undefined,
        name: 'Updated Name',
        adminTokenEnvVar: 'BODY_INJECTED_VAR',
      };

      const res = await app.request('/admin/harness-backends/intellect-rag-default', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateForm),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // 基于路径参数 id='intellect-rag-default' 生成,而非 body.adminTokenEnvVar
      expect(body.data.adminTokenEnvVar).toBe('HARNESS_INTELLECT_RAG_DEFAULT_TOKEN');
      expect(body.data.adminTokenEnvVar).not.toBe('BODY_INJECTED_VAR');

      const savedConfigs = stores.saveConfigMock.mock.calls[0][0];
      const saved = savedConfigs.find((c: HarnessBackendConfig) => c.id === 'intellect-rag-default');
      expect(saved.adminTokenEnvVar).toBe('HARNESS_INTELLECT_RAG_DEFAULT_TOKEN');

      // warn 被记录(因为 body 显式传入了 adminTokenEnvVar)
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('BODY_INJECTED_VAR');
      expect(warnSpy.mock.calls[0][0]).toContain('harness-admin:PUT');

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /admin/harness-backends/:id (remove)
  // -------------------------------------------------------------------------

  describe('DELETE /admin/harness-backends/:id', () => {
    it('未绑定的后端删除成功', async () => {
      // 准备一个未绑定的后端
      const unboundConfig: HarnessBackendConfig = {
        ...ragConfig,
        id: 'intellect-rag-unbound',
      };
      stores = createMockStores(
        [ragConfig, unboundConfig],
        [ragBackend],
        [tenant1], // tenant1 绑定 intellect-rag-default,不绑定 unbound
      );
      app = createApp(stores);

      const res = await app.request('/admin/harness-backends/intellect-rag-unbound', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);

      expect(stores.saveConfigMock).toHaveBeenCalledTimes(1);
      // 保存的配置中不再含 unbound
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0];
      expect(savedConfigs.find((c: HarnessBackendConfig) => c.id === 'intellect-rag-unbound')).toBeUndefined();

      expect(stores.invalidateMock).toHaveBeenCalledWith('intellect-rag-unbound');
    });

    it('被 tenant 绑定的后端删除返回 409', async () => {
      const res = await app.request('/admin/harness-backends/intellect-rag-default', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe(409);
      expect(body.message).toContain('绑定');
      // 不应触发 saveConfig
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('删除不存在的 id 返回 404', async () => {
      const res = await app.request('/admin/harness-backends/nonexistent', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(404);
    });

    it('canvasBackendId 绑定也算绑定(返回 409)', async () => {
      // tenant 同时绑定 canvasBackendId
      const tenantWithCanvas: BffTenant = {
        ...tenant1,
        id: 'tenant-canvas',
        intellectBackendId: 'intellect-rag-other', // 主后端是另一个
        canvasBackendId: 'intellect-rag-default', // 画布绑定 default
      };
      const otherBackend: HarnessBackend = {
        ...ragBackend,
        id: 'intellect-rag-other',
      };
      const otherConfig: HarnessBackendConfig = {
        ...ragConfig,
        id: 'intellect-rag-other',
      };
      stores = createMockStores(
        [ragConfig, otherConfig],
        [ragBackend, otherBackend],
        [tenantWithCanvas],
      );
      app = createApp(stores);

      const res = await app.request('/admin/harness-backends/intellect-rag-default', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(409);
    });

    // spec-010 v8 修改 6 (D2):RunRegistry 活跃 run / 历史记录校验

    it('backend 有活跃 run 时返回 409(spec-010 v8 D2)', async () => {
      // 准备一个未绑定的后端
      const unboundConfig: HarnessBackendConfig = {
        ...ragConfig,
        id: 'intellect-rag-unbound',
      };
      stores = createMockStores(
        [ragConfig, unboundConfig],
        [ragBackend],
        [tenant1], // tenant1 绑定 intellect-rag-default,不绑定 unbound
      );
      app = createApp(stores);

      // 注册一个活跃 run(status='running')
      registerRun('run-active-1', 'intellect-rag-unbound', 'agent-1');

      const res = await app.request('/admin/harness-backends/intellect-rag-unbound', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe(409);
      expect(body.message).toContain('run 记录');
      // 不应触发 saveConfig
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('backend 有历史 run 记录(已完成)时返回 409(spec-010 v8 D2)', async () => {
      const unboundConfig: HarnessBackendConfig = {
        ...ragConfig,
        id: 'intellect-rag-unbound',
      };
      stores = createMockStores(
        [ragConfig, unboundConfig],
        [ragBackend],
        [tenant1],
      );
      app = createApp(stores);

      // 注册一个已完成的 run(历史记录)
      registerRun('run-done-1', 'intellect-rag-unbound', 'agent-1');
      markRunCompleted('run-done-1', 'completed');

      const res = await app.request('/admin/harness-backends/intellect-rag-unbound', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe(409);
      expect(body.message).toContain('run 记录');
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('backend 无 run 记录时正常删除(spec-010 v8 D2)', async () => {
      // 准备一个未绑定的后端,且 RunRegistry 中无该 backend 的记录
      const unboundConfig: HarnessBackendConfig = {
        ...ragConfig,
        id: 'intellect-rag-clean',
      };
      stores = createMockStores(
        [ragConfig, unboundConfig],
        [ragBackend],
        [tenant1],
      );
      app = createApp(stores);

      // 不注册任何 run,registry 为空(beforeEach 已清空)

      const res = await app.request('/admin/harness-backends/intellect-rag-clean', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(stores.saveConfigMock).toHaveBeenCalledTimes(1);
      expect(stores.invalidateMock).toHaveBeenCalledWith('intellect-rag-clean');
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/harness-backends/:id/switch (spec-010 v8 修改 6 D2)
  // -------------------------------------------------------------------------

  describe('POST /admin/harness-backends/:id/switch', () => {
    it('有活跃 run 时返回 409(spec-010 v8 D2)', async () => {
      // 注册一个活跃 run,绑定到 intellect-rag-default
      registerRun('run-switch-active', 'intellect-rag-default', 'agent-1');

      const res = await app.request('/admin/harness-backends/intellect-rag-default/switch', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: 'tenant-1', role: 'primary' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe(409);
      expect(body.message).toContain('活跃 run');
      // 不应触发绑定切换
      expect(stores.setHarnessBindingMock).not.toHaveBeenCalled();
      expect(stores.setCanvasBindingMock).not.toHaveBeenCalled();
      // 不应触发缓存失效
      expect(stores.invalidateMock).not.toHaveBeenCalled();
    });

    it('无活跃 run 时切换 primary 成功(spec-010 v8 D2)', async () => {
      const res = await app.request('/admin/harness-backends/intellect-rag-default/switch', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: 'tenant-1', role: 'primary' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(body.message).toBe('切换成功');

      // 触发 setHarnessBinding(tenantId, backendId)
      expect(stores.setHarnessBindingMock).toHaveBeenCalledWith('tenant-1', 'intellect-rag-default');
      expect(stores.setCanvasBindingMock).not.toHaveBeenCalled();
      // 失效 Adapter 缓存
      expect(stores.invalidateMock).toHaveBeenCalled();
    });

    it('无活跃 run 时切换 canvas 成功(spec-010 v8 D2)', async () => {
      const res = await app.request('/admin/harness-backends/intellect-rag-default/switch', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: 'tenant-1', role: 'canvas' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);

      // 触发 setCanvasBinding(tenantId, backendId)
      expect(stores.setCanvasBindingMock).toHaveBeenCalledWith('tenant-1', 'intellect-rag-default');
      expect(stores.setHarnessBindingMock).not.toHaveBeenCalled();
      expect(stores.invalidateMock).toHaveBeenCalled();
    });

    it('缺少 tenantId 时返回 400', async () => {
      const res = await app.request('/admin/harness-backends/intellect-rag-default/switch', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'primary' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(400);
      expect(body.message).toContain('tenantId');
    });

    it('role 非法时返回 400', async () => {
      const res = await app.request('/admin/harness-backends/intellect-rag-default/switch', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: 'tenant-1', role: 'invalid' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(400);
      expect(body.message).toContain('role');
    });
  });
});
