/**
 * Contract: BFF Canvas API(008-explicit-canvas-service)
 *
 * Authority source: specs/008-explicit-canvas-service/contracts/canvas-api.ts
 * Runtime copy: bff/src/types/canvas.ts
 * Implementation: bff/src/routes/canvas.ts + bff/src/services/canvas-service.ts
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端画布操作经 BFF /api/bff/canvas/*,不直连 Intellect RAG
 * - Principle III (Canvas Hard-Bound): CanvasService 硬绑定 IntellectRagAdapter,不允许 enterprise
 * - Principle V (Tenant Isolation): 按 BffTenant.canvasBackendId 路由,未绑定返回 503
 * - Principle VII (YAGNI): 不引入 Canvas IR,DTO 字段与上游 1:1
 *
 * 路由前缀:/api/bff/canvas/*(Vite proxy rewrite 去掉 /api/bff → BFF 收到 /canvas/*)
 * 中间件:authMiddleware + tenantContextMiddleware
 *
 * 前端常量:src/utils/api.ts 中 `bffCanvas = '/api/bff/canvas'`
 * 改回 `${restAPIv1}/agents/...` 可瞬时回滚(Constitution FR-006 约束)
 */

// ---------------------------------------------------------------------------
// BFF Canvas 路由端点(前端调用)
// ---------------------------------------------------------------------------

export type BffCanvasEndpoint =
  // 画布 CRUD
  | { method: 'GET'; path: '/api/bff/canvas' }
  | { method: 'POST'; path: '/api/bff/canvas'; body: CreateCanvasBody }
  | { method: 'GET'; path: '/api/bff/canvas/{id}' }
  | { method: 'PUT'; path: '/api/bff/canvas/{id}'; body: SaveCanvasBody }
  | { method: 'DELETE'; path: '/api/bff/canvas/{id}' }
  | { method: 'POST'; path: '/api/bff/canvas/{id}/reset' }
  // 模板与 tags
  | { method: 'GET'; path: '/api/bff/canvas/templates' }
  | { method: 'GET'; path: '/api/bff/canvas/tags' }
  | { method: 'PUT'; path: '/api/bff/canvas/{id}/tags'; body: UpdateTagsBody }
  // 版本
  | { method: 'GET'; path: '/api/bff/canvas/{id}/versions' }
  | { method: 'GET'; path: '/api/bff/canvas/{id}/versions/{vid}' }
  // 组件
  | { method: 'GET'; path: '/api/bff/canvas/{id}/components/{cid}/input-form' }
  | { method: 'POST'; path: '/api/bff/canvas/{id}/components/{cid}/debug'; body: unknown }
  // trace
  | { method: 'GET'; path: '/api/bff/canvas/{id}/logs/{messageId}' }
  // prompts
  | { method: 'GET'; path: '/api/bff/canvas/prompts' }
  // db connection
  | { method: 'POST'; path: '/api/bff/canvas/test_db_connection'; body: unknown }
  // webhook
  | { method: 'POST'; path: '/api/bff/canvas/{id}/webhook/test'; body: unknown }
  | { method: 'GET'; path: '/api/bff/canvas/{id}/webhook/logs' }
  // rerun
  | { method: 'POST'; path: '/api/bff/canvas/rerun'; body: unknown }
  // task cancel
  | { method: 'POST'; path: '/api/bff/canvas/tasks/{taskId}/cancel' }
  // external inputs
  | { method: 'GET'; path: '/api/bff/canvas/{id}/external-inputs' }
  // 流式透传(multipart 上传 / 二进制下载)
  | { method: 'POST'; path: '/api/bff/canvas/{id}/upload'; body: FormData }
  | { method: 'GET'; path: '/api/bff/canvas/attachments/{docId}/download' }
  | { method: 'GET'; path: '/api/bff/canvas/download' };

// ---------------------------------------------------------------------------
// 请求/响应类型(DTO,字段与 Intellect RAG 上游 1:1,不做语义转换)
// ---------------------------------------------------------------------------

/**
 * 画布实体(透传上游 /api/v1/agents 响应)。
 * 字段用 [key: string]: unknown 透传,因 DSL schema 上游可控,BFF 不镜像(Principle VII YAGNI)。
 */
export interface CanvasAgent {
  id: string;
  [key: string]: unknown;
}

