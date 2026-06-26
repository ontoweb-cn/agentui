/**
 * Contract: IHarnessAdapter — Core Layer (Layer 1)
 *
 * Authority source: specs/001-multi-harness-p0/contracts/harness-adapter.ts
 * Runtime copy: bff/src/types/adapter.ts
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction):
 *   Layer 1 core interface — ALL backends MUST implement.
 *   Methods: Agent / Session / Message streaming / Health.
 *   New backend = new adapter implementing this interface, no BFF route changes.
 * - Principle IV (SSE Dual-Protocol Parsing):
 *   sendMessage returns AsyncIterable<StreamChunk>, parsed by backend-specific SSE parser.
 *   Parsers (parseOpenAISSE / parseIntellectEnterpriseSSE) are implemented in P1/P3,
 *   NOT in P0 — P0 only declares the contract.
 * - Principle VII (YAGNI + Test-First):
 *   P0 defines contract only; P1 IntellectRagAdapter is the first implementation
 *   and MUST have unit tests for listAgents/createSession/sendMessage.
 */

import type { AgentSummary, Session, SendMessageRequest } from './domain-models';
import type { StreamChunk, StreamIterable } from './stream-chunk';
import type { HarnessCapabilities } from './harness-backend';
import type { TenantContext } from './tenant-context';

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
 * - AdapterRegistry.getAdapterForTenant(tenantId) returns IHarnessAdapter
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
  listAgents(ctx: TenantContext): Promise<AgentSummary[]>;

  /**
   * 获取单个 Agent 详情。
   * @param ctx 租户上下文
   * @param agentId Agent ID
   */
  getAgent(ctx: TenantContext, agentId: string): Promise<AgentSummary>;

  // -----------------------------------------------------------------------
  // Session methods
  // -----------------------------------------------------------------------

  /**
   * 创建会话。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID
   * @param title 会话标题(可选)
   */
  createSession(ctx: TenantContext, agentId: string, title?: string): Promise<Session>;

  /**
   * 列出指定 Agent 下的所有会话。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID(P1 v1.2.0 调整:适配 Intellect RAG 嵌套结构 /agents/{agentId}/sessions)
   */
  listSessions(ctx: TenantContext, agentId: string): Promise<Session[]>;

  /**
   * 获取单个会话详情。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID(P1 v1.2.0 调整)
   * @param sessionId Session ID
   */
  getSession(ctx: TenantContext, agentId: string, sessionId: string): Promise<Session>;

  /**
   * 删除会话。
   * @param ctx 租户上下文
   * @param agentId 关联 Agent ID(P1 v1.2.0 调整)
   * @param sessionId Session ID
   */
  deleteSession(ctx: TenantContext, agentId: string, sessionId: string): Promise<void>;

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
  sendMessage(ctx: TenantContext, req: SendMessageRequest): Promise<StreamIterable>;

  /**
   * 取消进行中的消息流。
   * @param ctx 租户上下文
   * @param sessionId Session ID
   */
  cancelMessage(ctx: TenantContext, sessionId: string): Promise<void>;

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
// Adapter Factory (used by AdapterRegistry in P1)
// ---------------------------------------------------------------------------

/**
 * Adapter 工厂函数签名。
 * P1 AdapterRegistry.getAdapterForTenant() 调用此工厂创建/复用 Adapter 实例。
 *
 * @param backend 运行时后端对象(含 token)
 * @returns Adapter 实例
 *
 * Note: P0 declares this type only; P1 implements IntellectRagAdapterFactory.
 */
export type HarnessAdapterFactory = (backend: import('./harness-backend').HarnessBackend) => IHarnessAdapter;
