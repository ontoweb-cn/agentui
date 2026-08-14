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
 * - Principle V (Tenant Isolation): Intellect RAG 单租户。D1.2 B 起注入
 *   X-Intellect-Team/X-Intellect-Project 头(intellect-rag-app 已消费这些头
 *   用于 KB ownership 字段写入)。仅在 BackendContext 提供非空值时注入。
 * - Principle VIII: 仅企业版用 API_SERVER_KEY,Intellect RAG 用 admin token(Bearer)
 *
 * Naming: 类名 IntellectRagAdapter,目录 intellect-rag/(Constitution 命名规范)
 */

import type { IHarnessAdapter, ICanvasAdapter, IKnowledgeBaseAdapter } from '../../../types/adapter';
import type { AgentSummary, Session, SendMessageRequest, Dataset, KbDocument } from '../../../types/domain';
import type { StreamChunk, StreamIterable } from '../../../types/stream';
import type { HarnessCapabilities, HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import type { CanvasAgent, CreateCanvasBody, SaveCanvasBody } from '../../../types/canvas';
import { fetchWithRagToken } from '../../rag-fetch';
import { parseCanvasWorkflowSSE } from './parse-canvas-workflow-sse';

/**
 * Intellect RAG Adapter 实现。
 * 封装 Intellect RAG OpenAI 兼容 REST API 调用,baseUrl 形如 'http://localhost:9380'。
 *
 * spec-010 v8 A2-2: implements ICanvasAdapter,6 个高层画布方法路径拼接下沉到 Adapter。
 * spec-010 v8 A2-3: implements IKnowledgeBaseAdapter,KB 方法路径拼接下沉到 Adapter。
 */
export class IntellectRagAdapter implements IHarnessAdapter, ICanvasAdapter, IKnowledgeBaseAdapter {
  readonly backendId: string;
  readonly adapterKind = 'canvas' as const;
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly capabilities: HarnessCapabilities;

  constructor(backend: HarnessBackend) {
    this.backendId = backend.id;
    // endpoint 形如 'http://localhost:9380',API 路径前缀 /api/v1
    this.baseUrl = backend.endpoint.replace(/\/$/, '');
    this.adminToken = backend.adminToken;
    // AdapterRegistry 按 backend.type 路由,rag 后端 capabilities 必为 HarnessCapabilities
    this.capabilities = backend.capabilities as HarnessCapabilities;
  }

  // -----------------------------------------------------------------------
  // Agent methods
  // -----------------------------------------------------------------------

  async listAgents(_ctx: BackendContext): Promise<AgentSummary[]> {
    const data = await this.request<AgentSummary[]>('GET', '/api/v1/agents', undefined, _ctx);
    return data;
  }

  async getAgent(_ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    return this.request<AgentSummary>('GET', `/api/v1/agents/${encodeURIComponent(agentId)}`, undefined, _ctx);
  }

  // -----------------------------------------------------------------------
  // Session methods (嵌套在 agent 下, /api/v1/agents/{agentId}/sessions)
  // -----------------------------------------------------------------------

  async createSession(
    _ctx: BackendContext,
    agentId: string,
    title?: string,
  ): Promise<Session> {
    return this.request<Session>(
      'POST',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions`,
      { name: title },
      _ctx,
    );
  }

  async listSessions(_ctx: BackendContext, agentId: string): Promise<Session[]> {
    return this.request<Session[]>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions`,
      undefined,
      _ctx,
    );
  }

  async getSession(
    _ctx: BackendContext,
    agentId: string,
    sessionId: string,
  ): Promise<Session> {
    return this.request<Session>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      _ctx,
    );
  }

  async deleteSession(
    _ctx: BackendContext,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      _ctx,
    );
  }

  async updateSession(
    _ctx: BackendContext,
    agentId: string,
    sessionId: string,
    params: { title?: string },
  ): Promise<Session> {
    const data = await this.request<unknown>(
      'PATCH',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      params,
      _ctx,
    );
    return data as unknown as Session;
  }

  async getSessionMessages(
    _ctx: BackendContext,
    agentId: string,
    sessionId: string,
  ): Promise<unknown[]> {
    const data = await this.request<unknown>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      undefined,
      _ctx,
    );
    const arr = Array.isArray(data) ? data : (data as { messages?: unknown[] })?.messages ?? [];
    return arr;
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
    _ctx: BackendContext,
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

    const response = await fetchWithRagToken(url, {
      method: 'POST',
      headers: this.buildHeaders(_ctx),
      body: JSON.stringify(body),
    }, { fallbackStaticToken: this.adminToken, sessionToken: _ctx?.sessionToken });

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
  async cancelMessage(_ctx: BackendContext, _sessionId: string): Promise<void> {
    // P1 stub: no-op,前端通过 AbortController 取消流
  }

  // -----------------------------------------------------------------------
  // Health & discovery
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      // RAG 匿名健康端点 /api/v1/system/healthz(无 @login_required,
      // 见 intellect-rag-app/api/apps/restful_apis/system_api.py:230)。
      // 注意:根 /health 在 RAG 源码中不存在,勿改回。
      // 匿名端点无需注入 token,直接用 fetch(避免向公开端点发送 adminToken)。
      const response = await fetch(`${this.baseUrl}/api/v1/system/healthz`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
  // Canvas 高层语义方法(spec-010 v8 A2-2: ICanvasAdapter 实现)
  // 路径拼接下沉到 Adapter,CanvasService 改为一行转发。
  // -----------------------------------------------------------------------

  async listCanvas(ctx: BackendContext): Promise<CanvasAgent[]> {
    return this.request<CanvasAgent[]>('GET', '/api/v1/agents', undefined, ctx);
  }

  async getCanvas(ctx: BackendContext, id: string): Promise<CanvasAgent> {
    return this.request<CanvasAgent>('GET', `/api/v1/agents/${encodeURIComponent(id)}`, undefined, ctx);
  }

  async createCanvas(ctx: BackendContext, body: CreateCanvasBody): Promise<CanvasAgent> {
    return this.request<CanvasAgent>('POST', '/api/v1/agents', body, ctx);
  }

  async saveCanvas(ctx: BackendContext, id: string, body: SaveCanvasBody): Promise<CanvasAgent> {
    return this.request<CanvasAgent>('PUT', `/api/v1/agents/${encodeURIComponent(id)}`, body, ctx);
  }

  async deleteCanvas(ctx: BackendContext, id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`, undefined, ctx);
  }

  async resetCanvas(ctx: BackendContext, id: string): Promise<void> {
    return this.request<void>('POST', `/api/v1/agents/${encodeURIComponent(id)}/reset`, undefined, ctx);
  }

  // -----------------------------------------------------------------------
  // Knowledge Base 高层语义方法(spec-010 v8 A2-3: IKnowledgeBaseAdapter 实现)
  // 路径拼接下沉到 Adapter,对应 intellect-rag /api/v1/datasets/* 端点。
  // -----------------------------------------------------------------------

  async listDatasets(ctx: BackendContext): Promise<Dataset[]> {
    return this.request<Dataset[]>('GET', '/api/v1/datasets', undefined, ctx);
  }

  async createDataset(ctx: BackendContext, name: string, description?: string): Promise<Dataset> {
    return this.request<Dataset>(
      'POST',
      '/api/v1/datasets',
      { name, description },
      ctx,
    );
  }

  async getDataset(ctx: BackendContext, datasetId: string): Promise<Dataset> {
    return this.request<Dataset>(
      'GET',
      `/api/v1/datasets/${encodeURIComponent(datasetId)}`,
      undefined,
      ctx,
    );
  }

  async updateDataset(
    ctx: BackendContext,
    datasetId: string,
    patch: Partial<Dataset>,
  ): Promise<Dataset> {
    // spec-010 v8: 显式删除 permission 字段,防止旧客户端发送废弃字段污染数据
    // (project_memory 约束:Knowledgebase 更新接口需显式删除 permission 字段)
    const body: Record<string, unknown> = { ...patch };
    delete body.permission;
    return this.request<Dataset>(
      'PUT',
      `/api/v1/datasets/${encodeURIComponent(datasetId)}`,
      body,
      ctx,
    );
  }

  async deleteDataset(ctx: BackendContext, datasetId: string): Promise<void> {
    // intellect-rag 批量删除端点 DELETE /api/v1/datasets,body: { ids: [datasetId] }
    return this.request<void>(
      'DELETE',
      '/api/v1/datasets',
      { ids: [datasetId] },
      ctx,
    );
  }

  async listDocuments(ctx: BackendContext, datasetId: string): Promise<KbDocument[]> {
    return this.request<KbDocument[]>(
      'GET',
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`,
      undefined,
      ctx,
    );
  }

  async uploadDocument(
    ctx: BackendContext,
    datasetId: string,
    file: { name: string; type: string; body: ReadableStream<Uint8Array> | Blob | unknown },
    metadata?: Record<string, unknown>,
  ): Promise<KbDocument> {
    // multipart 上传:不设置 Content-Type,fetch 自动加 boundary
    const formData = new FormData();
    const blob = new Blob([file.body as BlobPart], { type: file.type });
    formData.append('file', blob, file.name);
    if (metadata) {
      formData.append('metadata', JSON.stringify(metadata));
    }
    // 构造 headers:身份头 + 不含 Content-Type(让 fetch 自动设 multipart boundary)
    const headers: Record<string, string> = {};
    if (ctx?.intellectUserId) headers['X-Intellect-User'] = ctx.intellectUserId;
    if (ctx?.intellectRole) headers['X-Intellect-Role'] = ctx.intellectRole;
    if (ctx?.intellectTeamId) headers['X-Intellect-Team'] = ctx.intellectTeamId;
    if (ctx?.intellectProjectId) headers['X-Intellect-Project'] = ctx.intellectProjectId;
    if (ctx?.intellectTenantId) headers['X-Intellect-Tenant'] = ctx.intellectTenantId;

    const url = `${this.baseUrl}/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`;
    const response = await fetchWithRagToken(url, {
      method: 'POST',
      headers,
      body: formData,
    }, { fallbackStaticToken: this.adminToken, sessionToken: ctx?.sessionToken });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Intellect RAG uploadDocument error ${response.status} at ${url}: ${text}`,
      );
    }
    return response.json() as Promise<KbDocument>;
  }

  async deleteDocument(
    ctx: BackendContext,
    datasetId: string,
    documentId: string,
  ): Promise<void> {
    // intellect-rag 批量删除端点 DELETE /api/v1/datasets/{id}/documents,body: { ids: [documentId] }
    return this.request<void>(
      'DELETE',
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`,
      { ids: [documentId] },
      ctx,
    );
  }

  /**
   * JSON 请求方法(供 CanvasService 等调用方直接使用)。
   *
   * spec-008 (Constitution Principle III): CanvasService 不引入 IR 层,
   * 直接调 adapter.request() 透传上游 JSON。
   *
   * spec-010 v8 A2-2: 纳入 ICanvasAdapter 接口契约。
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    ctx?: BackendContext,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetchWithRagToken(url, {
      method,
      headers: this.buildHeaders(ctx),
      body: body != null ? JSON.stringify(body) : undefined,
    }, { fallbackStaticToken: this.adminToken, sessionToken: ctx?.sessionToken });

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
   * 流式透传方法(供 CanvasService 上传/下载使用)。
   *
   * spec-008 R5: 用 Adapter 实例的 baseUrl + adminToken(而非全局 BASE_URL),
   * 落实 Principle II 多后端支持。
   *
   * @param method HTTP method
   * @param path 上游路径(如 /api/v1/agents/:id/upload)
   * @param req 请求组成部分(headers/body/query)
   * @returns 上游 fetch Response(不调 .json()/.text(),保留 body ReadableStream)
   */
  async proxy(
    method: string,
    path: string,
    req: { headers: Headers; body?: ReadableStream<Uint8Array> | null; query: string },
    ctx?: BackendContext,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}${req.query}`;

    // 复制请求头,删除 host 与客户端可能注入的 X-Intellect-* / Authorization 头。
    // Authorization 由 fetchWithRagToken 统一注入(动态 token 优先,降级到 adminToken)。
    const headers = new Headers(req.headers);
    headers.delete('host');
    // 安全(S1.1 修复):强制删除客户端可能注入的 X-Intellect-* 头,
    // 仅由 BFF 注入可信值。防止客户端伪造 team/project 头导致 KB ownership
    // 字段被写入恶意值(跨 team/project 越权访问)。
    headers.delete('X-Intellect-User');
    headers.delete('X-Intellect-Team');
    headers.delete('X-Intellect-Project');
    headers.delete('X-Intellect-Tenant');
    headers.delete('X-Intellect-Role');
    // 删除客户端 Authorization,统一由 fetchWithRagToken 注入(动态 token > adminToken)
    headers.delete('Authorization');
    // D1.2 B: proxy 路径(canvas 上传/下载)也注入身份头,
    // 与 buildHeaders() 保持一致。
    if (ctx?.intellectUserId) {
      headers.set('X-Intellect-User', ctx.intellectUserId);
    }
    if (ctx?.intellectRole) {
      headers.set('X-Intellect-Role', ctx.intellectRole);
    }
    if (ctx?.intellectTeamId) {
      headers.set('X-Intellect-Team', ctx.intellectTeamId);
    }
    if (ctx?.intellectProjectId) {
      headers.set('X-Intellect-Project', ctx.intellectProjectId);
    }
    if (ctx?.intellectTenantId) {
      headers.set('X-Intellect-Tenant', ctx.intellectTenantId);
    }

    // fetchWithRagToken 处理:token 注入(动态优先,降级 adminToken)+ 401 重试。
    // bufferBody:false 保持原流式透传语义,避免大文件上传(如 100MB 附件)
    // 被完整读入内存导致内存压力与敏感数据驻留。
    // 代价:上传场景下 401 不重试(由调用方自行处理,或重发请求)。
    return fetchWithRagToken(url, {
      method,
      headers,
      body: req.body ?? undefined,
    }, { fallbackStaticToken: this.adminToken, bufferBody: false, sessionToken: ctx?.sessionToken });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * 构造请求头(Content-Type + X-Intellect-* 身份头)。
   *
   * 不注入 Authorization — 由 fetchWithRagToken 统一处理:
   * 优先动态 token(ragTokenProvider),降级到 backend.adminToken(fallbackStaticToken)。
   * 401 时自动重新登录重试(仅动态 token 场景)。
   */
  private buildHeaders(ctx?: BackendContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // BFF-P0-1: 注入解析后的 member_id 为 X-Intellect-User header。
    // 让 intellect-rag-app 在 KB/Chunk 创建时设置正确的 owner_user_id,
    // 替代之前的 current_user.id (RAG UUID) 回退。
    // 安全: member_id 来自服务端 token→/api/members/me 解析,非客户端 X-User-Id header。
    if (ctx?.intellectUserId) {
      headers['X-Intellect-User'] = ctx.intellectUserId;
    }
    if (ctx?.intellectRole) {
      headers['X-Intellect-Role'] = ctx.intellectRole;
    }
    // D1.2 B (identity-model-migration): intellect-rag-app 已开始消费
    // X-Intellect-Team / X-Intellect-Project 头(visibility=team/project)。
    // 注入这些头让 KB ownership 字段能正确写入,避免静默降级为 private。
    // 仅在 BackendContext 提供非空值时注入(缺省租户 '0' 已被 backend-context
    // 中间件过滤,不会到达此处)。
    if (ctx?.intellectTeamId) {
      headers['X-Intellect-Team'] = ctx.intellectTeamId;
    }
    if (ctx?.intellectProjectId) {
      headers['X-Intellect-Project'] = ctx.intellectProjectId;
    }
    // 方案 B: 注入实例级 tenant_id,让 intellect-rag 的 SubjectContext.tenant_id 正确解析。
    // 优先级: X-Intellect-Tenant header > INTELLECT_TENANT_ID env > current_user.id (legacy)。
    // 不注入时 intellect-rag 会走 legacy 回退,导致 tenant_membership 不一致。
    if (ctx?.intellectTenantId) {
      headers['X-Intellect-Tenant'] = ctx.intellectTenantId;
    }
    return headers;
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
