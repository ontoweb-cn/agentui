import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authSessionMiddleware } from '../middleware/auth-session';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { Credential, ITokenVault } from '../services/token-vault';
import { AUTH_COOKIE_NAME } from '../types/auth';
import type {
  HarnessBackendConfig,
  HarnessCapabilities,
} from '../types/harness';
import type { BackendStore, HarnessStore } from '../types/stores';
import type { BffTenant } from '../types/tenant';
import { kbConnectionRoutes } from './kb-connection';

vi.mock('../services/member-id-resolver', () => ({
  resolveMemberInfo: vi.fn(),
}));
vi.mock('../services/ssrf-guard', () => ({
  safeFetch: vi.fn(),
}));
vi.mock('../services/run-registry', () => ({
  getActiveRunCount: vi.fn(),
  hasActiveRuns: vi.fn(),
}));

import { resolveMemberInfo } from '../services/member-id-resolver';
import { getActiveRunCount, hasActiveRuns } from '../services/run-registry';
import { safeFetch } from '../services/ssrf-guard';

const resolveMemberInfoMock = vi.mocked(resolveMemberInfo);
const safeFetchMock = vi.mocked(safeFetch);
const hasActiveRunsMock = vi.mocked(hasActiveRuns);
const getActiveRunCountMock = vi.mocked(getActiveRunCount);

const TENANT_ID = 'tenant-enterprise';
const MAIN_ID = 'enterprise-main';
const RAG_ID = `${MAIN_ID}-rag`;
const SESSION_TOKEN = 'imt_session_secret';
const OLD_TOKEN = 'vault-old-token-secret';
const NEW_TOKEN = 'candidate-new-token-secret';
const OLD_ENDPOINT = 'https://kb-old.example';
const NEW_ENDPOINT = 'https://kb-new.example';
const CONNECTION_PATH = '/settings/kb-connection';
const TEST_PATH = `${CONNECTION_PATH}/test`;

const capabilities: HarnessCapabilities = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: false,
  multiTenant: false,
  modelManagement: true,
};

function mainConfig(
  overrides: Partial<HarnessBackendConfig> = {},
): HarnessBackendConfig {
  return {
    id: MAIN_ID,
    name: 'Enterprise Main',
    type: 'intellect-enterprise',
    endpoint: 'https://enterprise.example',
    adminTokenEnvVar: 'HARNESS_ENTERPRISE_MAIN_TOKEN',
    capabilities: { ...capabilities, canvas: false, multiTenant: true },
    revision: 2,
    ...overrides,
  };
}

function ragConfig(
  overrides: Partial<HarnessBackendConfig> = {},
): HarnessBackendConfig {
  return {
    id: RAG_ID,
    name: 'Enterprise Main RAG',
    type: 'intellect-rag',
    endpoint: OLD_ENDPOINT,
    adminTokenEnvVar: 'HARNESS_ENTERPRISE_MAIN_RAG_TOKEN',
    capabilities,
    credentialKind: 'bearer-token',
    revision: 4,
    ...overrides,
  };
}

