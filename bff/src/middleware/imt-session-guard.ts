/**
 * IMT 会话验证中间件(审计缺陷 A 修复)。
 *
 * 背景:authMiddleware 企业模式只验证 imt_token cookie **存在性**;
 * 真实验证原先仅存在于 /auth/me(调 gateway /api/members/me)。数据与
 * 管理路由(/proxy /capabilities /admin/* /canvas /agents)可被任意
 * 伪造 cookie 旁路,而其上游调用携带服务端凭证,上游无法识别用户——
 * 实测垃圾 cookie 可达 capabilities 与后端管理面。
 *
 * 行为:
 * - 社区模式(flag 关闭)直通——社区版鉴权靠透传的用户 JWT 由 RAG 上游验证;
 * - 豁免路径:/admin/wizard/*(首次安装无会话)与 /proxy/v1/system/config
 *   (公开),与 authMiddleware 的公开清单对齐;
 * - 验证:调 enterprise backend 的 GET /api/members/me(Bearer member token),
 *   结果缓存 60s(有效)/10s(无效)——控制 gateway 往返频率;权限回收的
 *   生效窗口 ≤60s;
 * - gateway 不可达:fail-closed 502(与 /auth/me 行为一致——认证源不可用
 *   时拒绝,尤其保护 /admin/* 变更面)。
 */
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';

import { AUTH_COOKIE_NAME } from '../types/auth';
import { isImtCanvasAgentsEnabled } from '../utils/feature-flags';

/** 与 authMiddleware 的公开路径保持同步(此处只列需豁免本中间件的)。 */
const EXEMPT_PREFIXES = ['/admin/wizard'];
const EXEMPT_PATHS = new Set(['/proxy/v1/system/config']);

const VALID_TTL_MS = 60_000;
const INVALID_TTL_MS = 10_000;
const CACHE_MAX = 1_000;

interface CacheEntry {
  valid: boolean;
  expires: number;
}

const verdictCache = new Map<string, CacheEntry>();

/** 测试辅助:清空验证缓存。 */
export function clearImtSessionCache(): void {
  verdictCache.clear();
}

function cacheGet(token: string): boolean | undefined {
  const entry = verdictCache.get(token);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expires) {
    verdictCache.delete(token);
    return undefined;
  }
  return entry.valid;
}

function cacheSet(token: string, valid: boolean): void {
  if (verdictCache.size >= CACHE_MAX) {
    const oldest = verdictCache.keys().next().value;
    if (oldest !== undefined) {
      verdictCache.delete(oldest);
    }
  }
  verdictCache.set(token, {
    valid,
    expires: Date.now() + (valid ? VALID_TTL_MS : INVALID_TTL_MS),
  });
}

export type ImtTokenVerdict = 'valid' | 'invalid' | 'unreachable';

/**
 * 调 enterprise backend 验证 member token。fetchImpl 可注入(单测)。
 * 非 401/403 的失败(5xx/网络)归为 unreachable——由调用方 fail-closed。
 */
export async function validateImtToken(
  token: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImtTokenVerdict> {
  try {
    const resp = await fetchImpl(
      `${baseUrl.replace(/\/$/, '')}/api/members/me`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (resp.ok) {
      return 'valid';
    }
    if (resp.status === 401 || resp.status === 403) {
      return 'invalid';
    }
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** 从 harnessStore 解析首个就绪 enterprise backend 的 endpoint。 */
function resolveEnterpriseBaseUrl(c: Context): string | null {
  const store = c.get('harnessStore') as
    | { listConfigs?: () => Array<{ type?: string; endpoint?: string }> }
    | undefined;
  const cfg = store?.listConfigs?.().find((b) => b.type === 'intellect-enterprise');
  return cfg?.endpoint ?? null;
}

export const requireValidImtSession = async (
  c: Context,
  next: Next,
): Promise<Response | void> => {
  if (!isImtCanvasAgentsEnabled()) {
    return next();
  }
  const path = c.req.path;
  if (EXEMPT_PATHS.has(path) || EXEMPT_PREFIXES.some((p) => path.startsWith(p))) {
    return next();
  }

  const token = getCookie(c, AUTH_COOKIE_NAME);
  if (!token) {
    // 正常流程下 authMiddleware 已保证 cookie 存在;此处兜底
    return c.json({ code: 401, message: 'Unauthorized: missing session cookie' }, 401);
  }

  const cached = cacheGet(token);
  if (cached === true) {
    return next();
  }
  if (cached === false) {
    return c.json({ code: 401, message: 'Unauthorized: invalid session token' }, 401);
  }

  const baseUrl = resolveEnterpriseBaseUrl(c);
  if (!baseUrl) {
    return c.json(
      { code: 503, message: 'No intellect-enterprise backend configured for session validation' },
      503,
    );
  }

  const verdict = await validateImtToken(token, baseUrl);
  cacheSet(token, verdict === 'valid');
  if (verdict === 'valid') {
    return next();
  }
  if (verdict === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized: invalid session token' }, 401);
  }
  return c.json(
    { code: 502, message: 'Session validation backend unreachable (fail-closed)' },
    502,
  );
};
