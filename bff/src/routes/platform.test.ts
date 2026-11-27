import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createPlatformRoutes, resolvePlatformSuffix } from './platform';

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

describe('createPlatformRoutes', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
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