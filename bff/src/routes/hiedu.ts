/**
 * hiedu 门户断言代理 — P0-1。
 *
 * 前端路径 `/api/bff/hiedu/*`(经 Vite rewrite 去掉 `/api/bff` 后为 `/hiedu/*`)
 * 由本路由代理到 `{HIEDU_BASE_URL}{去掉前缀后的路径}`。
 *
 * 安全约定:
 * - 从 `imt_token` cookie 取会话(由 authSessionMiddleware 注入 AuthSession);
 * - 复用 member-id-resolver 调 intellect-team `/api/members/me` 解析 memberId;
 * - 即时签发 Ed25519 JWS 断言,注入 `X-Hiedu-Assertion`;
 * - 请求头白名单重建:仅保留 Content-Type / Accept + 合法 X-Request-Id,
 *   客户端传入的所有 `X-Hiedu-*`、`Cookie`、`Authorization` 一律不转发;
 * - 认证失败返回 403,并写一条 `auth.reject` 审计。
 */

import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';

import { getAuthSession } from '../middleware/auth-session';
import { resolveMemberInfoFromContext } from '../services/member-id-resolver';
import { loadHieduConfig, signHieduAssertion } from '../services/hiedu-assertion';
import type { HieduConfigResult } from '../services/hiedu-assertion';
import {
  consoleHieduAuditSink,
  type HieduAuditSink,
  type HieduAuthRejectEvent,
  type HieduAuthRejectReason,
} from '../services/hiedu-audit';
import { streamResponse } from '../utils/response';
import type { BackendStore } from '../types/stores';
import type { HarnessStore } from '../types/stores';

interface HieduVariables {
  backendStore: BackendStore;
  harnessStore: HarnessStore;
}

/** 支持两种挂载前缀:直连 BFF 的 /api/bff/hiedu,以及 Vite rewrite 后的 /hiedu */
const HIEDU_PATH_PREFIXES = ['/api/bff/hiedu', '/hiedu'] as const;

/** 客户端可传入的 X-Request-Id 合法形态(防止超长/控制字符注入响应/日志) */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** 允许代理的方法;其余(如 OPTIONS/TRACE)直接拒绝 */
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE']);

/**
 * If-Match 白名单形态（RFC 7232）：
 * - `*` 或一个/多个强实体标签（引号包裹，逗号分隔）；
 * - 拒绝弱标签（W/）与控制字符——If-Match 要求强比较，weak 标签无法生效。
 */
const IF_MATCH_PATTERN =
  /^(?:\*|"[^\x00-\x1F\x7F"\\]*"(?:\s*,\s*"[^\x00-\x1F\x7F"\\]*")*)$/;

/** 上游路径白名单:仅允许 hiedu 的 /api 路径,避免把 /healthz 等非 API 暴露给浏览器 */
const UPSTREAM_PATH_PATTERN = /^\/api\/[A-Za-z0-9_./{}$-]*$/;

/** 代理请求体上限(与 hiedu 导入接口的 8MB 上限对齐) */
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;

/**
 * 从请求路径剥离 hiedu 前缀,得到上游相对路径。
 * 例:`/api/bff/hiedu/api/me` → `/api/me`;`/hiedu/api/me` → `/api/me`。
 */
export function resolveHieduUpstreamPath(requestPath: string): string | undefined {
  for (const prefix of HIEDU_PATH_PREFIXES) {
    if (requestPath === prefix) {
      return '/';
    }
    if (requestPath.startsWith(`${prefix}/`)) {
      return requestPath.slice(prefix.length);
    }
  }
  return undefined;
}

export interface HieduRouteDeps {
  /** 配置加载器(默认每次请求从 env 解析;测试可注入固定配置) */
  configLoader?: () => HieduConfigResult;
  /** token → memberId 解析器(默认复用 member-id-resolver) */
  resolveMemberId?: (c: Context<{ Variables: HieduVariables }>) => Promise<string | undefined>;
  /** 审计 sink(默认写单行 JSON 到 console.warn) */
  auditSink?: HieduAuditSink;
  /** fetch 实现(测试可注入) */
  fetchImpl?: typeof fetch;
  /** 当前时间(毫秒),测试可注入 */
  now?: () => number;
  /** 请求 ID 生成器(缺省 randomUUID) */
  requestIdFactory?: () => string;
}

function reject(
  c: Context<{ Variables: HieduVariables }>,
  params: {
    reason: HieduAuthRejectReason;
    message: string;
    requestId: string;
    auditSink: HieduAuditSink;
    now: () => number;
  },
): Response {
  const event: HieduAuthRejectEvent = {
    event: 'auth.reject',
    ts: new Date(params.now()).toISOString(),
    requestId: params.requestId,
    method: c.req.method,
    path: c.req.path,
    reason: params.reason,
  };
  params.auditSink(event);
  return c.json(
    {
      code: 403,
      error: 'HIEDU_AUTH_REJECTED',
      reason: params.reason,
      message: params.message,
    },
    403,
  );
}

/** 默认配置加载器:进程内只解析一次 env/PEM,避免每请求重复解析私钥。 */
let cachedDefaultConfig: HieduConfigResult | undefined;

function createCachedConfigLoader(): () => HieduConfigResult {
  return () => (cachedDefaultConfig ??= loadHieduConfig());
}

