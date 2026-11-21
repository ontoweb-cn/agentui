// proxy 路由 401 诚实透传 / 占位租户过滤 / 诊断日志(P1-a)
// docs/model-provider-empty-models-fix-design.md §8.1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { proxyRoutes, MODEL_MANAGEMENT_PATH_RE } from './proxy';
import { AUTH_SESSION_KEY } from '../middleware/auth-session';
import type { BackendStore, HarnessStore } from '../types';

const RAG_401_ENVELOPE = {
  code: 401,
  data: null,
  message: "<Unauthorized '401: Unauthorized'>",
};

const SUCCESS_ENVELOPE = { code: 0, data: [] };

function upstream401() {
  return new Response(JSON.stringify(RAG_401_ENVELOPE), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function upstream200() {
  return new Response(JSON.stringify(SUCCESS_ENVELOPE), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// intellectTenantId 挂在 enterprise 后端(实例级租户,RAG 是其伴生插件)
// adminToken: null → RAG backend 无服务令牌(P1-b 退回成员令牌路径用)
function createStores(
  opts: { intellectTenantId?: string; adminToken?: string | null } = {},
) {
  const ent = {
    id: 'ent-1',
    name: 'Enterprise',
    type: 'intellect-enterprise',
    endpoint: 'https://ent.test',
    capabilities: {},
    ...(opts.intellectTenantId !== undefined
      ? { intellectTenantId: opts.intellectTenantId }
      : {}),
  };
  const rag = {
    id: 'rag-1',
    name: 'RAG',
    type: 'intellect-rag',
    endpoint: 'https://rag.test',
    adminToken:
      opts.adminToken === undefined ? 'rag-api-key' : (opts.adminToken ?? undefined),
    capabilities: {},
  };
  const backendStore = {
    getBackend: vi.fn(() => ({
      id: '0',
      authMode: 'intellect-enterprise',
      intellectBackendId: 'ent-1',
      canvasBackendId: 'rag-1',
    })),
    getIntellectTeamId: vi.fn(() => undefined),
    getIntellectProjectId: vi.fn(() => undefined),
  } as unknown as BackendStore;
  const harnessStore = {
    get: vi.fn((id: string) => {
      if (id === 'rag-1') return rag;
      if (id === 'ent-1') return ent;
      return undefined;
    }),
    list: vi.fn(() => [ent, rag]),
  } as unknown as HarnessStore;
  return { backendStore, harnessStore };
}

type TestStores = ReturnType<typeof createStores>;

function createTestApp(stores: TestStores, opts: { session?: boolean } = {}) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', async (c: any, next: any) => {
    c.set('backendStore', stores.backendStore);
    c.set('harnessStore', stores.harnessStore);
    if (opts.session) {
      c.set(AUTH_SESSION_KEY, {
        token: 'imt_test_token',
        backendId: '0',
        authMode: 'intellect-enterprise',
      });
    }
    await next();
  });
  app.route('/', proxyRoutes);
  return app;
}

describe('MODEL_MANAGEMENT_PATH_RE', () => {
  it.each([
    ['providers', true],
    ['providers/', true],
    ['providers/Tongyi-Qianwen/instances', true],
    ['models', true],
    ['models/default', true],
    ['users/me/models', false],
    ['datasets', false],
    ['chats', false],
    ['model', false],
  ])('%s → %s', (path, expected) => {
    expect(MODEL_MANAGEMENT_PATH_RE.test(path)).toBe(expected);
  });
});

describe('proxy 401 handling (P1-a)', () => {
  let stores: TestStores;
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BFF_ENABLE_IMT_CANVAS_AGENTS;
    stores = createStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    warnMock = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(warnMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('成员身份 + 模型路径:透传 401 与上游信封', async () => {
    fetchMock.mockResolvedValue(upstream401());
    const app = createTestApp(stores, { session: true });

    const res = await app.request('/proxy/v1/models');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RAG_401_ENVELOPE);
  });

  it('成员身份 + 默认模型写路径(PATCH):同样透传', async () => {
    fetchMock.mockResolvedValue(upstream401());
    const app = createTestApp(stores, { session: true });

    const res = await app.request('/proxy/v1/models/default', {
      method: 'PATCH',
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RAG_401_ENVELOPE);
  });

  it('成员身份 + 非模型路径:改写为空数据信封(现状行为)', async () => {
    fetchMock.mockResolvedValue(upstream401());
    const app = createTestApp(stores, { session: true });

    const res = await app.request('/proxy/v1/datasets');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 0, data: null, message: 'success' });
  });

  it('无会话(社区模式)+ 模型路径:改写为空数据信封(防登出循环)', async () => {
    fetchMock.mockResolvedValue(upstream401());
    const app = createTestApp(stores);

    const res = await app.request('/proxy/v1/models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 0, data: null, message: 'success' });
  });

  it('诊断日志包含上游 message 且不含任何令牌', async () => {
    fetchMock.mockResolvedValue(upstream401());
    const app = createTestApp(stores, { session: true });

    await app.request('/proxy/v1/models');

    expect(warnMock).toHaveBeenCalledTimes(1);
    const logged = String(warnMock.mock.calls[0][0]);
    expect(logged).toContain("<Unauthorized '401: Unauthorized'>");
    expect(logged).not.toContain('imt_test_token');
    expect(logged).not.toContain('rag-api-key');
  });
});

describe('proxy 占位租户过滤 (P1-a)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BFF_ENABLE_IMT_CANVAS_AGENTS;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('全 0 占位 tenantId 不注入 X-Intellect-Tenant', async () => {
    fetchMock.mockResolvedValue(upstream200());
    const stores = createStores({
      intellectTenantId: '00000000000000000000000000000000',
    });
    const app = createTestApp(stores);

    await app.request('/proxy/v1/models');

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('X-Intellect-Tenant')).toBeNull();
  });

  it('正常 tenantId 注入 X-Intellect-Tenant', async () => {
    fetchMock.mockResolvedValue(upstream200());
    const stores = createStores({ intellectTenantId: 'abcd1234efgh5678' });
    const app = createTestApp(stores);

    await app.request('/proxy/v1/models');

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('X-Intellect-Tenant')).toBe('abcd1234efgh5678');
  });
});

