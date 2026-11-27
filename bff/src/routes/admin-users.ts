import { Hono, type Context } from 'hono';
import { getKbPlatformBaseUrl } from '../utils/kb-platform-base-url';
import { streamResponse } from '../utils/response';

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Which (method, path) pairs kb-platform (Go) owns. Everything else under the
 * proxied prefixes is passed straight through to the Flask admin, so widening the
 * gateway to these prefixes cannot accidentally break a Flask-only endpoint
 * (sandbox schema/config/test, service stop/restart, roles, ...).
 *
 * 1b-rest: GET /services, /configs, /environments, /version, /variables,
 * /sandbox/providers are Go-owned; the rest of the sandbox and service surface
 * stays on Flask because it depends on the Python runtime.
 */
const GO_OWNED: Array<{ methods: string[]; matches: (path: string) => boolean }> = [
  {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    matches: (p) => p === '/api/v1/admin/users' || p.startsWith('/api/v1/admin/users/'),
  },
  {
    methods: ['GET'],
    matches: (p) => p === '/api/v1/admin/services' || /^\/api\/v1\/admin\/services\/[^/]+$/.test(p),
  },
  { methods: ['GET'], matches: (p) => p === '/api/v1/admin/configs' },
  { methods: ['GET'], matches: (p) => p === '/api/v1/admin/environments' },
  { methods: ['GET'], matches: (p) => p === '/api/v1/admin/version' },
  { methods: ['GET', 'PUT'], matches: (p) => p === '/api/v1/admin/variables' },
  { methods: ['GET'], matches: (p) => p === '/api/v1/admin/sandbox/providers' },
];

export function ownedByGo(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return GO_OWNED.some((rule) => rule.methods.includes(upper) && rule.matches(path));
}

/**
 * Prefixes routed into this module by nginx/vite. A prefix is listed here as soon
 * as part of it is Go-owned; handle() decides per request whether to use Go or
 * Flask.
 */
const ADMIN_PROXIED_PATHS = [
  '/api/v1/admin/users',
  '/api/v1/admin/services',
  '/api/v1/admin/configs',
  '/api/v1/admin/environments',
  '/api/v1/admin/version',
  '/api/v1/admin/variables',
  '/api/v1/admin/sandbox',
];

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

type LimitedBody =
  | { kind: 'none' }
  | { kind: 'too-large' }
  | { kind: 'body'; body: Uint8Array<ArrayBuffer> };

function declaredLength(req: Request): number | undefined {
  const raw = req.headers.get('content-length');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Read the request body while enforcing MAX_PROXY_BODY_BYTES *during* the read.
 * This route is mounted before the BFF user authentication, so buffering first
 * and checking the size afterwards would let an anonymous caller exhaust the
 * process memory with a single oversized upload.
 */
async function readBodyLimited(req: Request): Promise<LimitedBody> {
  const declared = declaredLength(req);
  if (declared !== undefined && declared > MAX_PROXY_BODY_BYTES) {
    return { kind: 'too-large' };
  }
  const stream = req.body;
  if (!stream) return { kind: 'none' };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > MAX_PROXY_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: 'too-large' };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released by cancel(); nothing left to unlock
    }
  }
  const merged = new Uint8Array(total);
  let written = 0;
  for (const chunk of chunks) {
    merged.set(chunk, written);
    written += chunk.byteLength;
  }
  return { kind: 'body', body: merged };
}

function payloadTooLarge(): Response {
  return new Response(
    JSON.stringify({ code: 41300, message: 'payload too large', data: null }),
    { status: 413, headers: { 'Content-Type': 'application/json' } },
  );
}

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
    if (method !== 'GET' && method !== 'HEAD') {
      // GET bodies are not forwarded: the fetch spec (and undici) reject a request
      // whose method is GET/HEAD but carries a body, so `GET /variables` with
      // {"var_name": ...} stays available on the admin port only, never here.
      const read = await readBodyLimited(c.req.raw);
      if (read.kind === 'too-large') return payloadTooLarge();
      if (read.kind === 'body') body = read.body;
    }

    const req: ProxyRequest = {
      method,
      path: c.req.path,
      search: new URL(c.req.url).search,
      headers,
      body,
    };
    const mode = process.env.KB_PLATFORM_ADMIN?.trim().toLowerCase() || 'go';

    // python mode, or a path Go does not ship yet: Flask stays authoritative.
    if (mode === 'python' || !ownedByGo(method, req.path)) {
      return forwardToFlask(upstreamFetch, req);
    }

    let go: Response;
    try {
      go = await fetchUpstream(upstreamFetch, getKbPlatformBaseUrl(), req);
    } catch (err) {
      return upstreamError(err);
    }

    // 50101 means "kb-platform cannot serve this" (store not configured, or a
    // capability deliberately left on Flask such as user deletion). Flask owns the
    // real answer, so fall back rather than surfacing a stub.
    if (go.status === 501) {
      return forwardToFlask(upstreamFetch, req);
    }
    return adaptV2ToFlask(go);
  };

  for (const path of ADMIN_PROXIED_PATHS) {
    routes.all(path, handle);
    routes.all(`${path}/*`, handle);
  }
  return routes;
}

async function forwardToFlask(
  upstreamFetch: AdminUserFetch,
  req: ProxyRequest,
): Promise<Response> {
  try {
    const flask = await fetchUpstream(upstreamFetch, getFlaskAdminBaseUrl(), req);
    return streamResponse(flask);
  } catch (err) {
    return upstreamError(err);
  }
}

export const adminUserRoutes = createAdminUserRoutes();
