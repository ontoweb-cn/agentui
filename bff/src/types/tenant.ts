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
 *   BffTenant only stores binding refs, NOT Team/Project/Member business data.
 *   Team/Project/Member managed via Intellect Enterprise HTTP API passthrough.
 */

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
   * 对应的 Intellect 企业版 Tenant ID(企业版用户必填)。
   * Intellect RAG 单租户场景可为空。
   * 值 "0" 表示缺省(P4b:不注入 X-Intellect-Team 头,intellect-team 走全局默认)。
   * 真实 team_id 启用多租户隔离(P5:注入 X-Intellect-Team 头)。
   */
  intellectTenantId?: string;
  /**
   * 可选绑定的 Intellect 企业版 Project ID(P5 新增)。
   * 设置后 TenantContext 注入 X-Intellect-Project 头(intellect-team 按 project 隔离)。
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
   * 认证模式(P4b 新增,默认 'intellect-rag',向后兼容)。
   * - 'intellect-rag':社区版,BFF 透传到 intellect-rag /api/v1/auth/*
   * - 'intellect-enterprise':企业版,BFF 调 intellect-team /api/members/* + /api/oauth/*
   *   此时 intellectBackendId 必须指向 type='intellect-enterprise' 的后端。
   */
  authMode?: 'intellect-rag' | 'intellect-enterprise';
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
 * Adapter 据此注入多租户头(Intellect 企业版: X-Intellect-Team / X-Intellect-Project)。
 *
 * Lifecycle:
 * 1. BFF 路由层从请求(JWT/Session)提取 userId
 * 2. BFF 路由层从 TenantStore.getTenant(tenantId) 查询绑定关系
 * 3. 构造 TenantContext
 * 4. 传给 IHarnessAdapter / IMultiTenantAdapter 方法
 *
 * Constitution Principle V (v1.1.0): 头名以 intellect-team
 * `_resolve_member_context` 实际实现为准,禁用臆造的 X-Team-Slug / X-Project-Slug。
 */
export interface TenantContext {
  /** BFF Tenant ID */
  tenantId: string;
  /** 当前用户 ID */
  userId: string;
  /**
   * Intellect 企业版 Team ID(多租户场景必填)。
   * Adapter 用此值注入 `X-Intellect-Team` 头。
   * 注意:intellect-team 接受 team_id(而非 slug),值为 intellect-team DB 中 teams.id。
   */
  intellectTeamId?: string;
  /**
   * Intellect 企业版 Project ID(多租户场景必填)。
   * Adapter 用此值注入 `X-Intellect-Project` 头。
   * 注意:intellect-team 接受 project_id(而非 slug),值为 intellect-team DB 中 projects.id。
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
}

// ---------------------------------------------------------------------------
// Validation Rules (enforced by TenantStore)
// ---------------------------------------------------------------------------

/**
 * TenantStore.setCanvasBinding 的校验规则:
 * 1. tenantId 必须存在
 * 2. canvasBackendId 必须在 HarnessStore 中存在
 * 3. 对应 HarnessBackend.type 必须是 'intellect-rag' (Constitution Principle III)
 * 违反则抛出明确错误,不静默失败。
 */