// ---------------------------------------------------------------------------
// P1-b(§4.1/§4.4/§4.6):模型管理路径服务令牌强制 + 写权限门控(flag 默认关)
// docs/model-provider-empty-models-fix-design.md
// ---------------------------------------------------------------------------
describe('proxy 服务令牌强制与写门控 (P1-b)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function memberMe(role: string) {
    return new Response(JSON.stringify({ id: 'mem-1', role }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // fetch 路由:/api/members/me → 指定角色;其余 URL → 上游响应
  function routeFetch(upstream: Response, role = 'admin') {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/api/members/me')) return memberMe(role);
      return upstream;
    });
  }

  function upstreamHeaders(urlNeedle: string) {
    const call = fetchMock.mock.calls.find(
      ([u]) =>
        String(u).includes(urlNeedle) && !String(u).includes('/api/members/me'),
    );
    if (!call) throw new Error('upstream not called: ' + urlNeedle);
    return new Headers((call as unknown as [string, { headers: Headers }])[1].headers);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.BFF_ENABLE_IMT_CANVAS_AGENTS;
    delete process.env.BFF_MODEL_MGMT_SERVICE_TOKEN;
    const { resetMemberIdCacheForTesting } = await import(
      '../services/member-id-cache'
    );
    resetMemberIdCacheForTesting();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.BFF_MODEL_MGMT_SERVICE_TOKEN;
  });

  it('flag 关(默认):零行为变化——成员会话透传 + 身份头注入', async () => {
    routeFetch(upstream200());
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/models', { method: 'PATCH' });
    expect(res.status).toBe(200);
    const h = upstreamHeaders('rag.test');
    expect(h.get('Authorization')).toBe('Bearer imt_test_token');
    expect(h.get('X-Intellect-Role')).toBe('admin');
  });

  it('flag 开 + 模型路径 GET:服务令牌鉴权,跳过全部身份头注入', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    routeFetch(upstream200());
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/models');
    expect(res.status).toBe(200);
    const h = upstreamHeaders('rag.test');
    expect(h.get('Authorization')).toBe('Bearer rag-api-key');
    expect(h.get('X-Intellect-User')).toBeNull();
    expect(h.get('X-Intellect-Role')).toBeNull();
    expect(h.get('X-Intellect-Tenant')).toBeNull();
  });

  it('flag 开 + 模型路径写 + admin 角色:放行并携带服务令牌', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    routeFetch(upstream200());
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/providers', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(upstreamHeaders('rag.test').get('Authorization')).toBe(
      'Bearer rag-api-key',
    );
  });

  it('flag 开 + 模型路径写 + member 角色:403 且上游不被调用', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    routeFetch(upstream200(), 'member');
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/models/default', {
      method: 'PATCH',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: 403,
      message: 'Model management write requires admin role',
    });
    const upstreamCalls = fetchMock.mock.calls.filter(
      ([u]) => !String(u).includes('/api/members/me'),
    );
    expect(upstreamCalls).toHaveLength(0);
  });

  it('flag 开 + 模型路径写 + role 解析失败:fail-closed 403', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/api/members/me')) throw new Error('net down');
      return upstream200();
    });
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/models/default', {
      method: 'PATCH',
    });
    expect(res.status).toBe(403);
  });

  it('flag 开 + 非模型路径写:不门控,成员身份照常透传', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    routeFetch(upstream200());
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/datasets', { method: 'POST' });
    expect(res.status).toBe(200);
    const h = upstreamHeaders('rag.test');
    expect(h.get('Authorization')).toBe('Bearer imt_test_token');
    expect(h.get('X-Intellect-Role')).toBe('admin');
  });

  it('flag 开 + ragAdminToken 缺失:自动退回成员令牌(不阻断)', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    routeFetch(upstream200());
    const app = createTestApp(createStores({ adminToken: null }), {
      session: true,
    });
    const res = await app.request('/proxy/v1/models');
    expect(res.status).toBe(200);
    const h = upstreamHeaders('rag.test');
    expect(h.get('Authorization')).toBe('Bearer imt_test_token');
    expect(h.get('X-Intellect-Role')).toBe('admin');
  });

  it('flag 开 + users/me/models:非模型管理路径,不强制不门控', async () => {
    process.env.BFF_MODEL_MGMT_SERVICE_TOKEN = 'true';
    routeFetch(upstream200());
    const app = createTestApp(createStores(), { session: true });
    const res = await app.request('/proxy/v1/users/me/models', {
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    expect(upstreamHeaders('rag.test').get('Authorization')).toBe(
      'Bearer imt_test_token',
    );
  });
});
