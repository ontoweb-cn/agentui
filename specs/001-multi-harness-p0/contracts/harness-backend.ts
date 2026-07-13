/**
 * Contract: Harness Backend Configuration & Runtime
 *
 * Authority source: specs/001-multi-harness-p0/contracts/harness-backend.ts
 * Runtime copy: bff/src/types/harness.ts
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction): capabilities drive Layer 1/2/3 selection
 * - Principle III (Canvas Hard-Bound): canvas capability only on intellect-rag
 * - Naming: backendType literal 'intellect-rag' | 'intellect-enterprise'
 * - Token Security: JSON stores adminTokenEnvVar (ref), not adminToken (plaintext)
 */

// ---------------------------------------------------------------------------
// Backend Type Literal (Constitution Naming Constraint, NON-NEGOTIABLE)
// ---------------------------------------------------------------------------

/**
 * Harness 后端类型字面量。
 * - 'intellect-rag' 指 intellect-rag 项目(画布引擎 + 知识库,单租户)
 * - 'intellect-enterprise' 指 intellect-team 项目(实例内 Team/Project 组织模型 + 编码 Agent;多租户通过多实例部署)
 * 禁用历史误用 'intellect-community'。
 */
export type BackendType = 'intellect-rag' | 'intellect-enterprise';

// ---------------------------------------------------------------------------
// Harness Capabilities
// ---------------------------------------------------------------------------

/**
 * 后端能力声明。
 * 前端 useHarnessCapabilities 据此条件渲染,BFF 据此选择走 Adapter 还是透传。
 *
 * Constitution constraints:
 * - canvas: 仅 'intellect-rag' 可声明 true (Principle III)
 * - multiTenant: 仅 'intellect-enterprise' 可声明 true
 */
export interface HarnessCapabilities {
  /** 是否支持画布(Intellect RAG = true,企业版 = false) */
  canvas: boolean;
  /** 是否支持知识库 CRUD */
  knowledgeBase: boolean;
  /** 是否支持 Memory(对话历史/总结) */
  memory: boolean;
  /** 是否支持 MCP 工具调用 */
  mcp: boolean;
  /** 是否支持实例内 Team/Project 组织模型(企业版 = true;真正租户隔离通过多实例部署) */
  multiTenant: boolean;
  /** 是否支持模型管理 UI */
  modelManagement: boolean;
}

// ---------------------------------------------------------------------------
// Configuration Layer (persisted to JSON, NO token plaintext)
// ---------------------------------------------------------------------------

/**
 * 持久化到 bff/data/harness-backends.json 的配置条目。
 * 不含 token 明文,只含环境变量引用。
 * 可入库(git-tracked)。
 */
export interface HarnessBackendConfig {
  /** 后端唯一标识,kebab-case,如 'intellect-rag-default' */
  id: string;
  /** 人类可读名称,如 'Intellect RAG (Default)' */
  name: string;
  /** 后端类型,Constitution 命名规范锁定 */
  type: BackendType;
  /** 后端 HTTP 端点,如 'http://localhost:9380' */
  endpoint: string;
  /** admin token 环境变量名,如 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN' */
  adminTokenEnvVar: string;
  /** project token 环境变量名(Intellect 企业版专用,可选) */
  projectTokenEnvVar?: string;
  /** 能力声明 */
  capabilities: HarnessCapabilities;
  /** 是否作为新 Tenant 的默认主后端(可选) */
  defaultForTenant?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime Layer (in-memory only, merged with env)
// ---------------------------------------------------------------------------

/**
 * 运行时完整后端对象,内存持有,不写回磁盘。
 * HarnessStore.load() 合并 HarnessBackendConfig + env 后产出。
 */
export interface HarnessBackend extends HarnessBackendConfig {
  /** admin token 明文(从 env 读取,仅内存) */
  adminToken: string;
  /** project token 明文(Intellect 企业版专用,从 env 读取) */
  projectToken?: string;
}

// ---------------------------------------------------------------------------
// Validation Helpers (Zod schemas, used by HarnessStore)
// ---------------------------------------------------------------------------

// Note: Zod schemas are defined in bff/src/services/harness-store.ts (implementation).
// This contract file only declares TypeScript types.
// P0 tasks will create the Zod schemas matching these types.
