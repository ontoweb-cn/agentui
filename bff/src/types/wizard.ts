// spec-010 v8 B-4: Wizard DTO — 首次安装向导请求/响应类型。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
// Token Security: 请求可含 token 明文(经 HTTPS),响应不含 token 明文,只含 envSnippet 引用。

import type { BackendType, HarnessCapabilities } from './harness';
import type { CredentialKind } from '../services/token-vault';

// Step 2: 选择后端类型
export interface WizardBackendTypeOption {
  type: BackendType;
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
  // intellect-enterprise 专用
  intellectTenantId?: string;
  // 是否作为默认主后端
  defaultForTenant?: boolean;
  // P3(wizard-sso):RAG 插件字段移除——RAG 由管理端补配,不随向导收集。
  /** wizard-sso(P2): 统一认证配置(仅 intellect-enterprise;明文 secret 仅存在于请求期,不落盘) */
  sso?: WizardSsoSettings;
}

/**
 * wizard-sso(P2): 向导 SSO 配置(设计 docs/wizard-kag-to-sso-design.md §4.3)。
 * 评审取舍:setup 不复刻生产 https 强制——运行时以 sso-config.ts 启动 fail-fast
 * 为单一裁决点,向导保持非阻塞;此处仅做结构校验。
 */
export interface WizardSsoSettings {
  enabled: boolean;
  publicOrigin: string;
  /** 客户端生成的随机密钥(≥32 字符);响应 envSnippet 永以 <your-secret> 占位 */
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
}

export interface WizardProbeResponse {
  healthy: boolean;
  capabilities?: HarnessCapabilities;
  error?: string;
  // P3(wizard-sso):ragHealthy/ragError 移除(RAG 探测随向导 RAG 区块一并移除)。
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
}

// Wizard 状态
export interface WizardStatusResponse {
  // 是否需要向导(无 backend 配置时 true)
  needsSetup: boolean;
  // 是否已启用 bootstrap token
  bootstrapEnabled: boolean;
  // 已配置的 backend 数量
  backendCount: number;
}
