/**
 * kb-platform (Go) 透明代理 — Phase 1a catalog demo。
 *
 * 前端 `/api/bff/platform/*`（Vite rewrite 后为 `/platform/*`）
 * → `${KB_PLATFORM_URL}/api/v1/platform/*`。
 *
 * 与 intellect-rag `/proxy/v1/*` 分离：不注入 RAG admin token。
 * 客户端已有 Authorization 则原样转发；否则仅对白名单 catalog GET/HEAD
 * 注入 `KB_PLATFORM_ADMIN_TOKEN`（禁止写/heartbeat/probe 注入）。
 */

import { Hono, type Context } from 'hono';
import { buildKbPlatformUpstreamUrl } from '../utils/kb-platform-base-url';
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
      headers.set(
        'Authorization',
        `Bearer ${process.env.KB_PLATFORM_ADMIN_TOKEN.trim()}`,
      );
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
