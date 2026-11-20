/**
 * SSO P2 配置（spec-014 / plan-p2 v1.3）。
 *
 * 每次调用按需读取 env，便于测试注入；启动时由 assertSsoConfigAtStartup 做 fail-fast。
 */

export const SSO_CALLBACK_PATH = '/api/bff/auth/oauth/callback';

export interface SsoConfig {
  enabled: boolean;
  stateSecret: string;
  publicOrigin: string;
  /** 全局应急名单；null = 不额外过滤，完全以网关 enabled/usage 为准。 */
  providers: string[] | null;
  silentRelogin: boolean;
  exchangeTimeoutMs: number;
  providerCacheMs: number;
  allowInsecure: boolean;
}

function readBoolean(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadSsoConfig(env: NodeJS.ProcessEnv = process.env): SsoConfig {
  const allowlist = (env.BFF_SSO_PROVIDERS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    enabled: readBoolean(env.BFF_SSO_ENABLED, false),
    stateSecret: (env.BFF_SSO_STATE_SECRET ?? '').trim(),
    publicOrigin: (env.BFF_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, ''),
    providers: allowlist.length > 0 ? allowlist : null,
    silentRelogin: readBoolean(env.BFF_SSO_SILENT_RELOGIN, true),
    exchangeTimeoutMs: readPositiveInt(env.BFF_SSO_EXCHANGE_TIMEOUT_MS, 10_000),
    providerCacheMs: readPositiveInt(env.BFF_SSO_PROVIDER_CACHE_MS, 30_000),
    allowInsecure: readBoolean(env.BFF_ALLOW_INSECURE_SSO, false),
  };
}

export function getSsoRedirectUri(config: SsoConfig): string {
  return `${config.publicOrigin}${SSO_CALLBACK_PATH}`;
}

export function isSecureCookie(config: SsoConfig): boolean {
  return config.publicOrigin.startsWith('https://');
}

/**
 * 启动校验：启用 SSO 但关键配置缺失时抛错（调用方负责退出进程）。
 */
export function validateSsoConfig(config: SsoConfig, nodeEnv = process.env.NODE_ENV): void {
  if (!config.enabled) return;

  if (config.stateSecret.length < 32) {
    throw new Error('BFF_SSO_STATE_SECRET must be at least 32 characters when BFF_SSO_ENABLED=true');
  }
  if (!config.publicOrigin) {
    throw new Error('BFF_PUBLIC_ORIGIN is required when BFF_SSO_ENABLED=true');
  }

  let origin: URL;
  try {
    origin = new URL(config.publicOrigin);
  } catch {
    throw new Error(`BFF_PUBLIC_ORIGIN is not a valid absolute URL: ${config.publicOrigin}`);
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error('BFF_PUBLIC_ORIGIN must use http or https');
  }
  if (nodeEnv === 'production' && origin.protocol !== 'https:' && !config.allowInsecure) {
    throw new Error('BFF_PUBLIC_ORIGIN must be https in production (set BFF_ALLOW_INSECURE_SSO=true only for local debugging)');
  }
}

/**
 * 进程启动时调用；失败直接退出，避免上线后才发现回调不可用。
 */
export function assertSsoConfigAtStartup(): void {
  const config = loadSsoConfig();
  try {
    validateSsoConfig(config);
  } catch (err) {
    console.error('[BFF] FATAL: invalid SSO configuration:', (err as Error).message);
    process.exit(1);
  }

  if (config.enabled) {
    console.log(
      `[BFF] SSO enabled: redirect_uri=${getSsoRedirectUri(config)}, ` +
        `silentRelogin=${config.silentRelogin}, providerCacheMs=${config.providerCacheMs}, ` +
        `globalAllowlist=${config.providers ? config.providers.join(',') : '(none)'}`,
    );
  }
}
