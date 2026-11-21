/**
 * D2-3：AgentUI BFF 的 IdP 直通配置（默认关闭）。
 *
 * BFF 以自有 OIDC client 完成 code→token，持有 15 分钟 access JWT 与 refresh
 * （服务端会话，浏览器无感）；出站用户态调用改用 `Authorization: Bearer <IdP JWT>`。
 * 未启用或配置不全时，所有调用方回退现有 imt_token / API_SERVER_KEY 行为。
 */

export interface IdpPassthroughConfig {
  /** 总开关：`BFF_IDP_PASSTHROUGH_ENABLED`（默认 false）。 */
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  /** access token 允许的 aud 白名单（默认 [clientId]）。 */
  audiences: string[];
  /** refresh 单飞（默认 true）。 */
  refreshSingleflight: boolean;
  exchangeTimeoutMs: number;
  /** 提前刷新窗口（默认 30s）。 */
  tokenSkewMs: number;
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function loadIdpPassthroughConfig(env: NodeJS.ProcessEnv = process.env): IdpPassthroughConfig {
  const issuer = trimSlash(env.BFF_IDP_ISSUER ?? '');
  const clientId = (env.BFF_IDP_CLIENT_ID ?? '').trim();
  const audiences = (env.BFF_IDP_AUDIENCES ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    enabled: readBoolean(env.BFF_IDP_PASSTHROUGH_ENABLED, false),
    issuer,
    clientId,
    clientSecret: (env.BFF_IDP_CLIENT_SECRET ?? '').trim(),
    // Casdoor 风格默认 token 端点；生产可用 BFF_IDP_TOKEN_URL 显式覆盖。
    tokenUrl: trimSlash(env.BFF_IDP_TOKEN_URL ?? '') || `${issuer}/api/login/oauth/access_token`,
    audiences: audiences.length > 0 ? audiences : clientId ? [clientId] : [],
    refreshSingleflight: readBoolean(env.BFF_IDP_REFRESH_SINGLEFLIGHT, true),
    exchangeTimeoutMs: readPositiveInt(env.BFF_IDP_EXCHANGE_TIMEOUT_MS, 10_000),
    tokenSkewMs: readPositiveInt(env.BFF_IDP_TOKEN_SKEW_MS, 30_000),
  };
}

/** 开关开启且必要字段齐全时，直通链路才可用。 */
export function isIdpPassthroughUsable(config: IdpPassthroughConfig): boolean {
  return (
    config.enabled &&
    Boolean(config.issuer) &&
    Boolean(config.clientId) &&
    Boolean(config.tokenUrl)
  );
}
