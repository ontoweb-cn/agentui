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

import type { AgentSummary, Session, SendMessageRequest } from './domain';
import type { StreamChunk, StreamIterable } from './stream';
import type { HarnessCapabilities, HarnessBackend } from './harness';
import type { BackendContext } from './tenant';
import type {
  Team,
  Project,
  TeamMember,
  ProjectMember,
} from './domain';

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
 */
export function isMultiTenantAdapter(
  adapter: IHarnessAdapter,
): adapter is IMultiTenantAdapter {
  return 'listTeams' in adapter && typeof (adapter as IMultiTenantAdapter).listTeams === 'function';
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
