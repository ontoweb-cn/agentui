// spec-010 v8 B-3: Wizard 路由单元测试
// Constitution Principle VII (Test-First): 覆盖 4 个端点 + SSRF 防护 + Token Security。
// Mock HarnessStore + BackendStore + AdapterRegistry + TokenVault + safeFetch + validateTenantConfigs。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Hono } from 'hono';
import { wizardRoutes } from './wizard';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { ITokenVault, Credential } from '../services/token-vault';
import type { HarnessStoreListConfigs } from '../types/harness-admin';
import type { HarnessBackendConfig, HarnessBackend } from '../types/harness';
import type { BffTenant } from '../types/tenant';

// Mock ssrf-guard + tenant-validator (hoisted)
vi.mock('../services/ssrf-guard', () => ({
  safeFetch: vi.fn(),
  isUrlSafe: vi.fn(),
}));
vi.mock('../services/tenant-validator', () => ({
  validateTenantConfigs: vi.fn(),
  // P3-m4 / B2 修复:fetchTenantInfo 默认返回 null(降级放行)
  fetchTenantInfo: vi.fn().mockResolvedValue(null),
}));

import { safeFetch, isUrlSafe } from '../services/ssrf-guard';
import { validateTenantConfigs, fetchTenantInfo } from '../services/tenant-validator';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ragConfig: HarnessBackendConfig = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG Default',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: { canvas: true, knowledgeBase: true, memory: true, mcp: false, multiTenant: false, modelManagement: false },
  defaultForTenant: true,
};

const ragBackend: HarnessBackend = { ...ragConfig, adminToken: 'rag-token-secret' };

const tenant1: BffTenant = {
  id: 'tenant-1',
  name: 'T1',
  intellectBackendId: 'intellect-rag-default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

interface MockStores {
  harnessStore: HarnessStore & HarnessStoreListConfigs;
  backendStore: BackendStore;
  registry: IAdapterRegistry;
  vault: ITokenVault;
  loadMock: Mock;
  saveConfigMock: Mock;
  invalidateMock: Mock;
  setCredentialsMock: Mock;
}

function createMockStores(
  configs: HarnessBackendConfig[] = [],
  backends: HarnessBackend[] = [],
  tenants: BffTenant[] = [],
): MockStores {
  const loadMock = vi.fn().mockResolvedValue(undefined);
  const saveConfigMock = vi.fn().mockResolvedValue(undefined);
  const invalidateMock = vi.fn();
  const setCredentialsMock = vi.fn().mockResolvedValue(undefined);

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
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setCanvasBinding: vi.fn(),
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

  const vault: ITokenVault = {
    getCredentials: vi.fn().mockResolvedValue(null),
    setCredentials: setCredentialsMock,
    deleteCredentials: vi.fn().mockResolvedValue(undefined),
    listBackendIds: vi.fn().mockResolvedValue([]),
  };

  return { harnessStore, backendStore, registry, vault, loadMock, saveConfigMock, invalidateMock, setCredentialsMock };
}

interface TestVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  tokenVault?: ITokenVault;
}

