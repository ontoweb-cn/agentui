// @see specs/003-harness-admin-capabilities/contracts/harness-admin-api.ts (authority source)
/**
 * Contract: Harness Admin API + Capabilities API (P2 新增)
 *
 * Authority source: specs/003-harness-admin-capabilities/contracts/harness-admin-api.ts
 * Runtime copy: bff/src/types/harness-admin.ts
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF Admin 路由管理后端配置
 * - Principle II (Adapter Abstraction): capabilities 经 AdapterRegistry 获取
 * - Principle V (Tenant Isolation): capabilities 按 tenant 返回;Admin 路由非租户隔离
 * - Token Security: 任何响应不含 adminToken 明文
 *
 * Implementation lifecycle:
 * - P0/P1: HarnessStore + AdapterRegistry 已实现
 * - P2: 新增 harness-admin 路由 + capabilities 路由,扩展 invalidate/listConfigs
 */

import type {
  BackendType,
  HarnessCapabilities,
  HarnessBackendConfig,
} from './harness';

// ---------------------------------------------------------------------------
// DTOs (P2 新增)
// ---------------------------------------------------------------------------

/**
 * Admin 列表 API 返回的后端配置 + 就绪状态。
 * 不含 adminToken 明文(Token Security),只含 adminTokenEnvVar 引用。
 */
export interface HarnessBackendWithStatus extends HarnessBackendConfig {
  /** env token 是否就绪(在 HarnessStore.list() 中为 true) */
  ready: boolean;
}

/**
 * 能力探测 API 响应。
 * GET /api/bff/capabilities 返回当前 tenant 绑定后端的能力。
 */
export interface CapabilitiesResponse {
  /** 当前 tenant 绑定的后端 ID */
  backendId: string;
  /** 后端名称 */
  backendName: string;
  /** 后端类型 */
  backendType: BackendType;
  /** 能力声明 */
  capabilities: HarnessCapabilities;
}

/**
 * Admin 页面新增/编辑表单提交数据。
 * BFF 校验 id/name/type/endpoint/adminTokenEnvVar 格式。
 */
export interface HarnessBackendForm {
  /** kebab-case,新增必填,编辑只读 */
  id: string;
  /** 非空 */
  name: string;
  /** 'intellect-rag' | 'intellect-enterprise' */
  type: BackendType;
  /** 合法 URL(http/https) */
  endpoint: string;
  /** 合法环境变量名(大写字母+下划线) */
  adminTokenEnvVar: string;
  /** 能力声明 */
  capabilities: HarnessCapabilities;
  /** 是否作为新 tenant 默认主后端(可选) */
  defaultForTenant?: boolean;
  // spec-010 v8 A3-7: 新增 credentialKind
  credentialKind?: 'bearer-token' | 'email-password';
}

// ---------------------------------------------------------------------------
// Validation Rules (P2 双层校验:前端 + BFF)
// ---------------------------------------------------------------------------

export const VALIDATION_RULES = {
  id: {
    pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    message: 'id 必须是 kebab-case(如 intellect-rag-default)',
  },
  name: {
    pattern: /^.+$/,
    message: 'name 不能为空',
  },
  type: {
    // spec-010 v8 A3-7: 扩展为 6 类(intellect-llm 不进表单)
    values: ['intellect-rag', 'intellect-enterprise', 'intellect-community', 'hermes', 'kag', 'agent-scope'] as const,
    message: 'type 必须是 intellect-rag/intellect-enterprise/intellect-community/hermes/kag/agent-scope 之一',
  },
  endpoint: {
    pattern: /^https?:\/\/.+/,
    message: 'endpoint 必须是合法 URL(http:// 或 https://)',
  },
  adminTokenEnvVar: {
    pattern: /^[A-Z_][A-Z0-9_]*$/,
    message: 'adminTokenEnvVar 必须是合法环境变量名(大写字母+下划线)',
  },
  // spec-010 v8 A3-7: 新增 credentialKind 校验
  credentialKind: {
    values: ['bearer-token', 'email-password'] as const,
    message: 'credentialKind 必须是 bearer-token 或 email-password',
  },
} as const;

// ---------------------------------------------------------------------------
// AdapterRegistry 扩展 (P1 → P2)
// ---------------------------------------------------------------------------

/**
 * AdapterRegistry 新增 invalidate 方法(P2 扩展)。
 * 后端配置变更后调用,失效缓存的 Adapter 实例,下次创建新实例(用新配置)。
 *
 * @param backendId 可选,不传清空整个缓存,传则只移除该条目
 */
export interface AdapterRegistryInvalidate {
  invalidate(backendId?: string): void;
}

// ---------------------------------------------------------------------------
// HarnessStore 扩展 (P0 → P2)
// ---------------------------------------------------------------------------

/**
 * HarnessStore 新增 listConfigs 方法(P2 扩展)。
 * 返回所有配置(含 env token 未就绪的),不含 adminToken 明文。
 * 用于 Admin 列表展示。
 */
export interface HarnessStoreListConfigs {
  listConfigs(): HarnessBackendConfig[];
}
