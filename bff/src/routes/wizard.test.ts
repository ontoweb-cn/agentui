// spec-010 v8 B-3: Wizard 路由单元测试
// Constitution Principle VII (Test-First): 覆盖 4 个端点 + SSRF 防护 + Token Security。
// Mock HarnessStore + BackendStore + AdapterRegistry + TokenVault + safeFetch + validateTenantConfigs。

import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Hono } from 'hono';
import { sanitizeSsoProviderIds, wizardRoutes } from './wizard';
import { clearImtSessionCache } from '../middleware/imt-session-guard';
import { AUTH_COOKIE_NAME } from '../types/auth';
import type { BootstrapTokenManager } from '../services/bootstrap-token';
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
  SSRF_PRIVATE_IP_HINT: 'TEST_HINT',
}));
vi.mock('../services/tenant-validator', () => ({
  validateTenantConfigs: vi.fn(),
  // P3-m4 / B2 修复:fetchTenantInfo 默认返回 null(降级放行)
  fetchTenantInfo: vi.fn().mockResolvedValue(null),
}));
// wizard-sso(P2):渠道拉取客户端 mock(路由层只关心选择结果)
vi.mock('../services/sso-providers', () => ({
  getLoginProviders: vi.fn(),
}));

import { safeFetch, isUrlSafe } from '../services/ssrf-guard';
import { validateTenantConfigs, fetchTenantInfo } from '../services/tenant-validator';
import { getLoginProviders } from '../services/sso-providers';

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
    setAuthMode: vi.fn(),
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

