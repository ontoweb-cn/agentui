// @see specs/004-intellect-enterprise-adapter/data-model.md (实体 1)
// @see specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts
/**
 * IntellectEnterpriseAdapter — Intellect 企业版(intellect-team)Adapter 实现。
 *
 * Authority source: specs/004-intellect-enterprise-adapter/data-model.md
 * Runtime: bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts
 *
 * Constitution references (v1.2.0):
 * - Principle II (Adapter Abstraction): Layer 1 所有后端必选实现
 * - Principle IV (SSE Dual-Protocol): sendMessage 用 parseIntellectEnterpriseSSE
 *   (企业版自定义事件,不复用 parseCanvasWorkflowSSE/parseOpenAISSE)
 * - Principle V (Tenant Isolation): 注入 X-Intellect-Team / X-Intellect-Project 头
 *   (通过 httpClient 统一注入,BffTenant.intellectTenantId 映射到 BackendContext.intellectTeamId)
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract):
 *   主通道 POST /api/sessions/{id}/chat/stream,鉴权 API_SERVER_KEY,禁用 /v1/chat/completions
 *
 * Naming: 类名 IntellectEnterpriseAdapter,目录 intellect-enterprise/(Constitution 命名规范)
 */

import type { IHarnessAdapter } from '../../../types/adapter';
import type {
  AgentSummary,
  Session,
  SendMessageRequest,
} from '../../../types/domain';
import type { StreamIterable } from '../../../types/stream';
import type { HarnessCapabilities, HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import {
  IntellectEnterpriseHttpClient,
  IntellectNotFoundError,
  IntellectBackendError,
} from './http-client';
import { parseIntellectEnterpriseSSE } from './parse-intellect-enterprise-sse';

/**
 * 企业版默认能力(当 /v1/capabilities 端点不存在时降级返回)。
 * research.md R4 决策:canvas=false(Principle III),multiTenant=true(Principle V,实例内 Team/Project 组织模型)。
 * 注意:真正的租户隔离通过多实例部署实现,multiTenant flag 仅表示实例内 Team/Project 组织能力。
 */
const DEFAULT_ENTERPRISE_CAPABILITIES: HarnessCapabilities = {
  canvas: false,
  knowledgeBase: false,
  memory: true,
  mcp: true,
  multiTenant: true,
  modelManagement: false,
};

/**
 * Intellect 企业版 Adapter 实现。
 * 封装 intellect-team REST API 调用,baseUrl 形如 'http://localhost:8642'。
 */
export class IntellectEnterpriseAdapter implements IHarnessAdapter {
  readonly backendId: string;
  private readonly httpClient: IntellectEnterpriseHttpClient;
  private readonly capabilities: HarnessCapabilities;

  constructor(backend: HarnessBackend) {
    this.backendId = backend.id;
    const baseUrl = backend.endpoint.replace(/\/$/, '');
    // Constitution Principle VIII: adminToken 字段承载 API_SERVER_KEY(env 注入)
    this.httpClient = new IntellectEnterpriseHttpClient(baseUrl, backend.adminToken);
    // AdapterRegistry 按 backend.type 路由,enterprise 后端 capabilities 必为 HarnessCapabilities
    this.capabilities = backend.capabilities as HarnessCapabilities;
  }

  // -----------------------------------------------------------------------
  // Agent methods (US1)
  // -----------------------------------------------------------------------

  async listAgents(ctx: BackendContext): Promise<AgentSummary[]> {
    try {
      const data = await this.httpClient.request<{ data: unknown[] } | unknown[]>(
        'GET',
        '/v1/models',
        ctx,
      );
      // intellect-team /v1/models 可能返回 {data:[...]} 或 [...] 兼容两种
      const arr = Array.isArray(data) ? data : data?.data ?? [];
      return arr.map((m) => this.normalizeAgent(m));
    } catch (err) {
      // Principle VII:后端不可达返回空数组 + console.warn,不抛异常
      if (
        err instanceof IntellectNotFoundError ||
        err instanceof IntellectBackendError
      ) {
        console.warn(
          `[IntellectEnterpriseAdapter] listAgents failed: ${(err as Error).message}`,
        );
        return [];
      }
      throw err;
    }
  }

  async getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    const data = await this.httpClient.request<unknown>(
      'GET',
      `/v1/models/${encodeURIComponent(agentId)}`,
      ctx,
    );
    return this.normalizeAgent(data);
  }

  // -----------------------------------------------------------------------
  // Session methods (US2, intellect-team /api/sessions 不嵌套在 agent 下)
  // -----------------------------------------------------------------------

  async createSession(
    ctx: BackendContext,
    _agentId: string,
    title?: string,
  ): Promise<Session> {
    // intellect-team POST /api/sessions,body 可带 title
    const data = await this.httpClient.request<{ id: string; title?: string }>(
      'POST',
      '/api/sessions',
      ctx,
      title ? { title } : {},
    );
    return this.normalizeSession(data, _agentId);
  }

  async listSessions(ctx: BackendContext, agentId: string): Promise<Session[]> {
    const data = await this.httpClient.request<{ data?: unknown[] } | unknown[]>(
      'GET',
      '/api/sessions',
      ctx,
    );
    const arr = Array.isArray(data) ? data : data?.data ?? [];
    return arr.map((s) => this.normalizeSession(s, agentId));
  }

  async getSession(
    ctx: BackendContext,
    agentId: string,
    sessionId: string,
  ): Promise<Session> {
    const data = await this.httpClient.request<unknown>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      ctx,
    );
    return this.normalizeSession(data, agentId);
  }

  async deleteSession(
    ctx: BackendContext,
    _agentId: string,
    sessionId: string,
  ): Promise<void> {
    await this.httpClient.request<void>(
      'DELETE',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      ctx,
    );
  }

  // -----------------------------------------------------------------------
  // Message streaming (US3, sendMessage via /api/sessions/{id}/chat/stream)
  // -----------------------------------------------------------------------

  async sendMessage(
    ctx: BackendContext,
    req: SendMessageRequest,
  ): Promise<StreamIterable> {
    const path = `/api/sessions/${encodeURIComponent(req.sessionId)}/chat/stream`;
    const stream = await this.httpClient.requestStream(path, ctx, {
      message: req.content,
      agent_id: req.agentId,
      model_id: req.modelId,
      attachments: req.attachments,
    });
    return parseIntellectEnterpriseSSE(stream);
  }

  async cancelMessage(_ctx: BackendContext, _sessionId: string): Promise<void> {
    // P3 stub: no-op,前端通过 AbortController 取消流
  }

  // -----------------------------------------------------------------------
  // Health & discovery (US1)
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      await this.httpClient.request('GET', '/health', {
        backendId: '',
        userId: '',
      });
      return true;
    } catch {
      // Principle VII:不抛异常,返回 false
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    try {
      const data = await this.httpClient.request<Partial<HarnessCapabilities>>(
        'GET',
        '/v1/capabilities',
        { backendId: '', userId: '' },
      );
      // 合并默认能力(确保所有字段存在)
      return { ...DEFAULT_ENTERPRISE_CAPABILITIES, ...data };
    } catch (err) {
      if (
        err instanceof IntellectNotFoundError ||
        err instanceof IntellectBackendError
      ) {
        // research.md R4:端点不存在降级返回默认能力
        console.warn(
          `[IntellectEnterpriseAdapter] discoverCapabilities fallback to defaults: ${(err as Error).message}`,
        );
        return { ...DEFAULT_ENTERPRISE_CAPABILITIES };
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * 归一化 intellect-team /v1/models 响应为 AgentSummary。
   * 兼容 {id,name,description} 和 {id,object,owned_by} 两种格式。
   */
  private normalizeAgent(raw: unknown): AgentSummary {
    const m = raw as Record<string, unknown>;
    return {
      id: String(m.id ?? ''),
      name: String(m.name ?? m.id ?? ''),
      description: m.description ? String(m.description) : undefined,
    };
  }

  /**
   * 归一化 intellect-team /api/sessions 响应为 Session。
   */
  private normalizeSession(raw: unknown, agentId: string): Session {
    const s = raw as Record<string, unknown>;
    return {
      id: String(s.id ?? ''),
      agentId,
      title: s.title ? String(s.title) : (s.name as string | undefined),
      createdAt: String(s.created_at ?? s.createdAt ?? new Date().toISOString()),
      updatedAt: String(s.updated_at ?? s.updatedAt ?? new Date().toISOString()),
    };
  }
}
