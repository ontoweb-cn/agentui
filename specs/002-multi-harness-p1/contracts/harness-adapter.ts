/**
 * Contract: IHarnessAdapter (Layer 1) — P1 调整版
 *
 * Authority source: specs/002-multi-harness-p1/contracts/harness-adapter.ts
 * Runtime copy: bff/src/types/adapter.ts (P1 更新)
 *
 * P0 → P1 调整(research.md R3):
 * - listSessions: 新增 agentId 参数(Intellect RAG session 嵌套在 /agents/{agentId}/sessions 下)
 * - getSession: 新增 agentId 参数
 * - deleteSession: 新增 agentId 参数
 * - createSession: P0 已有 agentId,P1 保持不变
 *
 * Constitution references (v1.2.0, pending ratification):
 * - Principle II (Adapter Abstraction): Layer 1 所有后端必选实现
 * - Principle IV (SSE Dual-Protocol): sendMessage 返回 AsyncIterable<StreamChunk>,
 *   Intellect RAG 用 parseCanvasWorkflowSSE,Intellect 企业版用 parseIntellectEnterpriseSSE
 * - Principle V (Tenant Isolation): Intellect RAG 不注入 Team/Project 组织隔离头
 *
 * Implementation lifecycle:
 * - P0: contract only, no implementation
 * - P1: IntellectRagAdapter implements this (with unit tests, coverage ≥ 80%)
 * - P3: IntellectEnterpriseAdapter implements this + IMultiTenantAdapter
 */

import type { AgentSummary, Session, SendMessageRequest } from './domain';
import type { StreamIterable } from './stream';
import type { HarnessCapabilities } from './harness';
import type { TenantContext } from './tenant';

export interface IHarnessAdapter {
  readonly backendId: string;

  // Agent methods
  listAgents(ctx: TenantContext): Promise<AgentSummary[]>;
  getAgent(ctx: TenantContext, agentId: string): Promise<AgentSummary>;

  // Session methods (P1 调整:全部含 agentId,适配 Intellect RAG 嵌套结构)
  createSession(ctx: TenantContext, agentId: string, title?: string): Promise<Session>;
  listSessions(ctx: TenantContext, agentId: string): Promise<Session[]>;
  getSession(ctx: TenantContext, agentId: string, sessionId: string): Promise<Session>;
  deleteSession(ctx: TenantContext, agentId: string, sessionId: string): Promise<void>;

  // Message streaming
  sendMessage(ctx: TenantContext, req: SendMessageRequest): Promise<StreamIterable>;
  cancelMessage(ctx: TenantContext, sessionId: string): Promise<void>;

  // Health & discovery
  healthCheck(): Promise<boolean>;
  discoverCapabilities(): Promise<HarnessCapabilities>;
}
