// A7(wizard-sso-followup): sso-admin 路由测试。
// mock sso-store(不触碰 bff/data);合并语义经真实 sso-config(纯 env 路径 stub)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../services/sso-store', () => ({
  readSsoRuntimeConfig: vi.fn(),
  writeSsoRuntimeConfig: vi.fn(),
  clearSsoRuntimeConfig: vi.fn(),
}));

import { ssoAdminRoutes } from './sso-admin';
import {
  readSsoRuntimeConfig,
  writeSsoRuntimeConfig,
  clearSsoRuntimeConfig,
} from '../services/sso-store';
import { authMiddleware } from '../middleware/auth';
import { clearImtSessionCache, requireValidImtSession } from '../middleware/imt-session-guard';

function createApp() {
  const app = new Hono();
  app.route('/', ssoAdminRoutes as unknown as Hono);
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
