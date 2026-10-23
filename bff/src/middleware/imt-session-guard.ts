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

function cacheGet(key: string): boolean | undefined {
  const entry = verdictCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expires) {
    verdictCache.delete(key);
    return undefined;
  }
  return entry.valid;
}

function cacheSet(key: string, valid: boolean): void {
  if (verdictCache.size >= CACHE_MAX) {
    const oldest = verdictCache.keys().next().value;
    if (oldest !== undefined) {
      verdictCache.delete(oldest);
    }
  }
  verdictCache.set(key, {
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
      {
        headers: { Authorization: `Bearer ${token}` },
        // 网关静默丢包(主机宕机不拒连)时 fetch 会无限悬挂,fail-closed
        // 退化为 fail-hang;5s 超时归入 unreachable(与 tenant-validator 对齐)
        signal: AbortSignal.timeout(5_000),
      },
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

/**
 * 解析用于会话校验的 enterprise 实例 endpoint。
 * 优选"就绪"(token 已加载)实例——listConfigs 含 token 未就绪的残留配置,
 * 对陈旧实例校验会把合法 admin 误判 401;无就绪实例时回退首个配置
 * (token 未就绪仍可reachable,只是没人用它的 admin token)。
 */
function resolveEnterpriseBaseUrl(c: Context): string | null {
  const store = c.get('harnessStore') as
    | {
        list?: () => Array<{ type?: string; endpoint?: string }>;
        listConfigs?: () => Array<{ type?: string; endpoint?: string }>;
      }
    | undefined;
  const ready = store?.list?.().find((b) => b.type === 'intellect-enterprise');
  if (ready?.endpoint) {
    return ready.endpoint;
  }
  const cfg = store?.listConfigs?.().find((b) => b.type === 'intellect-enterprise');
  return cfg?.endpoint ?? null;
}

export type ImtSessionCheck = { ok: true } | { ok: false; status: 401 | 502 | 503; message: string };

/**
 * 校验 imt_token(含 60s/10s 缓存与 fail-closed 语义)。
 * 供 requireValidImtSession 与 wizard setup 管理分支共用,拒绝时携带
 * 具体 status(401 无效 / 502 认证源不可达 / 503 无可用的 enterprise backend)。
 */
export async function checkImtSession(c: Context, token: string): Promise<ImtSessionCheck> {
  const baseUrl = resolveEnterpriseBaseUrl(c);
  if (!baseUrl) {
    return {
      ok: false,
      status: 503,
      message: 'No intellect-enterprise backend configured for session validation',
    };
  }

  // 缓存按 baseUrl|token 键:重登记切换网关后,旧实例的判定不会跨实例命中
  const cacheKey = `${baseUrl}|${token}`;
  const cached = cacheGet(cacheKey);
  if (cached === true) {
    return { ok: true };
  }
  if (cached === false) {
    return { ok: false, status: 401, message: 'Unauthorized: invalid session token' };
  }

  const verdict = await validateImtToken(token, baseUrl);
  cacheSet(cacheKey, verdict === 'valid');
  if (verdict === 'valid') {
    return { ok: true };
  }
  if (verdict === 'invalid') {
    return { ok: false, status: 401, message: 'Unauthorized: invalid session token' };
  }
  return { ok: false, status: 502, message: 'Session validation backend unreachable (fail-closed)' };
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

  const check = await checkImtSession(c, token);
  if (check.ok) {
    return next();
  }
  return c.json({ code: check.status, message: check.message }, check.status);
};
