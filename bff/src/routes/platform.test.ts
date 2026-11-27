import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  clearKbPlatformAdminAuthCache,
  createPlatformRoutes,
  injectRequiresAdminAuth,
  kbPlatformAdminAuthOK,
  resolvePlatformSuffix,
  shouldInjectKbPlatformAdminToken,
} from './platform';

describe('resolvePlatformSuffix', () => {
  it('剥 /platform 前缀', () => {
    expect(resolvePlatformSuffix('/platform/catalog/overview')).toBe(
      '/catalog/overview',
    );
  });

  it('剥 /api/bff/platform 前缀', () => {
    expect(resolvePlatformSuffix('/api/bff/platform/live')).toBe('/live');
  });

  it('非 platform 路径返回 undefined', () => {
    expect(resolvePlatformSuffix('/proxy/v1/agents')).toBeUndefined();
  });
});

describe('shouldInjectKbPlatformAdminToken', () => {
  it('allowlists exact catalog GET paths', () => {
    expect(shouldInjectKbPlatformAdminToken('GET', '/catalog/overview')).toBe(
      true,
    );
    expect(shouldInjectKbPlatformAdminToken('GET', '/catalog/instances')).toBe(
      true,
    );
    expect(
      shouldInjectKbPlatformAdminToken('GET', '/catalog/schemas/md'),
    ).toBe(true);
    expect(
      shouldInjectKbPlatformAdminToken('GET', '/catalog/instances/kid_1'),
    ).toBe(true);
    expect(
      shouldInjectKbPlatformAdminToken(
        'GET',
        '/catalog/instances/kid_1/config',
      ),
    ).toBe(true);
  });

  it('rejects writes, probes, and extra segments', () => {
    expect(
      shouldInjectKbPlatformAdminToken('POST', '/catalog/instances'),
    ).toBe(false);
    expect(shouldInjectKbPlatformAdminToken('GET', '/status')).toBe(false);
    expect(
      shouldInjectKbPlatformAdminToken(
        'GET',
        '/catalog/instances/kid_1/heartbeat',
      ),
    ).toBe(false);
  });
});

describe('injectRequiresAdminAuth', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH;
  });

  it('defaults to true', () => {
    delete process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH;
    expect(injectRequiresAdminAuth()).toBe(true);
  });

  it('false/0/no/off disable the gate', () => {
    process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH = 'false';
    expect(injectRequiresAdminAuth()).toBe(false);
  });
});

describe('kbPlatformAdminAuthOK', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
    clearKbPlatformAdminAuthCache();
    vi.restoreAllMocks();
  });

  it('returns false without proof', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    await expect(
      kbPlatformAdminAuthOK({ upstreamFetch }),
    ).resolves.toBe(false);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('probes /api/v1/admin/auth with cookie', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        cookieHeader: 'kb_admin_session=jwt-here; other=1',
      }),
    ).resolves.toBe(true);
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      'http://kb-platform.test:9381/api/v1/admin/auth',
    );
    const init = upstreamFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get('Cookie')).toBe(
      'kb_admin_session=jwt-here',
    );
  });

  it('probes with Bearer authorization', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        authorization: 'Bearer admin-jwt',
      }),
    ).resolves.toBe(true);
    const init = upstreamFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer admin-jwt',
    );
  });

  it('returns false on non-200', async () => {
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 401 }),
    );
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        cookieHeader: 'kb_admin_session=bad',
      }),
    ).resolves.toBe(false);
  });

  it('returns false on 403 forbidden', async () => {
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 403 }),
    );
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        cookieHeader: 'kb_admin_session=not-super',
      }),
    ).resolves.toBe(false);
  });

  it('returns false when probe throws', async () => {
    const upstreamFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        cookieHeader: 'kb_admin_session=x',
      }),
    ).resolves.toBe(false);
  });

  it('caches successful auth for TTL and skips second probe', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    const now = vi.fn(() => 1_000_000);
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        cookieHeader: 'kb_admin_session=cached-jwt',
        now,
      }),
    ).resolves.toBe(true);
    await expect(
      kbPlatformAdminAuthOK({
        upstreamFetch,
        cookieHeader: 'kb_admin_session=cached-jwt',
        now,
      }),
    ).resolves.toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
});

