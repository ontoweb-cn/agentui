// @see specs/008-explicit-canvas-service/data-model.md (实体 1)
// @see specs/008-explicit-canvas-service/research.md (R2, R5, R6)
/**
 * CanvasService — 画布服务层,封装画布操作对 IntellectRagAdapter 的调用。
 *
 * Authority source: specs/008-explicit-canvas-service/data-model.md
 * Runtime: bff/src/services/canvas-service.ts
 *
 * Constitution references (v1.2.0):
 * - Principle III (Canvas Hard-Bound): 硬绑定 IntellectRagAdapter,不经过 Adapter Registry 选择
 * - Principle V (Tenant Isolation): 经 AdapterRegistry.getCanvasBackendForBackend 按租户路由
 * - Principle VII (YAGNI): 不引入 Canvas IR,DTO 字段与上游 1:1
 *
 * 两类方法:
 * - JSON 方法:调 adapter.request<T>(method, path, body?),返回上游 JSON
 * - 流式方法:调 adapter.proxy(method, path, req),返回上游 Response
 */

import type { BackendContext } from '../types/tenant';
import type { IAdapterRegistry } from './adapter-registry-types';
import type {
  CanvasAgent,
  CanvasTemplate,
  CanvasTag,
  CanvasVersion,
  CreateCanvasBody,
  SaveCanvasBody,
  UpdateTagsBody,
} from '../types/canvas';
import type { IntellectRagAdapter } from './adapters/intellect-rag/intellect-rag-adapter';

export class CanvasService {
  private readonly registry: IAdapterRegistry;

  constructor(registry: IAdapterRegistry) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // Private helper
  // -------------------------------------------------------------------------

  /** 按租户上下文解析画布 Adapter(Constitution Principle III + V) */
  private resolveAdapter(ctx: BackendContext): IntellectRagAdapter {
    return this.registry.getCanvasBackendForBackend(ctx.backendId);
  }

  // -------------------------------------------------------------------------
  // JSON 方法 — 画布 CRUD
  // -------------------------------------------------------------------------

  async listCanvas(ctx: BackendContext): Promise<CanvasAgent[]> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasAgent[]>('GET', '/api/v1/agents', undefined, ctx);
  }

  async getCanvas(ctx: BackendContext, id: string): Promise<CanvasAgent> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasAgent>('GET', `/api/v1/agents/${encodeURIComponent(id)}`, undefined, ctx);
  }

  async createCanvas(ctx: BackendContext, body: CreateCanvasBody): Promise<CanvasAgent> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasAgent>('POST', '/api/v1/agents', body, ctx);
  }

  async saveCanvas(ctx: BackendContext, id: string, body: SaveCanvasBody): Promise<CanvasAgent> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasAgent>('PUT', `/api/v1/agents/${encodeURIComponent(id)}`, body, ctx);
  }

  async deleteCanvas(ctx: BackendContext, id: string): Promise<void> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<void>('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`, undefined, ctx);
  }

  async resetCanvas(ctx: BackendContext, id: string): Promise<void> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<void>('POST', `/api/v1/agents/${encodeURIComponent(id)}/reset`, undefined, ctx);
  }

  // -------------------------------------------------------------------------
  // JSON 方法 — 模板与 Tags
  // -------------------------------------------------------------------------

  async listTemplates(ctx: BackendContext): Promise<CanvasTemplate[]> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasTemplate[]>('GET', '/api/v1/agents/templates', undefined, ctx);
  }

  async listTags(ctx: BackendContext): Promise<CanvasTag[]> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasTag[]>('GET', '/api/v1/agents/tags', undefined, ctx);
  }

  async updateTags(ctx: BackendContext, id: string, body: UpdateTagsBody): Promise<void> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<void>('PUT', `/api/v1/agents/${encodeURIComponent(id)}/tags`, body, ctx);
  }

  // -------------------------------------------------------------------------
  // JSON 方法 — 版本
  // -------------------------------------------------------------------------

  async listVersions(ctx: BackendContext, id: string): Promise<CanvasVersion[]> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasVersion[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/versions`, undefined, ctx);
  }

  async getVersion(ctx: BackendContext, id: string, vid: string): Promise<CanvasVersion> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<CanvasVersion>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}`,
      undefined,
      ctx,
    );
  }

  // -------------------------------------------------------------------------
  // JSON 方法 — 组件
  // -------------------------------------------------------------------------

  async getInputForm(ctx: BackendContext, id: string, cid: string): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(id)}/components/${encodeURIComponent(cid)}/input-form`,
      undefined,
      ctx,
    );
  }

  async debugComponent(ctx: BackendContext, id: string, cid: string, body: unknown): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>(
      'POST',
      `/api/v1/agents/${encodeURIComponent(id)}/components/${encodeURIComponent(cid)}/debug`,
      body,
      ctx,
    );
  }

  // -------------------------------------------------------------------------
  // JSON 方法 — Trace / Prompts / DB / Webhook / Rerun / Cancel / External
  // -------------------------------------------------------------------------

  async trace(ctx: BackendContext, id: string, messageId: string): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(id)}/logs/${encodeURIComponent(messageId)}`,
      undefined,
      ctx,
    );
  }

  async listPrompts(ctx: BackendContext): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>('GET', '/api/v1/agents/prompts', undefined, ctx);
  }

  async testDbConnection(ctx: BackendContext, body: unknown): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>('POST', '/api/v1/agents/test_db_connection', body, ctx);
  }

  async testWebhook(ctx: BackendContext, id: string, body: unknown): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>(
      'POST',
      `/api/v1/agents/${encodeURIComponent(id)}/webhook/test`,
      body,
      ctx,
    );
  }

  async fetchWebhookLogs(ctx: BackendContext, id: string): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(id)}/webhook/logs`,
      undefined,
      ctx,
    );
  }

  async rerun(ctx: BackendContext, body: unknown): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>('POST', '/api/v1/agents/rerun', body, ctx);
  }

  async cancelTask(ctx: BackendContext, taskId: string): Promise<void> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<void>('POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, undefined, ctx);
  }

  async fetchExternalInputs(ctx: BackendContext, canvasId: string): Promise<unknown> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.request<unknown>(
      'GET',
      `/api/v1/agentbots/${encodeURIComponent(canvasId)}/inputs`,
      undefined,
      ctx,
    );
  }

  // -------------------------------------------------------------------------
  // 流式透传方法(调 adapter.proxy,返回上游 Response)
  // -------------------------------------------------------------------------

  async uploadAttachment(
    ctx: BackendContext,
    id: string,
    req: { headers: Headers; body?: ReadableStream<Uint8Array> | null; query: string },
  ): Promise<Response> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.proxy('POST', `/api/v1/agents/${encodeURIComponent(id)}/upload`, req, ctx);
  }

  async downloadAttachment(
    ctx: BackendContext,
    docId: string,
    query: string,
  ): Promise<Response> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.proxy('GET', `/api/v1/agents/attachments/${encodeURIComponent(docId)}/download`, {
      headers: new Headers(),
      query,
    }, ctx);
  }

  async downloadFile(
    ctx: BackendContext,
    req: { headers: Headers; body?: ReadableStream<Uint8Array> | null; query: string },
  ): Promise<Response> {
    const adapter = this.resolveAdapter(ctx);
    return adapter.proxy('GET', '/api/v1/agents/download', req, ctx);
  }
}
