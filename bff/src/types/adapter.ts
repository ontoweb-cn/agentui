// @see specs/001-multi-harness-p0/contracts/harness-adapter.ts (authority source)
// @see specs/001-multi-harness-p0/contracts/multi-tenant-adapter.ts (authority source)
/**
 * Contract: IHarnessAdapter (Layer 1) + IMultiTenantAdapter (Layer 2)
 *
 * Authority sources:
 * - specs/001-multi-harness-p0/contracts/harness-adapter.ts (Layer 1)
 * - specs/001-multi-harness-p0/contracts/multi-tenant-adapter.ts (Layer 2)
 * Runtime copy (merged): bff/src/types/adapter.ts
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction):
 *   Layer 1 core interface — ALL backends MUST implement.
 *   Layer 2 extension interface — only backends with capabilities.multiTenant = true.
 * - Principle IV (SSE Dual-Protocol Parsing):
 *   sendMessage returns AsyncIterable<StreamChunk>, parsed by backend-specific SSE parser.
 * - Principle V (Tenant Isolation via BFF):
 *   Layer 2 forwards Team/Project/Member to Intellect Enterprise HTTP API.
 *   BFF does NOT own this data, only forwards.
 */

import type { AgentSummary, Session, SendMessageRequest, Dataset, KbDocument } from './domain';
import type { StreamChunk, StreamIterable } from './stream';
import type { HarnessCapabilities, HarnessBackend } from './harness';
import type { BackendContext } from './tenant';
import type {
  Team,
  Project,
  TeamMember,
  ProjectMember,
} from './domain';
import type { CanvasAgent, CreateCanvasBody, SaveCanvasBody } from './canvas';

// ---------------------------------------------------------------------------
// AdapterKind — 类型标识(spec-010 v8 A1-1)
// ---------------------------------------------------------------------------

/**
 * Adapter 类型标识(spec-010 v8 A1-1 / v8.3 评审 D1 修复:同步 'mcp' 值)。
 * - 'harness-core':    仅实现 IHarnessAdapter(Layer 1)
 * - 'canvas':          额外实现 ICanvasAdapter
 * - 'knowledge-base':  额外实现 IKnowledgeBaseAdapter
 * - 'multi-tenant':    额外实现 IMultiTenantAdapter
 * - 'mcp':             v8.3 新增,额外实现 IMCPAdapter(见 spec-012)
 *
 * 多能力 Adapter(如 IntellectRagAdapter)取主能力标识:
 * - IntellectRagAdapter:        'canvas'(主能力画布)
 * - IntellectEnterpriseAdapter: 'multi-tenant'
 * - KagAdapter(待 spec-012 实施): 'mcp'
 */
export type AdapterKind = 'harness-core' | 'canvas' | 'knowledge-base' | 'multi-tenant' | 'mcp';

// ---------------------------------------------------------------------------
// IHarnessAdapter — Core Layer (Layer 1, all backends)
// ---------------------------------------------------------------------------

/**
 * Harness Adapter 核心层契约。
 * 所有后端(Intellect RAG / Intellect 企业版 / 未来后端)必选实现。
 *
 * Implementation lifecycle:
 * - P0: contract only (this file), no implementation
 * - P1: IntellectRagAdapter implements this (with unit tests)
 * - P3: IntellectEnterpriseAdapter implements this + IMultiTenantAdapter
 *
 * Selection:
 * - AdapterRegistry.getAdapterForBackend(tenantId) returns IHarnessAdapter
 * - BFF route layer does NOT know concrete adapter type
 */
export interface IHarnessAdapter {
  /** 后端 ID(对应 HarnessBackend.id) */
  readonly backendId: string;

  /** Adapter 类型标识,用于类型守卫(spec-010 v8 A1-1) */
  readonly adapterKind: AdapterKind;

  // -----------------------------------------------------------------------
  // Agent methods
  // -----------------------------------------------------------------------

  /**
   * 列出所有 Agent。
   * @param ctx 租户上下文
   */
  listAgents(ctx: BackendContext): Promise<AgentSummary[]>;

