// @see specs/002-multi-harness-p1/contracts/harness-adapter.ts (authority source)
// @see specs/002-multi-harness-p1/data-model.md (实体 1)
/**
 * IntellectRagAdapter — Intellect RAG OpenAI 兼容 REST API 的 Adapter 实现。
 *
 * Authority source: specs/002-multi-harness-p1/contracts/harness-adapter.ts
 * Runtime: bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts
 *
 * Constitution references (v1.2.0):
 * - Principle II (Adapter Abstraction): Layer 1 所有后端必选实现
 * - Principle IV (SSE Dual-Protocol): sendMessage 返回 AsyncIterable<StreamChunk>,
 *   Intellect RAG 用 parseCanvasWorkflowSSE(P1 主通道,US2 实现)
 * - Principle V (Tenant Isolation): Intellect RAG 单租户,不注入 X-Intellect-Team/X-Intellect-Project 头
 * - Principle VIII: 仅企业版用 API_SERVER_KEY,Intellect RAG 用 admin token(Bearer)
 *
 * Naming: 类名 IntellectRagAdapter,目录 intellect-rag/(Constitution 命名规范)
 */

import type { IHarnessAdapter } from '../../../types/adapter';
import type { AgentSummary, Session, SendMessageRequest } from '../../../types/domain';
import type { StreamChunk, StreamIterable } from '../../../types/stream';
import type { HarnessCapabilities, HarnessBackend } from '../../../types/harness';
import type { TenantContext } from '../../../types/tenant';
import { parseCanvasWorkflowSSE } from './parse-canvas-workflow-sse';

/**
 * Intellect RAG Adapter 实现。
 * 封装 Intellect RAG OpenAI 兼容 REST API 调用,baseUrl 形如 'http://localhost:9380'。
 */
export class IntellectRagAdapter implements IHarnessAdapter {
  readonly backendId: string;
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly capabilities: HarnessCapabilities;

  constructor(backend: HarnessBackend) {
    this.backendId = backend.id;
    // endpoint 形如 'http://localhost:9380',API 路径前缀 /api/v1
    this.baseUrl = backend.endpoint.replace(/\/$/, '');
    this.adminToken = backend.adminToken;
    this.capabilities = backend.capabilities;
  }

  // -----------------------------------------------------------------------
  // Agent methods
  // -----------------------------------------------------------------------

  async listAgents(_ctx: TenantContext): Promise<AgentSummary[]> {
    const data = await this.request<AgentSummary[]>('GET', '/api/v1/agents');
    return data;
  }

  async getAgent(_ctx: TenantContext, agentId: string): Promise<AgentSummary> {
    return this.request<AgentSummary>('GET', `/api/v1/agents/${encodeURIComponent(agentId)}`);
  }

  // -----------------------------------------------------------------------
  // Session methods (嵌套在 agent 下, /api/v1/agents/{agentId}/sessions)
  // -----------------------------------------------------------------------

  async createSession(
    _ctx: TenantContext,
    agentId: string,
    title?: string,
  ): Promise<Session> {
    return this.request<Session>(
      'POST',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions`,
      { name: title },
    );
  }

  async listSessions(_ctx: TenantContext, agentId: string): Promise<Session[]> {
    return this.request<Session[]>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions`,
    );
  }

  async getSession(
    _ctx: TenantContext,
    agentId: string,
    sessionId: string,
  ): Promise<Session> {
    return this.request<Session>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async deleteSession(
    _ctx: TenantContext,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  // -----------------------------------------------------------------------
  // Message streaming (US2 实现 sendMessage, parseCanvasWorkflowSSE)
  // -----------------------------------------------------------------------

  /**
   * 发送消息并返回 Canvas Workflow SSE 流(Constitution Principle IV v1.2.0)。
   *
   * 调 POST /api/v1/agents/chat/completions,响应为 Canvas Workflow SSE
   * (workflow_started/message/message_end/workflow_finished),
   * 用 parseCanvasWorkflowSSE 解析为 StreamChunk 迭代器。
   *
   * 错误处理:上游非 200 时产出单个 StreamError chunk 后终止。
   */
  async sendMessage(
    _ctx: TenantContext,
    req: SendMessageRequest,
  ): Promise<StreamIterable> {
    const url = `${this.baseUrl}/api/v1/agents/chat/completions`;
    const body = {
      agent_id: req.agentId,
      session_id: req.sessionId,
      content: req.content,
      attachments: req.attachments,
      model_id: req.modelId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      return errorStream(
        `Intellect RAG sendMessage error ${response.status} at ${url}: ${text}`,
      );
    }

    return parseCanvasWorkflowSSE(response.body);
  }

  /**
   * P1 stub:不调上游(Intellect RAG 取消端点待 US2+ 评估)。
   * 前端取消时直接 abort fetch,BFF 流式路由关闭 SSE 连接。
   */
  async cancelMessage(_ctx: TenantContext, _sessionId: string): Promise<void> {
    // P1 stub: no-op,前端通过 AbortController 取消流
  }

  // -----------------------------------------------------------------------
  // Health & discovery
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.buildHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    // P1 不动态探测,返回静态 capabilities
    return this.capabilities;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.adminToken) {
      headers['Authorization'] = `Bearer ${this.adminToken}`;
    }
    // Constitution Principle V: Intellect RAG 单租户,不注入 X-Intellect-Team/X-Intellect-Project
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Intellect RAG API error ${response.status} at ${url}: ${text}`,
      );
    }

    // DELETE 可能无 body
    if (response.status === 204 || method === 'DELETE') {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  /**
   * 空流迭代器(P1 sendMessage stub 用,US2 已替换为真实实现,保留供测试/未来场景用)。
   * 立即产出 StreamDone 并终止。
   */
  private async *emptyStream(): StreamIterable {
    yield { type: 'done' as const };
  }
}

/**
 * 产出单个 StreamError 后终止的迭代器(用于 sendMessage 上游错误)。
 */
async function* errorStream(message: string): StreamIterable {
  yield { type: 'error' as const, message } as StreamChunk;
}
