// A7(wizard-sso-followup): sso-admin 路由测试。
// mock sso-store(不触碰 bff/data);合并语义经真实 sso-config(纯 env 路径 stub)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../services/sso-store', () => ({
  readSsoRuntimeConfig: vi.fn(),
  writeSsoRuntimeConfig: vi.fn(),
  clearSsoRuntimeConfig: vi.fn(),
}));
// v1.4:检测服务与渠道拉取 mock(路由层只关心结果)
vi.mock('../services/enterprise-sso-check', () => ({
  verifyEnterpriseSso: vi.fn(),
  GATEWAY_BASE_HINT: 'TEST_HINT',
  TENANT_ID_RE: /^[0-9a-fA-F]{32}$/,
}));
vi.mock('../services/sso-providers', () => ({
  getLoginProviders: vi.fn(),
}));
vi.mock('../services/tenant-validator', () => ({
  fetchTenantInfo: vi.fn().mockResolvedValue(null),
  validateTenantConfigs: vi.fn(),
}));

import { ssoAdminRoutes } from './sso-admin';
import {
  readSsoRuntimeConfig,
  writeSsoRuntimeConfig,
  clearSsoRuntimeConfig,
} from '../services/sso-store';
import { verifyEnterpriseSso } from '../services/enterprise-sso-check';
import { getLoginProviders } from '../services/sso-providers';
import { authMiddleware } from '../middleware/auth';
import { clearImtSessionCache, requireValidImtSession } from '../middleware/imt-session-guard';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { HarnessBackend } from '../types/harness';
import type { BffTenant } from '../types/tenant';

function createApp() {
  const app = new Hono();
  app.route('/', ssoAdminRoutes as unknown as Hono);
  return app;
}

/** v1.4:注入默认租户 '0' 绑定企业后端的 app(守卫/检测/providers 用) */
function createAppWithBackend(backend: Partial<HarnessBackend> | null) {
  const app = new Hono<{
    Variables: { harnessStore: HarnessStore; backendStore: BackendStore };
  }>();
  app.use('*', async (c, next) => {
    const tenant: BffTenant | undefined = backend
      ? ({
          id: '0',
          name: 'T0',
          intellectBackendId: backend.id ?? 'ent-default',
          createdAt: '',
          updatedAt: '',
        } as BffTenant)
      : undefined;
    const backendStore = {
      load: vi.fn(),
      getBackend: vi.fn((id: string) => (id === '0' ? tenant : undefined)),
      listBackends: vi.fn(() => (tenant ? [tenant] : [])),
    } as unknown as BackendStore;
    const harnessStore = {
      get: vi.fn((id: string) =>
        backend ? ({ id, type: 'intellect-enterprise', endpoint: 'http://gw.example', ...backend } as HarnessBackend) : undefined,
      ),
      list: vi.fn(() => []),
    } as unknown as HarnessStore;
    c.set('backendStore', backendStore);
    c.set('harnessStore', harnessStore);
    await next();
  });
  app.route(
    '/',
    ssoAdminRoutes as unknown as Hono<{
      Variables: { harnessStore: HarnessStore; backendStore: BackendStore };
    }>,
  );
  return app;
}

const runtimeSample = {
  enabled: true,
  publicOrigin: 'https://rt.example.com',
  providers: ['intellect-auth'],
  silentRelogin: true,
  updatedAt: '2026-11-21T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BFF_SSO_STATE_SECRET', 'x'.repeat(40));
  vi.stubEnv('BFF_SSO_ENABLED', 'false');
  vi.stubEnv('BFF_PUBLIC_ORIGIN', '');
  vi.stubEnv('BFF_SSO_PROVIDERS', '');
});

