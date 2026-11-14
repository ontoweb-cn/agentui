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
// 市场只读；以下写路径精确放行（SameSite=Lax cookie + aihub 断言 + jti 去重）。
const READ_METHODS = new Set(['GET', 'HEAD']);
const ADMIN_PREFIXES = ['/api/bff/aihub/admin/', '/aihub/admin/'] as const;
const ADMIN_METHODS = new Set(['POST']);
const AIHUB_PREFIX = String.raw`\/(?:api\/bff\/aihub|aihub)`;
const FAVORITE_ROUTE = new RegExp(String.raw`^${AIHUB_PREFIX}\/assets\/[^/]+\/favorite$`);
// 精确白名单：发布 dataset、下载、安装、打开安装、对话，卸载用 DELETE。
const WRITE_RULES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/assets$`) },
  {
    method: 'PATCH',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/assets\/[^/]+$`),
  },
  {
    method: 'POST',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/skills$`),
  },
  { method: 'POST', pattern: FAVORITE_ROUTE },
  {
    method: 'POST',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/assets\/[^/]+\/actions\/download$`),
  },
  {
    method: 'POST',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/assets\/[^/]+\/install$`),
  },
  {
    method: 'POST',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/assets\/[^/]+\/publish$`),
  },
  {
    method: 'POST',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/installations\/[^/]+\/open$`),
  },
  {
    method: 'POST',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/chat\/completions$`),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/installations\/[^/]+$`),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(String.raw`^${AIHUB_PREFIX}\/chat\/sessions\/[^/]+$`),
  },
];
const CHAT_STREAM_ROUTE = new RegExp(
  String.raw`^${AIHUB_PREFIX}\/chat\/completions$`,
);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;
const BODY_TOO_LARGE = 'AIHUB_PAYLOAD_TOO_LARGE';

/** 流式计数：超过上限即中断，避免 chunked 请求绕过 Content-Length 检查。 */
function guardBodySize(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new Error(BODY_TOO_LARGE));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/** undici 可能把流错误包在 `cause` 中，这里两处都检查。 */
function isBodyTooLargeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  const cause = (err as { cause?: unknown } | null)?.cause;
  const causeMessage = cause instanceof Error ? cause.message : '';
  return message.includes(BODY_TOO_LARGE) || causeMessage.includes(BODY_TOO_LARGE);
}

/**
 * SSE 透传：把上游流原样转发，并在流结束或客户端断开时清理监听与取消上游。
 * 仅用于 `chat/completions`（无总超时）。
 */
function streamWithCleanup(
  upstream: Response,
  cleanup: () => void,
  controller: AbortController,
): Response {
  const headers = new Headers(upstream.headers);
  headers.delete('set-cookie');
  headers.delete('transfer-encoding');
  headers.delete('content-encoding');
  const contentType = headers.get('Content-Type') ?? '';
  if (
    contentType.includes('text/event-stream') &&
    !headers.has('X-Accel-Buffering')
  ) {
    headers.set('X-Accel-Buffering', 'no');
  }
  const source = upstream.body;
  if (!source) {
    cleanup();
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }
  const body = new ReadableStream<Uint8Array>({
    async start(target) {
      const reader = source.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          target.enqueue(value);
        }
        target.close();
      } catch (err) {
        target.error(err);
      } finally {
        cleanup();
      }
    },
    cancel() {
      controller.abort();
      cleanup();
    },
  });
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

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
  resolveRole?: (c: Context) => Promise<string | undefined>;
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
  const resolveRole =
    deps.resolveRole ??
    (async (c) => (await resolveMemberInfoFromContext(c))?.role);
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
    const isAdminPath = ADMIN_PREFIXES.some((prefix) =>
      c.req.path.startsWith(prefix),
    );
    const isAllowedWrite = WRITE_RULES.some(
      (rule) => rule.method === c.req.method && rule.pattern.test(c.req.path),
    );
    if (
      !READ_METHODS.has(c.req.method) &&
      !(isAdminPath && ADMIN_METHODS.has(c.req.method)) &&
      !isAllowedWrite
    ) {
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
      role: await resolveRole(c),
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
    // SSE（chat/completions）不设总超时，客户端断开时通过 abort 取消上游。
    const isChatStream = CHAT_STREAM_ROUTE.test(c.req.path);
    const controller = new AbortController();
    let timedOut = false;
    const timer = isChatStream
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, UPSTREAM_TIMEOUT_MS);
    const onClientAbort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', onClientAbort, { once: true });
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', onClientAbort);
    };

    let upstream: Response;
    const declaredLength = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_BODY_BYTES) {
      cleanup();
      return c.json(
        {
          code: 413,
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds 8MB limit',
        },
        413,
      );
    }

    const init: RequestInit & { duplex?: 'half' } = {
      method: c.req.method,
      headers,
      signal: controller.signal,
    };
    if (!READ_METHODS.has(c.req.method)) {
      const body = c.req.raw.body;
      if (body) {
        init.body = guardBodySize(body, MAX_PROXY_BODY_BYTES);
        // Node fetch 转发请求流时必需，避免整体缓冲到内存。
        init.duplex = 'half';
      }
    }

    try {
      upstream = await fetchImpl(targetUrl, init);
    } catch (err) {
      if (isBodyTooLargeError(err)) {
        return c.json(
          {
            code: 413,
            error: 'PAYLOAD_TOO_LARGE',
            message: 'Request body exceeds 8MB limit',
          },
          413,
        );
      }
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
      if (!isChatStream) cleanup();
    }

    if (isChatStream) {
      return streamWithCleanup(upstream, cleanup, controller);
    }
    return streamResponse(upstream, { stripHeaders: ['set-cookie'] });
  };

  routes.all('/aihub/*', handler);
  routes.all('/api/bff/aihub/*', handler);
  return routes;
}

export const aihubRoutes = createAihubRoutes();
