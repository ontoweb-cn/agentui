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
import type { WizardProbeResponse, WizardProbeSso, WizardSetupCheck } from '../types/wizard';

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

/**
 * 保存后的联合验证(2026-11-26 方案 §14.3 第 7 步)。
 *
 * 只做服务端可判定的三项:渠道列表、登录跳转、回调入口可达;
 * 回调白名单与跨应用登录/推理仍为人工确认项(以 skip 返回)。
 * 任何网络失败都降级为 skip,不阻断向导保存。
 *
 * 评审加固(H2/M1/L3):
 * - 总预算 4s、渠道/回调并行各 ≤2.5s,登录跳转用剩余预算——避免保存请求被拖到网关超时;
 * - publicOrigin 先做 URL/scheme 预校验,非法直接全部 skip,不对任意地址发起探测;
 * - 三处 safeFetch 显式 allowPrivateIP:false(限制内网探测面);
 * - 5xx 视为服务暂不可用 → skip(非 fail),4xx 才是配置问题。
 */
/** 联合验证总预算(毫秒):保存响应不应被联检拖到网关超时 */
const SSO_FLOW_BUDGET_MS = 4000;
/** 并行两项(渠道/回调)各自的超时 */
const SSO_PARALLEL_TIMEOUT_MS = 2500;

const CHECK_CHANNELS_LABEL = '统一认证渠道';
const CHECK_LOGIN_LABEL = '登录跳转';
const CHECK_CALLBACK_LABEL = '回调入口';
const CHECK_REGISTERED_LABEL = 'auth 回调白名单';

function skipAllChecks(detail: string): WizardSetupCheck[] {
  return [
    { id: 'channels', label: CHECK_CHANNELS_LABEL, status: 'skip', detail },
    { id: 'login_redirect', label: CHECK_LOGIN_LABEL, status: 'skip', detail },
    { id: 'callback_reachable', label: CHECK_CALLBACK_LABEL, status: 'skip', detail },
    {
      id: 'callback_registered',
      label: CHECK_REGISTERED_LABEL,
      status: 'skip',
      detail: '需人工确认 ia-intellect-team.redirectUris 已包含该回调',
    },
  ];
}

/** 渠道列表:data[] 非空即视为登录入口已就绪;首个渠道用于后续登录跳转 */
async function probeChannels(
  base: string,
): Promise<{ check: WizardSetupCheck; channel?: string }> {
  const id = 'channels';
  try {
    const resp = await safeFetch(`${base}/api/bff/auth/login/channels`, {
      headers: { Accept: 'application/json' },
      timeoutMs: SSO_PARALLEL_TIMEOUT_MS,
      allowPrivateIP: false,
    });
    if (resp.ok) {
      const body = (await resp.json().catch(() => null)) as
        | { data?: Array<{ channel?: string }> }
        | Array<{ channel?: string }>
        | null;
      const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      const ids = list.map((item) => item?.channel).filter((cid): cid is string => Boolean(cid));
      if (ids.length === 0) {
        return {
          check: {
            id,
            label: CHECK_CHANNELS_LABEL,
            status: 'fail',
            detail: '渠道列表为空:确认 SSO 已启用且网关 provider 可用',
          },
        };
      }
      return {
        check: {
          id,
          label: CHECK_CHANNELS_LABEL,
          status: 'pass',
          detail: `${ids.length} 个可用渠道`,
        },
        channel: ids[0],
      };
    }
    if (resp.status >= 500) {
      return {
        check: {
          id,
          label: CHECK_CHANNELS_LABEL,
          status: 'skip',
          detail: `BFF 服务暂不可用(HTTP ${resp.status}),稍后重试`,
        },
      };
    }
    if (resp.status === 404) {
      return {
        check: {
          id,
          label: CHECK_CHANNELS_LABEL,
          status: 'fail',
          detail: 'BFF 未暴露渠道端点(镜像可能仍是旧版本)',
        },
      };
    }
    return {
      check: { id, label: CHECK_CHANNELS_LABEL, status: 'fail', detail: `HTTP ${resp.status}` },
    };
  } catch (err) {
    return {
      check: {
        id,
        label: CHECK_CHANNELS_LABEL,
        status: 'skip',
        detail: `BFF 无法回访自身公网地址:${(err as Error).message}`,
      },
    };
  }
}

