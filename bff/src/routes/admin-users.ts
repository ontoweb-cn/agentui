import { Hono, type Context } from 'hono';
import { getKbPlatformBaseUrl } from '../utils/kb-platform-base-url';
import { streamResponse } from '../utils/response';

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;
const DELETE_USER_PATH = /^\/api\/v1\/admin\/users\/[^/]+$/;

export type AdminUserFetch = typeof fetch;

export interface AdminUserRouteDeps {
  upstreamFetch?: AdminUserFetch;
}

function getFlaskAdminBaseUrl(): string {
  return (process.env.INTELLECT_ADMIN_URL?.trim() || 'http://127.0.0.1:9381').replace(
    /\/+$/,
    '',
  );
}

type ProxyRequest = {
  method: string;
  path: string;
  search: string;
  headers: Headers;
  body?: BodyInit;
};

async function fetchUpstream(
  upstreamFetch: AdminUserFetch,
  baseUrl: string,
  req: ProxyRequest,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await upstreamFetch(`${baseUrl}${req.path}${req.search}`, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamError(err: unknown): Response {
  const message =
    err instanceof Error && err.name === 'AbortError'
      ? 'admin upstream timeout'
      : 'admin upstream unreachable';
  return new Response(
    JSON.stringify({ code: 50200, message, data: null }),
    { status: 502, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Convert Go's real-HTTP-status envelope to the Flask shape AgentUI consumes. */
export async function adaptV2ToFlask(upstream: Response): Promise<Response> {
  let payload: { code?: unknown; message?: unknown; data?: unknown };
  try {
    payload = await upstream.json();
  } catch {
    return new Response(
      JSON.stringify({ code: 50200, message: 'invalid kb-platform response', data: null }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (typeof payload.code !== 'number' || typeof payload.message !== 'string') {
    return new Response(
      JSON.stringify({ code: 50200, message: 'invalid kb-platform response', data: null }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const success = upstream.status >= 200 && upstream.status < 300 && payload.code === 0;
  return new Response(
    JSON.stringify({
      code: payload.code,
      message: payload.message,
      data: success ? payload.data : null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

export function createAdminUserRoutes(deps: AdminUserRouteDeps = {}): Hono {
  const upstreamFetch = deps.upstreamFetch ?? fetch;
  const routes = new Hono();

  const handle = async (c: Context): Promise<Response> => {
    const method = c.req.method.toUpperCase();
    const headers = new Headers();
    for (const name of ['content-type', 'accept', 'authorization', 'cookie']) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }

    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD' && c.req.raw.body) {
      const buf = Buffer.from(await c.req.raw.arrayBuffer());
      if (buf.length > MAX_PROXY_BODY_BYTES) {
        return new Response(
          JSON.stringify({ code: 41300, message: 'payload too large', data: null }),
          { status: 413, headers: { 'Content-Type': 'application/json' } },
        );
      }
      body = buf;
    }

    const req: ProxyRequest = {
      method,
      path: c.req.path,
      search: new URL(c.req.url).search,
      headers,
      body,
    };
    const mode = process.env.KB_PLATFORM_ADMIN?.trim().toLowerCase() || 'go';

    if (mode === 'python') {
      try {
        const flask = await fetchUpstream(upstreamFetch, getFlaskAdminBaseUrl(), req);
        return streamResponse(flask);
      } catch (err) {
        return upstreamError(err);
      }
    }

    let go: Response;
    try {
      go = await fetchUpstream(upstreamFetch, getKbPlatformBaseUrl(), req);
    } catch (err) {
      return upstreamError(err);
    }

    if (go.status === 501 && method === 'DELETE' && DELETE_USER_PATH.test(req.path)) {
      try {
        const flask = await fetchUpstream(upstreamFetch, getFlaskAdminBaseUrl(), req);
        return streamResponse(flask);
      } catch (err) {
        return upstreamError(err);
      }
    }
    return adaptV2ToFlask(go);
  };

  routes.all('/api/v1/admin/users', handle);
  routes.all('/api/v1/admin/users/*', handle);
  return routes;
}

export const adminUserRoutes = createAdminUserRoutes();
