import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminUserRoutes, ownedByGo } from './admin-users';

const GO = 'http://kb-platform.test:9381';
const FLASK = 'http://flask-admin.test:9381';

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

function upstreamSpy() {
  return vi.fn<typeof fetch>(async () =>
    jsonResponse(200, { code: 0, message: 'ok', data: [] }),
  );
}

describe('1b-rest admin proxy ownership', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_ADMIN;
    delete process.env.KB_PLATFORM_URL;
    delete process.env.INTELLECT_ADMIN_URL;
    vi.restoreAllMocks();
  });

  it('R1 ownedByGo matches the Go-owned surface only', () => {
    expect(ownedByGo('GET', '/api/v1/admin/services')).toBe(true);
    expect(ownedByGo('GET', '/api/v1/admin/services/0')).toBe(true);
    expect(ownedByGo('GET', '/api/v1/admin/configs')).toBe(true);
    expect(ownedByGo('GET', '/api/v1/admin/environments')).toBe(true);
    expect(ownedByGo('GET', '/api/v1/admin/version')).toBe(true);
    expect(ownedByGo('GET', '/api/v1/admin/variables')).toBe(true);
    expect(ownedByGo('PUT', '/api/v1/admin/variables')).toBe(true);
    expect(ownedByGo('GET', '/api/v1/admin/sandbox/providers')).toBe(true);

    // Still Flask-owned: no Go implementation exists for these.
    expect(ownedByGo('PUT', '/api/v1/admin/services/0')).toBe(false);
    expect(ownedByGo('DELETE', '/api/v1/admin/services/0')).toBe(false);
    expect(ownedByGo('GET', '/api/v1/admin/service_types/intellect_server')).toBe(false);
    expect(ownedByGo('GET', '/api/v1/admin/sandbox/config')).toBe(false);
    expect(ownedByGo('POST', '/api/v1/admin/sandbox/config')).toBe(false);
    expect(ownedByGo('POST', '/api/v1/admin/sandbox/test')).toBe(false);
    expect(ownedByGo('GET', '/api/v1/admin/sandbox/providers/local/schema')).toBe(false);
    expect(ownedByGo('GET', '/api/v1/admin/log_levels')).toBe(false);
    expect(ownedByGo('POST', '/api/v1/admin/roles')).toBe(false);
  });

  it('R2 GET /services is served by kb-platform', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = GO;
    process.env.INTELLECT_ADMIN_URL = FLASK;
    const upstreamFetch = upstreamSpy();
    await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/services',
    );
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(`${GO}/api/v1/admin/services`);
  });

  it('R3 Flask-only service and sandbox paths stay on Flask', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = GO;
    process.env.INTELLECT_ADMIN_URL = FLASK;

    for (const [method, path] of [
      ['PUT', '/api/v1/admin/services/0'],
      ['DELETE', '/api/v1/admin/services/0'],
      ['GET', '/api/v1/admin/sandbox/config'],
      ['POST', '/api/v1/admin/sandbox/test'],
      ['GET', '/api/v1/admin/sandbox/providers/ssh/schema'],
    ] as const) {
      const upstreamFetch = upstreamSpy();
      await appWithFetch(upstreamFetch as typeof fetch).request(path, { method });
      expect(String(upstreamFetch.mock.calls[0][0])).toBe(`${FLASK}${path}`);
    }
  });

  it('R4 GET /sandbox/providers is served by kb-platform', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = GO;
    process.env.INTELLECT_ADMIN_URL = FLASK;
    const upstreamFetch = upstreamSpy();
    await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/sandbox/providers',
    );
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      `${GO}/api/v1/admin/sandbox/providers`,
    );
  });

  it('R5 variables GET and PUT are served by kb-platform', async () => {
    process.env.KB_PLATFORM_ADMIN = 'go';
    process.env.KB_PLATFORM_URL = GO;
    process.env.INTELLECT_ADMIN_URL = FLASK;

    const getSpy = upstreamSpy();
    await appWithFetch(getSpy as typeof fetch).request('/api/v1/admin/variables');
    expect(String(getSpy.mock.calls[0][0])).toBe(`${GO}/api/v1/admin/variables`);

    const putSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { code: 0, message: 'Set variable successfully', data: {} }),
    );
    await appWithFetch(putSpy as typeof fetch).request('/api/v1/admin/variables', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ var_name: 'a.b', var_value: 'c' }),
    });
    expect(String(putSpy.mock.calls[0][0])).toBe(`${GO}/api/v1/admin/variables`);
  });

  it('R6 python mode keeps every new path on Flask', async () => {
    process.env.KB_PLATFORM_ADMIN = 'python';
    process.env.KB_PLATFORM_URL = GO;
    process.env.INTELLECT_ADMIN_URL = FLASK;
    const upstreamFetch = upstreamSpy();
    await appWithFetch(upstreamFetch as typeof fetch).request(
      '/api/v1/admin/environments',
    );
    expect(String(upstreamFetch.mock.calls[0][0])).toBe(
      `${FLASK}/api/v1/admin/environments`,
    );
  });
});