/** 回调入口:404 说明路由不存在;5xx 服务暂不可用 → skip */
async function probeCallback(base: string): Promise<WizardSetupCheck> {
  const id = 'callback_reachable';
  try {
    const resp = await safeFetch(`${base}/api/bff/auth/oauth/callback`, {
      timeoutMs: SSO_PARALLEL_TIMEOUT_MS,
      redirect: 'manual',
      allowPrivateIP: false,
    });
    if (resp.status >= 500) {
      return {
        id,
        label: CHECK_CALLBACK_LABEL,
        status: 'skip',
        detail: `BFF 服务暂不可用(HTTP ${resp.status})`,
      };
    }
    return {
      id,
      label: CHECK_CALLBACK_LABEL,
      status: resp.status === 404 ? 'fail' : 'pass',
      detail: `HTTP ${resp.status}`,
    };
  } catch (err) {
    return {
      id,
      label: CHECK_CALLBACK_LABEL,
      status: 'skip',
      detail: `请求失败:${(err as Error).message}`,
    };
  }
}

/** 登录跳转:期望 302 且目标是 IdP;timeoutMs 由总预算剩余决定 */
async function probeLoginRedirect(
  base: string,
  channel: string,
  timeoutMs: number,
): Promise<WizardSetupCheck> {
  const id = 'login_redirect';
  try {
    // M2:带 probe=1,要求 BFF/网关只构建授权 URL、不写 OAuth state
    //(联检不应在网关侧留下 pending state)
    const resp = await safeFetch(
      `${base}/api/bff/auth/login/${encodeURIComponent(channel)}?probe=1`,
      { timeoutMs, redirect: 'manual', allowPrivateIP: false },
    );
    if (resp.status >= 500) {
      return {
        id,
        label: CHECK_LOGIN_LABEL,
        status: 'skip',
        detail: `BFF 服务暂不可用(HTTP ${resp.status})`,
      };
    }
    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get('location') ?? '';
      let target = location;
      try {
        target = new URL(location, base).origin;
      } catch {
        // 保留原始 Location 用于展示
      }
      return {
        id,
        label: CHECK_LOGIN_LABEL,
        status: 'pass',
        detail: `302 → ${target}`,
      };
    }
    return {
      id,
      label: CHECK_LOGIN_LABEL,
      status: 'fail',
      detail: `期望 302,实际 HTTP ${resp.status}`,
    };
  } catch (err) {
    return {
      id,
      label: CHECK_LOGIN_LABEL,
      status: 'skip',
      detail: `请求失败:${(err as Error).message}`,
    };
  }
}

export async function verifySsoLoginFlow(
  publicOrigin: string,
  channel: string,
): Promise<WizardSetupCheck[]> {
  const base = publicOrigin.replace(/\/+$/, '');
  let resolvedChannel = channel.trim();

  // M1:先做 URL 与 scheme 预校验;非法直接全部 skip,避免对任意地址发起探测
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    return skipAllChecks('publicOrigin 不是合法的 http(s) 地址,跳过联检');
  }

  const startedAt = Date.now();
  const remainingMs = () =>
    Math.max(800, SSO_FLOW_BUDGET_MS - (Date.now() - startedAt));

  // 1)+3) 并行:渠道列表与回调入口(各 ≤2.5s)
  const [channelsProbe, callbackCheck] = await Promise.all([
    probeChannels(base),
    probeCallback(base),
  ]);
  if (channelsProbe.channel) resolvedChannel = channelsProbe.channel;

  const checks: WizardSetupCheck[] = [channelsProbe.check];

  // 2) 登录跳转:需要渠道;用剩余预算(总预算 4s 内完成)
  checks.push(
    resolvedChannel
      ? await probeLoginRedirect(base, resolvedChannel, remainingMs())
      : {
          id: 'login_redirect',
          label: CHECK_LOGIN_LABEL,
          status: 'skip',
          detail: '没有可用渠道,跳过',
        },
  );

  checks.push(callbackCheck);

  // 4) 回调白名单:跨系统,只能人工确认
  checks.push({
    id: 'callback_registered',
    label: CHECK_REGISTERED_LABEL,
    status: 'skip',
    detail: '需人工确认 ia-intellect-team.redirectUris 已包含该回调',
  });

  return checks;
}
