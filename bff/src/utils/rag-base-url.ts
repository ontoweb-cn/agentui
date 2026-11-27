/** Intellect RAG 上游 origin。未设置时默认本地 9380。尾部斜杠会被去掉。 */
const DEFAULT_RAG_URL = 'http://localhost:9380';

export function getRagBaseUrl(): string {
  const raw = process.env.INTELLECT_RAG_URL?.trim() || DEFAULT_RAG_URL;
  return raw.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// D10 路径级灰度分流(spec 2026-11-27-go-migration-w1b §5.1/§5.3)
// ---------------------------------------------------------------------------
// 与 nginx 侧 docker/gen-go-split.sh 同源:同一个 RAG_GO_PREFIXES /
// RAG_GO_UPSTREAM 驱动两端,规则必须逐条对齐,否则浏览器入口与服务端入口
// 会把同一路径送到不同上游。
// 默认(两个变量都为空)→ 完全等价于 getRagBaseUrl(),行为零变化。

/** 禁用前缀:管理面 / 平台通道 / BFF 自身 / 画布。 */
export const FORBIDDEN_GO_PREFIXES = [
  '/api/v1/admin',
  '/api/v1/platform',
  '/api/bff',
  '/api/v1/wargame',
] as const;

/** 与 shell 生成器一致:仅允许 [A-Za-z0-9/._-],必须以 / 开头,长度 ≤ 128。 */
const PREFIX_ALLOWED_RE = /^\/[A-Za-z0-9/_.-]*$/;
const MAX_PREFIX_LEN = 128;

interface GoPrefixesResult {
  prefixes: string[];
  /** 非空表示配置非法:整体回退 Python,禁止部分切换。 */
  error?: string;
}

/** 去掉尾部斜杠(保留根 /),使两端匹配语义一致。 */
function normalizePrefix(prefix: string): string {
  const stripped = prefix.replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
}

function isForbiddenPrefix(prefix: string): boolean {
  return FORBIDDEN_GO_PREFIXES.some((forbidden) => {
    // 禁用面被该前缀按字符串覆盖:nginx `^~` 前缀不按段边界匹配,
    // 因此 `/api/v1/ad` 会吃掉 `/api/v1/admin`,必须拒绝。
    if (forbidden === prefix || forbidden.startsWith(prefix)) {
      return true;
    }
    // 前缀落在禁用面内部(按段边界,避免误杀 /api/v1/adminx)。
    return prefix.startsWith(`${forbidden}/`);
  });
}

function validatePrefix(prefix: string): string | null {
  if (!prefix.startsWith('/')) {
    return `前缀必须以 / 开头: ${prefix}`;
  }
  if (!PREFIX_ALLOWED_RE.test(prefix)) {
    return `前缀仅允许 A-Za-z0-9 / _ . -: ${prefix}`;
  }
  if (prefix.includes('..')) {
    return `前缀不允许路径穿越 ..: ${prefix}`;
  }
  if (prefix.length > MAX_PREFIX_LEN) {
    return `前缀长度 ${prefix.length} 超过 ${MAX_PREFIX_LEN}: ${prefix}`;
  }
  if (isForbiddenPrefix(prefix)) {
    return `禁用前缀(管理面/平台/BFF/画布不可切 Go): ${prefix}`;
  }
  return null;
}

/** 解析 RAG_GO_PREFIXES;空/缺失返回空前缀列表(不报错)。 */
function parseGoPrefixes(raw: string): GoPrefixesResult {
  const entries = raw.split(/[\s,]+/).filter((entry) => entry !== '');
  const prefixes: string[] = [];
  for (const entry of entries) {
    const prefix = normalizePrefix(entry);
    const error = validatePrefix(prefix);
    if (error) {
      return { prefixes: [], error };
    }
    prefixes.push(prefix);
  }
  return { prefixes };
}

/** 已告警过的非法配置原文:同一份配置只报一次,避免每请求刷日志。 */
let warnedConfig: string | null = null;

function warnInvalidConfig(raw: string, message: string): void {
  if (warnedConfig === raw) {
    return;
  }
  warnedConfig = raw;
  console.error(
    `[rag-base-url] RAG_GO_PREFIXES 配置非法,全部流量回退 Python(不部分切换): ${message}`,
  );
}

/**
 * 按请求路径解析 RAG 上游 origin(D10 灰度分流)。
 *
 * - RAG_GO_PREFIXES / RAG_GO_UPSTREAM 任一为空 → 全量 Python(`fallbackBaseUrl`
 *   或 `getRagBaseUrl()`)。
 * - 最长前缀命中(按路径段边界)→ Go 上游。
 * - 任一非法/禁用前缀 → 记一次错误并整体回退 Python。
 *
 * @param pathname 上游路径(如 `/api/v1/datasets/xxx`),query/hash 会被忽略
 * @param fallbackBaseUrl 未分流时的 origin(调用方已有租户级 endpoint 时传入,
 *   缺省回退 `getRagBaseUrl()`)
 */
export function resolveRagBaseUrl(pathname: string, fallbackBaseUrl?: string): string {
  const pythonBase =
    (fallbackBaseUrl ?? '').trim().replace(/\/+$/, '') || getRagBaseUrl();

  const rawPrefixes = process.env.RAG_GO_PREFIXES?.trim() ?? '';
  const rawUpstream = process.env.RAG_GO_UPSTREAM?.trim() ?? '';
  if (rawPrefixes === '' || rawUpstream === '') {
    return pythonBase;
  }

  const { prefixes, error } = parseGoPrefixes(rawPrefixes);
  if (error) {
    warnInvalidConfig(rawPrefixes, error);
    return pythonBase;
  }
  if (prefixes.length === 0) {
    return pythonBase;
  }

  const upstream = rawUpstream.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(upstream)) {
    warnInvalidConfig(rawUpstream, `RAG_GO_UPSTREAM 必须以 http:// 或 https:// 开头`);
    return pythonBase;
  }

  const path = pathname.split(/[?#]/)[0] || '/';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let matched: string | null = null;
  for (const prefix of prefixes) {
    const hit =
      prefix === '/'
        ? normalizedPath.startsWith('/')
        : normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
    if (hit && (matched === null || prefix.length > matched.length)) {
      matched = prefix;
    }
  }

  return matched === null ? pythonBase : upstream;
}