function enterpriseTenant(overrides: Partial<BffTenant> = {}): BffTenant {
  return {
    id: TENANT_ID,
    name: 'Enterprise Tenant',
    intellectBackendId: MAIN_ID,
    authMode: 'intellect-enterprise',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface RigOptions {
  configs: HarnessBackendConfig[];
  tenants: BffTenant[];
  credentials?: Record<string, Credential>;
}

function createRig(options: RigOptions) {
  const state = {
    configs: clone(options.configs),
    tenants: clone(options.tenants),
    credentials: new Map<string, Credential>(
      Object.entries(clone(options.credentials ?? {})),
    ),
  };

  const applyConfigs = (configs: HarnessBackendConfig[]) => {
    // 替换数组而非原地 splice:路由持有的 existing 快照必须保持不变,才能验证回滚参数。
    state.configs = clone(configs);
  };

  const load = vi.fn().mockResolvedValue(undefined);
  const saveConfig = vi.fn(async (configs: HarnessBackendConfig[]) => {
    applyConfigs(configs);
  });
  const listConfigs = vi.fn(() => state.configs);
  const harnessStore: HarnessStore & { listConfigs(): HarnessBackendConfig[] } =
    {
      load,
      list: vi.fn(() =>
        state.configs.map((config) => ({
          ...config,
          adminToken: 'runtime-token-not-used',
        })),
      ),
      get: vi.fn((id: string) => {
        const config = state.configs.find((item) => item.id === id);
        return config
          ? { ...config, adminToken: 'runtime-token-not-used' }
          : undefined;
      }),
      saveConfig,
      listConfigs,
    };

  const getBackend = vi.fn((id: string) =>
    state.tenants.find((tenant) => tenant.id === id),
  );
  const setCanvasBinding = vi.fn(
    async (tenantId: string, backendId: string) => {
      const tenant = state.tenants.find((item) => item.id === tenantId);
      if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
      tenant.canvasBackendId = backendId;
    },
  );
  const backendStore: BackendStore = {
    load: vi.fn().mockResolvedValue(undefined),
    getBackend,
    listBackends: vi.fn(() => state.tenants),
    createBackend: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setAuthMode: vi.fn(),
    setCanvasBinding,
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };

  const invalidate = vi.fn();
  const registry: IAdapterRegistry = {
    getAdapterForBackend: vi.fn(),
    registerFactory: vi.fn(),
    isReady: vi.fn(() => true),
    invalidate,
    getCanvasBackendForBackend:
      vi.fn() as unknown as IAdapterRegistry['getCanvasBackendForBackend'],
  };

  const getCredentials = vi.fn(async (backendId: string) => {
    const credential = state.credentials.get(backendId);
    return credential ? clone(credential) : null;
  });
  const setCredentials = vi.fn(
    async (backendId: string, credential: Credential) => {
      state.credentials.set(backendId, clone(credential));
    },
  );
  const deleteCredentials = vi.fn(async (backendId: string) => {
    state.credentials.delete(backendId);
  });
  const vault: ITokenVault = {
    getCredentials,
    setCredentials,
    deleteCredentials,
    listBackendIds: vi.fn(async () => [...state.credentials.keys()]),
  };

  return {
    state,
    applyConfigs,
    harnessStore,
    backendStore,
    registry,
    vault,
    load,
    saveConfig,
    listConfigs,
    getBackend,
    setCanvasBinding,
    invalidate,
    getCredentials,
    setCredentials,
    deleteCredentials,
  };
}

type TestRig = ReturnType<typeof createRig>;

interface TestVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  tokenVault: ITokenVault;
}

type TestApp = Hono<{ Variables: TestVariables }>;

function createApp(rig: TestRig): TestApp {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('harnessStore', rig.harnessStore);
    c.set('backendStore', rig.backendStore);
    c.set('adapterRegistry', rig.registry);
    c.set('tokenVault', rig.vault);
    await next();
  });
  app.use('*', authSessionMiddleware);
  app.route('/', kbConnectionRoutes as unknown as TestApp);
  return app;
}

function enterpriseHeaders(): Record<string, string> {
  return {
    'X-Backend-Id': TENANT_ID,
    Cookie: `${AUTH_COOKIE_NAME}=${SESSION_TOKEN}`,
  };
}

function jsonRequest(
  app: TestApp,
  method: 'POST' | 'PUT',
  path: string,
  payload: unknown,
  headers: Record<string, string> = enterpriseHeaders(),
) {
  return app.request(path, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function createBoundRig() {
  return createRig({
    configs: [mainConfig({ ragBackendId: RAG_ID }), ragConfig()],
    tenants: [enterpriseTenant()],
    credentials: { [RAG_ID]: { kind: 'bearer-token', token: OLD_TOKEN } },
  });
}

function createUnboundRig() {
  return createRig({
    configs: [mainConfig()],
    tenants: [enterpriseTenant()],
  });
}

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveMemberInfoMock.mockResolvedValue({
    memberId: 'member-1',
    role: 'owner',
  });
  hasActiveRunsMock.mockReturnValue(false);
  getActiveRunCountMock.mockReturnValue(0);
});

