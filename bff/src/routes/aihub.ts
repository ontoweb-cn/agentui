/**
 * AIHub 代理路由（M0 最小集）。
 *
 * 前端 `/api/bff/aihub/*`（Vite rewrite 后为 `/aihub/*`）
 * → `${AIHUB_BASE_URL}/api/v1/aihub/*`，并注入 Ed25519 断言 `X-Aihub-Assertion`。
 *
 * 与 hiedu 代理同构：浏览器不持有 aihub 凭据；aihub 只信任 BFF 断言。
 * M0 未实现完整头白名单/审计落盘（见 docs/m0/03-gap-list.md）。
 */

import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';

import { getAuthSession } from '../middleware/auth-session';
import { resolveMemberInfoFromContext } from '../services/member-id-resolver';
import { loadAihubConfig, signAihubAssertion } from '../services/aihub-assertion';
import type { AihubConfigResult } from '../services/aihub-assertion';
import {
  consoleAihubAuditSink,
  type AihubAuditSink,
  type AihubAuthRejectReason,
} from '../services/aihub-audit';
import { streamResponse } from '../utils/response';

const PREFIXES = ['/api/bff/aihub', '/aihub'] as const;
// M0 仅有只读接口；写方法在 M1 写接口 + CSRF/jti 去重就绪后再开放。
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UPSTREAM_TIMEOUT_MS = 15_000;

/** `/api/bff/aihub/meta` → `/api/v1/aihub/meta`。 */
export function resolveAihubUpstreamPath(path: string): string | undefined {
  const prefix = PREFIXES.find(
    (item) => path === item || path.startsWith(`${item}/`),
  );
  if (!prefix) {
    return undefined;
  }
  const rest = path.slice(prefix.length);
  return rest ? `/api/v1/aihub${rest}` : '/api/v1/aihub';
}

export interface AihubRouteDeps {
  configLoader?: () => AihubConfigResult;
  resolveMemberId?: (c: Context) => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestIdFactory?: () => string;
  auditSink?: AihubAuditSink;
}

let cachedConfig: AihubConfigResult | undefined;

function defaultConfigLoader(): AihubConfigResult {
  cachedConfig ??= loadAihubConfig();
  return cachedConfig;
}

export function createAihubRoutes(deps: AihubRouteDeps = {}): Hono {
  const configLoader = deps.configLoader ?? defaultConfigLoader;
  const resolveMemberId =
    deps.resolveMemberId ??
    (async (c) => (await resolveMemberInfoFromContext(c))?.memberId);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const requestIdFactory = deps.requestIdFactory ?? randomUUID;
  const auditSink = deps.auditSink ?? consoleAihubAuditSink;
  const routes = new Hono();

  const auditReject = (
    c: Context,
    requestId: string,
    reason: AihubAuthRejectReason,
  ) => {
    auditSink({
      event: 'auth.reject',
      feature: 'aihub',
      ts: new Date(now()).toISOString(),
      requestId,
      method: c.req.method,
      path: c.req.path,
      reason,
    });
  };

  const handler = async (c: Context) => {
    const upstreamPath = resolveAihubUpstreamPath(c.req.path);
    if (upstreamPath === undefined) {
      return c.json(
        { code: 404, error: 'NOT_FOUND', message: 'Unknown aihub path' },
        404,
      );
    }
    if (!ALLOWED_METHODS.has(c.req.method)) {
      return c.json(
        { code: 405, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' },
        405,
      );
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(c.req.path);
    } catch {
      return c.json(
        { code: 400, error: 'INVALID_PATH', message: 'Malformed request path' },
        400,
      );
    }
    if (decodedPath.includes('..') || decodedPath.includes('\\')) {
      return c.json(
        { code: 400, error: 'INVALID_PATH', message: 'Path traversal not allowed' },
        400,
      );
    }

    const clientRequestId = c.req.header('X-Request-Id')?.trim();
    const requestId =
      clientRequestId && REQUEST_ID_PATTERN.test(clientRequestId)
        ? clientRequestId
        : requestIdFactory();

    const configResult = configLoader();
    if (!configResult.ok) {
      return c.json(
        {
          code: configResult.statusCode,
          error: configResult.error,
          message: configResult.message,
        },
        configResult.statusCode,
      );
    }

    const session = getAuthSession(c);
    if (!session?.token) {
      auditReject(c, requestId, 'missing_session');
      return c.json(
        {
          code: 401,
          error: 'AIHUB_SESSION_REQUIRED',
          message: 'Unauthorized: missing imt_token session cookie',
        },
        401,
      );
    }

    const memberId = (await resolveMemberId(c))?.trim();
    if (!memberId) {
      auditReject(c, requestId, 'missing_member_id');
      return c.json(
        {
          code: 403,
          error: 'AIHUB_AUTH_REJECTED',
          message: 'Forbidden: session has no member identity',
        },
        403,
      );
    }

    const signed = signAihubAssertion({
      config: configResult.config,
      memberId,
      nowMs: now(),
    });

    const headers = new Headers();
    const contentType = c.req.header('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    const accept = c.req.header('Accept');
    if (accept) headers.set('Accept', accept);
    headers.set('X-Aihub-Assertion', signed.assertion);
    headers.set('X-Request-Id', requestId);

    const query = c.req.url.includes('?')
      ? `?${c.req.url.split('?')[1]}`
      : '';
    const targetUrl = `${configResult.config.baseUrl}${upstreamPath}${query}`;

    // 超时 + 客户端断开取消：避免上游挂起长期占用 BFF 连接。
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);
    const onClientAbort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', onClientAbort, { once: true });

    let upstream: Response;
    try {
      upstream = await fetchImpl(targetUrl, {
        method: c.req.method,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        return c.json(
          {
            code: 504,
            error: 'AIHUB_UPSTREAM_TIMEOUT',
            message: `aihub upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms`,
          },
          504,
        );
      }
      console.error(
        `[aihub] upstream error ${c.req.method} ${upstreamPath}: ${(err as Error).message}`,
      );
      return c.json(
        {
          code: 502,
          error: 'AIHUB_UPSTREAM_UNREACHABLE',
          message: 'aihub upstream request failed',
        },
        502,
      );
    } finally {
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', onClientAbort);
    }

    return streamResponse(upstream, { stripHeaders: ['set-cookie'] });
  };

  routes.all('/aihub/*', handler);
  routes.all('/api/bff/aihub/*', handler);
  return routes;
}

export const aihubRoutes = createAihubRoutes();