function createApp(stores: MockStores): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('harnessStore', stores.harnessStore as HarnessStore);
    c.set('backendStore', stores.backendStore);
    c.set('adapterRegistry', stores.registry);
    c.set('tokenVault', stores.vault);
    await next();
  });
  app.route('/', wizardRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wizard 路由 (B-3)', () => {
  let stores: MockStores;
  let app: Hono<{ Variables: TestVariables }>;

  beforeEach(() => {
    vi.clearAllMocks();
    stores = createMockStores();
    app = createApp(stores);
  });

  // -------------------------------------------------------------------------
  // GET /admin/wizard/status
  // -------------------------------------------------------------------------

  describe('GET /admin/wizard/status', () => {
    it('无 backend 配置时返回 needsSetup=true', async () => {
      stores = createMockStores([], [], []);
      app = createApp(stores);

      const res = await app.request('/admin/wizard/status', {
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.needsSetup).toBe(true);
      expect(body.backendCount).toBe(0);
      expect(typeof body.bootstrapEnabled).toBe('boolean');
    });

    it('有就绪 backend(token 已加载)时返回 needsSetup=false', async () => {
      stores = createMockStores([ragConfig], [ragBackend], [tenant1]);
      app = createApp(stores);

      const res = await app.request('/admin/wizard/status', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      expect(body.needsSetup).toBe(false);
      expect(body.backendCount).toBe(1);
    });

    // 修复回归:configs 中有条目但 token 未就绪(对应 env var 未设置)时,
    // list() 返回空数组,needsSetup 应为 true,触发向导而非进入登录页。
    it('configs 有条目但无就绪 backend 时返回 needsSetup=true(token 未就绪)', async () => {
      stores = createMockStores([ragConfig], [], []);
      app = createApp(stores);

      const res = await app.request('/admin/wizard/status', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      expect(body.needsSetup).toBe(true);
      expect(body.backendCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/wizard/backend-types
  // -------------------------------------------------------------------------

  describe('GET /admin/wizard/backend-types', () => {
    it('返回 6 个后端类型选项', async () => {
      const res = await app.request('/admin/wizard/backend-types', {
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.options).toHaveLength(6);

      const types = body.options.map((o: { type: string }) => o.type);
      expect(types).toEqual([
        'kag',
        'intellect-enterprise',
        'intellect-rag',
        'intellect-community',
        'hermes',
        'agent-scope',
      ]);
    });

    it('每个选项含 capabilities + credentialKind', async () => {
      const res = await app.request('/admin/wizard/backend-types', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      for (const opt of body.options) {
        expect(opt.capabilities).toBeDefined();
        expect(opt.credentialKind).toBe('bearer-token');
        expect(opt.defaultEndpoint).toMatch(/^http/);
        expect(opt.label).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/wizard/probe
  // -------------------------------------------------------------------------

  describe('POST /admin/wizard/probe', () => {
    it('探测成功返回 healthy=true', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      vi.mocked(safeFetch).mockResolvedValue(
        new Response('[]', { status: 200 }),
      );

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-rag',
          endpoint: 'http://example.com:9380',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.healthy).toBe(true);
      expect(body.capabilities).toBeDefined();
    });

    it('SSRF 拦截返回 400', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(false);

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-rag',
          endpoint: 'http://127.0.0.1:9380',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.healthy).toBe(false);
      expect(body.error).toContain('不安全');
    });

    it('上游返回非 200 时 healthy=false', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      vi.mocked(safeFetch).mockResolvedValue(
        new Response('Not Found', { status: 404 }),
      );

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-rag',
          endpoint: 'http://example.com:9380',
        }),
      });
      const body = await res.json();
      expect(body.healthy).toBe(false);
      expect(body.error).toContain('404');
    });

    it('网络错误时 healthy=false + error 消息', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      vi.mocked(safeFetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-rag',
          endpoint: 'http://example.com:9380',
        }),
      });
      const body = await res.json();
      expect(body.healthy).toBe(false);
      expect(body.error).toContain('ECONNREFUSED');
    });

    it('缺少 endpoint 返回 400', async () => {
      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'intellect-rag' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/wizard/setup
  // -------------------------------------------------------------------------

  describe('POST /admin/wizard/setup', () => {
    it('创建 backend 成功,触发 saveConfig + load + invalidate + vault.setCredentials', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My RAG',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'secret-token-123',
          defaultForTenant: true,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.backendId).toBe('my-rag');
      expect(body.envSnippet).toContain('MY_RAG_TOKEN');
      // P1-3 修复:响应不含 token 明文
      expect(body.envSnippet).not.toContain('secret-token-123');
      expect(body.envSnippet).toContain('<your-token>');

      // saveConfig 被调用
      expect(stores.saveConfigMock).toHaveBeenCalledTimes(1);
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(savedConfigs).toHaveLength(1);
      expect(savedConfigs[0].id).toBe('my-rag');
      expect(savedConfigs[0].adminTokenEnvVar).toBe('MY_RAG_TOKEN');

      // load 被调用(热加载)
      expect(stores.loadMock).toHaveBeenCalledTimes(1);

      // invalidate 被调用
      expect(stores.invalidateMock).toHaveBeenCalledWith('my-rag');

      // vault.setCredentials 被调用(bearer-token 模式)
      expect(stores.setCredentialsMock).toHaveBeenCalledTimes(1);
      const [backendId, credential] = stores.setCredentialsMock.mock.calls[0];
      expect(backendId).toBe('my-rag');
      expect(credential).toEqual({ kind: 'bearer-token', token: 'secret-token-123' });
    });

    it('响应不含 token 明文(P1-3 修复)', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Backend',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'plaintext-secret',
        }),
      });
      const text = await res.text();
      // saveConfig 收到的 config 不含 token
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(JSON.stringify(savedConfigs)).not.toContain('plaintext-secret');
      // P1-3 修复:响应体也不含 token 明文(包括 envSnippet)
      expect(text).not.toContain('plaintext-secret');
      expect(text).toContain('<your-token>');
    });

    it('id 重复时返回 409', async () => {
      stores = createMockStores([ragConfig], [ragBackend], [tenant1]);
      app = createApp(stores);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Intellect RAG Default', // 生成 backendId = 'intellect-rag-default' (重复)
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'token',
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('已存在');
    });

    it('缺少必填字段返回 400', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          // 缺 type, endpoint, credentialKind
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('intellect-enterprise 类型触发 validateTenantConfigs', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      // P3-m4 修复:fetchTenantInfo 默认返回 null(降级放行),不阻断 setup
      vi.mocked(fetchTenantInfo).mockResolvedValue(null);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Enterprise',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:8642',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          // P3-m4 修复:32 位 hex 格式(Rust 版本要求)
          intellectTenantId: '0123456789abcdef0123456789abcdef',
        }),
      });
      expect(res.status).toBe(200);
      expect(validateTenantConfigs).toHaveBeenCalledTimes(1);

      // 验证保存的 config 含 intellectTenantId
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(savedConfigs[0].intellectTenantId).toBe('0123456789abcdef0123456789abcdef');
    });

    it('validateTenantConfigs 失败时返回 400 + 回滚', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(false);
      // B2 修复:fetchTenantInfo 降级放行(返回 null),由持久化后 validateTenantConfigs 校验
      vi.mocked(fetchTenantInfo).mockResolvedValue(null);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Enterprise',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:8642',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          // P3-m4 修复:32 位 hex 格式
          intellectTenantId: '0123456789abcdef0123456789abcdef',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('mismatch');
      expect(body.error).toContain('回滚');
      // B2 修复:验证回滚被调用(saveConfig 第二次调用传入空数组)
      expect(stores.saveConfigMock).toHaveBeenCalledTimes(2);
      const rollbackConfigs = stores.saveConfigMock.mock.calls[1][0] as HarnessBackendConfig[];
      expect(rollbackConfigs).toHaveLength(0);
    });

    it('fetchTenantInfo 返回不匹配的 tenant_id 时返回 400(不持久化)', async () => {
      vi.mocked(fetchTenantInfo).mockResolvedValue({
        tenant_id: 'fedcba9876543210fedcba9876543210',
      });

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Enterprise',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:8642',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          intellectTenantId: '0123456789abcdef0123456789abcdef',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('mismatch');
      // B2 修复:校验失败时不应持久化(saveConfig 未被调用)
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('intellect-enterprise 缺少 intellectTenantId 返回 400(P3-m4)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Enterprise',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:8642',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          // 缺 intellectTenantId
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('intellectTenantId');
    });

    it('intellectTenantId 格式错误(非 32 位 hex)返回 400(P3-m4)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Enterprise',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:8642',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          intellectTenantId: 'not-hex',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('32 位 hex');
    });

    it('email-password 模式存储到 vault', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'RAG Email',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'email-password',
          email: 'admin@example.com',
          password: 'pass123',
        }),
      });
      expect(res.status).toBe(200);
      const credential: Credential = stores.setCredentialsMock.mock.calls[0][1];
      expect(credential).toEqual({
        kind: 'email-password',
        email: 'admin@example.com',
        password: 'pass123',
      });
    });

    it('email-password 模式无 vault 时返回 500(P1-5 修复)', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      // 创建无 vault 的 app
      const appNoVault = new Hono<{ Variables: TestVariables }>();
      appNoVault.use('*', async (c, next) => {
        c.set('harnessStore', stores.harnessStore as HarnessStore);
        c.set('backendStore', stores.backendStore);
        c.set('adapterRegistry', stores.registry);
        // 不设置 tokenVault
        await next();
      });
      appNoVault.route('/', wizardRoutes as unknown as Hono<{ Variables: TestVariables }>);

      const res = await appNoVault.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'RAG Email',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'email-password',
          email: 'admin@example.com',
          password: 'pass123',
        }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('vault');
      // 不应持久化
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('email-password 模式缺 email 或 password 返回 400(P1-5 修复)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'RAG Email',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'email-password',
          email: 'admin@example.com',
          // 缺 password
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('email-password');
    });

    it('backendId 清洗特殊字符(P1-4 修复)', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My RAG! @#$% Backend/2026',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'token',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // 特殊字符被替换为 -,连续的 - 合并
      expect(body.backendId).toBe('my-rag-backend-2026');
    });

    it('name 仅含特殊字符时返回 400(P1-4 修复)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '!@#$%',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'token',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('清洗后为空');
    });
  });
});
