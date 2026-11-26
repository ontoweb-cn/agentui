// spec-010 v8 B-4: Wizard DTO — 首次安装向导请求/响应类型。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
// Token Security: 请求可含 token 明文(经 HTTPS),响应不含 token 明文,只含 envSnippet 引用。

import type { BackendType, HarnessCapabilities } from './harness';
import type { CredentialKind } from '../services/token-vault';

/**
 * wizard-ent-sso-mode:企业双卡选型 profile(不写入 harness type / authMode)。
 * `enterprise-non-sso` 覆盖密码/邮箱/服务密钥等非 SSO 方式(2026-11-26 命名调整);
 * `enterprise-password` 作为 deprecated 别名保留,后端入口统一归一化。
 */
export type WizardSetupProfile = 'enterprise-sso' | 'enterprise-non-sso' | 'enterprise-password';

// Step 2: 选择后端类型
export interface WizardBackendTypeOption {
  /** 选型主键;企业双卡必不同(§8 R1);非企业可等于 type */
  optionId: string;
  type: BackendType;
  /** 仅 intellect-enterprise 双卡 */
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

// Step 3: 填写连接信息
export interface WizardSetupRequest {
  name: string;
  type: BackendType;
  endpoint: string;
  credentialKind: CredentialKind;
  // bearer-token 模式
  token?: string;
  // email-password 模式
  email?: string;
  password?: string;
  // env var 模式(展示 .env 片段,用户手动设置)
  adminTokenEnvVar?: string;
  // intellect-enterprise 专用。
  // wizard-ent-sso-mode v1.3:SSO 模式不向用户采集,缺省时 BFF 从网关公开端点自动识别。
  intellectTenantId?: string;
  /**
   * wizard-ent-sso-mode:企业双卡;缺省时 BFF 按 sso.enabled 推断并 warning(§8 R5)。
   * v1.3:enterprise-sso 模式下 name / credentialKind / intellectTenantId 均可缺省——
   * 企业后端由系统自动登记,向导只采集统一认证信息。
   */
  setupProfile?: WizardSetupProfile;
  // 是否作为默认主后端
  defaultForTenant?: boolean;
  // P3(wizard-sso):RAG 插件字段移除——RAG 由管理端补配,不随向导收集。
  /** wizard-sso(P2): 统一认证配置(仅 enterprise-sso;明文 secret 仅存在于请求期,不落盘) */
  sso?: WizardSsoSettings;
}

/**
 * wizard-sso(P2): 向导 SSO 配置(设计 docs/wizard-kag-to-sso-design.md §4.3)。
 * 评审取舍:setup 不复刻生产 https 强制——运行时以 sso-config.ts 启动 fail-fast
 * 为单一裁决点,向导保持非阻塞;此处仅做结构校验。
 */
export interface WizardSsoSettings {
  /** 兼容字段:enterprise-sso 模式下由 BFF 推定为 true,客户端传值被忽略 */
  enabled: boolean;
  publicOrigin: string;
  /** @deprecated 已无消费方(2026-11-26);仅为旧客户端兼容保留,传入会被忽略 */
  stateSecret?: string;
  /** 登录渠道白名单;缺省/null/空 = 不过滤(与 BFF_SSO_PROVIDERS 语义一致) */
  providers?: string[] | null;
  /** 静默重登(默认 true) */
  silentRelogin?: boolean;
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

// Step 4: 探测
export interface WizardProbeRequest {
  type: BackendType;
  endpoint: string;
  token?: string;
  email?: string;
  password?: string;
  // P3(wizard-sso):RAG 插件探测字段移除(RAG 由管理端补配,不随向导探测)。
  /** wizard-ent-sso-mode v1.3:enterprise-sso 时走 SSO 模式验证分支 */
  setupProfile?: WizardSetupProfile;
}

/** wizard-ent-sso-mode v1.3:SSO 模式验证的四项结论(向导第 4 步逐项展示) */
export interface WizardProbeSso {
  /** 网关公开端点 /api/tenant/info 可达 */
  gatewayOk: boolean;
  /** 网关返回的实例级租户 ID;null = 网关可达但未返回,需手填 */
  tenantId: string | null;
  /** 网关服务密钥是否通过受保护端点校验;null = 无法判定(端点缺失/网络错误),不阻断 */
  keyValid: boolean | null;
  /** 统一认证服务(渠道列表端点)是否可达 */
  providersOk: boolean;
  /** 可用登录渠道数(providersOk 时有值) */
  providerCount?: number;
}

export interface WizardProbeResponse {
  healthy: boolean;
  capabilities?: HarnessCapabilities;
  error?: string;
  // P3(wizard-sso):ragHealthy/ragError 移除(RAG 探测随向导 RAG 区块一并移除)。
  /** 仅 setupProfile=enterprise-sso 的验证返回 */
  sso?: WizardProbeSso;
}

// Step 5: Setup 响应
export interface WizardSetupResponse {
  success: boolean;
  backendId?: string;
  // env 模式:展示 .env 片段
  envSnippet?: string;
  error?: string;
  /** 非阻断告警(如新后端未就绪、默认租户绑定未更新),前端可展示 */
  warnings?: string[];
  /** SSO 模式保存后的联合验证结果(失败不阻断保存) */
  checks?: WizardSetupCheck[];
}

/** 保存后的联合验证项:服务端可自动判定的部分 + 需人工确认的部分 */
export interface WizardSetupCheck {
  id: 'channels' | 'login_redirect' | 'callback_reachable' | 'callback_registered';
  label: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

// Wizard 状态
export interface WizardStatusResponse {
  // 是否需要向导(无 backend 配置时 true)
  needsSetup: boolean;
  // 是否已启用 bootstrap token
  bootstrapEnabled: boolean;
  // 已配置的 backend 数量
  backendCount: number;
  /**
   * 是否已存在企业版后端配置(含 token 未就绪的)。向导在"新增后端"场景据此隐藏
   * SSO 模式卡:该卡会再登记一条企业后端并改写默认租户绑定,统一认证的调整应走
   * 系统管理的「统一认证设置」。
   */
  hasEnterpriseBackend: boolean;
}
