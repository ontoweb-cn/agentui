import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import {
  createAihubRoutes,
  resolveAihubUpstreamPath,
} from './aihub';
import { authSessionMiddleware } from '../middleware/auth-session';
import type { AihubConfigResult } from '../services/aihub-assertion';

const { privateKey } = generateKeyPairSync('ed25519');

const okConfig: AihubConfigResult = {
  ok: true,
  config: {
    baseUrl: 'http://aihub.test',
    iss: 'gateway',
    aud: 'aihub',
    kid: 'kid-test',
    privateKey,
  },
};

describe('resolveAihubUpstreamPath', () => {
  it('maps BFF prefix to /api/v1/aihub', () => {
    expect(resolveAihubUpstreamPath('/api/bff/aihub/meta')).toBe(
      '/api/v1/aihub/meta',
    );
    expect(resolveAihubUpstreamPath('/aihub')).toBe('/api/v1/aihub');
    expect(resolveAihubUpstreamPath('/other')).toBeUndefined();
  });
});

describe('aihub proxy', () => {
  it('rejects requests without a host session', async () => {
    const auditSink = vi.fn();
    const app = new Hono();
    app.route(
      '/',
      createAihubRoutes({ configLoader: () => okConfig, auditSink }),
    );
    const res = await app.request('/aihub/meta');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AIHUB_SESSION_REQUIRED');
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'missing_session', feature: 'aihub' }),
    );
  });

  it('rejects write methods in M0', async () => {
    const app = new Hono();
    app.route('/', createAihubRoutes({ configLoader: () => okConfig }));
    const res = await app.request('/aihub/meta', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('allows POST only on admin paths (then enforces session)', async () => {
    const app = new Hono();
    app.route('/', createAihubRoutes({ configLoader: () => okConfig }));
    const res = await app.request('/aihub/admin/seed/import', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('AIHUB_SESSION_REQUIRED');
  });

  it('allows POST on the favorite toggle route only', async () => {
    const app = new Hono();
    app.route('/', createAihubRoutes({ configLoader: () => okConfig }));
    const favorite = await app.request('/aihub/assets/abc/favorite', {
      method: 'POST',
    });
    expect(favorite.status).toBe(401);
    expect((await favorite.json()).error).toBe('AIHUB_SESSION_REQUIRED');

    const otherWrite = await app.request('/aihub/assets/abc', {
      method: 'POST',
    });
    expect(otherWrite.status).toBe(405);
  });

  it('forwards request body for write methods and omits it for GET', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = new Hono();
    app.use('*', authSessionMiddleware);
    app.route(
      '/',
      createAihubRoutes({
        configLoader: () => okConfig,
        resolveMemberId: async () => 'member-1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => 1_000_000,
      }),
    );

    await app.request('/aihub/admin/seed/import', {
      method: 'POST',
      headers: {
        cookie: 'imt_token=token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ hello: 'world' }),
    });
    const [, postInit] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(await new Response(postInit.body).text()).toBe(
      JSON.stringify({ hello: 'world' }),
    );

    await app.request('/aihub/meta', {
      headers: { cookie: 'imt_token=token-1' },
    });
    const [, getInit] = fetchImpl.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(getInit.body).toBeUndefined();
  });

  it('returns 503 when proxy config is incomplete', async () => {
    const app = new Hono();
    app.route(
      '/',
      createAihubRoutes({
        configLoader: () => ({
          ok: false,
          statusCode: 503,
          error: 'AIHUB_PROXY_MISCONFIGURED',
          message: 'disabled',
        }),
      }),
    );
    const res = await app.request('/aihub/meta');
    expect(res.status).toBe(503);
  });

  it('rejects streamed request bodies above the proxy limit', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      await new Response(init.body).arrayBuffer();
      return new Response('{}', { status: 200 });
    });
    const app = new Hono();
    app.use('*', authSessionMiddleware);
    app.route(
      '/',
      createAihubRoutes({
        configLoader: () => okConfig,
        resolveMemberId: async () => 'member-1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const res = await app.request('/aihub/admin/seed/import', {
      method: 'POST',
      headers: {
        cookie: 'imt_token=token-1',
        'content-type': 'application/octet-stream',
      },
      body: 'x'.repeat(8 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps upstream network failure to 502', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const app = new Hono();
    app.use('*', authSessionMiddleware);
    app.route(
      '/',
      createAihubRoutes({
        configLoader: () => okConfig,
        resolveMemberId: async () => 'member-1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => 1_000_000,
      }),
    );
    const res = await app.request('/aihub/meta', {
      headers: { cookie: 'imt_token=token-1' },
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AIHUB_UPSTREAM_UNREACHABLE');
  });

  it('injects assertion and forwards to /api/v1/aihub', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = new Hono();
    app.use('*', authSessionMiddleware);
    app.route(
      '/',
      createAihubRoutes({
        configLoader: () => okConfig,
        resolveMemberId: async () => 'member-1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => 1_000_000,
        requestIdFactory: () => 'req-test',
      }),
    );
    const res = await app.request('/aihub/meta', {
      headers: { cookie: 'imt_token=token-1' },
    });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://aihub.test/api/v1/aihub/meta');
    const headers = init.headers as Headers;
    const assertion = headers.get('X-Aihub-Assertion');
    expect(assertion?.split('.')).toHaveLength(3);
    expect(headers.get('X-Request-Id')).toBe('req-test');
  });
});