  /**
   * 获取单个 Agent 详情。
   * @param ctx 租户上下文
   * @param agentId Agent ID
   */
  getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary>;

  // -----------------------------------------------------------------------
  // Session methods
  // -----------------------------------------------------------------------

  /**
   * 创建会话。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID
   * @param title 会话标题(可选)
   */
  createSession(ctx: BackendContext, agentId: string, title?: string): Promise<Session>;

  /**
   * 列出指定 Agent 下的所有会话。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID(P1 v1.2.0 调整:适配 Intellect RAG 嵌套结构 /agents/{agentId}/sessions)
   */
  listSessions(ctx: BackendContext, agentId: string): Promise<Session[]>;

  /**
   * 获取单个会话详情。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID(P1 v1.2.0 调整)
   * @param sessionId Session ID
   */
  getSession(ctx: BackendContext, agentId: string, sessionId: string): Promise<Session>;

  /**
   * 删除会话。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID(P1 v1.2.0 调整)
   * @param sessionId Session ID
   */
  deleteSession(ctx: BackendContext, agentId: string, sessionId: string): Promise<void>;

  /**
   * 更新会话(目前仅支持 title 重命名,对应 Gateway PATCH /api/sessions/{id})。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID
   * @param sessionId Session ID
   * @param params 更新字段 { title? }
   */
  updateSession(
    ctx: BackendContext,
    agentId: string,
    sessionId: string,
    params: { title?: string },
  ): Promise<Session>;

  /**
   * 获取会话的消息历史(对应 Gateway GET /api/sessions/{id}/messages)。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID
   * @param sessionId Session ID
   * @returns 消息数组(每条含 id/role/content/timestamp 等字段)
   */
  getSessionMessages(
    ctx: BackendContext,
    agentId: string,
    sessionId: string,
  ): Promise<unknown[]>;

  // -----------------------------------------------------------------------
  // Message streaming methods
  // -----------------------------------------------------------------------

