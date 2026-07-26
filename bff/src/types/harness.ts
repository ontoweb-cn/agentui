// @see specs/001-multi-harness-p0/contracts/harness-backend.ts (authority source)
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
 * - 'intellect-rag' 指 intellect-rag 项目(画布引擎 + 知识库)
 * - 'intellect-enterprise' 指 intellect-team 项目(实例内 Team/Project 组织模型 + 编码 Agent)
 * 多租户隔离通过多实例实现:每个 intellect-team 实例 = 一个租户,不同 BffTenant 绑定不同实例。
 * 禁用历史误用 'intellect-community'。
 */
export type BackendType = 'intellect-rag' | 'intellect-enterprise' | 'intellect-llm';

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
  /** 是否支持实例内 Team/Project 组织模型(企业版 = true;注意:真正的租户隔离通过多实例部署实现) */
  multiTenant: boolean;
  /** 是否支持模型管理 UI */
  modelManagement: boolean;
}

/**
 * LLM Gateway 后端能力声明(intellect-llm 类型专用)。
 * Phase 3 引入,用于 IntellectLlmAdapter。
 */
export interface LlmCapabilities {
  chat: boolean;
  embedding: boolean;
  rerank: boolean;
  costTracking: boolean;
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
  /** project token 环境变量名(Intellect 企业版专用,可选,P4+ 预留) */
  projectTokenEnvVar?: string;
  /** 能力声明(rag/enterprise 用 HarnessCapabilities,llm 用 LlmCapabilities) */
  capabilities: HarnessCapabilities | LlmCapabilities;
  /** 是否作为新 Tenant 的默认主后端(可选) */
  defaultForTenant?: boolean;
  /**
   * Intellect 企业版实例级 Tenant ID（仅 type='intellect-enterprise' 需要）。
   * 来源：intellect-team gateway 的 INTELLECT_TENANT_ID env var。
   * BFF 注入到 X-Intellect-Tenant 头,让 intellect-rag 的 SubjectContext.tenant_id
   * 正确解析(避免走 legacy current_user.id 回退导致 tenant 不一致)。
   * 注意：与 BffTenant.intellectTenantId（实际是 team_id,命名遗留）不同,
   * 这是实例级标识,单实例单 tenant。
   */
  intellectTenantId?: string;
  /** 备注(可选,如 intellect-llm 共享 endpoint 说明) */
  comment?: string;
}

// ---------------------------------------------------------------------------
// Runtime Layer (in-memory only, merged with env)
// ---------------------------------------------------------------------------

/**
 * 运行时完整后端对象,内存持有,不写回磁盘。
 * HarnessStore.load() 合并 HarnessBackendConfig + env 后产出。
 */
export interface HarnessBackend extends HarnessBackendConfig {
  /** admin token 明文(从 env 读取,仅内存)。intellect-enterprise 类型此字段承载 API_SERVER_KEY(Constitution Principle VIII) */
  adminToken: string;
  /** project token 明文(P4+ 预留,P0-P3 不使用) */
  projectToken?: string;
}
