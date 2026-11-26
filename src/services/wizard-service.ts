// spec-010 v8 B-7: Wizard Service — 首次安装向导服务层封装。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
// Token Security: 请求可含 token 明文(经 HTTPS),响应不含 token 明文,只含 envSnippet 引用。
//
// 类型与 bff/src/types/wizard.ts 同步。
// wizard-sso(P2/P3, 2026-11):
// - 新增 WizardSsoSettings / sso 渠道端点;
// - RAG 插件字段移除(RAG 由管理端补配,不随向导收集/探测,见 docs/wizard-kag-to-sso-design.md)。

import api from '@/utils/api';
import request from '@/utils/next-request';

// ---------------------------------------------------------------------------
// Types — 与 BFF src/types/wizard.ts 同步
// ---------------------------------------------------------------------------

export type BackendType =
  | 'intellect-rag'
  | 'intellect-enterprise'
  | 'intellect-llm'
  | 'intellect-community'
  | 'hermes'
  // P1(wizard-sso):kag 已从向导选项下架;类型联合保留 —— 与 admin 管理端/存量配置同源,
  // 仅向导不再提供该选项(docs/wizard-kag-to-sso-design.md §3.3)。
  | 'kag'
  | 'agent-scope';

export type CredentialKind = 'bearer-token' | 'email-password';

export interface HarnessCapabilities {
  canvas: boolean;
  knowledgeBase: boolean;
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;
  modelManagement: boolean;
}

export interface WizardStatusResponse {
  needsSetup: boolean;
  bootstrapEnabled: boolean;
  backendCount: number;
  /** 已存在企业版后端配置(含 token 未就绪);"新增后端"场景据此隐藏 SSO 模式卡 */
  hasEnterpriseBackend: boolean;
}

/** wizard-ent-sso-mode:企业双卡 profile(与 BFF 同步;enterprise-password 为 deprecated 别名) */
export type WizardSetupProfile = 'enterprise-sso' | 'enterprise-non-sso' | 'enterprise-password';

export interface WizardBackendTypeOption {
  /** 选型主键;企业双卡必不同 */
  optionId: string;
  type: BackendType;
  setupProfile?: WizardSetupProfile;
  label: string;
  description: string;
  defaultEndpoint: string;
  capabilities: HarnessCapabilities;
  credentialKind: CredentialKind;
}

export interface WizardBackendTypesResponse {
  options: WizardBackendTypeOption[];
}

export interface WizardProbeRequest {
  type: BackendType;
  endpoint: string;
  token?: string;
  email?: string;
  password?: string;
  /** wizard-ent-sso-mode v1.3:enterprise-sso 时走 SSO 模式验证分支 */
  setupProfile?: WizardSetupProfile;
}

/** wizard-ent-sso-mode v1.3:SSO 模式验证的四项结论(第 4 步逐项展示) */
export interface WizardProbeSso {
  gatewayOk: boolean;
  /** 网关返回的实例级租户 ID;null = 网关可达但未返回,需手填 */
  tenantId: string | null;
  /** 网关服务密钥是否通过校验;null = 无法判定,不阻断 */
  keyValid: boolean | null;
  providersOk: boolean;
  providerCount?: number;
}

export interface WizardProbeResponse {
  healthy: boolean;
  capabilities?: HarnessCapabilities;
  error?: string;
  /** 仅 SSO 模式验证返回 */
  sso?: WizardProbeSso;
}

/**
 * wizard-sso(P2): 向导 SSO 配置。
 * 评审取舍:setup 不复刻生产 https 强制——运行时以 BFF sso-config 启动 fail-fast
 * 为单一裁决点,向导保持非阻塞;此处仅做结构校验。
 */