  /**
   * 发送消息并返回流式响应。
   *
   * Constitution Principle IV: 返回 AsyncIterable<StreamChunk>,
   * 由后端专用 SSE 解析器(parseOpenAISSE / parseIntellectEnterpriseSSE)产出。
   * BFF 路由层用 for-await-of 消费并透传给前端 SSE。
   *
   * @param ctx 租户上下文
   * @param req 发送消息请求
   * @returns 流式 chunk 迭代器,以 done 或 error chunk 终止
   */
  sendMessage(ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable>;

  /**
   * 取消进行中的消息流。
   * @param ctx 租户上下文
   * @param sessionId Session ID
   */
  cancelMessage(ctx: BackendContext, sessionId: string): Promise<void>;

  /**
   * 提交工具审批(v1.3.0 新增,仅 IntellectEnterpriseAdapter 实现)。
   *
   * Constitution Principle VIII v1.3.0:
   * - 调用 intellect-team `POST /v1/runs/{run_id}/approval` 端点
   * - 仅 /v1/runs 主通道产出的 approval_request 事件需要此方法
   * - IntellectRagAdapter 不实现此方法(不产出 approval 事件)
   *
   * @param ctx 租户上下文
   * @param runId Run ID(从 StreamApprovalRequest.runId 获取)
   * @param choice 审批选项
   * @returns intellect-team 审批响应
   */
  submitApproval?(
    ctx: BackendContext,
    runId: string,
    choice: 'once' | 'session' | 'always' | 'deny',
  ): Promise<{
    runId: string;
    choice: 'once' | 'session' | 'always' | 'deny';
    resolved: number;
  }>;

  /**
   * 提交 clarify 答案(v1.4.0 新增,仅 IntellectEnterpriseAdapter 实现)。
   *
   * Gateway `set_clarify_fn` 注入的 clarify 工具回调:
   * - 调用 intellect-team `POST /v1/chat/completions/{session_id}/clarify` 端点
   * - 请求体:`{clarify_id, answer}`
   * - 响应体:`{status: "ok"}` / 400 缺字段 / 403 session 归属错 / 404 无活跃 clarify
   * - 仅 clarify_request 事件触发后,用户提交答案时调用此方法
   *
   * @param ctx 租户上下文
   * @param sessionId Session ID(从 StreamClarifyRequest.sessionId 获取,用于构造回调路径)
   * @param clarifyId clarify ID(从 StreamClarifyRequest.clarifyId 获取,格式 `session_id:timestamp_ms`)
   * @param answer 用户输入的答案文本
   * @returns intellect-team clarify 响应(含 status 字段)
   */
  submitClarify?(
    ctx: BackendContext,
    sessionId: string,
    clarifyId: string,
    answer: string,
  ): Promise<{ status: string }>;

  // -----------------------------------------------------------------------
  // Health & discovery
  // -----------------------------------------------------------------------

  /**
   * 健康检查。
   * @returns true 表示后端可达且鉴权通过
   */
  healthCheck(): Promise<boolean>;

  /**
   * 探测后端能力。
   * 返回 HarnessCapabilities,P0 由 HarnessBackendConfig.capabilities 静态提供;
   * P1+ 可选实现动态探测(覆盖静态声明)。
   */
  discoverCapabilities(): Promise<HarnessCapabilities>;
}

// ---------------------------------------------------------------------------
// ICanvasAdapter — Extension Layer (Layer 2, Canvas capability)
// spec-010 v8 A2-1: 画布能力接口
// ---------------------------------------------------------------------------

/**
 * 画布扩展契约。
 * 仅 IntellectRagAdapter(capabilities.canvas = true)实现。
 * 必须同时实现 IHarnessAdapter(Layer 1)。
 *
 * 设计原则:
 * - 高层语义方法对应业务操作,便于未来跨 Adapter 复用
 * - request<T>()/proxy() 透传方法覆盖 CanvasService 16+ 透传场景
 *   (模板/tags/版本/组件/trace/webhook/upload/download 等),避免接口爆炸
 * - CanvasService 通过 ICanvasAdapter 接口调用,不再依赖 IntellectRagAdapter 具体类
 *
 * Constitution Principle III (Canvas Hard-Bound):
 * 路由层用 capabilities.canvas 静态判断,isCanvasAdapter() 运行时双保险。
 */
export interface ICanvasAdapter extends IHarnessAdapter {
  // ── 高层语义方法(路径拼接在 Adapter 内) ──
  listCanvas(ctx: BackendContext): Promise<CanvasAgent[]>;
  getCanvas(ctx: BackendContext, id: string): Promise<CanvasAgent>;
  createCanvas(ctx: BackendContext, body: CreateCanvasBody): Promise<CanvasAgent>;
  saveCanvas(ctx: BackendContext, id: string, body: SaveCanvasBody): Promise<CanvasAgent>;
  deleteCanvas(ctx: BackendContext, id: string): Promise<void>;
  resetCanvas(ctx: BackendContext, id: string): Promise<void>;

  // ── 透传方法(供 CanvasService 16+ 透传场景使用) ──
  request<T>(
    method: string,
    path: string,
    body?: unknown,
    ctx?: BackendContext,
  ): Promise<T>;

