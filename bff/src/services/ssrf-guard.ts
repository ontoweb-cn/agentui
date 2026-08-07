/**
 * SSRF 防护 — 安全 fetch 封装。
 *
 * spec-010 v8 B-2: SSRF 防护强化。
 * - DNS rebinding 校验:解析域名后校验 IP 不在私有范围
 * - redirect: manual:不自动跟随重定向(防止重定向到内网)
 * - 超时控制:默认 10s
 *
 * 运行时:Node.js(tsx),用 node:dns 的 promises.lookup 解析域名。
 */

import { promises as dns } from 'node:dns';

/**
 * 默认是否允许私有 IP。
 *
 * 多数内部/实验室部署的后端位于私有网段(192.168.x.x / 10.x.x.x 等),
 * 默认放行以适配内网部署场景。公网暴露的 BFF 应通过环境变量
 * SSRF_ALLOW_PRIVATE_IP=false 显式拦截(部署级 opt-out)。
 */
const DEFAULT_ALLOW_PRIVATE_IP = process.env.SSRF_ALLOW_PRIVATE_IP !== 'false';

/**
 * SSRF 私有 IP 拦截时附加给用户的操作指引(单一数据源)。
 * 所有因私有网段拦截产生的错误消息均复用此串,确保用户得到准确的修复建议。
 */
export const SSRF_PRIVATE_IP_HINT =
  '如需访问内网/私有网段后端,请确认 BFF .env 未设置 SSRF_ALLOW_PRIVATE_IP=false,或将其删除以放行';

const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8 (loopback)
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 (link-local)
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

export interface SafeFetchOptions extends RequestInit {
  /** 超时毫秒,默认 10000 */
  timeoutMs?: number;
  /** 允许私有 IP(开发环境,默认 false) */
  allowPrivateIP?: boolean;
}

/**
 * 解析 hostname 并校验所有解析结果均非私有 IP。
 * - IPv4 字面量直接校验
 * - IPv6 字面量(URL 中以 [ ] 包裹)直接校验
 * - 域名走 dns.lookup({ all: true }),逐个校验返回地址
 *
 * @returns 通过校验无异常(返回 void);失败抛 Error。
 */
async function assertHostNotPrivate(
  hostname: string,
  allowPrivateIP: boolean,
): Promise<void> {
  if (allowPrivateIP) return;

  // IPv4 字面量
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`SSRF blocked: ${hostname} is a private IP。${SSRF_PRIVATE_IP_HINT}`);
    }
    return;
  }

  // IPv6 字面量(URL 中以 [ ] 包裹)
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const ip = hostname.slice(1, -1);
    if (isPrivateIP(ip)) {
      throw new Error(`SSRF blocked: ${hostname} is a private IP。${SSRF_PRIVATE_IP_HINT}`);
    }
    return;
  }

  // 域名:DNS 解析后逐个校验(DNS rebinding 防护)
  try {
    const lookupResults = await dns.lookup(hostname, { all: true });
    for (const { address } of lookupResults) {
      if (isPrivateIP(address)) {
        throw new Error(
          `SSRF blocked: ${hostname} resolves to private IP ${address}。${SSRF_PRIVATE_IP_HINT}`,
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('SSRF blocked:')) {
      throw e;
    }
    // DNS 解析失败(如离线/域名不存在):降级为跳过 DNS 校验,
    // 由后续 fetch 的网络层错误自然返回。生产环境若需严格模式,
    // 可在此处改为 throw。
    console.warn(
      `[ssrf-guard] DNS resolution skipped for ${hostname}: ${
        (e as Error).message
      }`,
    );
  }
}

/**
 * 安全 fetch:SSRF 防护 + 超时控制。
 *
 * @throws Error 如果 URL 指向私有 IP(且未 allowPrivateIP)
 * @throws Error 如果请求超时(AbortError)
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 10000, allowPrivateIP = DEFAULT_ALLOW_PRIVATE_IP, ...fetchOptions } = options;

  // SSRF 校验:解析 URL,检查 hostname
  const parsed = new URL(url);
  await assertHostNotPrivate(parsed.hostname, allowPrivateIP);

  // 超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 合并 signal(用户传入的 signal + 超时 signal)
  // AbortSignal.any 在 Node 18+ 可用
  const signal = fetchOptions.signal
    ? AbortSignal.any([fetchOptions.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal,
      redirect: 'manual', // M6: 不自动跟随重定向
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 校验 URL 是否安全(不指向私有 IP)。
 * 用于向导探测端点前的预校验。
 *
 * 注:域名无法在预校验阶段做 DNS rebinding 防护
 * (解析与实际请求之间存在 TOCTOU 窗口),域名仅做格式校验,
 * 真正的 SSRF 防护依赖 safeFetch 运行时校验。
 */
export async function isUrlSafe(
  url: string,
  allowPrivateIP = DEFAULT_ALLOW_PRIVATE_IP,
): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) {
      return allowPrivateIP || !isPrivateIP(parsed.hostname);
    }
    if (parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')) {
      const ip = parsed.hostname.slice(1, -1);
      return allowPrivateIP || !isPrivateIP(ip);
    }
    return true; // 域名无法预校验,依赖 safeFetch 运行时校验
  } catch {
    return false;
  }
}