function createApp(stores: MockStores, bootstrapManager?: unknown): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('harnessStore', stores.harnessStore as HarnessStore);
    c.set('backendStore', stores.backendStore);
    c.set('adapterRegistry', stores.registry);
    c.set('tokenVault', stores.vault);
    if (bootstrapManager !== undefined) {
      // 注入式 fake manager,避免用例触碰真实 bff/data/.bootstrap-token(与其他测试文件并行竞争)
      c.set('bootstrapTokenManager' as never, bootstrapManager as never);
    }
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

  beforeAll(() => {
    // 2026-10 方案A鉴权修复后,默认模式下 setup 的 admin 凭据须为经真实校验的
    // imt cookie;既有用例的 `Authorization: Bearer test` 头对应社区模式契约。
    // 整体切到社区模式(flag='false')保持这些用例原意(覆盖 handler 逻辑),
    // 默认模式的鉴权矩阵在下方专门 describe 覆盖。
    process.env.BFF_ENABLE_IMT_CANVAS_AGENTS = 'false';
  });
  afterAll(() => {
    delete process.env.BFF_ENABLE_IMT_CANVAS_AGENTS;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock:isUrlSafe 返回 true(安全 URL),SSRF 拦截测试用例显式覆盖为 false
    vi.mocked(isUrlSafe).mockResolvedValue(true);
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

    it('hasEnterpriseBackend:configs 含企业后端(即使 token 未就绪)时为 true(v1.3 D5)', async () => {
      stores = createMockStores(
        [{ ...ragConfig, id: 'intellect-enterprise-default', type: 'intellect-enterprise' }],
        [],
        [],
      );
      app = createApp(stores);

      const res = await app.request('/admin/wizard/status', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      expect(body.hasEnterpriseBackend).toBe(true);
    });

    it('hasEnterpriseBackend:仅有非企业后端时为 false(v1.3 D5)', async () => {
      stores = createMockStores([ragConfig], [ragBackend], [tenant1]);
      app = createApp(stores);

      const res = await app.request('/admin/wizard/status', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      expect(body.hasEnterpriseBackend).toBe(false);
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
    it('返回 5 个选项:双企业卡置顶 + community/hermes/agent-scope(无 kag/rag)', async () => {
      const res = await app.request('/admin/wizard/backend-types', {
        headers: { Authorization: 'Bearer test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.options).toHaveLength(5);

      const optionIds = body.options.map((o: { optionId: string }) => o.optionId);
      expect(optionIds).toEqual([
        'enterprise-sso',
        'enterprise-password',
        'intellect-community',
        'hermes',
        'agent-scope',
      ]);
      expect(body.options[0].type).toBe('intellect-enterprise');
      expect(body.options[0].setupProfile).toBe('enterprise-sso');
      expect(body.options[1].type).toBe('intellect-enterprise');
      expect(body.options[1].setupProfile).toBe('enterprise-password');

      const types = body.options.map((o: { type: string }) => o.type);
      expect(types).not.toContain('intellect-rag');
      expect(types).not.toContain('kag');
    });

    it('每个选项含 optionId + capabilities + credentialKind', async () => {
      const res = await app.request('/admin/wizard/backend-types', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      for (const opt of body.options) {
        expect(opt.optionId).toBeTruthy();
        expect(opt.capabilities).toBeDefined();
        expect(opt.credentialKind).toBe('bearer-token');
        expect(opt.defaultEndpoint).toMatch(/^http/);
        expect(opt.label).toBeTruthy();
      }
    });
    it('v1.3 D2:非 SSO 卡说明不再提 SSO,SSO 卡说明保留', async () => {
      const res = await app.request('/admin/wizard/backend-types', {
        headers: { Authorization: 'Bearer test' },
      });
      const body = await res.json();
      const ssoCard = body.options.find((o: { optionId: string }) => o.optionId === 'enterprise-sso');
      const passwordCard = body.options.find((o: { optionId: string }) => o.optionId === 'enterprise-password');
      expect(ssoCard.description).toMatch(/SSO/);
      expect(passwordCard.description).not.toMatch(/SSO/);
    });
  });

  // -------------------------------------------------------------------------
  // 已下架类型 kag(P1/D-02):probe 与 setup 均显式拒绝
  // -------------------------------------------------------------------------

  describe('已下架类型 kag(X-02/D-02)', () => {
    it('probe type=kag 返回 400(不再误走 /v1/models 探测)', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'kag',
          endpoint: 'http://localhost:3000',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.healthy).toBe(false);
      expect(body.error).toContain('Unsupported backend type: kag');
      // 不应发起任何上游请求
      expect(vi.mocked(safeFetch).mock.calls.length).toBe(0);
    });

    it('setup type=kag 返回 400(选项表已移除)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'e2e-kag',
          type: 'kag',
          endpoint: 'http://localhost:3000',
          credentialKind: 'bearer-token',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unsupported backend type: kag');
    });
  });

  // -------------------------------------------------------------------------
  // wizard-sso(P2):setup sso 扩展 + GET /admin/wizard/sso/providers
  // -------------------------------------------------------------------------

  describe('wizard-sso(P2)', () => {
    const SECRET = 's'.repeat(48);
    const enterpriseSetupBody = {
      name: 'e2e-sso-ent',
      type: 'intellect-enterprise',
      endpoint: 'http://localhost:9091',
      credentialKind: 'bearer-token',
      token: 'ent-token',
      intellectTenantId: '0123456789abcdef0123456789abcdef',
      sso: {
        enabled: true,
        publicOrigin: 'https://wizard.example.com',
        stateSecret: SECRET,
        providers: ['intellect-auth'],
        silentRelogin: true,
      },
    };

    it('U-07: enterprise + 合法 sso → envSnippet 追加 SSO 配置,明文密钥不回显', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'c', authorizeUrl: 'u', scopes: 's' },
        ],
        misconfigured: [],
      });

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify(enterpriseSetupBody),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.envSnippet).toContain('BFF_SSO_ENABLED=true');
      expect(body.envSnippet).toContain('BFF_PUBLIC_ORIGIN=https://wizard.example.com');
      expect(body.envSnippet).toContain('BFF_SSO_STATE_SECRET=<your-secret>');
      expect(body.envSnippet).toContain('BFF_SSO_PROVIDERS=intellect-auth');
      expect(body.envSnippet).toContain('BFF_SSO_SILENT_RELOGIN=true');
      // Token Security:整个响应(含 envSnippet)不得出现明文密钥
      expect(JSON.stringify(body)).not.toContain(SECRET);
    });

    it('U-08: stateSecret 少于 32 字符 → 400', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...enterpriseSetupBody, sso: { ...enterpriseSetupBody.sso, stateSecret: 'short' } }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('32');
    });

    it('U-09: publicOrigin 非法 URL → 400', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          sso: { ...enterpriseSetupBody.sso, publicOrigin: 'not-a-url' },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('publicOrigin');
    });

    it('U-10: 非 enterprise 类型携带 sso.enabled=true → 400(R1)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          type: 'hermes',
          sso: { ...enterpriseSetupBody.sso },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('intellect-enterprise');
    });

    it('U-11: 白名单含未知渠道 → 200 + warnings 非阻断', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'c', authorizeUrl: 'u', scopes: 's' },
        ],
        misconfigured: [],
      });

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          sso: { ...enterpriseSetupBody.sso, providers: ['ghost-channel'] },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.warnings.some((w: string) => w.includes('未知或不可用渠道'))).toBe(true);
    });

    it('U-12: 嵌套 snake_case(sso.public_origin 等)归一化生效', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'e2e-sso-ent',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:9091',
          credential_kind: 'bearer-token',
          token: 'ent-token',
          intellect_tenant_id: '0123456789abcdef0123456789abcdef',
          sso: {
            enabled: true,
            public_origin: 'https://wizard.example.com',
            state_secret: SECRET,
            silent_relogin: false,
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.envSnippet).toContain('BFF_PUBLIC_ORIGIN=https://wizard.example.com');
      expect(body.envSnippet).toContain('BFF_SSO_SILENT_RELOGIN=false');
      expect(body.envSnippet).toContain('# BFF_SSO_PROVIDERS=');
    });

    it('U-13: GET sso/providers 字段裁剪(不透出 clientId/authorizeUrl/scopes)', async () => {
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'secret-c', authorizeUrl: 'https://idp', scopes: 'openid' },
        ],
        misconfigured: ['broken-provider'],
      });

      // 独立 forwarded-for 键:该端点与 probe 共享限流器,避免挤占 probe 用例的 'unknown' 额度
      vi.stubEnv('BFF_TRUST_PROXY', 'true');
      const res = await app.request('/admin/wizard/sso/providers?endpoint=http://x.example:9091', {
        headers: { 'x-forwarded-for': 'e2e-providers-u13' },
      });
      vi.unstubAllEnvs();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers).toHaveLength(1);
      expect(Object.keys(body.providers[0]).sort()).toEqual(['displayName', 'icon', 'id']);
      expect(body.misconfigured).toEqual(['broken-provider']);
      expect(JSON.stringify(body)).not.toContain('secret-c');
      expect(JSON.stringify(body)).not.toContain('authorizeUrl');
    });

    it('U-14: GET sso/providers SSRF 拦截 → 400', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(false);
      vi.stubEnv('BFF_TRUST_PROXY', 'true');
      const res = await app.request('/admin/wizard/sso/providers?endpoint=http://127.0.0.1:9091', {
        headers: { 'x-forwarded-for': 'e2e-providers-u14' },
      });
      vi.unstubAllEnvs();
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('不安全');
    });

    it('U-15: GET sso/providers 上游失败 → 502', async () => {
      vi.mocked(getLoginProviders).mockRejectedValue(new Error('provider list returned 500'));
      vi.stubEnv('BFF_TRUST_PROXY', 'true');
      const res = await app.request('/admin/wizard/sso/providers?endpoint=http://x.example:9091', {
        headers: { 'x-forwarded-for': 'e2e-providers-u15' },
      });
      vi.unstubAllEnvs();
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.providers).toHaveLength(0);
    });

    it('U-17: setupProfile=enterprise-sso 且无 sso → 400', async () => {
      const { sso: _sso, ...rest } = enterpriseSetupBody;
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rest, setupProfile: 'enterprise-sso' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('enterprise-sso');
    });

    it('U-17b(v1.3): SSO 模式不传 sso.enabled 也视为启用(启用状态由模式推定)', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'c', authorizeUrl: 'u', scopes: 's' },
        ],
        misconfigured: [],
      });
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          setupProfile: 'enterprise-sso',
          sso: { ...enterpriseSetupBody.sso, enabled: false },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.envSnippet).toContain('BFF_SSO_ENABLED=true');
    });

    it('U-18: setupProfile=enterprise-password + sso.enabled → 400', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          setupProfile: 'enterprise-password',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('enterprise-password');
    });

    it('U-19: setupProfile=enterprise-password 无 sso → 200 且无 BFF_SSO_ENABLED', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      const { sso: _sso, ...rest } = enterpriseSetupBody;
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rest,
          name: 'e2e-ent-password',
          setupProfile: 'enterprise-password',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      // v1.3 D4:凭据已存入 vault,不再输出任何 token 环境变量行
      expect(body.envSnippet).toBeUndefined();
    });

    it('U-20: setupProfile=enterprise-sso + 合法 sso → 200 且含待写入 warning', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'c', authorizeUrl: 'u', scopes: 's' },
        ],
        misconfigured: [],
      });
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          name: 'e2e-ent-sso-profile',
          setupProfile: 'enterprise-sso',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.envSnippet).toContain('BFF_SSO_ENABLED=true');
      expect(body.warnings.some((w: string) => w.includes('尚未生效') || w.includes('写入'))).toBe(true);
    });

    it('U-21(§9 S2): providers 含换行/等号 → snippet 不注入且 warning 剔除', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'c', authorizeUrl: 'u', scopes: 's' },
        ],
        misconfigured: [],
      });
      const evil = 'evil\nBFF_SSO_ENABLED=false';
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enterpriseSetupBody,
          name: 'e2e-ent-sso-inject',
          setupProfile: 'enterprise-sso',
          sso: {
            ...enterpriseSetupBody.sso,
            providers: ['intellect-auth', evil],
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.envSnippet).toContain('BFF_SSO_PROVIDERS=intellect-auth');
      expect(body.envSnippet).not.toContain('BFF_SSO_ENABLED=false');
      expect(body.envSnippet.split('\n').some((l: string) => l.includes(evil))).toBe(false);
      expect(body.warnings.some((w: string) => w.includes('非法 id'))).toBe(true);
    });

    it('sanitizeSsoProviderIds 仅放行 [A-Za-z0-9_-]', () => {
      const { ok, rejected } = sanitizeSsoProviderIds([
        'intellect-auth',
        'a=b',
        'x\ny',
        ' ok_id ',
        '',
      ]);
      expect(ok).toEqual(['intellect-auth', 'ok_id']);
      expect(rejected).toEqual(['a=b', 'x\ny']);
    });

    it('U-16: GET sso/providers 限流 → 429(独立 forwarded-for 键,不干扰其他用例)', async () => {
      vi.stubEnv('BFF_TRUST_PROXY', 'true');
      try {
        let last: Response | undefined;
        for (let i = 0; i < 11; i++) {
          last = await app.request('/admin/wizard/sso/providers?endpoint=http://x.example:9091', {
            headers: { 'x-forwarded-for': 'e2e-rate-limited' },
          });
        }
        expect(last?.status).toBe(429);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  // -------------------------------------------------------------------------
  // wizard-ent-sso-mode v1.3:SSO 模式只采集统一认证信息,企业后端由系统自动登记
  // -------------------------------------------------------------------------

  describe('wizard-ent-sso-mode v1.3(SSO 模式 setup)', () => {
    const SECRET = 's'.repeat(48);
    const TENANT_ID = '0123456789abcdef0123456789abcdef';
    const GATEWAY = 'http://x.example:9091';
    /** SSO 模式的最小请求:不带 name / credentialKind / intellectTenantId,也不带 sso.enabled */
    const ssoMinimalBody = {
      type: 'intellect-enterprise',
      endpoint: GATEWAY,
      token: 'server-key',
      setupProfile: 'enterprise-sso',
      sso: {
        publicOrigin: 'https://wizard.example.com',
        stateSecret: SECRET,
        providers: ['intellect-auth'],
        silentRelogin: true,
      },
    };

    function mockHealthyGateway() {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(fetchTenantInfo).mockResolvedValue({ tenant_id: TENANT_ID });
      vi.mocked(getLoginProviders).mockResolvedValue({
        providers: [
          { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'c', authorizeUrl: 'u', scopes: 's' },
        ],
        misconfigured: [],
      });
    }

    async function callSetup(body: Record<string, unknown>) {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    }

    it('W-01: 不传名称/凭据类型/租户 ID 也能完成;租户 ID 自动识别,后端以默认名登记', async () => {
      mockHealthyGateway();
      const { status, body } = await callSetup(ssoMinimalBody);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.backendId).toBe('intellect-enterprise-default');
      expect(body.envSnippet).toContain('BFF_SSO_ENABLED=true');
      // D4:服务密钥已入 vault,片段里没有 token 环境变量行
      expect(body.envSnippet).not.toContain('HARNESS_');

      const saved = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(saved[0]).toMatchObject({
        id: 'intellect-enterprise-default',
        type: 'intellect-enterprise',
        endpoint: GATEWAY,
        credentialKind: 'bearer-token',
        intellectTenantId: TENANT_ID,
      });
      expect(stores.setCredentialsMock).toHaveBeenCalledWith('intellect-enterprise-default', {
        kind: 'bearer-token',
        token: 'server-key',
      });
      // Token Security:落盘配置与响应都不含服务密钥/引导密钥明文
      expect(JSON.stringify(saved)).not.toContain('server-key');
      expect(JSON.stringify(body)).not.toContain('server-key');
      expect(JSON.stringify(body)).not.toContain(SECRET);
    });

    it('W-02: 缺网关服务密钥 → 400,不落盘', async () => {
      const { token: _token, ...withoutToken } = ssoMinimalBody;
      const { status, body } = await callSetup(withoutToken);
      expect(status).toBe(400);
      expect(body.error).toContain('网关服务密钥');
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('W-03: 网关未返回租户 ID 且未手填 → 400,不落盘', async () => {
      vi.mocked(fetchTenantInfo).mockResolvedValue(null);
      const { status, body } = await callSetup(ssoMinimalBody);
      expect(status).toBe(400);
      expect(body.error).toContain('无法自动识别企业租户 ID');
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('W-04: 自动识别拿不到租户 ID 时,手填 intellectTenantId 可完成(D7)', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      // 网关侧读不到租户 ID(返回空);持久化前的一致性校验同样取不到,按既有口径降级放行
      vi.mocked(fetchTenantInfo).mockResolvedValue({ tenant_id: '' });
      vi.mocked(getLoginProviders).mockResolvedValue({ providers: [], misconfigured: [] });

      const { status } = await callSetup({ ...ssoMinimalBody, intellectTenantId: TENANT_ID });
      expect(status).toBe(200);
      const saved = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(saved[0].intellectTenantId).toBe(TENANT_ID);
    });

    it('W-05: 非 SSO 模式显式携带 sso(即使 enabled=false)→ 400(D2)', async () => {
      const { status, body } = await callSetup({
        ...ssoMinimalBody,
        name: 'e2e-password-with-sso',
        intellectTenantId: TENANT_ID,
        setupProfile: 'enterprise-password',
        sso: { enabled: false, publicOrigin: 'https://wizard.example.com', stateSecret: SECRET },
      });
      expect(status).toBe(400);
      expect(body.error).toContain('enterprise-password');
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('W-06: 旧客户端未传 profile 且 sso.enabled=false → 按非 SSO 模式放行,无 SSO 输出', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      const { setupProfile: _profile, ...rest } = ssoMinimalBody;
      const { status, body } = await callSetup({
        ...rest,
        name: 'e2e-legacy-disabled-sso',
        credentialKind: 'bearer-token',
        intellectTenantId: TENANT_ID,
        sso: { enabled: false, publicOrigin: 'https://wizard.example.com', stateSecret: SECRET },
      });
      expect(status).toBe(200);
      expect(body.envSnippet).toBeUndefined();
      expect(body.warnings.some((w: string) => w.includes('未传 setupProfile'))).toBe(true);
    });

    it('W-07: 凭据未能写入 vault(无 vault)时,envSnippet 保留 HARNESS_<ID>_TOKEN 行', async () => {
      stores = createMockStores();
      stores.vault = undefined as unknown as ITokenVault;
      app = createApp(stores);

      const { status, body } = await callSetup({
        name: 'No Vault',
        type: 'intellect-community',
        endpoint: 'http://localhost:9380',
        credentialKind: 'bearer-token',
        token: 'env-fallback-token',
      });
      expect(status).toBe(200);
      expect(body.envSnippet).toContain('HARNESS_NO_VAULT_TOKEN=<your-token>');
      expect(JSON.stringify(body)).not.toContain('env-fallback-token');
    });

    it('W-08: 未知 setupProfile → 400', async () => {
      const { status, body } = await callSetup({
        ...ssoMinimalBody,
        setupProfile: 'enterprise-unknown',
      });
      expect(status).toBe(400);
      expect(body.error).toContain('未知 setupProfile');
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/wizard/probe
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // P3(wizard-sso):ragProbePaths/probeRagPlugin 已随向导 RAG 区块移除,
  // 原"探测前缀对齐"用例一并删除;enterprise 探测仅校验网关基址。
  // -------------------------------------------------------------------------

  describe('POST /admin/wizard/probe', () => {
    it('无 Authorization header 时 probe 正常返回(公开端点)', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      vi.mocked(safeFetch).mockResolvedValue(
        new Response('[]', { status: 200 }),
      );

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-community',
          endpoint: 'http://example.com:9380',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.healthy).toBe(true);
    });

    it('探测成功返回 healthy=true', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      vi.mocked(safeFetch).mockResolvedValue(
        new Response('[]', { status: 200 }),
      );

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-community',
          endpoint: 'http://example.com:9380',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.healthy).toBe(true);
      expect(body.capabilities).toBeDefined();
    });

    it('enterprise 探测 /api/tenant/info 不可达 → 失败消息含网关基址防呆提示', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(true);
      // fetchTenantInfo 默认 mock 即 null(不可达形态)
      vi.mocked(fetchTenantInfo).mockResolvedValue(null);

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-enterprise',
          endpoint: 'https://ai.wust.edu.cn/intellect',
        }),
      });
      const body = await res.json();
      expect(body.healthy).toBe(false);
      expect(body.error).toContain('/api/tenant/info');
      expect(body.error).toContain('网关基址');
      expect(body.error).toContain('WebUI');
      vi.mocked(fetchTenantInfo).mockResolvedValue(null);
    });

    describe('SSO 模式验证(wizard-ent-sso-mode v1.3)', () => {
      const GATEWAY = 'http://x.example:9091';
      const TENANT_ID = '0123456789abcdef0123456789abcdef';
      let seq = 0;

      function mockGateway(tenantId: string | null) {
        vi.mocked(fetchTenantInfo).mockResolvedValue(
          tenantId === null ? null : { tenant_id: tenantId },
        );
      }

      /** 依次给出各受保护端点的响应状态;最后一个状态重复使用 */
      function mockKeyCheck(...statuses: number[]) {
        const queue = [...statuses];
        vi.mocked(safeFetch).mockImplementation(async () => {
          const status = queue.length > 1 ? queue.shift() : queue[0];
          return new Response('{}', { status });
        });
      }

      function mockProviders(count: number) {
        vi.mocked(getLoginProviders).mockResolvedValue({
          providers: Array.from({ length: count }, (_, i) => ({
            id: `provider-${i}`,
            displayName: `渠道 ${i}`,
            icon: 'sso',
            clientId: 'c',
            authorizeUrl: 'u',
            scopes: 's',
          })),
          misconfigured: [],
        });
      }

      /** 独立 forwarded-for 键:probe 限流器按 IP 计数,避免挤占其他用例的 'unknown' 额度 */
      async function probeSso(overrides: Record<string, unknown> = {}) {
        vi.stubEnv('BFF_TRUST_PROXY', 'true');
        try {
          const res = await app.request('/admin/wizard/probe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': `e2e-probe-sso-${++seq}`,
            },
            body: JSON.stringify({
              type: 'intellect-enterprise',
              endpoint: GATEWAY,
              token: 'server-key',
              setupProfile: 'enterprise-sso',
              ...overrides,
            }),
          });
          return { status: res.status, body: await res.json() };
        } finally {
          vi.unstubAllEnvs();
        }
      }

      it('W-P10: 请求键为 snake_case(setup_profile)时同样走 SSO 验证分支', async () => {
        mockGateway(TENANT_ID);
        mockKeyCheck(200);
        mockProviders(2);
        vi.stubEnv('BFF_TRUST_PROXY', 'true');
        try {
          const res = await app.request('/admin/wizard/probe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': `e2e-probe-sso-${++seq}`,
            },
            // 前端共享 axios 拦截器会把 setupProfile 转为 setup_profile
            body: JSON.stringify({
              type: 'intellect-enterprise',
              endpoint: GATEWAY,
              token: 'server-key',
              setup_profile: 'enterprise-sso',
            }),
          });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.healthy).toBe(true);
          expect(body.sso).toMatchObject({ gatewayOk: true, keyValid: true, providersOk: true });
        } finally {
          vi.unstubAllEnvs();
        }
      });

      afterEach(() => {
        vi.mocked(safeFetch).mockReset();
        vi.mocked(fetchTenantInfo).mockResolvedValue(null);
        vi.mocked(getLoginProviders).mockReset();
      });

      it('W-P01: 四项全部通过 → healthy=true 并返回明细', async () => {
        mockGateway(TENANT_ID);
        mockKeyCheck(200);
        mockProviders(2);
        const { status, body } = await probeSso();
        expect(status).toBe(200);
        expect(body.healthy).toBe(true);
        expect(body.sso).toEqual({
          gatewayOk: true,
          tenantId: TENANT_ID,
          keyValid: true,
          providersOk: true,
          providerCount: 2,
        });
      });

      it('W-P02: 网关不可达 → healthy=false + 网关基址防呆提示,不再校验密钥', async () => {
        mockGateway(null);
        const { body } = await probeSso();
        expect(body.healthy).toBe(false);
        expect(body.error).toContain('网关基址');
        expect(body.sso).toMatchObject({ gatewayOk: false, tenantId: null, keyValid: null, providersOk: false });
        expect(vi.mocked(safeFetch)).not.toHaveBeenCalled();
      });

      it('W-P03: 密钥被网关拒绝(401)→ keyValid=false,其余结论照常返回', async () => {
        mockGateway(TENANT_ID);
        mockKeyCheck(401);
        mockProviders(1);
        const { body } = await probeSso();
        expect(body.healthy).toBe(false);
        expect(body.error).toContain('服务密钥无效');
        expect(body.sso).toMatchObject({ gatewayOk: true, keyValid: false, providersOk: true });
      });

      it('W-P04: 两处受保护端点都是 404 → keyValid=null(无法判定),不阻断', async () => {
        mockGateway(TENANT_ID);
        mockKeyCheck(404, 404);
        mockProviders(1);
        const { body } = await probeSso();
        expect(body.healthy).toBe(true);
        expect(body.sso.keyValid).toBeNull();
        expect(vi.mocked(safeFetch).mock.calls.map((call) => String(call[0]))).toEqual([
          `${GATEWAY}/v1/capabilities`,
          `${GATEWAY}/v1/models`,
        ]);
      });

      it('W-P05: /v1/capabilities 不存在但 /v1/models 认可密钥 → keyValid=true', async () => {
        mockGateway(TENANT_ID);
        mockKeyCheck(404, 200);
        mockProviders(1);
        const { body } = await probeSso();
        expect(body.sso.keyValid).toBe(true);
      });

      it('W-P06: 网关未返回租户 ID → healthy=false 且 tenantId=null(前端回退手填),其余照常', async () => {
        mockGateway('');
        mockKeyCheck(200);
        mockProviders(1);
        const { body } = await probeSso();
        expect(body.healthy).toBe(false);
        expect(body.error).toContain('手动填写');
        expect(body.sso).toMatchObject({ gatewayOk: true, tenantId: null, keyValid: true, providersOk: true });
      });

      it('W-P07: 统一认证服务不可达 → providersOk=false', async () => {
        mockGateway(TENANT_ID);
        mockKeyCheck(200);
        vi.mocked(getLoginProviders).mockRejectedValue(new Error('provider list returned 500'));
        const { body } = await probeSso();
        expect(body.healthy).toBe(false);
        expect(body.sso.providersOk).toBe(false);
      });

      it('W-P08: 未填服务密钥 → keyValid=false', async () => {
        mockGateway(TENANT_ID);
        mockProviders(1);
        const { body } = await probeSso({ token: '' });
        expect(body.sso.keyValid).toBe(false);
        expect(body.error).toContain('网关服务密钥');
      });

      it('W-P09: 非 enterprise 类型携带 setupProfile → 400', async () => {
        const { status, body } = await probeSso({ type: 'hermes' });
        expect(status).toBe(400);
        expect(body.error).toContain('setupProfile');
      });
    });

    it('SSRF 拦截返回 400', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(false);

      const res = await app.request('/admin/wizard/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-community',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-community',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intellect-community',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'intellect-rag' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/wizard/setup
  // -------------------------------------------------------------------------

  describe('POST /admin/wizard/setup', () => {
    it('Bug1:已有就绪后端时,无凭证调用返回 401 而非 500(Context not finalized)', async () => {
      // 回归用例:wizardSetupAuth 尾部裸调 c.json() 缺 return,
      // 未授权请求曾得到 500 "Internal Server Error"
      const stores = createMockStores([], [ragBackend]);
      const app = createApp(stores);
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // 无 Authorization/cookie
        body: JSON.stringify({
          name: 'any',
          type: 'hermes',
          endpoint: 'http://localhost:9999',
          credentialKind: 'bearer-token',
        }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.message).toContain('admin token or bootstrap token');
    });
    it('type=intellect-rag 返回 400(不作为独立向导类型)', async () => {
      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Standalone RAG',
          type: 'intellect-rag',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('intellect-rag');
      expect(stores.saveConfigMock).not.toHaveBeenCalled();
    });

    it('SSRF 拦截:endpoint 指向私有 IP 时返回 400', async () => {
      vi.mocked(isUrlSafe).mockResolvedValue(false);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'SSRF Test',
          type: 'intellect-community',
          endpoint: 'http://127.0.0.1:9380',
          credentialKind: 'bearer-token',
          token: 'test-token',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('不安全');
    });

    it('创建 backend 成功,触发 saveConfig + load + invalidate + vault.setCredentials', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My RAG',
          type: 'intellect-community',
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
      // v1.3 D4:凭据已存入 vault,不再输出 HARNESS_MY_RAG_TOKEN 环境变量行
      expect(body.envSnippet).toBeUndefined();
      // P1-3 修复:响应不含 token 明文
      expect(JSON.stringify(body)).not.toContain('secret-token-123');

      // saveConfig 被调用
      expect(stores.saveConfigMock).toHaveBeenCalledTimes(1);
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(savedConfigs).toHaveLength(1);
      expect(savedConfigs[0].id).toBe('my-rag');
      expect(savedConfigs[0].adminTokenEnvVar).toBe('HARNESS_MY_RAG_TOKEN');

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
          type: 'intellect-community',
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
      // v1.3 D4:凭据已入 vault,响应不再带 token 环境变量占位行
      expect(text).not.toContain('<your-token>');
    });

    it('id 重复时返回 409', async () => {
      stores = createMockStores([ragConfig], [ragBackend], [tenant1]);
      app = createApp(stores);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Intellect RAG Default', // 生成 backendId = 'intellect-rag-default' (重复)
          type: 'intellect-community',
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

    it('U-05/U-06: enterprise 无 RAG 字段成功;不创建伴生 RAG,warnings 含 RAG 提示(P3)', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      vi.mocked(fetchTenantInfo).mockResolvedValue(null);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Enterprise',
          type: 'intellect-enterprise',
          endpoint: 'http://localhost:9091',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          intellectTenantId: '0123456789abcdef0123456789abcdef',
        }),
      });
      expect(res.status).toBe(200);
      expect(validateTenantConfigs).toHaveBeenCalledTimes(1);

      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(savedConfigs).toHaveLength(1);
      const enterprise = savedConfigs.find((c) => c.type === 'intellect-enterprise');
      expect(enterprise?.intellectTenantId).toBe('0123456789abcdef0123456789abcdef');
      // 不再创建伴生 RAG:无 ragBackendId、无 intellect-rag 条目
      expect(enterprise?.ragBackendId).toBeUndefined();
      expect(savedConfigs.some((c) => c.type === 'intellect-rag')).toBe(false);
      // 凭据仅企业版一条
      expect(stores.setCredentialsMock).toHaveBeenCalledTimes(1);
      expect(stores.setCredentialsMock).toHaveBeenCalledWith('enterprise', {
        kind: 'bearer-token',
        token: 'ent-token',
      });
      // 不再绑定 canvas(无 RAG)
      expect(stores.backendStore.setCanvasBinding).not.toHaveBeenCalled();
      // envSnippet 无 RAG 行
      const body = await res.json();
      expect(body.envSnippet ?? '').not.toContain('rag');
      // warnings 含 RAG 延后提示(X-04)
      expect(
        (body.warnings as string[]).some((w) => w.includes('RAG 插件未配置')),
      ).toBe(true);
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
          endpoint: 'http://localhost:9091',
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
          endpoint: 'http://localhost:9091',
          credentialKind: 'bearer-token',
          token: 'ent-token',
          intellectTenantId: '0123456789abcdef0123456789abcdef',
          ragEndpoint: 'http://localhost:9380',
          ragApiKey: 'rag-api-key-secret',
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
          endpoint: 'http://localhost:9091',
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
          endpoint: 'http://localhost:9091',
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
          type: 'intellect-community',
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
          type: 'intellect-community',
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
          type: 'intellect-community',
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
          type: 'intellect-community',
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
          type: 'intellect-community',
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

    // -------------------------------------------------------------------------
    // adminTokenEnvVar 自动生成测试(任务:移除必填,BFF 自动生成 HARNESS_<ID>_TOKEN)
    // -------------------------------------------------------------------------

    it('adminTokenEnvVar 未传时自动生成 HARNESS_<ID>_TOKEN', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Auto Gen Var',
          type: 'intellect-community',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'token',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.backendId).toBe('auto-gen-var');
      // 命名规则升级为 HARNESS_<ID>_TOKEN(凭据已入 vault,片段里不再出现,以持久化配置为准)
      expect(body.envSnippet).toBeUndefined();

      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(savedConfigs[0].adminTokenEnvVar).toBe('HARNESS_AUTO_GEN_VAR_TOKEN');
    });

    it('前端传入 adminTokenEnvVar 时被忽略 + 记录 warn + 自动生成', async () => {
      vi.mocked(validateTenantConfigs).mockResolvedValue(true);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const res = await app.request('/admin/wizard/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ignore Var',
          type: 'intellect-community',
          endpoint: 'http://localhost:9380',
          credentialKind: 'bearer-token',
          token: 'token',
          // 前端尝试污染命名空间,应被忽略
          adminTokenEnvVar: 'FRONTEND_INJECTED_VAR',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.backendId).toBe('ignore-var');
      // 持久化的是 BFF 自动生成的值,而非前端传入
      const savedConfigs = stores.saveConfigMock.mock.calls[0][0] as HarnessBackendConfig[];
      expect(savedConfigs[0].adminTokenEnvVar).toBe('HARNESS_IGNORE_VAR_TOKEN');
      expect(savedConfigs[0].adminTokenEnvVar).not.toBe('FRONTEND_INJECTED_VAR');
      expect(body.envSnippet).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('FRONTEND_INJECTED_VAR');
      // warn 被记录,包含被忽略的值
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('FRONTEND_INJECTED_VAR');
      expect(warnSpy.mock.calls[0][0]).toContain('Ignoring frontend-provided adminTokenEnvVar');

      warnSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// POST /admin/wizard/setup — 方案A鉴权(默认 flag 开,imt cookie 真实校验)
// 2026-10 安全修复回归:任意 Authorization Bearer 不再等价 admin。
// ---------------------------------------------------------------------------

describe('POST /admin/wizard/setup 方案A鉴权(默认模式)', () => {
  const enterpriseConfig: HarnessBackendConfig = {
    id: 'ent-1',
    name: 'Ent',
    type: 'intellect-enterprise',
    endpoint: 'https://gw.example',
    adminTokenEnvVar: 'HARNESS_ENT_TOKEN',
    capabilities: {
      canvas: true,
      knowledgeBase: true,
      memory: true,
      mcp: true,
      multiTenant: true,
      modelManagement: true,
    },
  };

  const setupBody = {
    name: 'Sec Backend',
    type: 'intellect-community',
    endpoint: 'http://localhost:9380',
    credentialKind: 'bearer-token',
    token: 't',
  };

  /** gateway 响应桩:validateImtToken 走全局 fetch。 */
  function gw(status: number) {
    return vi.fn(async () => new Response(null, { status }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isUrlSafe).mockResolvedValue(true);
    vi.mocked(validateTenantConfigs).mockResolvedValue(true);
    // 恢复默认(方案 A)模式:空串 !== 'false' → flag 开
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearImtSessionCache();
  });

  it('安全回归:任意 Authorization Bearer 不再等价 admin,已有就绪后端时 401 且不落盘', async () => {
    const stores = createMockStores([], [ragBackend]);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Authorization: 'Bearer arbitrary-garbage', 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toContain('admin token or bootstrap token');
    expect(stores.saveConfigMock).not.toHaveBeenCalled();
  });

  it('方案A:无凭据 + 无就绪后端 → 首次安装放行(spec §9.4)仍可用', async () => {
    const stores = createMockStores([], [], []);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(200);
    expect(stores.saveConfigMock).toHaveBeenCalled();
  });

  it('方案A:经 gateway 验证的 imt cookie → 放行执行 setup', async () => {
    vi.stubGlobal('fetch', gw(200));
    const stores = createMockStores([enterpriseConfig], [ragBackend]);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE_NAME}=valid-token`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(200);
    expect(stores.saveConfigMock).toHaveBeenCalled();
  });

  it('方案A:伪造 imt cookie(gateway 401)→ 401 且不落盘', async () => {
    vi.stubGlobal('fetch', gw(401));
    const stores = createMockStores([enterpriseConfig], [ragBackend]);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE_NAME}=forged`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(401);
    expect(stores.saveConfigMock).not.toHaveBeenCalled();
  });

  it('方案A:gateway 不可达 → 502 fail-closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('gateway down');
      }),
    );
    const stores = createMockStores([enterpriseConfig], [ragBackend]);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE_NAME}=some-token`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(502);
  });

  it('方案A:cookie 存在但无 enterprise backend 可校验 → 503', async () => {
    vi.stubGlobal('fetch', gw(200));
    const stores = createMockStores([], [ragBackend]);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE_NAME}=some-token`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/wizard/setup — bootstrap 消费时机 + 未就绪租户门控(方案A)
