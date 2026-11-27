/**
 * kb-platform (Go) 透明代理 — Phase 1a catalog demo + 1b-ζ admin inject gate.
 *
 * 前端 `/api/bff/platform/*`（Vite rewrite 后为 `/platform/*`）
 * → `${KB_PLATFORM_URL}/api/v1/platform/*`。
 *
 * 与 intellect-rag `/proxy/v1/*` 分离：不注入 RAG admin token。
 * 客户端已有 Authorization 则原样转发；否则仅对白名单 catalog GET/HEAD
 * 在通过 kb-platform `/api/v1/admin/auth`（1b-α 超管）后注入
 * `KB_PLATFORM_ADMIN_TOKEN`（禁止写/heartbeat/probe 注入）。
 *
 * Emergency: `KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH=false` restores 1a
 * inject-for-any-BFF-login behavior.
 */

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  buildKbPlatformUpstreamUrl,
  getKbPlatformBaseUrl,
} from '../utils/kb-platform-base-url';
import { streamResponse } from '../utils/response';

const PLATFORM_PATH_PREFIXES = ['/api/bff/platform', '/platform'] as const;

const ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;
const ADMIN_AUTH_CACHE_TTL_MS = 30_000;

export type PlatformFetch = typeof fetch;

export function resolvePlatformSuffix(requestPath: string): string | undefined {
  for (const prefix of PLATFORM_PATH_PREFIXES) {
    if (requestPath === prefix) {
      return '';
    }
    if (requestPath.startsWith(`${prefix}/`)) {
      return requestPath.slice(prefix.length);
    }
  }
  return undefined;
}

/** Exact allowlist for default-injecting KB_PLATFORM_ADMIN_TOKEN (GET/HEAD only). */
export function shouldInjectKbPlatformAdminToken(
  method: string,
  platformSuffix: string,
): boolean {
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  const path = platformSuffix.split('?')[0] || '';
  if (path === '/catalog/instances' || path === '/catalog/overview') return true;
  if (/^\/catalog\/schemas\/[^/]+$/.test(path)) return true;
  if (/^\/catalog\/instances\/[^/]+$/.test(path)) return true;
  if (/^\/catalog\/instances\/[^/]+\/config$/.test(path)) return true;
  return false;
}

