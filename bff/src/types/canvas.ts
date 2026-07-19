// @see specs/008-explicit-canvas-service/contracts/canvas-api.ts (authority source)
// @see specs/008-explicit-canvas-service/data-model.md (实体 5)
/**
 * Canvas DTO types — 显式 CanvasService (spec-008).
 *
 * Authority source: specs/008-explicit-canvas-service/contracts/canvas-api.ts
 * Runtime copy: bff/src/types/canvas.ts
 *
 * Constitution references (v1.2.0):
 * - Principle III (Canvas Hard-Bound): CanvasService 硬绑定 IntellectRagAdapter
 * - Principle VII (YAGNI): 不引入 Canvas IR,DTO 字段与上游 1:1
 */

// ---------------------------------------------------------------------------
// 画布实体(透传上游 /api/v1/agents 响应,字段 1:1,不做语义转换)
// ---------------------------------------------------------------------------

/** 画布实体(透传上游 /api/v1/agents 响应) */
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

// ---------------------------------------------------------------------------
// 请求 body DTO(字段与上游 1:1)
// ---------------------------------------------------------------------------

export interface CreateCanvasBody {
  name: string;
  dsl?: unknown;
  [key: string]: unknown;
}

export interface SaveCanvasBody {
  name?: string;
  dsl?: unknown;
  [key: string]: unknown;
}

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

/** 503: 租户未绑定画布后端或 backend 无效或 Registry 未就绪 */
export const CANVAS_503_NO_BACKEND = 503;

/** 502: Intellect RAG 上游不可达或 5xx */
export const CANVAS_502_UPSTREAM_ERROR = 502;

/** 404: 画布/版本/组件等资源不存在(上游 404 透传) */
export const CANVAS_404_NOT_FOUND = 404;

/** 4xx: 上游 4xx 透传(保留上游 body) */
export const CANVAS_4XX_UPSTREAM_PASSTHROUGH = 400;
