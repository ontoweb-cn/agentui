// wizard-sso-followup(A7): 统一认证运行时配置管理服务层。
// 网络分层:仅经 @/utils/next-request;类型与 bff/src/routes/sso-admin.ts 响应同步。
//
// wizard-ent-sso-mode v1.4(设计 §11.2/§11.3):扩展管理页"前置状态"能力——
// stateSecret 三态、绑定后端信息、?check=1 实时四项检测、渠道裁剪预览。

import api from '@/utils/api';
import request from '@/utils/next-request';

export interface SsoAdminConfig {
  enabled: boolean;
  publicOrigin: string;
  /** null = 不过滤(以网关 enabled/usage 为准) */
  providers: string[] | null;
  silentRelogin: boolean;
}

/** stateSecret 三态(§12 R-5):unset=未设置 / set=已设置且合规 / invalid=已设但 <32 字符 */
export type SsoStateSecretStatus = 'unset' | 'set' | 'invalid';

/** 默认租户绑定的企业后端(仅非敏感字段) */
export interface SsoBoundBackend {
  id: string;
  endpoint: string;
}

/** ?check=1 的实时四项检测结论(与向导 probe 的 sso 明细同构) */
export interface SsoBackendCheckStatus {
  gatewayOk: boolean;
  /** 网关返回的实例级租户 ID;null = 网关可达但未返回 */
  tenantId: string | null;
  /** null = 无法判定(网关无受保护端点/网络错误),不阻断 */
  keyValid: boolean | null;
  providersOk: boolean;
  providerCount?: number;
}

export interface SsoAdminView {
  config: SsoAdminConfig;
  /** 当前生效的运行时文件内容(无则 null) */
  runtime: SsoAdminConfig & { updatedAt: string } | null;
  sources: Record<string, 'runtime' | 'env'>;
  /** 兼容位(v1.3):= stateSecretStatus === 'set' */
  stateSecretConfigured: boolean;
  /** v1.4 三态 */
  stateSecretStatus: SsoStateSecretStatus;
  /** 默认租户绑定的企业后端;null=未绑定;stores 缺失(部分单测)时缺省 */
  boundBackend?: SsoBoundBackend | null;
  warnings?: string[];
  /** 仅 ?check=1 时返回 */
  check?: {
    boundBackendMissing: boolean;
    status: SsoBackendCheckStatus | null;
  };
}

export interface SsoAdminSavePayload {
  enabled: boolean;
  publicOrigin: string;
  /** 逗号分隔清单由页面解析;空 = null(不过滤) */
  providers: string[] | null;
  silentRelogin: boolean;
}

/** 渠道裁剪视图(不透出 clientId/authorizeUrl/scopes) */
export interface SsoAdminProviderView {
  id: string;
  displayName: string;
  icon: string;
}

export interface SsoAdminProvidersResponse {
  providers: SsoAdminProviderView[];
  /** 因字段缺失/PKCE 不支持被排除的渠道 id */
  misconfigured: string[];
}

export const getSsoAdminConfig = (check = false) =>
  request.get<SsoAdminView>(
    check ? `${api.ssoAdminConfig}?check=1` : api.ssoAdminConfig,
  );

export const getSsoAdminProviders = () =>
  request.get<SsoAdminProvidersResponse>(api.ssoAdminProviders);

export const saveSsoAdminConfig = (payload: SsoAdminSavePayload) =>
  request.put<SsoAdminView>(api.ssoAdminConfig, payload);

export const resetSsoAdminConfig = () =>
  request.delete<SsoAdminView>(api.ssoAdminConfig);
