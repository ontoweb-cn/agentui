// @see specs/001-multi-harness-p0/contracts/tenant-context.ts (authority source)
/**
 * Contract: Tenant Context & BFF Tenant
 *
 * Authority source: specs/001-multi-harness-p0/contracts/tenant-context.ts
 * Runtime copy: bff/src/types/tenant.ts
 *
 * Constitution references:
 * - Principle III (Canvas Hard-Bound): canvasBackendId must be intellect-rag type
 * - Principle V (Tenant Isolation via BFF):
 *   真正的租户隔离通过多实例实现:不同 BffTenant 绑定不同 intellectBackendId(即不同 intellect-team 实例)。
 *   BffTenant only stores binding refs, NOT Team/Project/Member business data.
 *   Team/Project/Member managed via Intellect Enterprise HTTP API passthrough.
 *   intellectTenantId/intellectProjectId 是实例内 Team/Project 组织隔离,非租户隔离。
 */

/**
 * 认证模式类型。
 * - 'intellect-community':社区版(默认),BFF 透传到后端 /api/v1/auth/*
 * - 'intellect-rag':旧版社区版(向后兼容,行为同 intellect-community)
 * - 'intellect-enterprise':企业版,BFF 调 intellect-team /api/members/* + /api/oauth/*
 */
export type AuthMode = 'intellect-community' | 'intellect-rag' | 'intellect-enterprise';

// ---------------------------------------------------------------------------
// BFF Tenant (persisted to bff/data/bff-tenants.json, NO token)
// ---------------------------------------------------------------------------

/**
 * BFF 维护的租户实体。
 * 只存绑定关系(id/name/intellectTenantId/intellectBackendId/canvasBackendId),
 * 不存 Team/Project/Member(Constitution Principle V)。
 *
 * Persistence: bff/data/bff-tenants.json (no token, git-tracked).
 */
