/**
 * SSO P2 配置（spec-014 / plan-p2 v1.3）。
 *
 * 每次调用按需读取 env，便于测试注入；启动时由 assertSsoConfigAtStartup 做 fail-fast。
 */

// A7(wizard-sso-followup):运行时配置存储(状态密钥永不入 store)
import { readSsoRuntimeConfig } from './sso-store';

export const SSO_CALLBACK_PATH = '/api/bff/auth/oauth/callback';

export interface SsoConfig {
  /**
   * 保留配置面：BFF-as-RP 登录链路已移除，该字段仅用于 admin/向导展示与
   * provider 公开列表分支，不再驱动登录/回调流程。
   */
  enabled: boolean;
  stateSecret: string;
  publicOrigin: string;
  /** 全局应急名单；null = 不额外过滤，完全以网关 enabled/usage 为准。 */
  providers: string[] | null;
  silentRelogin: boolean;
  /**
   * §14 登出三项(可选;空串 = 未配置)。
   * oauthClientId/idpLogoutUrl 为 runtime(sso-config.json)优先于 env;
   * M6:idpIssuer 例外——env(BFF_OAUTH_IDP_ISSUER)是 back-channel 验签信任锚,
   * 一旦设置即固定,运行时配置不得覆盖(仅 env 未设置时作为引导值)。
   * 保持 optional 以兼容既有 SsoConfig 字面量构造方。
   */
  oauthClientId?: string;
  idpIssuer?: string;
  idpLogoutUrl?: string;
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
  const envConfig: SsoConfig = buildEnvConfig(env);
  // A7(wizard-sso-followup):runtime 文件逐字段优先于 env(M6 例外:idpIssuer
  // 以 env 为信任锚,见下);文件缺失/损坏 → 纯 env(向后兼容,删除文件即回滚)。
  // 见 services/sso-store.ts。
  const runtime = readSsoRuntimeConfig();
  if (!runtime) return envConfig;
  return {
    ...envConfig,
    enabled: runtime.enabled,
    publicOrigin: runtime.publicOrigin || envConfig.publicOrigin,
    // runtime null = 显式"不过滤",覆盖 env 应急名单
    providers: runtime.providers,
    silentRelogin: runtime.silentRelogin,
    // §14 登出三项:clientId/logoutUrl runtime 非空优先,否则回落 env
    oauthClientId: runtime.oauthClientId || envConfig.oauthClientId,
    // M6:issuer 是 back-channel 验签的信任锚(决定 JWKS discovery 地址),
    // 部署 env 一旦设置即固定,运行时配置不得覆盖(避免管理员把信任锚改到任意地址)。
    // env 未设置时才允许运行时配置作为引导值。
    idpIssuer: envConfig.idpIssuer || runtime.idpIssuer,
    idpLogoutUrl: runtime.idpLogoutUrl || envConfig.idpLogoutUrl,
  };
}

function buildEnvConfig(env: NodeJS.ProcessEnv): SsoConfig {
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
    // §14 登出三项 env 兜底(空串=未配置)
    oauthClientId: (env.BFF_OAUTH_CLIENT_ID ?? '').trim(),
    idpIssuer: (env.BFF_OAUTH_IDP_ISSUER ?? '').trim(),
    idpLogoutUrl: (env.BFF_OAUTH_IDP_LOGOUT_URL ?? '').trim(),
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
 * §14:可选 URL 字段校验 — 非空时必须是合法的 http(s) 绝对 URL。
 */
function assertOptionalHttpUrl(name: string, value: string | undefined): void {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid absolute URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
}

/**
 * 启动校验：启用 SSO 但关键配置缺失时抛错（调用方负责退出进程）。
 */
export function validateSsoConfig(config: SsoConfig, nodeEnv = process.env.NODE_ENV): void {
  if (!config.enabled) return;

  // BFF-as-RP 链路已移除，stateSecret 不再参与签名/校验，故不再强制要求。
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
  // §14 登出三项:issuer / logoutUrl 非空必须是合法 http(s) URL
  assertOptionalHttpUrl('BFF_OAUTH_IDP_ISSUER', config.idpIssuer);
  assertOptionalHttpUrl('BFF_OAUTH_IDP_LOGOUT_URL', config.idpLogoutUrl);
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