describe('kb-connection GET 企业版鉴权与读取', () => {
  it.each(['owner', 'admin'] as const)(
    '%s 可读取配置,revision/version 正确且不泄漏 Token',
    async (role) => {
      resolveMemberInfoMock.mockResolvedValue({
        memberId: `member-${role}`,
        role,
      });
      const rig = createBoundRig();
      const app = createApp(rig);
      safeFetchMock.mockResolvedValue(
        jsonResponse({ code: 0, data: { version: 'v9.8.7' } }),
      );

      const response = await app.request(CONNECTION_PATH, {
        headers: enterpriseHeaders(),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 0,
        data: {
          configured: true,
          endpoint: OLD_ENDPOINT,
          tokenConfigured: true,
          revision: 4,
          version: 'v9.8.7',
          versionError: null,
        },
      });
      expect(resolveMemberInfoMock).toHaveBeenCalledWith(
        TENANT_ID,
        SESSION_TOKEN,
        'https://enterprise.example',
      );
      expect(safeFetchMock).toHaveBeenCalledOnce();
      expect(safeFetchMock).toHaveBeenCalledWith(
        `${OLD_ENDPOINT}/api/v1/system/version`,
        {
          method: 'GET',
          timeoutMs: 5_000,
        },
      );
      const responseText = JSON.stringify(body);
      expect(responseText).not.toContain(OLD_TOKEN);
      expect(responseText).not.toContain(SESSION_TOKEN);
      expect(body.data).not.toHaveProperty('serviceToken');
      expect(body.data).not.toHaveProperty('adminToken');
    },
  );

  it('member 返回 403,且不读取版本接口', async () => {
    resolveMemberInfoMock.mockResolvedValue({
      memberId: 'member-basic',
      role: 'member',
    });
    const app = createApp(createBoundRig());

    const response = await app.request(CONNECTION_PATH, {
      headers: enterpriseHeaders(),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(403);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('缺少 X-Backend-Id 返回 400,不按 tenant 0 继续解析', async () => {
    const rig = createRig({
      configs: [
        mainConfig({ id: 'tenant-zero-main' }),
        ragConfig({ id: 'tenant-zero-rag' }),
      ],
      tenants: [
        enterpriseTenant({
          id: '0',
          intellectBackendId: 'tenant-zero-main',
        }),
      ],
    });
    const app = createApp(rig);

    const response = await app.request(CONNECTION_PATH);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('X-Backend-Id');
    expect(rig.getBackend).not.toHaveBeenCalled();
    expect(resolveMemberInfoMock).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('未知 tenant 返回 404', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);

    const response = await app.request(CONNECTION_PATH, {
      headers: {
        'X-Backend-Id': 'tenant-unknown',
        Cookie: `${AUTH_COOKIE_NAME}=${SESSION_TOKEN}`,
      },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe(404);
    expect(resolveMemberInfoMock).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe('kb-connection GET 社区版鉴权', () => {
  function createCommunityRig() {
    const communityRag = ragConfig({
      id: 'community-rag',
      endpoint: 'https://community-auth.example',
    });
    return createRig({
      configs: [communityRag],
      tenants: [
        enterpriseTenant({
          id: 'tenant-community',
          intellectBackendId: communityRag.id,
          authMode: 'intellect-community',
        }),
      ],
      credentials: {
        [communityRag.id]: { kind: 'bearer-token', token: OLD_TOKEN },
      },
    });
  }

  it('把原 Authorization 仅显式传给当前绑定认证源 /users/me,超管可读取', async () => {
    const rig = createCommunityRig();
    const app = createApp(rig);
    safeFetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/users/me')) {
        return jsonResponse({ code: 0, data: { is_superuser: true } });
      }
      if (url.endsWith('/system/version')) {
        return jsonResponse({ code: 0, data: 'community-v2' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await app.request(CONNECTION_PATH, {
      headers: {
        'X-Backend-Id': 'tenant-community',
        Authorization: 'Bearer original-community-authorization',
        'X-Intellect-User': 'dynamic-user',
        'X-Intellect-Role': 'owner',
        'X-Intellect-Team': 'dynamic-team',
      },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.version).toBe('community-v2');
    expect(safeFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://community-auth.example/api/v1/users/me',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer original-community-authorization' },
        timeoutMs: 5_000,
      },
    );
    expect(safeFetchMock).toHaveBeenNthCalledWith(
      2,
      'https://community-auth.example/api/v1/system/version',
      { method: 'GET', timeoutMs: 5_000 },
    );
    expect(resolveMemberInfoMock).not.toHaveBeenCalled();
  });

  it('is_superuser=false 返回 403,不继续读取版本', async () => {
    const app = createApp(createCommunityRig());
    safeFetchMock.mockResolvedValue(
      jsonResponse({ code: 0, data: { is_superuser: false } }),
    );

    const response = await app.request(CONNECTION_PATH, {
      headers: {
        'X-Backend-Id': 'tenant-community',
        Authorization: 'Bearer ordinary-community-user',
      },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(403);
    expect(safeFetchMock).toHaveBeenCalledOnce();
    expect(safeFetchMock.mock.calls[0][0]).toBe(
      'https://community-auth.example/api/v1/users/me',
    );
  });
});

describe('kb-connection POST test 候选凭据探测', () => {
  it('datasets 只携带精确候选 Token;上游 401 返回 200 + authentication 失败且不重试', async () => {
    const app = createApp(createBoundRig());
    safeFetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/system/version')) {
        return jsonResponse({ code: 0, data: 'v-test' });
      }
      if (url.includes('/datasets?')) {
        return jsonResponse({ code: 401, message: 'unauthorized' }, 401);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await jsonRequest(
      app,
      'POST',
      TEST_PATH,
      { endpoint: OLD_ENDPOINT, serviceToken: NEW_TOKEN },
      {
        ...enterpriseHeaders(),
        Authorization: 'Bearer session-authorization-must-not-leak',
        'X-Intellect-User': 'session-user',
        'X-Intellect-Role': 'owner',
        'X-Intellect-Team': 'session-team',
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 0,
      data: {
        success: false,
        stage: 'authentication',
        version: 'v-test',
        upstreamStatus: 401,
      },
    });
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    expect(safeFetchMock).toHaveBeenNthCalledWith(
      1,
      `${OLD_ENDPOINT}/api/v1/system/version`,
      { method: 'GET', timeoutMs: 5_000 },
    );
    expect(safeFetchMock).toHaveBeenNthCalledWith(
      2,
      `${OLD_ENDPOINT}/api/v1/datasets?page=1&page_size=1`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${NEW_TOKEN}` },
        timeoutMs: 5_000,
      },
    );
    expect(JSON.stringify(body)).not.toContain(NEW_TOKEN);
  });

  it('URL 改变且 Token 留空返回 400,不复用 vault 旧 Token', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);

    const response = await jsonRequest(app, 'POST', TEST_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: '   ',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(400);
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(rig.getCredentials).not.toHaveBeenCalled();
  });

  it('同 URL 留空可使用 vault 旧 Token 完成探测', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);
    safeFetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/system/version')) {
        return jsonResponse({ code: 0, data: { version: 'v-vault' } });
      }
      return jsonResponse({ code: 0, data: { items: [] } });
    });

    const response = await jsonRequest(app, 'POST', TEST_PATH, {
      endpoint: OLD_ENDPOINT,
      serviceToken: '',
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      success: true,
      stage: null,
    });
    expect(rig.getCredentials).toHaveBeenCalledWith(RAG_ID);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    expect(safeFetchMock).toHaveBeenNthCalledWith(
      2,
      `${OLD_ENDPOINT}/api/v1/datasets?page=1&page_size=1`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${OLD_TOKEN}` },
        timeoutMs: 5_000,
      },
    );
  });

  it('接受 snake_case service_token,并将其作为 datasets 候选 Token', async () => {
    const app = createApp(createBoundRig());
    safeFetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/system/version')) {
        return jsonResponse({ code: 0, data: 'v-snake' });
      }
      return jsonResponse({ code: 0, data: { items: [] } });
    });

    const response = await jsonRequest(app, 'POST', TEST_PATH, {
      endpoint: OLD_ENDPOINT,
      service_token: 'snake-post-token',
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.success).toBe(true);
    expect(safeFetchMock).toHaveBeenNthCalledWith(
      2,
      `${OLD_ENDPOINT}/api/v1/datasets?page=1&page_size=1`,
      {
        method: 'GET',
        headers: { Authorization: 'Bearer snake-post-token' },
        timeoutMs: 5_000,
      },
    );
  });

  it('候选 Token 为 imt_ 时返回 400,不调用上游', async () => {
    const app = createApp(createBoundRig());

    const response = await jsonRequest(app, 'POST', TEST_PATH, {
      endpoint: OLD_ENDPOINT,
      serviceToken: 'imt_candidate_token',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('imt_');
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('同 URL 保留的 vault Token 为 imt_ 时也返回 400,不调用上游', async () => {
    const rig = createRig({
      configs: [mainConfig({ ragBackendId: RAG_ID }), ragConfig()],
      tenants: [enterpriseTenant()],
      credentials: {
        [RAG_ID]: { kind: 'bearer-token', token: 'imt_retained_token' },
      },
    });
    const app = createApp(rig);

    const response = await jsonRequest(app, 'POST', TEST_PATH, {
      endpoint: OLD_ENDPOINT,
      service_token: '',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('imt_');
    expect(rig.getCredentials).toHaveBeenCalledWith(RAG_ID);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe('kb-connection PUT 保存、绑定与活跃 Run', () => {
  it('未绑定时创建伴生 RAG、设置 Canvas 绑定,并返回“保存并启用”', async () => {
    const rig = createUnboundRig();
    const app = createApp(rig);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 0,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('知识库服务已保存并启用');
    expect(body.data).toMatchObject({
      configured: true,
      endpoint: NEW_ENDPOINT,
      tokenConfigured: true,
      revision: 1,
      version: null,
    });
    expect(rig.setCredentials).toHaveBeenCalledWith(RAG_ID, {
      kind: 'bearer-token',
      token: NEW_TOKEN,
    });
    expect(rig.saveConfig).toHaveBeenCalledOnce();
    const savedConfigs = rig.saveConfig.mock.calls[0][0];
    expect(savedConfigs.find((config) => config.id === MAIN_ID)).toMatchObject({
      ragBackendId: RAG_ID,
      revision: 3,
    });
    expect(savedConfigs.find((config) => config.id === RAG_ID)).toMatchObject({
      type: 'intellect-rag',
      endpoint: NEW_ENDPOINT,
      revision: 1,
    });
    expect(rig.load).toHaveBeenCalledOnce();
    expect(rig.setCanvasBinding).toHaveBeenCalledWith(TENANT_ID, RAG_ID);
    expect(rig.invalidate).toHaveBeenCalledOnce();
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(NEW_TOKEN);
  });

  it('revision 冲突返回 409,不写配置、凭据或绑定', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 3,
    });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(409);
    expect(rig.saveConfig).not.toHaveBeenCalled();
    expect(rig.load).not.toHaveBeenCalled();
    expect(rig.setCredentials).not.toHaveBeenCalled();
    expect(rig.deleteCredentials).not.toHaveBeenCalled();
    expect(rig.setCanvasBinding).not.toHaveBeenCalled();
    expect(rig.invalidate).not.toHaveBeenCalled();
  });

  it('绑定变化遇活跃 Run 返回 409,且没有任何写操作', async () => {
    const rig = createUnboundRig();
    const app = createApp(rig);
    hasActiveRunsMock.mockImplementation((id) => id === TENANT_ID);
    getActiveRunCountMock.mockReturnValue(3);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 0,
    });

    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain('3 个活跃 Run');
    expect(rig.saveConfig).not.toHaveBeenCalled();
    expect(rig.load).not.toHaveBeenCalled();
    expect(rig.setCredentials).not.toHaveBeenCalled();
    expect(rig.deleteCredentials).not.toHaveBeenCalled();
    expect(rig.setCanvasBinding).not.toHaveBeenCalled();
    expect(rig.invalidate).not.toHaveBeenCalled();
  });

  it('已有绑定仅更新 URL/Token 时不被活跃 Run 阻断', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);
    hasActiveRunsMock.mockReturnValue(true);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 4,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe('知识库服务配置已保存');
    expect(hasActiveRunsMock).not.toHaveBeenCalled();
    expect(rig.saveConfig).toHaveBeenCalledOnce();
    expect(rig.setCredentials).toHaveBeenCalledWith(RAG_ID, {
      kind: 'bearer-token',
      token: NEW_TOKEN,
    });
    expect(rig.setCanvasBinding).not.toHaveBeenCalled();
    expect(
      rig.state.configs.find((config) => config.id === RAG_ID),
    ).toMatchObject({
      endpoint: NEW_ENDPOINT,
      revision: 5,
    });
  });

  it('PUT URL 改变且 Token 留空返回 400,不写旧 Token', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: '',
      revision: 4,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(400);
    expect(rig.saveConfig).not.toHaveBeenCalled();
    expect(rig.setCredentials).not.toHaveBeenCalled();
    expect(rig.setCanvasBinding).not.toHaveBeenCalled();
  });

  it('接受 snake_case service_token 保存候选 Token', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: OLD_ENDPOINT,
      service_token: 'snake-put-token',
      revision: 4,
    });

    expect(response.status).toBe(200);
    expect(rig.setCredentials).toHaveBeenCalledWith(RAG_ID, {
      kind: 'bearer-token',
      token: 'snake-put-token',
    });
    expect(rig.saveConfig).toHaveBeenCalledOnce();
  });

  it('PUT 候选 Token 为 imt_ 时返回 400,不写配置或凭据', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: OLD_ENDPOINT,
      service_token: 'imt_candidate_token',
      revision: 4,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('imt_');
    expect(rig.saveConfig).not.toHaveBeenCalled();
    expect(rig.setCredentials).not.toHaveBeenCalled();
    expect(rig.setCanvasBinding).not.toHaveBeenCalled();
  });

  it('PUT 同 URL 保留的 vault Token 为 imt_ 时返回 400,不写配置或凭据', async () => {
    const rig = createRig({
      configs: [mainConfig({ ragBackendId: RAG_ID }), ragConfig()],
      tenants: [enterpriseTenant()],
      credentials: {
        [RAG_ID]: { kind: 'bearer-token', token: 'imt_retained_token' },
      },
    });
    const app = createApp(rig);

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: OLD_ENDPOINT,
      serviceToken: '',
      revision: 4,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('imt_');
    expect(rig.saveConfig).not.toHaveBeenCalled();
    expect(rig.setCredentials).not.toHaveBeenCalled();
    expect(rig.setCanvasBinding).not.toHaveBeenCalled();
  });
});

describe('kb-connection PUT 串行化', () => {
  it('两个同 revision 并发 PUT 只写入首个;第二个在锁内重读后返回 409', async () => {
    const rig = createBoundRig();
    const app = createApp(rig);
    const firstWriteStarted = createGate();
    const releaseFirstWrite = createGate();
    rig.saveConfig.mockImplementationOnce(async (configs) => {
      firstWriteStarted.release();
      await releaseFirstWrite.promise;
      rig.applyConfigs(configs);
    });

    const firstPromise = jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: 'https://kb-first.example',
      serviceToken: 'first-new-token',
      revision: 4,
    });
    await firstWriteStarted.promise;
    const secondPromise = jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: 'https://kb-second.example',
      serviceToken: 'second-new-token',
      revision: 4,
    });

    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(rig.saveConfig).toHaveBeenCalledTimes(1);
      expect(rig.setCredentials).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirstWrite.release();
    }

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(rig.saveConfig).toHaveBeenCalledTimes(1);
    expect(rig.setCredentials).toHaveBeenCalledTimes(1);
    expect(rig.load).toHaveBeenCalledTimes(1);
    expect(
      rig.state.configs.find((config) => config.id === RAG_ID),
    ).toMatchObject({
      endpoint: 'https://kb-first.example',
      revision: 5,
    });
    expect(rig.state.credentials.get(RAG_ID)).toEqual({
      kind: 'bearer-token',
      token: 'first-new-token',
    });
  });
});

describe('kb-connection PUT 失败回滚与 Token 保密', () => {
  it('saveConfig 失败时恢复旧 config 快照和旧 credential', async () => {
    const rig = createBoundRig();
    const originalConfigs = clone(rig.state.configs);
    const app = createApp(rig);
    rig.saveConfig.mockRejectedValueOnce(new Error('saveConfig failed'));

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 4,
    });

    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(responseText).not.toContain(NEW_TOKEN);
    expect(responseText).not.toContain(OLD_TOKEN);
    expect(rig.setCredentials).toHaveBeenNthCalledWith(1, RAG_ID, {
      kind: 'bearer-token',
      token: NEW_TOKEN,
    });
    expect(rig.setCredentials).toHaveBeenNthCalledWith(2, RAG_ID, {
      kind: 'bearer-token',
      token: OLD_TOKEN,
    });
    expect(rig.saveConfig).toHaveBeenCalledTimes(2);
    expect(rig.saveConfig.mock.calls[1][0]).toEqual(originalConfigs);
    expect(rig.load).toHaveBeenCalledOnce();
    expect(rig.state.configs).toEqual(originalConfigs);
    expect(rig.state.credentials.get(RAG_ID)).toEqual({
      kind: 'bearer-token',
      token: OLD_TOKEN,
    });
    expect(rig.invalidate).not.toHaveBeenCalled();
  });

  it('load 失败时再次 saveConfig/load 回滚,并恢复旧 credential', async () => {
    const rig = createBoundRig();
    const originalConfigs = clone(rig.state.configs);
    const app = createApp(rig);
    rig.load.mockRejectedValueOnce(new Error('load failed'));

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 4,
    });

    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(responseText).not.toContain(NEW_TOKEN);
    expect(responseText).not.toContain(OLD_TOKEN);
    expect(rig.saveConfig).toHaveBeenCalledTimes(2);
    expect(rig.saveConfig.mock.calls[1][0]).toEqual(originalConfigs);
    expect(rig.load).toHaveBeenCalledTimes(2);
    expect(rig.setCredentials).toHaveBeenNthCalledWith(2, RAG_ID, {
      kind: 'bearer-token',
      token: OLD_TOKEN,
    });
    expect(rig.state.configs).toEqual(originalConfigs);
    expect(rig.state.credentials.get(RAG_ID)).toEqual({
      kind: 'bearer-token',
      token: OLD_TOKEN,
    });
    expect(rig.invalidate).not.toHaveBeenCalled();
  });

  it('setCanvasBinding 失败时回滚新 config,删除新 credential,不泄漏 Token', async () => {
    const rig = createUnboundRig();
    const originalConfigs = clone(rig.state.configs);
    const app = createApp(rig);
    rig.setCanvasBinding.mockRejectedValueOnce(new Error('binding failed'));

    const response = await jsonRequest(app, 'PUT', CONNECTION_PATH, {
      endpoint: NEW_ENDPOINT,
      serviceToken: NEW_TOKEN,
      revision: 0,
    });

    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(responseText).not.toContain(NEW_TOKEN);
    expect(rig.deleteCredentials).toHaveBeenCalledWith(RAG_ID);
    expect(rig.saveConfig).toHaveBeenCalledTimes(2);
    expect(rig.saveConfig.mock.calls[1][0]).toEqual(originalConfigs);
    expect(rig.load).toHaveBeenCalledTimes(2);
    expect(rig.state.configs).toEqual(originalConfigs);
    expect(rig.state.credentials.has(RAG_ID)).toBe(false);
    expect(rig.invalidate).not.toHaveBeenCalled();
  });
});