describe('createPlatformRoutes', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
    delete process.env.KB_PLATFORM_ADMIN_TOKEN;
    delete process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH;
    clearKbPlatformAdminAuthCache();
    vi.restoreAllMocks();
  });

  it('GET overview 代理到 KB_PLATFORM_URL 并透传 v2 envelope', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const envelope = { code: 0, message: 'ok', data: { by_kind: {} } };
    const upstreamFetch = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        'http://kb-platform.test:9381/api/v1/platform/catalog/overview',
      );
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));

    const res = await app.request('/platform/catalog/overview', {
      method: 'GET',
      headers: { Authorization: 'Bearer platform-admin' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(envelope);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get('Authorization')).toBe(
      'Bearer platform-admin',
    );
  });

  it('上游不可达时返回 502 v2 envelope', async () => {
    const upstreamFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));

    const res = await app.request('/platform/status');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe(50200);
  });
});

describe('KB_PLATFORM_ADMIN_TOKEN injection', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
    delete process.env.KB_PLATFORM_ADMIN_TOKEN;
    delete process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH;
    clearKbPlatformAdminAuthCache();
    vi.restoreAllMocks();
  });

  it('does not inject without admin session when gate is on (default)', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ code: 0 }), { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', { method: 'GET' });
    const [, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });

  it('injects after /admin/auth 200 with kb_admin_session cookie', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/v1/admin/auth')) {
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', {
      method: 'GET',
      headers: { Cookie: 'kb_admin_session=super-jwt' },
    });
    expect(upstreamFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const catalogCall = upstreamFetch.mock.calls.find(([u]) =>
      String(u).includes('/api/v1/platform/catalog/overview'),
    ) as unknown as [string, RequestInit];
    expect((catalogCall[1].headers as Headers).get('Authorization')).toBe(
      'Bearer bff-admin',
    );
  });

  it('does not inject when /admin/auth fails', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/v1/admin/auth')) {
        return new Response('{}', { status: 401 });
      }
      return new Response('{}', { status: 200 });
    });
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', {
      method: 'GET',
      headers: { Cookie: 'kb_admin_session=bad' },
    });
    const catalogCall = upstreamFetch.mock.calls.find(([u]) =>
      String(u).includes('/catalog/overview'),
    ) as unknown as [string, RequestInit];
    expect((catalogCall[1].headers as Headers).get('Authorization')).toBeNull();
  });

  it('does not inject when /admin/auth returns 403', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/v1/admin/auth')) {
        return new Response('{}', { status: 403 });
      }
      return new Response('{}', { status: 200 });
    });
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', {
      method: 'GET',
      headers: { Cookie: 'kb_admin_session=user-jwt' },
    });
    const catalogCall = upstreamFetch.mock.calls.find(([u]) =>
      String(u).includes('/catalog/overview'),
    ) as unknown as [string, RequestInit];
    expect((catalogCall[1].headers as Headers).get('Authorization')).toBeNull();
  });

  it('flag false restores 1a inject without admin session', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH = 'false';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ code: 0 }), { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', { method: 'GET' });
    const [, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer bff-admin',
    );
  });

  it('does not overwrite client Authorization', async () => {
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', {
      method: 'GET',
      headers: { Authorization: 'Bearer client-tok' },
    });
    const [, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer client-tok',
    );
  });

  it('does not inject on POST instances', async () => {
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH = 'false';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/instances', {
      method: 'POST',
      body: '{}',
    });
    const [, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });

  it('does not inject on GET /status', async () => {
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH = 'false';
    const upstreamFetch = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/status', { method: 'GET' });
    const [, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });
});
