/**
 * 公开 OAuth provider 元数据客户端（spec-014 FR-013/FR-023）。
 *
 * - 只调用网关公开端点 `/api/members/oauth/providers`，不携带 API_SERVER_KEY
 * - 字段缺失的 provider 视为 misconfigured，不进入渠道列表
 * - 按 tenant 维度做短 TTL 缓存；刷新失败时允许使用 ≤5 分钟的旧值
 * - 出站经 `safeFetch`（§9 S1：redirect:manual + 主机/DNS 私网校验）
 */
import type { SsoConfig } from './sso-config';
import { safeFetch } from './ssrf-guard';

export interface PublicOAuthProvider {
  id: string;
  name?: string;
  usage?: string;
  enabled?: boolean;
  logo_svg?: string;
  display_order?: number;
  client_id?: string;
  authorize_url?: string;
  scopes?: string;
  /** 兼容 boolean 或字符串（如 'S256'）；缺省视为支持。 */
  pkce?: boolean | string;
}

export interface SsoProvider {
  id: string;
  displayName: string;
  icon: string;
  clientId: string;
  authorizeUrl: string;
  scopes: string;
}

export interface ProviderSelection {
  providers: SsoProvider[];
  /** 因字段缺失被排除的 provider id（用于 sso_misconfigured 日志）。 */
  misconfigured: string[];
}

interface CacheEntry {
  fetchedAt: number;
  raw: PublicOAuthProvider[];
}

const DEFAULT_SCOPES = 'openid profile email';
const STALE_MAX_MS = 5 * 60 * 1000;

const cache = new Map<string, CacheEntry>();

export function clearProviderCache(): void {
  cache.clear();
}

function isPkceSupported(pkce: boolean | string | undefined): boolean {
  if (pkce === undefined) return true;
  if (typeof pkce === 'boolean') return pkce;
  return pkce.toUpperCase().includes('S256');
}

function extractArray(body: unknown): PublicOAuthProvider[] | null {
  if (Array.isArray(body)) return body as PublicOAuthProvider[];
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as PublicOAuthProvider[]) : null;
}

async function fetchPublicProviders(baseUrl: string): Promise<PublicOAuthProvider[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/members/oauth/providers`;
  // 与 wizard probe 对齐：安全出站（默认允许私网以适配内网网关；公网部署设 SSRF_ALLOW_PRIVATE_IP=false）
  const resp = await safeFetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 5000,
  });

  if (!resp.ok) {
    throw new Error(`provider list returned ${resp.status}`);
  }

  const body = (await resp.json().catch(() => null)) as unknown;
  const providers = extractArray(body);
  if (!providers) throw new Error('provider list response is not an array');
  return providers;
}

async function loadRawProviders(
  baseUrl: string,
  tenantId: string,
  config: SsoConfig,
): Promise<PublicOAuthProvider[]> {
  const cacheKey = `${tenantId}@${baseUrl}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.fetchedAt <= config.providerCacheMs) {
    return cached.raw;
  }

  try {
    const raw = await fetchPublicProviders(baseUrl);
    cache.set(cacheKey, { fetchedAt: now, raw });
    return raw;
  } catch (err) {
    if (cached && now - cached.fetchedAt <= Math.max(config.providerCacheMs, STALE_MAX_MS)) {
      console.warn(
        `[sso-providers] refresh failed for tenant ${tenantId}, using cached list:`,
        (err as Error).message,
      );
      return cached.raw;
    }
    throw err;
  }
}

/**
 * 选取可登录的渠道。字段缺失或 PKCE 不支持的 provider 进入 misconfigured。
 */
export async function getLoginProviders(
  baseUrl: string,
  tenantId: string,
  config: SsoConfig,
): Promise<ProviderSelection> {
  const raw = await loadRawProviders(baseUrl, tenantId, config);
  const providers: SsoProvider[] = [];
  const misconfigured: string[] = [];

  for (const item of raw) {
    if (!item?.id || item.enabled !== true) continue;
    if (!(item.usage ?? '').split(/[\s,]+/).some((usage) => usage.trim() === 'login')) continue;

    if (!item.client_id || !item.authorize_url) {
      const missing: string[] = [];
      if (!item.client_id) missing.push('client_id');
      if (!item.authorize_url) missing.push('authorize_url');
      misconfigured.push(item.id);
      console.warn(
        `[sso-providers] provider ${item.id} missing ${missing.join(',')}; hidden from channels`,
      );
      continue;
    }

    const clientId = item.client_id;
    const authorizeUrl = item.authorize_url;

    if (!isPkceSupported(item.pkce)) {
      misconfigured.push(item.id);
      console.warn(`[sso-providers] provider ${item.id} does not support PKCE S256; hidden from channels`);
      continue;
    }

    if (config.providers && !config.providers.includes(item.id)) continue;

    providers.push({
      id: item.id,
      displayName: item.name?.trim() || item.id,
      icon: item.logo_svg || 'sso',
      clientId,
      authorizeUrl,
      scopes: item.scopes?.trim() || DEFAULT_SCOPES,
    });
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { providers, misconfigured };
}
