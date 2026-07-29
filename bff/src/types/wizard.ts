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
}

// Step 4: 探测
export interface WizardProbeRequest {
  type: BackendType;
  endpoint: string;
  token?: string;
  email?: string;
  password?: string;
}

export interface WizardProbeResponse {
  healthy: boolean;
  capabilities?: HarnessCapabilities;
  error?: string;
}

// Step 5: Setup 响应
export interface WizardSetupResponse {
  success: boolean;
  backendId?: string;
  // env 模式:展示 .env 片段
  envSnippet?: string;
  error?: string;
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
