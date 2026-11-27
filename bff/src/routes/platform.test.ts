import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  createPlatformRoutes,
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

describe('createPlatformRoutes', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
    delete process.env.KB_PLATFORM_ADMIN_TOKEN;
    vi.restoreAllMocks();
  });

  it('GET overview 代理到 KB_PLATFORM_URL 并透传 v2 envelope', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const envelope = { code: 0, message: 'ok', data: { by_kind: {} } };
    const upstreamFetch = vi.fn(async (url: string | URL | Request) => {
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
    const [, init] = upstreamFetch.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get('Authorization')).toBe(
      'Bearer platform-admin',
    );
  });

  it('上游不可达时返回 502 v2 envelope', async () => {
    const upstreamFetch = vi.fn(async () => {
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
    vi.restoreAllMocks();
  });

  it('injects admin Bearer on allowlisted GET when client omits Authorization', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 0 }), { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', { method: 'GET' });
    const [, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer bff-admin',
    );
  });

  it('does not overwrite client Authorization', async () => {
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/overview', {
      method: 'GET',
      headers: { Authorization: 'Bearer client-tok' },
    });
    const [, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer client-tok',
    );
  });

  it('does not inject on POST instances', async () => {
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/catalog/instances', {
      method: 'POST',
      body: '{}',
    });
    const [, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });

  it('does not inject on GET /status', async () => {
    process.env.KB_PLATFORM_ADMIN_TOKEN = 'bff-admin';
    const upstreamFetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    );
    const app = new Hono();
    app.route('/', createPlatformRoutes({ upstreamFetch }));
    await app.request('/platform/status', { method: 'GET' });
    const [, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });
});