export interface BffTenant {
  /** BFF Tenant UUID,如 'tenant-001' */
  id: string;
  /** 人类可读名称 */
  name: string;
  /**
   * 对应的 Intellect 企业版实例内 Team ID(企业版用户可选)。
   * Intellect RAG 无 Team 概念,可为空。
   * 值 "0" 表示缺省(P4b:不注入 X-Intellect-Team 头,intellect-team 走全局默认)。
   * 真实 team_id 启用实例内 Team/Project 数据隔离(P5:注入 X-Intellect-Team 头)。
   * 注意:真正的租户隔离通过 intellectBackendId 绑定不同 intellect-team 实例实现,
   * 此字段是实例内的组织隔离,非租户隔离。
   */
  intellectTenantId?: string;
  /**
   * 可选绑定的 Intellect 企业版 Project ID(P5 新增)。
   * 设置后 BackendContext 注入 X-Intellect-Project 头(intellect-team 按 project 隔离)。
   * 未设置则不注入 X-Intellect-Project(intellect-team 用全局 project)。
   */
  intellectProjectId?: string;
  /**
   * 主后端 ID(指向 HarnessBackend.id)。
   * 任意类型(intellect-rag 或 intellect-enterprise)。
   */
  intellectBackendId: string;
  /**
   * 画布后端 ID(可选,必须是 intellect-rag 类型)。
   * Constitution Principle III:画布永远走 Intellect RAG Adapter。
   * 企业版用户需画布时,额外绑定一个 Intellect RAG 后端。
   * Intellect RAG 单租户场景: intellectBackendId 本身是 intellect-rag,
   *   canvasBackendId 可空(画布走主后端)。
   */
  canvasBackendId?: string;
  /**
   * 认证模式(P4b 新增,默认 'intellect-community',向后兼容)。
   * - 'intellect-community':社区版(默认),BFF 透传到后端 /api/v1/auth/*
   * - 'intellect-rag':旧版社区版(向后兼容,行为同 intellect-community)
   * - 'intellect-enterprise':企业版,BFF 调 intellect-team /api/members/* + /api/oauth/*
   *   此时 intellectBackendId 必须指向 type='intellect-enterprise' 的后端。
   */
  authMode?: AuthMode;
  /** ISO 8601 创建时间戳 */
  createdAt: string;
  /** ISO 8601 更新时间戳 */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tenant Context (request-scoped, passed to Adapter methods)
// ---------------------------------------------------------------------------

/**
 * 请求上下文,携带租户/用户/Intellect 侧 team/project 标识。
 * Adapter 据此注入 Team/Project 组织隔离头(Intellect 企业版: X-Intellect-Team / X-Intellect-Project)。
 * 注意:真正的租户隔离通过多实例(intellectBackendId 绑定不同 intellect-team 实例)实现,
 * Team/Project 头是实例内的组织数据隔离。
 *
 * Lifecycle:
 * 1. BFF 路由层从请求(JWT/Session)提取 userId
 * 2. BFF 路由层从 BackendStore.getBackend(tenantId) 查询绑定关系
 * 3. 构造 BackendContext
 * 4. 传给 IHarnessAdapter / IMultiTenantAdapter 方法
 *
 * Constitution Principle V (v1.1.0): 头名以 intellect-team
 * `_resolve_member_context` 实际实现为准,禁用臆造的 X-Team-Slug / X-Project-Slug。
 */
export interface BackendContext {
  /** BFF Tenant ID */
  backendId: string;
  /** 当前用户 ID */
  userId: string;
  /**
   * Intellect 企业版解析后的 member_id (来自 token → /api/members/me 解析)。
   * BFF-P0-1: 由 backendContextMiddleware 注入,Adapter 据此设置 X-Intellect-User header。
   * 仅在企业版 (authMode=intellect-enterprise) 下解析,RAG 版为 undefined。
   * 安全要求:绝不信任客户端 X-User-Id header,必须经服务端 token 解析。
   */
  intellectUserId?: string;
  /**
   * Intellect 企业版解析后的 member role (来自 token → /api/members/me 的 role 字段)。
   * 值:'owner' | 'admin' | 'member'(intellect-team role)。Adapter 据此注入
   * X-Intellect-Role header,让 intellect-rag 在首次建 membership 时写正确角色。
   * 仅企业版有值,RAG 版为 undefined。安全:绝不信任客户端传入,必须服务端解析。
   */
  intellectRole?: string;
  /**
   * Intellect 企业版实例内 Team ID(组织隔离场景必填)。
   * Adapter 用此值注入 `X-Intellect-Team` 头。
   * 注意:intellect-team 接受 team_id(而非 slug),值为 intellect-team DB 中 teams.id。
   * 这是实例内的 Team 级数据隔离,非租户隔离。
   */
  intellectTeamId?: string;
  /**
   * Intellect 企业版 Project ID(组织隔离场景可选)。
   * Adapter 用此值注入 `X-Intellect-Project` 头。
   * 注意:intellect-team 接受 project_id(而非 slug),值为 intellect-team DB 中 projects.id。
   * 这是实例内的 Project 级数据隔离,非租户隔离。
   */
  intellectProjectId?: string;
  /**
   * Intellect 企业版 Session ID(可选,会话续接)。
   * Adapter 用此值注入 `X-Intellect-Session-Id` 头。
   */
  intellectSessionId?: string;
  /**
   * Intellect 企业版 Session Key(可选,长期记忆范围)。
   * Adapter 用此值注入 `X-Intellect-Session-Key` 头。
   */
  intellectSessionKey?: string;
  /**
   * Intellect 企业版实例级 Tenant ID（来自 HarnessBackend.intellectTenantId）。
   * Adapter 注入 X-Intellect-Tenant 头,让 intellect-rag 的 SubjectContext.tenant_id
   * 正确解析(优先级高于 env var 和 current_user.id 回退)。
   * 这是实例级标识,与 intellectTeamId（实例内 Team 组织隔离）不同。
   */
  intellectTenantId?: string;
  /**
   * 用户会话 token（imt_ 前缀,来自 cookie,经 AuthSession 中间件提取）。
   * 优先于 admin JWT 传递给 intellect-rag,实现真实身份透传。
   * 仅企业版 (authMode=intellect-enterprise) 下有值,RAG 版为 undefined。
   * 切换到 imt_ token 路径后, intellect-rag 的 current_user.id == member_id,
   * 消除 admin JWT 路径下的双 ID 体系问题。
   */
  sessionToken?: string;
}

// ---------------------------------------------------------------------------
// Validation Rules (enforced by BackendStore)
// ---------------------------------------------------------------------------

/**
 * BackendStore.setCanvasBinding 的校验规则:
 * 1. tenantId 必须存在
 * 2. canvasBackendId 必须在 HarnessStore 中存在
 * 3. 对应 HarnessBackend.type 必须是 'intellect-rag' (Constitution Principle III)
 * 违反则抛出明确错误,不静默失败。
 */