/** Default on; only explicit false/0/no/off disables the 1b-ζ gate. */
export function injectRequiresAdminAuth(): boolean {
  const v = process.env.KB_PLATFORM_INJECT_REQUIRE_ADMIN_AUTH?.trim().toLowerCase();
  if (!v) return true;
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

export function kbPlatformAdminCookieName(): string {
  return (
    process.env.KB_PLATFORM_ADMIN_COOKIE_NAME?.trim() || 'kb_admin_session'
  );
}

type AuthCacheEntry = { ok: boolean; expiresAt: number };

const adminAuthCache = new Map<string, AuthCacheEntry>();

/** Test helper: clear in-process auth probe cache. */
export function clearKbPlatformAdminAuthCache(): void {
  adminAuthCache.clear();
}

function cacheKey(kind: 'bearer' | 'cookie', value: string): string {
  return `${kind}:${value}`;
}

export async function kbPlatformAdminAuthOK(opts: {
  upstreamFetch: PlatformFetch;
  authorization?: string | null;
  cookieHeader?: string | null;
  cookieName?: string;
  now?: () => number;
}): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const cookieName = opts.cookieName ?? kbPlatformAdminCookieName();
  let proofKind: 'bearer' | 'cookie' | null = null;
  let proofValue = '';
  let authHeader = '';

  const auth = opts.authorization?.trim();
  if (auth) {
    proofKind = 'bearer';
    proofValue = auth;
    authHeader = auth.toLowerCase().startsWith('bearer ')
      ? auth
      : `Bearer ${auth}`;
  } else if (opts.cookieHeader) {
    // Parse Cookie header for the admin session cookie without depending on Hono Context.
    const parts = opts.cookieHeader.split(';');
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      if (name === cookieName) {
        proofKind = 'cookie';
        proofValue = part.slice(idx + 1).trim();
        break;
      }
    }
  }

  if (!proofKind || !proofValue) {
    return false;
  }

  const key = cacheKey(proofKind, proofValue);
  const cached = adminAuthCache.get(key);
  if (cached && cached.expiresAt > now()) {
    return cached.ok;
  }

  const url = `${getKbPlatformBaseUrl()}/api/v1/admin/auth`;
  const headers = new Headers();
  if (proofKind === 'bearer') {
    headers.set('Authorization', authHeader);
  } else {
    headers.set('Cookie', `${cookieName}=${proofValue}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await opts.upstreamFetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const ok = res.status === 200;
    if (ok) {
      adminAuthCache.set(key, {
        ok: true,
        expiresAt: now() + ADMIN_AUTH_CACHE_TTL_MS,
      });
    } else {
      adminAuthCache.delete(key);
    }
    return ok;
  } catch {
    adminAuthCache.delete(key);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PlatformRouteDeps {
  upstreamFetch?: PlatformFetch;
}

export function createPlatformRoutes(deps: PlatformRouteDeps = {}): Hono {
  const upstreamFetch = deps.upstreamFetch ?? fetch;
  const routes = new Hono();

  const handle = async (c: Context) => {
    const suffix = resolvePlatformSuffix(c.req.path);
    if (suffix === undefined) {
      return new Response(null, { status: 404 });
    }

    const method = c.req.method.toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      return new Response(JSON.stringify({ code: 40500, message: 'method not allowed', data: {} }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(c.req.url);
    const upstreamUrl = buildKbPlatformUpstreamUrl(suffix, url.search);
    if (!upstreamUrl) {
      return new Response(
        JSON.stringify({ code: 40001, message: 'invalid platform path', data: {} }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const headers = new Headers();
    const contentType = c.req.header('content-type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    const accept = c.req.header('accept');
    if (accept) {
      headers.set('Accept', accept);
    }
    const authorization = c.req.header('authorization');
    if (authorization) {
      headers.set('Authorization', authorization);
    } else if (
      shouldInjectKbPlatformAdminToken(method, suffix) &&
      process.env.KB_PLATFORM_ADMIN_TOKEN?.trim()
    ) {
      let allowInject = !injectRequiresAdminAuth();
      if (!allowInject) {
        const cookieName = kbPlatformAdminCookieName();
        const sessionCookie = getCookie(c, cookieName);
        allowInject = await kbPlatformAdminAuthOK({
          upstreamFetch,
          // Prefer dedicated admin Bearer if client sent one under another header? Spec: only Cookie or we need a way to pass α JWT when Authorization is reserved for inject.
          // When Authorization is absent, α proof is the kb_admin_session cookie (or optional X-Kb-Admin-Authorization — keep cookie-only for inject path per spec A).
          cookieHeader: sessionCookie
            ? `${cookieName}=${sessionCookie}`
            : c.req.header('cookie') ?? null,
          cookieName,
        });
      }
      if (allowInject) {
        headers.set(
          'Authorization',
          `Bearer ${process.env.KB_PLATFORM_ADMIN_TOKEN.trim()}`,
        );
      }
    }

    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const rawBody = c.req.raw.body;
      if (rawBody) {
        const buf = Buffer.from(await c.req.raw.arrayBuffer());
        if (buf.length > MAX_PROXY_BODY_BYTES) {
          return new Response(
            JSON.stringify({ code: 41300, message: 'payload too large', data: {} }),
            { status: 413, headers: { 'Content-Type': 'application/json' } },
          );
        }
        body = buf;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await upstreamFetch(upstreamUrl, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      return streamResponse(upstream);
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'kb-platform upstream timeout'
          : 'kb-platform upstream unreachable';
      return new Response(
        JSON.stringify({ code: 50200, message, data: {} }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  for (const prefix of PLATFORM_PATH_PREFIXES) {
    routes.all(`${prefix}/*`, (c) => handle(c));
    routes.all(prefix, (c) => handle(c));
  }

  return routes;
}

export const platformRoutes = createPlatformRoutes();
