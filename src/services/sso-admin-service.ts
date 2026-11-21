// wizard-sso-followup(A7): 统一认证运行时配置管理服务层。
// 网络分层:仅经 @/utils/next-request;类型与 bff/src/routes/sso-admin.ts 响应同步。

import api from '@/utils/api';
import request from '@/utils/next-request';

export interface SsoAdminConfig {
  enabled: boolean;
  publicOrigin: string;
  /** null = 不过滤(以网关 enabled/usage 为准) */
  providers: string[] | null;
  silentRelogin: boolean;
}

export interface SsoAdminView {
  config: SsoAdminConfig;
  /** 当前生效的运行时文件内容(无则 null) */
  runtime: SsoAdminConfig & { updatedAt: string } | null;
  sources: Record<string, 'runtime' | 'env'>;
  /** 启用但密钥缺失时的自检提示位 */
  stateSecretConfigured: boolean;
  warnings?: string[];
}

export interface SsoAdminSavePayload {
  enabled: boolean;
  publicOrigin: string;
  /** 逗号分隔清单由页面解析;空 = null(不过滤) */
  providers: string[] | null;
  silentRelogin: boolean;
}

export const getSsoAdminConfig = () =>
  request.get<SsoAdminView>(api.ssoAdminConfig);

export const saveSsoAdminConfig = (payload: SsoAdminSavePayload) =>
  request.put<SsoAdminView>(api.ssoAdminConfig, payload);

export const resetSsoAdminConfig = () =>
  request.delete<SsoAdminView>(api.ssoAdminConfig);