/**
 * 创建 hiedu 代理路由(依赖可注入,便于测试)。
 */
export function createHieduRoutes(
  deps: HieduRouteDeps = {},
): Hono<{ Variables: HieduVariables }> {
  const configLoader = deps.configLoader ?? createCachedConfigLoader();
  const resolveMemberId =
    deps.resolveMemberId ??
    (async (c) => (await resolveMemberInfoFromContext(c))?.memberId);
  const auditSink = deps.auditSink ?? consoleHieduAuditSink;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const requestIdFactory = deps.requestIdFactory ?? randomUUID;

  const routes = new Hono<{ Variables: HieduVariables }>();

  const handler = async (c: Context<{ Variables: HieduVariables }>) => {
    const upstreamPath = resolveHieduUpstreamPath(c.req.path);
    if (upstreamPath === undefined) {
      return c.json({ code: 404, error: 'NOT_FOUND', message: 'Unknown hiedu path' }, 404);
    }
    // 方法白名单:代理只承载 hiedu 实际使用的方法。
    const method = c.req.method;
    if (!ALLOWED_METHODS.has(method)) {
      return c.json(
        { code: 405, error: 'METHOD_NOT_ALLOWED', message: `Method ${method} not allowed` },
        405,
      );
    }
    // 先解码再检查,覆盖 %2e%2e 等形式;并拒绝反斜杠路径。
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(c.req.path);
    } catch {
      return c.json({ code: 400, error: 'INVALID_PATH', message: 'Malformed request path' }, 400);
    }
    if (decodedPath.includes('..') || decodedPath.includes('\\')) {
      return c.json(
        { code: 400, error: 'INVALID_PATH', message: 'Invalid path: path traversal not allowed' },
        400,
      );
    }
    // 仅允许 /api/*,缩小暴露面。
    if (!UPSTREAM_PATH_PATTERN.test(upstreamPath)) {
      return c.json({ code: 404, error: 'NOT_FOUND', message: 'Unknown hiedu path' }, 404);
    }

    // X-Request-Id 在鉴权前确定,失败审计与转发头共用同一个 ID。
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
    const { config } = configResult;

    const session = getAuthSession(c);
    if (!session?.token) {
      return reject(c, {
        reason: 'missing_session',
        message: 'Unauthorized: missing imt_token session cookie',
        requestId,
        auditSink,
        now,
      });
    }

    let rawMemberId: string | undefined;
    try {
      rawMemberId = await resolveMemberId(c);
    } catch (err) {
      console.error(
        `[hiedu] member id resolve error: ${(err as Error).message}`,
      );
      rawMemberId = undefined;
    }

    if (rawMemberId === undefined) {
      return reject(c, {
        reason: 'invalid_session',
        message: 'Forbidden: invalid or expired imt_token session',
        requestId,
        auditSink,
        now,
      });
    }

    const memberId = rawMemberId.trim();
    if (!memberId) {
      return reject(c, {
        reason: 'missing_member_id',
        message: 'Forbidden: session has no member identity',
        requestId,
        auditSink,
        now,
      });
    }

    const signed = signHieduAssertion({
      config,
      memberId,
      nowMs: now(),
    });

    // 重建请求头白名单:客户端所有 X-Hiedu-* / Cookie / Authorization 均被丢弃。
    const headers = new Headers();
    const contentType = c.req.header('Content-Type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    const accept = c.req.header('Accept');
    if (accept) {
      headers.set('Accept', accept);
    }
    // 并发控制：If-Match 必须透传，否则后端乐观锁永不触发（P1 评审发现）。
    const ifMatch = c.req.header('If-Match')?.trim();
    if (ifMatch) {
      if (!IF_MATCH_PATTERN.test(ifMatch)) {
        return c.json(
          {
            code: 400,
            error: 'INVALID_IF_MATCH',
            message: 'If-Match must be * or strong entity-tag(s)',
          },
          400,
        );
      }
      headers.set('If-Match', ifMatch);
    }
    headers.set('X-Hiedu-Assertion', signed.assertion);
    headers.set('X-Request-Id', requestId);

    const query = c.req.url.includes('?')
      ? `?${c.req.url.split('?')[1]}`
      : '';
    const targetUrl = `${config.baseUrl}${upstreamPath}${query}`;

    const declaredLength = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_BODY_BYTES) {
      return c.json(
        { code: 413, error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 8MB limit' },
        413,
      );
    }

    const init: RequestInit & { duplex?: 'half' } = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      const body = c.req.raw.body;
      if (body) {
        init.body = body;
        // Node fetch 转发请求流时必需
        init.duplex = 'half';
      }
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(targetUrl, init);
    } catch (err) {
      console.error(
        `[hiedu] upstream error ${method} ${upstreamPath}: ${(err as Error).message}`,
      );
      return c.json(
        { code: 502, error: 'HIEDU_UPSTREAM_ERROR', message: 'hiedu upstream request failed' },
        502,
      );
    }

    return streamResponse(upstream, { stripHeaders: ['set-cookie'] });
  };

  routes.all('/hiedu/*', handler);
  routes.all('/api/bff/hiedu/*', handler);

  return routes;
}

/** 生产默认实例:配置/依赖均从 env 与现有服务读取。 */
export const hieduRoutes = createHieduRoutes();
