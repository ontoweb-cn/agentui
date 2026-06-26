// @see specs/001-multi-harness-p0/contracts/domain-models.ts (authority source)
/**
 * Contract: Domain Models (Agent / Session / Team / Project / Member)
 *
 * Authority source: specs/001-multi-harness-p0/contracts/domain-models.ts
 * Runtime copy: bff/src/types/domain.ts
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction): these models are the shared schema
 *   for Layer 1 (Agent/Session) and Layer 2 (Team/Project/Member) methods.
 * - Principle V (Tenant Isolation): Team/Project/Member are passthrough models
 *   (BFF does not own this data, only forwards from Intellect Enterprise API).
 */

// ---------------------------------------------------------------------------
// Agent (Layer 1 — all backends)
// ---------------------------------------------------------------------------

/**
 * Agent 摘要(列表/详情)。
 * P1 IntellectRagAdapter 与 P3 IntellectEnterpriseAdapter 共用。
 */
export interface AgentSummary {
  /** Agent ID */
  id: string;
  /** Agent 名称 */
  name: string;
  /** Agent 描述(可选) */
  description?: string;
  /** Agent 头像 URL(可选) */
  avatarUrl?: string;
  /** Agent 能力标签,如 ['chat', 'code', 'reasoning'] */
  capabilities?: string[];
  /** 默认模型 ID(可选) */
  modelId?: string;
  /** ISO 8601 创建时间(可选,后端可能不返回) */
  createdAt?: string;
  /** ISO 8601 更新时间(可选) */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Session (Layer 1 — all backends)
// ---------------------------------------------------------------------------

/**
 * 会话实体。
 * metadata 字段为后端专有元数据,透传不纳入统一 schema(Constitution Principle II Layer 3)。
 */
export interface Session {
  /** Session ID */
  id: string;
  /** 关联 Agent ID */
  agentId: string;
  /** 会话标题(可选) */
  title?: string;
  /** ISO 8601 创建时间 */
  createdAt: string;
  /** ISO 8601 更新时间 */
  updatedAt: string;
  /**
   * 后端专有元数据(透传,不纳入统一 schema)。
   * Constitution Principle II Layer 3: 透传层不纳入统一 schema。
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Team (Layer 2 — Intellect Enterprise only)
// ---------------------------------------------------------------------------

/**
 * Intellect 企业版 Team 实体。
 * BFF 透传管理,不存副本(Constitution Principle V)。
 */
export interface Team {
  /** Team ID */
  id: string;
  /** Team 名称 */
  name: string;
  /** Team slug(URL 友好) */
  slug: string;
  /** Team 描述(可选) */
  description?: string;
  /** 成员数(可选,后端可能不返回) */
  memberCount?: number;
  /** ISO 8601 创建时间(可选) */
  createdAt?: string;
  /** ISO 8601 更新时间(可选) */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Project (Layer 2 — Intellect Enterprise only)
// ---------------------------------------------------------------------------

/**
 * Intellect 企业版 Project 实体。
 * BFF 透传管理,不存副本(Constitution Principle V)。
 */
export interface Project {
  /** Project ID */
  id: string;
  /** 所属 Team ID */
  teamId: string;
  /** Project 名称 */
  name: string;
  /** Project slug */
  slug: string;
  /** Project 描述(可选) */
  description?: string;
  /** 成员数(可选) */
  memberCount?: number;
  /** ISO 8601 创建时间(可选) */
  createdAt?: string;
  /** ISO 8601 更新时间(可选) */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Members (Layer 2 — Intellect Enterprise only)
// ---------------------------------------------------------------------------

/**
 * Team 或 Project 成员角色。
 * Constitution Principle V: BFF 不维护权限模型,只透传,由企业版 Member role 执行。
 */
export type MemberRole = 'owner' | 'admin' | 'member';

/**
 * 成员实体(Team 与 Project 共用)。
 */
export interface Member {
  /** 用户 ID */
  userId: string;
  /** 用户名称(可选) */
  name?: string;
  /** 邮箱(可选) */
  email?: string;
  /** 角色 */
  role: MemberRole;
  /** 加入时间 ISO 8601(可选) */
  addedAt?: string;
}

/**
 * Team 成员(Member + teamId)。
 */
export interface TeamMember extends Member {
  /** 所属 Team ID */
  teamId: string;
}

/**
 * Project 成员(Member + projectId)。
 */
export interface ProjectMember extends Member {
  /** 所属 Project ID */
  projectId: string;
}

// ---------------------------------------------------------------------------
// Send Message Request (Layer 1 — all backends)
// ---------------------------------------------------------------------------

/**
 * 发送消息请求,P1/P3 Adapter 共用。
 */
export interface SendMessageRequest {
  /** Session ID */
  sessionId: string;
  /** 用户消息内容 */
  content: string;
  /** 关联的 Agent ID(可选,部分后端需要) */
  agentId?: string;
  /** 附件列表(可选) */
  attachments?: SendMessageAttachment[];
  /** 模型覆盖(可选) */
  modelId?: string;
}

/**
 * 消息附件。
 */
export interface SendMessageAttachment {
  /** 附件类型 */
  type: 'image' | 'file' | 'url';
  /** 附件 URL 或内容 */
  url: string;
  /** 附件名称(可选) */
  name?: string;
  /** MIME 类型(可选) */
  mimeType?: string;
}
