/**
 * imt-session-guard 测试(审计缺陷 A 修复):
 * 垃圾 cookie 拒绝、有效 token 放行、缓存命中不重复请求、
 * 社区模式直通、wizard/公开路径豁免、gateway 不可达 fail-closed。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import {
  clearImtSessionCache,
  requireValidImtSession,
  validateImtToken,
} from './imt-session-guard';

function buildApp(stores: Record<string, unknown> = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [k, v] of Object.entries(stores)) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set(k, v);
    }
    await next();
  });
  app.use('*', requireValidImtSession);
  app.get('/capabilities', (c) => c.json({ ok: true }));
  app.get('/admin/harness-backends', (c) => c.json({ ok: true }));
  return app;
}

const STORE = {
  harnessStore: {
    listConfigs: () => [
      { type: 'intellect-enterprise', endpoint: 'https://gw.example' },
    ],
  },
};

beforeEach(() => {
  clearImtSessionCache();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('validateImtToken(判定分类)', () => {
  it('200 → valid;401/403 → invalid;5xx/网络异常 → unreachable', async () => {
    const mk = (status: number) => vi.fn().mockResolvedValue(new Response('{}', { status }));
    expect(await validateImtToken('t', 'https://gw.example', mk(200) as unknown as typeof fetch)).toBe('valid');
    expect(await validateImtToken('t', 'https://gw.example', mk(401) as unknown as typeof fetch)).toBe('invalid');
    expect(await validateImtToken('t', 'https://gw.example', mk(503) as unknown as typeof fetch)).toBe('unreachable');
    const throwing = vi.fn().mockRejectedValue(new Error('net'));
    expect(await validateImtToken('t', 'https://gw.example', throwing as unknown as typeof fetch)).toBe('unreachable');
  });
});

describe('requireValidImtSession(企业模式默认开)', () => {
  beforeEach(() => {
    // 显式开启,不依赖进程默认——test-setup.ts 全局把该 flag 置为 'false',
    // 依赖默认值的用例在全量运行时会静默变成社区模式直通
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'true');
  });

  it('垃圾 cookie → 401(核心回归:原先可旁路)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await buildApp(STORE).request('/capabilities', {
      headers: { Cookie: 'imt_token=totally-fake-garbage' },
    });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('有效 token → 放行;60s 缓存内二次请求不再调 gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = buildApp(STORE);
    const r1 = await app.request('/capabilities', {
      headers: { Cookie: 'imt_token=real-token' },
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request('/admin/harness-backends', {
      headers: { Cookie: 'imt_token=real-token' },
    });
    expect(r2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce(); // 缓存命中
  });

  it('无 enterprise backend → 503;gateway 不可达 → 502 fail-closed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const noBackend = await buildApp({ harnessStore: { listConfigs: () => [] } }).request(
      '/capabilities',
      { headers: { Cookie: 'imt_token=t' } },
    );
    expect(noBackend.status).toBe(503);

    const down = await buildApp(STORE).request('/capabilities', {
      headers: { Cookie: 'imt_token=t' },
    });
    expect(down.status).toBe(502);
  });

  it('社区模式(flag=false)直通,不验证', async () => {
    vi.stubEnv('BFF_ENABLE_IMT_CANVAS_AGENTS', 'false');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await buildApp(STORE).request('/capabilities', {
      headers: { Cookie: 'imt_token=whatever' },
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wizard 路径豁免(首次安装无会话)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = buildApp(STORE);
    app.post('/admin/wizard/setup', (c) => c.json({ ok: true }));
    const res = await app.request('/admin/wizard/setup', {
      method: 'POST',
      headers: { Cookie: '' },
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
