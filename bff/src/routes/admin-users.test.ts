import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminUserRoutes } from './admin-users';

function appWithFetch(upstreamFetch: typeof fetch): Hono {
  const app = new Hono();
  app.route('/', createAdminUserRoutes({ upstreamFetch }));
  return app;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('admin users backend proxy', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_ADMIN;
    delete process.env.KB_PLATFORM_URL;
    delete process.env.INTELLECT_ADMIN_URL;
    vi.restoreAllMocks();
  });

  it('C8.1 python mode forwards Flask response unchanged', async () => {
    process.env.KB_PLATFORM_ADMIN = 'python';
    process.env.INTELLECT_ADMIN_URL = 'http://flask-admin.test:9381';
    const flaskBody = { code: 40401, message: 'flask-shaped', data: null };
    const upstreamFetch = vi.fn<typeof fetch>(async () => jsonResponse(200, flaskBody));
    const res = await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/users/user%40example.com?verbose=1',
      { method: 'GET' },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(flaskBody);
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      'http://flask-admin.test:9381/api/v1/admin/users/user%40example.com?verbose=1',
    );
  });

  it('C8.2 C8.3 go success becomes Flask-style HTTP 200 code 0', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const rows = [{ email: 'user@example.com' }];
    const upstreamFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { code: 0, message: 'Get all users', data: rows }),
    );
    const res = await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/users',
      { method: 'GET' },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: 0,
      message: 'Get all users',
      data: rows,
    });
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      'http://kb-platform.test:9381/api/v1/admin/users',
    );
  });

  it.each([
    ['C8.4', 404, 40401, '/api/v1/admin/users/missing%40example.com', 'GET'],
    ['C8.5', 409, 40901, '/api/v1/admin/users/admin%40example.com/admin', 'PUT'],
  ])(
    '%s Go business error becomes HTTP 200 with data null',
    async (_name, goStatus, goCode, path, method) => {
      process.env.KB_PLATFORM_ADMIN = 'go';
      process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
      process.env.INTELLECT_ADMIN_URL = 'http://flask-admin.test:9381';
      const upstreamFetch = vi.fn<typeof fetch>(async () =>
        jsonResponse(goStatus, { code: goCode, message: 'failed', data: {} }),
      );
      const res = await appWithFetch(upstreamFetch as typeof fetch).request(path, {
        method,
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        code: goCode,
        message: 'failed',
        data: null,
      });
      expect(upstreamFetch).toHaveBeenCalledOnce();
    },
  );

  it('C8.7 exact DELETE user 501 falls back to Flask', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.INTELLECT_ADMIN_URL = 'http://flask-admin.test:9381';
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(501, { code: 50101, message: 'use Flask', data: {} }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { code: 0, message: 'deleted by Flask', data: null }),
      );
    const res = await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/users/user%40example.com',
      { method: 'DELETE' },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: 0,
      message: 'deleted by Flask',
      data: null,
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      'http://kb-platform.test:9381/api/v1/admin/users/user%40example.com',
    );
    expect(String(upstreamFetch.mock.calls[1][0])).toBe(
      'http://flask-admin.test:9381/api/v1/admin/users/user%40example.com',
    );
  });

  it('C8.7 any 501 falls back to Flask', async () => {
    // 1b-rest: the fallback used to be limited to DELETE /users/:u. A 501 from
    // kb-platform always means "this build cannot serve it" (unconfigured store or
    // a capability left on Flask), so every Go-owned path falls back the same way.
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    process.env.INTELLECT_ADMIN_URL = 'http://flask-admin.test:9381';
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(501, { code: 50101, message: 'not configured', data: {} }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { code: 0, message: 'served by Flask', data: null }),
      );
    const res = await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/users/user%40example.com/keys/key',
      { method: 'DELETE' },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: 0,
      message: 'served by Flask',
      data: null,
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(String(upstreamFetch.mock.calls[1][0])).toBe(
      'http://flask-admin.test:9381/api/v1/admin/users/user%40example.com/keys/key',
    );
  });

  it('C8.8 missing KB_PLATFORM_ADMIN defaults to go', async () => {
    process.env.KB_PLATFORM_URL = 'http://kb-platform-default.test:9381';
    const upstreamFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { code: 0, message: 'ok', data: [] }),
    );
    await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/users',
    );
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      'http://kb-platform-default.test:9381/api/v1/admin/users',
    );
  });

  it('C8.10 declared oversized body is rejected without reaching upstream', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const upstreamFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { code: 0, message: 'ok', data: [] }),
    );
    const res = await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/users/user%40example.com/keys',
      {
        method: 'POST',
        headers: { 'content-length': String(9 * 1024 * 1024) },
        body: 'x',
      },
    );

    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe(41300);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('C8.11 chunked body over the limit is aborted mid-read', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 9) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const upstreamFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { code: 0, message: 'ok', data: [] }),
    );
    const res = await appWithFetch(upstreamFetch as typeof fetch).request(
      new Request('http://bff.test/api/v1/admin/users/user%40example.com/keys', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
    );

    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe(41300);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });

  it.each(['go', 'python'])(
    'C8.9 %s receives Bearer and Cookie headers',
    async (mode) => {
      process.env.KB_PLATFORM_ADMIN = mode;
      process.env.KB_PLATFORM_URL = 'http://kb-platform.test:9381';
      process.env.INTELLECT_ADMIN_URL = 'http://flask-admin.test:9381';
      const upstreamFetch = vi.fn<typeof fetch>(async () =>
        jsonResponse(200, { code: 0, message: 'ok', data: [] }),
      );
      await appWithFetch(upstreamFetch as typeof fetch).request(
        '/api/v1/admin/users',
        {
          headers: {
            Authorization: 'Bearer admin-jwt',
            Cookie: 'kb_admin_session=cookie-jwt; other=1',
          },
        },
      );
      const init = upstreamFetch.mock.calls[0][1] as RequestInit;
      expect((init.headers as Headers).get('Authorization')).toBe(
        'Bearer admin-jwt',
      );
      expect((init.headers as Headers).get('Cookie')).toBe(
        'kb_admin_session=cookie-jwt; other=1',
      );
    },
  );
});