export interface CanvasTemplate {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CanvasTag {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CanvasVersion {
  id: string;
  agent_id: string;
  [key: string]: unknown;
}

/** 创建画布请求 body(对齐上游 POST /api/v1/agents) */
export interface CreateCanvasBody {
  name: string;
  dsl?: unknown;
  [key: string]: unknown;
}

/** 保存画布 DSL 请求 body(对齐上游 PUT /api/v1/agents/:id) */
export interface SaveCanvasBody {
  name?: string;
  dsl?: unknown;
  [key: string]: unknown;
}

/** 更新画布 tags 请求 body(对齐上游 PUT /api/v1/agents/:id/tags) */
export interface UpdateTagsBody {
  tags?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// 错误响应(research.md R6 错误码映射)
// ---------------------------------------------------------------------------

export interface CanvasErrorResponse {
  code: number;
  message: string;
}

/**
 * 503: 租户未绑定画布后端(CanvasBackendNotBoundError)
 *      或 canvasBackendId 无效(InvalidCanvasBackendError / BackendNotConfiguredError)
 *      或 Registry 未就绪(RegistryNotReadyError)
 */
export const CANVAS_503_NO_BACKEND = 503;

/**
 * 502: Intellect RAG 上游不可达或 5xx
 */
export const CANVAS_502_UPSTREAM_ERROR = 502;

/**
 * 404: 画布/版本/组件等资源不存在(上游 404 透传)
 */
export const CANVAS_404_NOT_FOUND = 404;

/**
 * 4xx: 上游 4xx 透传(400 Bad Request / 422 Validation Error 等),保留上游 body
 */
export const CANVAS_4XX_UPSTREAM_PASSTHROUGH = 400;

// ---------------------------------------------------------------------------
// 中间件与路由挂载约定(BFF 内部实现依据)
// ---------------------------------------------------------------------------

/**
 * 路由挂载:index.ts 中
 *   app.use('/canvas/*', authMiddleware);
 *   app.use('/canvas/*', tenantContextMiddleware);
 *   app.route('/', canvasRoutes);
 *
 * 路径前缀冲突校验:
 *   /canvas/* 与 /agents/* / /admin/* / /capabilities/* / /auth/* / /proxy/v1/* / /health 不冲突
 *
 * 中间件策略:
 *   - authMiddleware: 校验 Authorization header,未授权返回 401,不进入 CanvasService
 *   - tenantContextMiddleware: 注入 TenantContext,缺失 X-Tenant-Id 时回退 'default'(社区版兼容)
 *
 * 不注入 X-Intellect-Team / X-Intellect-Project 头:
 *   Intellect RAG 不消费 Team/Project 组织隔离头(Constitution Principle V)
 */

// ---------------------------------------------------------------------------
// AdapterRegistry 扩展契约
// ---------------------------------------------------------------------------

/**
 * AdapterRegistry.getCanvasBackendForTenant(tenantId): IntellectRagAdapter
 *
 * Resolution flow (research.md R3):
 * 1. tenant = tenantStore.getTenant(tenantId)
 * 2. if tenant.canvasBackendId:
 *      adapter = getAdapterForBackend(tenant.canvasBackendId)  // 复用缓存
 *      if !(adapter instanceof IntellectRagAdapter): throw InvalidCanvasBackendError
 *      return adapter as IntellectRagAdapter
 * 3. if !canvasBackendId:
 *      if tenantId === 'default' || !tenant: return 首个 intellect-rag backend(社区版回退)
 *      else: throw CanvasBackendNotBoundError
 *
 * 错误类型:
 *   - CanvasBackendNotBoundError(tenantId) → 503
 *   - InvalidCanvasBackendError(tenantId, backendId, actualType) → 503
 *   - BackendNotConfiguredError(backendId) → 503(canvasBackendId 在 HarnessStore 不存在)
 *   - RegistryNotReadyError() → 503
 *   - TenantNotFoundError(tenantId) → 404(理论上不会触发,因 default 回退在 tenant 不存在时也生效)
 */

// ---------------------------------------------------------------------------
// IntellectRagAdapter 扩展契约
// ---------------------------------------------------------------------------

/**
 * IntellectRagAdapter.proxy(method, path, req): Promise<Response>
 *
 * 流式透传方法,用 Adapter 实例的 baseUrl + adminToken(非全局 intellect-client.proxy)。
 *
 * Implementation:
 *   - URL: `${this.baseUrl}${path}${req.query}`
 *   - Headers: 复制 req.headers,删 host,强制覆盖 Authorization: Bearer ${this.adminToken}
 *   - Body: 流式透传 req.body(ReadableStream)
 *   - duplex: 'half'(Node fetch stream body)
 *   - 返回上游 Response 原样(不调 .json()/.text(),保留 body ReadableStream)
 *
 * 用途:
 *   - uploadAttachment(multipart/form-data 上传)
 *   - downloadAttachment(二进制附件下载)
 *   - downloadFile(二进制文件下载)
 */

// ---------------------------------------------------------------------------
// 前端 api.ts 迁移契约(research.md R7)
// ---------------------------------------------------------------------------

/**
 * 前端 src/utils/api.ts 新增常量:
 *   const bffCanvas = '/api/bff/canvas';
 *   export { restAPIv1, webAPI, bffAgents, bffCapabilities, bffHarnessAdmin, bffAuth, bffCanvas };
 *
 * 迁移到 ${bffCanvas} 的 endpoint(22 条):
 *   listAgentTemplate, listAgentTags, updateAgentTags, createAgent, updateAgent, deleteAgent,
 *   resetAgent, testDbConnect, debug, trace, cancelCanvas, inputForm, fetchVersionList,
 *   fetchVersion, uploadAgentFile, fetchExternalAgentInputs, prompt, cancelDataflow,
 *   getAttachmentFileDownload, downloadFile, testWebhook, fetchWebhookTrace
 *
 * 保留 ${bffAgents} 的 endpoint(7 条,P1 已迁移,本 spec 不动):
 *   listAgents, getAgent, agentChatCompletion, createAgentSession,
 *   fetchAgentSessions, fetchAgentSessionById
 *
 * 保留 ${restAPIv1} 或 ${webAPI} 的 endpoint(非画布域,本 spec 不动):
 *   其余 datasets/kb/memory/mcp/chat/files/admin 等域
 */

export {};