export interface WizardSsoSettings {
  /** 兼容字段:SSO 模式下由 BFF 推定为 true,前端不传 */
  enabled?: boolean;
  publicOrigin: string;
  /** 客户端生成的随机密钥(≥32 字符);响应 envSnippet 永以 <your-secret> 占位 */
  stateSecret?: string;
  /** 登录渠道白名单;缺省/null/空 = 不过滤(与 BFF_SSO_PROVIDERS 语义一致) */
  providers?: string[] | null;
  /** 静默重登(默认 true) */
  silentRelogin?: boolean;
}

export interface WizardSetupRequest {
  name: string;
  type: BackendType;
  endpoint: string;
  credentialKind: CredentialKind;
  token?: string;
  email?: string;
  password?: string;
  adminTokenEnvVar?: string;
  /** 企业版实例级租户 ID;SSO 模式下可缺省,由 BFF 从网关自动识别(识别不到时手填) */
  intellectTenantId?: string;
  /** wizard-ent-sso-mode:企业双卡。SSO 模式下 name / credentialKind 亦可缺省 */
  setupProfile?: WizardSetupProfile;
  defaultForTenant?: boolean;
  /** wizard-sso(P2): 统一认证配置(仅 enterprise-sso;明文 secret 仅存在于请求期,不落盘) */
  sso?: WizardSsoSettings;
}

export interface WizardSetupResponse {
  success: boolean;
  backendId?: string;
  envSnippet?: string;
  error?: string;
  /** 非阻断告警(如新后端未就绪、RAG 未配置、SSO 白名单含未知渠道),前端展示于 Done 步骤 */
  warnings?: string[];
  /** SSO 模式保存后的联合验证结果(失败不阻断保存) */
  checks?: WizardSetupCheck[];
}

export interface WizardSetupCheck {
  id: 'channels' | 'login_redirect' | 'callback_reachable' | 'callback_registered';
  label: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

/** wizard-sso(P2): 渠道视图(评审 R2:字段裁剪,不透出 clientId/authorizeUrl/scopes) */
export interface WizardSsoProviderView {
  id: string;
  displayName: string;
  icon: string;
}

/** wizard-sso(P2): GET /admin/wizard/sso/providers 响应 */
export interface WizardSsoProvidersResponse {
  providers: WizardSsoProviderView[];
  /** 因字段缺失/PKCE 不支持被排除的渠道 id */
  misconfigured: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------
//
// 注意:BFF wizard 路由直接返回裸对象(无 ApiResponse { code, message, data } 包装),
// 因此泛型参数使用响应体类型本身。历史遗留:原声明为 ApiResponse<T> 与 BFF 实际返回
// 格式不符,导致消费方需用 `as unknown as` 双重断言或读 `data.data.xxx`(运行时
// undefined,会抛 TypeError)。已在 spec-010 评审中根治。

/**
 * 查询 Wizard 状态(是否需要首次安装)。
 * GET /api/bff/admin/wizard/status
 */
export const fetchWizardStatus = () =>
  request.get<WizardStatusResponse>(api.wizard.status);

/**
 * 获取可用后端类型列表(Step 2)。
 * GET /api/bff/admin/wizard/backend-types
 */
export const fetchWizardBackendTypes = () =>
  request.get<WizardBackendTypesResponse>(api.wizard.backendTypes);

/**
 * 探测后端连接(Step 4)。
 * POST /api/bff/admin/wizard/probe
 */
export const probeWizardBackend = (req: WizardProbeRequest) =>
  request.post<WizardProbeResponse>(api.wizard.probe, req);

/**
 * 创建第一个 backend(Step 5)。
 * POST /api/bff/admin/wizard/setup
 */
export const setupWizardBackend = (req: WizardSetupRequest) =>
  request.post<WizardSetupResponse>(api.wizard.setup, req);

/**
 * wizard-sso(P2): 拉取网关已配置的 SSO 登录渠道(公开端点,IP 限流 + SSRF 防护)。
 * GET /api/bff/admin/wizard/sso/providers?endpoint=...
 */
export const fetchWizardSsoProviders = (endpoint: string) =>
  request.get<WizardSsoProvidersResponse>(api.wizard.ssoProviders, {
    params: { endpoint },
  });