  proxy(
    method: string,
    path: string,
    req: { headers: Headers; body?: ReadableStream<Uint8Array> | null; query: string },
    ctx?: BackendContext,
  ): Promise<Response>;
}

// ---------------------------------------------------------------------------
// IKnowledgeBaseAdapter — Extension Layer (Layer 2, Knowledge Base capability)
// spec-010 v8 A2-3: 知识库能力接口
// ---------------------------------------------------------------------------

/**
 * 知识库扩展契约。
 * 由 IntellectRagAdapter(capabilities.knowledgeBase = true)和未来的 KagAdapter 实现。
 * 必须同时实现 IHarnessAdapter(Layer 1)。
 *
 * 设计原则(与 ICanvasAdapter 一致):
 * - 高层语义方法对应业务操作,路径拼接在 Adapter 内
 * - 上游返回结构透传,不纳入统一 schema(Constitution Principle VII YAGNI)
 *
 * Constitution Principle II: 路由层用 capabilities.knowledgeBase 静态判断,
 * isKnowledgeBaseAdapter() 作为运行时双保险。
 */
export interface IKnowledgeBaseAdapter extends IHarnessAdapter {
  /** 列出数据集。 */
  listDatasets(ctx: BackendContext): Promise<Dataset[]>;
  /** 创建数据集。 */
  createDataset(ctx: BackendContext, name: string, description?: string): Promise<Dataset>;
  /** 获取单个数据集详情。 */
  getDataset(ctx: BackendContext, datasetId: string): Promise<Dataset>;
  /** 更新数据集。 */
  updateDataset(ctx: BackendContext, datasetId: string, patch: Partial<Dataset>): Promise<Dataset>;
  /** 删除数据集。 */
  deleteDataset(ctx: BackendContext, datasetId: string): Promise<void>;
  /** 列出数据集下的文档。 */
  listDocuments(ctx: BackendContext, datasetId: string): Promise<KbDocument[]>;
  /** 上传文档(multipart 透传)。 */
  uploadDocument(
    ctx: BackendContext,
    datasetId: string,
    file: { name: string; type: string; body: ReadableStream<Uint8Array> | Blob | unknown },
    metadata?: Record<string, unknown>,
  ): Promise<KbDocument>;
  /** 删除文档。 */
  deleteDocument(ctx: BackendContext, datasetId: string, documentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// IMCPAdapter — Extension Layer (Layer 2, MCP capability)
// spec-012 (v8.3 新增): MCP 工具调用能力接口
// ---------------------------------------------------------------------------

/**
 * MCP 扩展契约(spec-012)。
 *
 * 由 MCPBaseAdapter 子类实现(当前仅 KagAdapter)。
 * 必须同时实现 IHarnessAdapter(Layer 1)。
 *
 * 设计原则(与 ICanvasAdapter/IKnowledgeBaseAdapter 一致):
 * - listTools/discoverTools:动态发现 MCP Server 暴露的工具
 * - callTool:通用工具调用(供未来非 KAG 的 MCP 后端复用)
 * - qaPipeline/kbRetrieve:KAG 专用高层语义方法(便捷调用)
 *
 * Constitution Principle II: 路由层用 capabilities.mcp 静态判断,
 * isMCPAdapter() 作为运行时双保险。
 */
export interface IMCPAdapter extends IHarnessAdapter {
  /** 列出 MCP Server 暴露的所有工具。 */
  listTools(ctx: BackendContext): Promise<MCPTool[]>;

  /** 通用 MCP 工具调用。 */
  callTool(
    ctx: BackendContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;

  /**
   * KAG 专用:QA 问答管道。
   * 调用 MCP 工具 `qa_pipeline(query)`,返回 LLM 生成的答案。
   */
  qaPipeline(ctx: BackendContext, query: string): Promise<string>;

  /**
   * KAG 专用:知识库检索。
   * 调用 MCP 工具 `kb_retrieve(query)`,返回 JSON:
   * { summary: string, references: Array<{ spo: [s,p,o], chunks: string[] }> }
   */
  kbRetrieve(ctx: BackendContext, query: string): Promise<string>;
}

/** MCP 工具描述(spec-012)。 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// IMultiTenantAdapter — Extension Layer (Layer 2, Intellect Enterprise only)
// ---------------------------------------------------------------------------

/**
 * Team/Project 组织扩展契约。
 * 仅 Intellect 企业版(capabilities.multiTenant = true)实现。
 * 必须同时实现 IHarnessAdapter(Layer 1)。
 *
 * Constitution Principle V (v1.1.0): Team/Project/Member 通过此接口透传到
 * intellect-team HTTP API,BFF 不存副本,不维护权限模型。
 * 实际 intellect-team 端点(从 plugins/platforms/api_server/adapter.py 确认):
 * - Team/Project/Member CRUD: 由 intellect-team /api/sessions 等会话级端点隐式管理,
 *   目前没有独立的 /api/teams 或 /api/projects HTTP 端点(P4+ 由 intellect-team 侧新增)
 * - 实例内 Team/Project 数据隔离通过 X-Intellect-Team / X-Intellect-Project 头注入
 *   (注意:真正的租户隔离通过多实例部署实现,非此头)
 *
 * Implementation lifecycle:
 * - P0: contract only (this file), no implementation
 * - P3: IntellectEnterpriseAdapter implements IHarnessAdapter + IMultiTenantAdapter
 * - P4+: intellect-team 侧补齐 Team/Project/Member HTTP 端点后,本接口才能完整实现
 *
 * P3 阶段 IntellectEnterpriseAdapter 可先实现 createSession/listSessions 等会话级方法
 * (依赖 intellect-team /api/sessions 端点),Team/Project/Member 管理暂留 stub 抛 NotImplemented。
 */
export interface IMultiTenantAdapter extends IHarnessAdapter {
  // -----------------------------------------------------------------------
  // Team CRUD
  // -----------------------------------------------------------------------

  /** 列出当前租户下的所有 Team。 */
  listTeams(ctx: BackendContext): Promise<Team[]>;

  /** 创建 Team。 */
  createTeam(
    ctx: BackendContext,
    name: string,
    slug: string,
    description?: string,
  ): Promise<Team>;

  /** 获取单个 Team 详情。 */
  getTeam(ctx: BackendContext, teamId: string): Promise<Team>;

  /** 更新 Team。 */
  updateTeam(
    ctx: BackendContext,
    teamId: string,
    patch: Partial<Pick<Team, 'name' | 'slug' | 'description'>>,
  ): Promise<Team>;

  /** 删除 Team。 */
  deleteTeam(ctx: BackendContext, teamId: string): Promise<void>;

  // -----------------------------------------------------------------------
  // Team Member management
  // -----------------------------------------------------------------------

  /** 列出 Team 成员。 */
  listTeamMembers(ctx: BackendContext, teamId: string): Promise<TeamMember[]>;

  /** 添加 Team 成员。 */
  addTeamMember(
    ctx: BackendContext,
    teamId: string,
    userId: string,
    role: TeamMember['role'],
  ): Promise<TeamMember>;

  /** 更新 Team 成员角色。 */
  updateTeamMemberRole(
    ctx: BackendContext,
    teamId: string,
    userId: string,
    role: TeamMember['role'],
  ): Promise<TeamMember>;

  /** 移除 Team 成员。 */
  removeTeamMember(ctx: BackendContext, teamId: string, userId: string): Promise<void>;

  // -----------------------------------------------------------------------
  // Project CRUD
  // -----------------------------------------------------------------------

  /** 列出 Team 下的所有 Project。 */
  listProjects(ctx: BackendContext, teamId: string): Promise<Project[]>;

  /** 创建 Project。 */
  createProject(
    ctx: BackendContext,
    teamId: string,
    name: string,
    slug: string,
    description?: string,
  ): Promise<Project>;

  /** 获取单个 Project 详情。 */
  getProject(ctx: BackendContext, teamId: string, projectId: string): Promise<Project>;

  /** 更新 Project。 */
  updateProject(
    ctx: BackendContext,
    teamId: string,
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'slug' | 'description'>>,
  ): Promise<Project>;

  /** 删除 Project。 */
  deleteProject(ctx: BackendContext, teamId: string, projectId: string): Promise<void>;

  // -----------------------------------------------------------------------
  // Project Member management
  // -----------------------------------------------------------------------

  /** 列出 Project 成员。 */
  listProjectMembers(
    ctx: BackendContext,
    teamId: string,
    projectId: string,
  ): Promise<ProjectMember[]>;

  /** 添加 Project 成员。 */
  addProjectMember(
    ctx: BackendContext,
    teamId: string,
    projectId: string,
    userId: string,
    role: ProjectMember['role'],
  ): Promise<ProjectMember>;

  /** 更新 Project 成员角色。 */
  updateProjectMemberRole(
    ctx: BackendContext,
    teamId: string,
    projectId: string,
    userId: string,
    role: ProjectMember['role'],
  ): Promise<ProjectMember>;

  /** 移除 Project 成员。 */
  removeProjectMember(
    ctx: BackendContext,
    teamId: string,
    projectId: string,
    userId: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Type Guard
// ---------------------------------------------------------------------------

/**
 * 类型守卫:Adapter 是否支持实例内 Team/Project 组织模型(实现了 IMultiTenantAdapter)。
 * BFF 路由层据此决定是否暴露 Team/Project 相关端点。
 * 注意:真正的租户隔离通过多实例部署实现,此 guard 仅判断实例内组织模型扩展能力。
 *
 * Constitution Principle II: 路由层用 capabilities.multiTenant 静态判断,
 * 此 guard 作为运行时双保险。
 *
 * spec-010 v8 A1-3: 改用 adapterKind 字段判断(替代方法名存在性判断)。
 */
export function isMultiTenantAdapter(
  adapter: IHarnessAdapter,
): adapter is IMultiTenantAdapter {
  return adapter.adapterKind === 'multi-tenant';
}

/**
 * 类型守卫:Adapter 是否实现 ICanvasAdapter(画布能力)。
 * BFF 路由层(CanvasService)据此决定是否暴露画布端点。
 *
 * Constitution Principle III (Canvas Hard-Bound):
 * 路由层用 capabilities.canvas 静态判断,此 guard 作为运行时双保险。
 *
 * spec-010 v8 A2-1: 基于 adapterKind 字段判断。
 */
export function isCanvasAdapter(
  adapter: IHarnessAdapter,
): adapter is ICanvasAdapter {
  return adapter.adapterKind === 'canvas';
}

/**
 * 类型守卫:Adapter 是否实现 IKnowledgeBaseAdapter(知识库能力)。
 * BFF 路由层据此决定是否暴露知识库端点。
 *
 * Constitution Principle II: 路由层用 capabilities.knowledgeBase 静态判断,
 * 此 guard 作为运行时双保险。
 *
 * spec-010 v8 A2-3: 基于 adapterKind 字段判断。
 * 注意:多能力 Adapter(如 IntellectRagAdapter)主能力为 'canvas',
 * 但同时实现 IKnowledgeBaseAdapter。因此本守卫检查 adapterKind 是否为
 * 'canvas' 或 'knowledge-base'。
 *
 * spec-010 v8.3 评审 D1 修复:KagAdapter 不再实现 IKnowledgeBaseAdapter
 * (KAG 无 REST KB CRUD API,改走 MCP 通道,见 spec-012)。
 */
export function isKnowledgeBaseAdapter(
  adapter: IHarnessAdapter,
): adapter is IKnowledgeBaseAdapter {
  return adapter.adapterKind === 'canvas' || adapter.adapterKind === 'knowledge-base';
}

/**
 * 类型守卫:Adapter 是否实现 IMCPAdapter(MCP 工具调用能力)。
 *
 * spec-010 v8.3 / spec-012 新增。KagAdapter(待实施)将使用此标识。
 * Constitution Principle II: 路由层用 capabilities.mcp 静态判断,
 * 此 guard 作为运行时双保险。
 *
 * spec-012 Phase 1(T1-3)修复:IMCPAdapter 接口已定义,守卫返回类型更新。
 */
export function isMCPAdapter(adapter: IHarnessAdapter): adapter is IMCPAdapter {
  return adapter.adapterKind === 'mcp';
}

// ---------------------------------------------------------------------------
// Adapter Factory (used by AdapterRegistry in P1)
// ---------------------------------------------------------------------------

/**
 * Adapter 工厂函数签名。
 * P1 AdapterRegistry.getAdapterForBackend() 调用此工厂创建/复用 Adapter 实例。
 *
 * @param backend 运行时后端对象(含 token)
 * @returns Adapter 实例
 *
 * Note: P0 declares this type only; P1 implements IntellectRagAdapterFactory.
 */
export type HarnessAdapterFactory = (backend: HarnessBackend) => IHarnessAdapter;
