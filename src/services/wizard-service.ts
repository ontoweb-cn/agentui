// spec-010 v8 B-7: Wizard Service — 首次安装向导服务层封装。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
// Token Security: 请求可含 token 明文(经 HTTPS),响应不含 token 明文,只含 envSnippet 引用。
//
// 类型与 bff/src/types/wizard.ts 同步。

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
}

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

export interface WizardSetupRequest {
  name: string;
  type: BackendType;
  endpoint: string;
  credentialKind: CredentialKind;
  token?: string;
  email?: string;
  password?: string;
  adminTokenEnvVar?: string;
  intellectTenantId?: string;
  defaultForTenant?: boolean;
}

export interface WizardSetupResponse {
  success: boolean;
  backendId?: string;
  envSnippet?: string;
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