describe('sso-admin 路由 (A7)', () => {
  it('GET 无 runtime 文件 → 生效值回落 env,sources=env', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    const res = await createApp().request('/admin/sso/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.config.enabled).toBe(false); // env BFF_SSO_ENABLED=false
    expect(body.data.sources.enabled).toBe('env');
    expect(body.data.runtime).toBeNull();
    expect(body.data.stateSecretConfigured).toBe(true);
  });

  it('GET 有 runtime 文件 → 生效值取 runtime,sources=runtime', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(runtimeSample);
    const res = await createApp().request('/admin/sso/config');
    const body = await res.json();
    expect(body.data.config.enabled).toBe(true);
    expect(body.data.config.publicOrigin).toBe('https://rt.example.com');
    expect(body.data.sources.publicOrigin).toBe('runtime');
  });

  it('PUT 合法最小集 → writeSsoRuntimeConfig 被调用(归一化入参)', async () => {
    vi.mocked(writeSsoRuntimeConfig).mockReturnValue(runtimeSample);
    const res = await createApp().request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        public_origin: 'https://rt.example.com/',
        providers: ['intellect-auth'],
        silent_relogin: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(writeSsoRuntimeConfig).toHaveBeenCalledWith({
      enabled: true,
      publicOrigin: 'https://rt.example.com/',
      providers: ['intellect-auth'],
      silentRelogin: true,
    });
  });

  it('PUT enabled 非布尔 → 400', async () => {
    const res = await createApp().request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT enabled=true 且 publicOrigin 非法 → 400', async () => {
    const res = await createApp().request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, publicOrigin: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('publicOrigin');
  });

  it('PUT providers 非数组 → 400', async () => {
    const res = await createApp().request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, providers: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT 启用但 env 密钥缺失 → 200 + 非阻断 warning', async () => {
    vi.stubEnv('BFF_SSO_STATE_SECRET', '');
    vi.mocked(writeSsoRuntimeConfig).mockReturnValue(runtimeSample);
    const res = await createApp().request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, publicOrigin: 'https://rt.example.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.warnings.some((w: string) => w.includes('BFF_SSO_STATE_SECRET'))).toBe(true);
  });

  it('PUT 不接受 secret 类字段(写入口不含 stateSecret)', async () => {
    vi.mocked(writeSsoRuntimeConfig).mockReturnValue(runtimeSample);
    await createApp().request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
        stateSecret: 'should-be-ignored',
        publicOrigin: 'https://rt.example.com',
      }),
    });
    const arg = vi.mocked(writeSsoRuntimeConfig).mock.calls[0][0];
    expect(Object.keys(arg)).toEqual(['enabled', 'publicOrigin', 'providers', 'silentRelogin']);
  });

  it('DELETE → 清除运行时配置并返回 env 生效视图', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    const res = await createApp().request('/admin/sso/config', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(clearSsoRuntimeConfig).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.data.sources.enabled).toBe('env');
  });
});

