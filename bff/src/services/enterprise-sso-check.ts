/**
 * 企业版 SSO 前置状态检测服务(wizard-ent-sso-mode v1.4 §12 R-2 抽取)。
 *
 * 从 wizard 路由抽出,供两处复用:
 * - POST /admin/wizard/probe(deprecated enterprise-sso 验证分支,回归兼容)
 * - GET /admin/sso/config?check=1(管理页「前置状态」实时检测,admin 门控)
 *
 * 判定口径(§10.6,勿回退):只对网关"明确拒绝"下结论——
 * 服务密钥依次试 /v1/capabilities、/v1/models:200=有效,401/403=无效,
 * 其余(404/5xx/网络错误)= unknown(keyValid=null,不阻断)。
 */

import { safeFetch } from './ssrf-guard';
import { loadSsoConfig } from './sso-config';
import { getLoginProviders } from './sso-providers';
import { fetchTenantInfo, type TenantInfoResponse } from './tenant-validator';
import type { WizardProbeResponse, WizardProbeSso } from '../types/wizard';

/** 企业版实例级租户 ID(Rust 版网关要求 32 位 hex) */
export const TENANT_ID_RE = /^[0-9a-fA-F]{32}$/;

/** 网关基址防呆:WebUI 页面地址与网关基址都能通过 URL 安全校验,但前者没有 /api/tenant/info */
export const GATEWAY_BASE_HINT =
  '无法访问 /api/tenant/info 端点(请确认 endpoint 填写的是网关基址,如 https://<host>/intellect-gateway,而非 WebUI 页面地址)';

/** 受 API_SERVER_KEY 保护的网关端点,依次尝试;首个非 404 的响应即作为判据 */
const SERVER_KEY_PROBE_PATHS = ['/v1/capabilities', '/v1/models'];

/**
 * 校验网关服务密钥:200 = 有效,401/403 = 无效。
 * 其余(端点不存在 404、5xx、网络错误)= unknown,不阻断——不同网关实现的
 * 受保护端点并不一致,向导/管理页只对"网关明确拒绝"下结论。
 */
export async function verifyEnterpriseServerKey(
  endpoint: string,
  serverKey: string,
): Promise<'valid' | 'invalid' | 'unknown'> {
  for (const path of SERVER_KEY_PROBE_PATHS) {
    try {
      const resp = await safeFetch(`${endpoint}${path}`, {
        headers: { Authorization: `Bearer ${serverKey}` },
        timeoutMs: 5000,
      });
      if (resp.ok) return 'valid';
      if (resp.status === 401 || resp.status === 403) return 'invalid';
      if (resp.status !== 404) return 'unknown';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

/**
 * SSO 前置状态检测,一次给出网关 / 租户 / 密钥 / 认证服务四项结论。
 * 租户 ID 缺失不算静默失败:以 healthy=false + error 说明,
 * 其余结论照常返回(tenantId=null 由调用方回退为手填)。
 */
export async function verifyEnterpriseSso(
  endpoint: string,
  tenantInfo: TenantInfoResponse | null,
  serverKey: string | undefined,
): Promise<WizardProbeResponse> {
  const sso: WizardProbeSso = {
    gatewayOk: false,
    tenantId: null,
    keyValid: null,
    providersOk: false,
  };
  if (!tenantInfo) {
    return { healthy: false, error: GATEWAY_BASE_HINT, sso };
  }
  sso.gatewayOk = true;
  sso.tenantId = tenantInfo.tenant_id?.trim() || null;

  let error: string | undefined;
  if (!sso.tenantId) {
    error = '网关未返回企业租户 ID,请手动填写(32 位 hex)。';
  }

  if (!serverKey) {
    sso.keyValid = false;
    error ??= '请填写网关服务密钥。';
  } else {
    const verdict = await verifyEnterpriseServerKey(endpoint, serverKey);
    sso.keyValid = verdict === 'unknown' ? null : verdict === 'valid';
    if (sso.keyValid === false) {
      error ??= '网关服务密钥无效(网关返回 401/403)。';
    }
  }

  try {
    // 不过滤渠道:这里要的是网关侧可用渠道总数,而非当前 env 白名单下的子集
    const selection = await getLoginProviders(endpoint, 'wizard-probe', {
      ...loadSsoConfig(),
      providers: null,
    });
    sso.providersOk = true;
    sso.providerCount = selection.providers.length;
  } catch {
    error ??= '统一认证服务不可达,请稍后再试。';
  }

  return { healthy: !error, ...(error ? { error } : {}), sso };
}

export type EnterpriseSsoCheckResult = WizardProbeResponse;
