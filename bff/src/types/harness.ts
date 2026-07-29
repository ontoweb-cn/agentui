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
 * 后端类型。
 * - 'intellect-rag': Intellect RAG 画布+知识库(P1 已实施)
 * - 'intellect-enterprise': Intellect 企业版 Team/Project(P3 已实施)
 * - 'intellect-llm': LLM Gateway 透传(Phase 3 引入,legacy,不注册 Adapter 工厂,走 llm-proxy 路由)
 * - 'intellect-community' 指 intellect-agent 社区版(纯 Agent 运行时,OpenAI 兼容)。历史误用指将其指代 intellect-rag,现已澄清。spec-010 v8 修订依据:消除历史命名歧义,不依赖项目合并状态。
 * spec-010 v8 Phase C-P1/P2/P3 已实施 Adapter: 'intellect-community'/'hermes'/'agent-scope'
 * spec-010 v8 Phase C-P4(KAG)待 spec-012 实施: 'kag'(协议族 mcp-protocol)
 *    类型联合已扩展(对齐 VALIDATION_RULES.type.values)。
 */
export type BackendType =
  | 'intellect-rag'
  | 'intellect-enterprise'
  | 'intellect-llm'
  | 'intellect-community'
  | 'hermes'
  | 'kag'
  | 'agent-scope';

/**
 * 协议族(spec-010 v8 A3-2 / m2 修正 / v8.3 评审 D2 修复:同步 'mcp-protocol')。
 *
 * 与 BackendType 的映射见 spec-010 §3.1 协议族分类表:
 * - 'canvas-workflow':      Intellect RAG 专用,parseCanvasWorkflowSSE
 * - 'intellect-enterprise': Intellect Enterprise 专用,parseIntellectEnterpriseSSE
 * - 'openai-compatible':    3 个 OpenAI 兼容后端(intellect-community/hermes/agent-scope),parseOpenAISSE
 * - 'mcp-protocol':         v8.3 新增,KAG 专用(MCP SDK 调用,无 SSE 解析,见 spec-012)
 */
export type ProtocolFamily =
  | 'canvas-workflow'
  | 'intellect-enterprise'
  | 'openai-compatible'
  | 'mcp-protocol';

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
   * spec-010 v8 A3-6: 凭据类型声明(可选)。
   * 配合 TokenVault 使用:有值时 load() 优先从 vault 读取对应类型凭据。
   * 未设置或 vault 未命中时回退 adminTokenEnvVar(现有逻辑,向后兼容)。
   */
  credentialKind?: 'bearer-token' | 'email-password';
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