// ---------------------------------------------------------------------------
// 鉴权门控(评审补强):index.ts 同款双层 authMiddleware + requireValidImtSession。
// 此前 9 例直连路由(app 无中间件),未覆盖"谁能改全局 SSO 配置"——
// authMiddleware 是纯存在性检查,垃圾 cookie 原本可写运行时配置(评审 P1)。
// 注:社区模式 requireValidImtSession 直通(与既有 /admin/* 一致),此处不为其
// 弱放行路径建绿测试,仅以"无凭据 401"固化存在性底线。
// ---------------------------------------------------------------------------
describe('sso-admin 鉴权门控(评审补强)', () => {
  const ENTERPRISE_STORE = {
    harnessStore: {
      list: () => [{ type: 'intellect-enterprise', endpoint: 'https://gw.example' }],
    },
  };

  function createGuardedApp(stores: Record<string, unknown> = {}) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      for (const [k, v] of Object.entries(stores)) {
        (c as unknown as { set: (k: string, v: unknown) => void }).set(k, v);
      }
      await next();
    });
    app.use('/admin/sso/*', authMiddleware);
    app.use('/admin/sso/*', requireValidImtSession);
    app.route('/', ssoAdminRoutes as unknown as Hono);
    return app;
  }

  beforeEach(() => {
    clearImtSessionCache();
    vi.unstubAllGlobals();
  });

  it('企业模式:PUT 无凭据 → 401(authMiddleware 存在性检查,变更面)', async () => {
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'true');
    const res = await createGuardedApp().request('/admin/sso/config', { method: 'PUT' });
    expect(res.status).toBe(401);
  });

  it('企业模式:垃圾 cookie → 401(requireValidImtSession 后端实校,原缺口回归)', async () => {
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'true');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await createGuardedApp(ENTERPRISE_STORE).request('/admin/sso/config', {
      headers: { Cookie: 'imt_token=totally-fake-garbage' },
    });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('企业模式:有效 token → 放行进入路由(200)', async () => {
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'true');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    const res = await createGuardedApp(ENTERPRISE_STORE).request('/admin/sso/config', {
      headers: { Cookie: 'imt_token=real-token' },
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('企业模式:认证源不可达 → 502 fail-closed', async () => {
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const res = await createGuardedApp(ENTERPRISE_STORE).request('/admin/sso/config', {
      headers: { Cookie: 'imt_token=whatever' },
    });
    expect(res.status).toBe(502);
  });

  it('社区模式:guard 直通,authMiddleware 仍要求凭据存在(无凭据 401)', async () => {
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'false');
    const res = await createGuardedApp().request('/admin/sso/config');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// v1.4 管理页扩展(设计 §11.2/§11.3 + §12 R-3/R-4/R-5):
// stateSecret 三态 / boundBackend / ?check=1 / providers 预览 / PUT 守卫
// ---------------------------------------------------------------------------

const entBackend = { id: 'ent-default', endpoint: 'http://gw.example', adminToken: 'gw-key' };

describe('sso-admin v1.4 管理页扩展', () => {
  it('V-01: stateSecretStatus 三态(unset/set/invalid),stateSecretConfigured 兼容位=set', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    vi.stubEnv('BFF_SSO_STATE_SECRET', '');
    let body = await (await createApp().request('/admin/sso/config')).json();
    expect(body.data.stateSecretStatus).toBe('unset');
    expect(body.data.stateSecretConfigured).toBe(false);

    vi.stubEnv('BFF_SSO_STATE_SECRET', 'short');
    body = await (await createApp().request('/admin/sso/config')).json();
    expect(body.data.stateSecretStatus).toBe('invalid');
    expect(body.data.stateSecretConfigured).toBe(false);

    vi.stubEnv('BFF_SSO_STATE_SECRET', 'x'.repeat(40));
    body = await (await createApp().request('/admin/sso/config')).json();
    expect(body.data.stateSecretStatus).toBe('set');
    expect(body.data.stateSecretConfigured).toBe(true);
    // 永不回显密钥值
    expect(JSON.stringify(body)).not.toContain('xxxx');
  });

  it('V-02: view.boundBackend 反映默认租户绑定(有→对象,无→null,stores 缺失→undefined)', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    let body = await (await createAppWithBackend(entBackend).request('/admin/sso/config')).json();
    expect(body.data.boundBackend).toEqual({ id: 'ent-default', endpoint: 'http://gw.example' });

    body = await (await createAppWithBackend(null).request('/admin/sso/config')).json();
    expect(body.data.boundBackend).toBeNull();

    body = await (await createApp().request('/admin/sso/config')).json();
    expect(body.data.boundBackend).toBeUndefined();
  });

  it('V-03: ?check=1 → 服务端实时四项检测(复用 verifyEnterpriseSso)', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    vi.mocked(verifyEnterpriseSso).mockResolvedValue({
      healthy: true,
      sso: { gatewayOk: true, tenantId: 'a'.repeat(32), keyValid: true, providersOk: true, providerCount: 2 },
    });
    const res = await createAppWithBackend(entBackend).request('/admin/sso/config?check=1');
    const body = await res.json();
    expect(body.data.check.boundBackendMissing).toBe(false);
    expect(body.data.check.status).toMatchObject({
      gatewayOk: true,
      tenantId: 'a'.repeat(32),
      keyValid: true,
      providersOk: true,
      providerCount: 2,
    });
    expect(vi.mocked(verifyEnterpriseSso)).toHaveBeenCalledWith(
      'http://gw.example',
      null, // tenant-validator 已 mock:fetchTenantInfo → null
      'gw-key',
    );
  });

  it('V-04: ?check=1 未绑定后端 → boundBackendMissing=true', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    const body = await (await createAppWithBackend(null).request('/admin/sso/config?check=1')).json();
    expect(body.data.check.boundBackendMissing).toBe(true);
    expect(body.data.check.status).toBeNull();
  });

  it('V-05: GET /admin/sso/providers → 裁剪视图;无绑定 → 400;上游失败 → 502', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    vi.mocked(getLoginProviders).mockResolvedValue({
      providers: [
        { id: 'intellect-auth', displayName: '统一认证', icon: 'sso', clientId: 'secret-c', authorizeUrl: 'https://idp', scopes: 'openid' },
      ],
      misconfigured: ['broken'],
    });
    const ok = await createAppWithBackend(entBackend).request('/admin/sso/providers');
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.data.providers[0]).toEqual({ id: 'intellect-auth', displayName: '统一认证', icon: 'sso' });
    expect(JSON.stringify(okBody)).not.toContain('secret-c');

    const noBackend = await createAppWithBackend(null).request('/admin/sso/providers');
    expect(noBackend.status).toBe(400);

    vi.mocked(getLoginProviders).mockRejectedValue(new Error('provider list returned 500'));
    const bad = await createAppWithBackend(entBackend).request('/admin/sso/providers');
    expect(bad.status).toBe(502);
  });

  it('V-06: PUT 启用守卫(R-3)——后端缺失→warning;后端未就绪→warning;就绪→无后端 warning', async () => {
    vi.mocked(readSsoRuntimeConfig).mockReturnValue(null);
    vi.mocked(writeSsoRuntimeConfig).mockReturnValue(runtimeSample);

    const missing = await createAppWithBackend(null).request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, publicOrigin: 'https://rt.example.com' }),
    });
    let body = await missing.json();
    expect(body.data.warnings.some((w: string) => w.includes('未绑定企业后端'))).toBe(true);

    const notReady = await createAppWithBackend({ id: 'ent-default', endpoint: 'http://gw.example', adminToken: '' }).request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, publicOrigin: 'https://rt.example.com' }),
    });
    body = await notReady.json();
    expect(body.data.warnings.some((w: string) => w.includes('未就绪'))).toBe(true);

    const ready = await createAppWithBackend(entBackend).request('/admin/sso/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, publicOrigin: 'https://rt.example.com' }),
    });
    body = await ready.json();
    expect(body.data.warnings.some((w: string) => w.includes('未绑定企业后端'))).toBe(false);
    expect(body.data.warnings.some((w: string) => w.includes('未就绪'))).toBe(false);
  });
});