// ---------------------------------------------------------------------------

describe('POST /admin/wizard/setup bootstrap 消费时机 + 租户门控(方案A)', () => {
  const enterpriseConfig: HarnessBackendConfig = {
    id: 'ent-1',
    name: 'Ent',
    type: 'intellect-enterprise',
    endpoint: 'https://gw.example',
    adminTokenEnvVar: 'HARNESS_ENT_TOKEN',
    capabilities: {
      canvas: true,
      knowledgeBase: true,
      memory: true,
      mcp: true,
      multiTenant: true,
      modelManagement: true,
    },
  };

  const tenant0: BffTenant = {
    id: '0',
    name: 'Old',
    intellectBackendId: 'old-ent',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const setupBody = {
    name: 'Sec Backend',
    type: 'intellect-community',
    endpoint: 'http://localhost:9380',
    credentialKind: 'bearer-token',
    token: 't',
  };

  const BOOT_TOKEN = 'b'.repeat(64);

  /** 注入式 fake manager(非消耗式 matches),避免触碰真实 bootstrap token 文件。 */
  function fakeBootstrapManager(validToken: string | null): BootstrapTokenManager & {
    matches: Mock;
    verify: Mock;
    invalidate: Mock;
  } {
    return {
      matches: vi.fn((t: string) => validToken !== null && t === validToken),
      verify: vi.fn((t: string) => validToken !== null && t === validToken),
      invalidate: vi.fn(),
    } as unknown as BootstrapTokenManager & { matches: Mock; verify: Mock; invalidate: Mock };
  }

  function gw(status: number) {
    return vi.fn(async () => new Response(null, { status }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isUrlSafe).mockResolvedValue(true);
    vi.mocked(validateTenantConfigs).mockResolvedValue(true);
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearImtSessionCache();
  });

  it('有效 bootstrap token → 放行(首装放行不可用)且 handler 成功后作废一次', async () => {
    const manager = fakeBootstrapManager(BOOT_TOKEN);
    // 就绪后端存在 → 首次安装放行分支不可用,200 只能来自 bootstrap token 分支
    const stores = createMockStores([], [ragBackend]);
    const app = createApp(stores, manager);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(200);
    expect(manager.invalidate).toHaveBeenCalledOnce();
  });

  it('handler 400 拒绝时 token 不被烧掉,同一 token 可重试成功', async () => {
    const manager = fakeBootstrapManager(BOOT_TOKEN);
    const stores = createMockStores([], [ragBackend]);
    const app = createApp(stores, manager);

    const bad = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'hermes' }), // 缺 name/endpoint/credentialKind → 400(P1:kag 已下架,换用 hermes)
    });
    expect(bad.status).toBe(400);
    // 非消耗式 matches:400 不得作废 token(修复前 verify-on-match 即烧掉)
    expect(manager.invalidate).not.toHaveBeenCalled();

    const good = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(good.status).toBe(200);
    expect(manager.invalidate).toHaveBeenCalledOnce();
  });

  it('默认租户已存在 + 新后端未就绪 → 跳过绑定并返回 warnings(P2 回归)', async () => {
    vi.stubGlobal('fetch', gw(200));
    // list 不含即将创建的 'sec-backend' → newBackendReady=false → 不得绑定
    const stores = createMockStores([enterpriseConfig], [ragBackend], [tenant0]);
    const app = createApp(stores);
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE_NAME}=valid-token`, 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings[0]).toContain('未就绪');
    expect(stores.backendStore.setHarnessBinding).not.toHaveBeenCalled();
    expect(stores.saveConfigMock).toHaveBeenCalled(); // 配置本身仍正常落盘
  });
});
