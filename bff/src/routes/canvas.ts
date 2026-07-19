// @see specs/008-explicit-canvas-service/data-model.md (实体 4)
// @see specs/008-explicit-canvas-service/contracts/canvas-api.ts
/**
 * Canvas 路由 — 显式 /api/bff/canvas/* 入口(spec-008)。
 *
 * Authority source: specs/008-explicit-canvas-service/data-model.md
 * Runtime: bff/src/routes/canvas.ts
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端画布操作经 BFF /canvas/*,不直连 Intellect RAG
 * - Principle III (Canvas Hard-Bound): CanvasService 硬绑定 IntellectRagAdapter
 * - Principle V (Tenant Isolation): 按 BffTenant.canvasBackendId 路由,未绑定返回 503
 *
 * 路径映射:前端 /api/bff/canvas/* → Vite proxy rewrite 去掉 /api/bff → BFF 收到 /canvas/*
 * 中间件:authMiddleware + tenantContextMiddleware(在 index.ts 挂载)
 * 挂载点:'/' 与 bffAgentRoutes 并列,路径前缀不冲突
 *
 * 注意:静态路径(/canvas/templates 等)必须在 /canvas/:id 之前注册,
 * 否则 Hono 会将 'templates' 捕获为 :id 参数。
 */

import { Hono, type Context } from 'hono';
import { CanvasService } from '../services/canvas-service';
import type { TenantContext } from '../types/tenant';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import { resolveTenantContext } from '../middleware/tenant-context';
import { streamResponse } from '../utils/response';
import {
  CanvasBackendNotBoundError,
  InvalidCanvasBackendError,
  BackendNotConfiguredError,
  RegistryNotReadyError,
  TenantNotFoundError,
} from '../services/adapter-registry-errors';

// Hono context variables for canvas routes
interface CanvasRouteVariables {
  adapterRegistry: IAdapterRegistry;
  canvasService: CanvasService;
  tenantContext?: TenantContext;
}

export const canvasRoutes = new Hono<{ Variables: CanvasRouteVariables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 从 Hono context 获取 CanvasService 实例 */
function getCanvasService(c: Context): CanvasService {
  return c.get('canvasService');
}

/**
 * 将 CanvasService / AdapterRegistry 错误映射为 HTTP 响应(research.md R6)。
 *
 * 错误码映射:
 * - 503: Registry 未就绪 / 租户未绑定画布 / backend 无效
 * - 404: 租户不存在 / 上游 404
 * - 400: 上游 4xx 透传
 * - 502: 上游不可达 / 其他错误
 */
function handleCanvasError(c: Context, err: Error, defaultStatus = 502) {
  const msg = err.message;

  if (
    err instanceof RegistryNotReadyError ||
    err instanceof CanvasBackendNotBoundError ||
    err instanceof InvalidCanvasBackendError ||
    err instanceof BackendNotConfiguredError
  ) {
    return c.json({ code: 503, message: msg }, 503 as 200);
  }

  if (err instanceof TenantNotFoundError) {
    return c.json({ code: 404, message: msg }, 404 as 200);
  }

  if (/404/.test(msg)) {
    return c.json({ code: 404, message: msg }, 404 as 200);
  }

  if (/4\d{2}/.test(msg)) {
    return c.json({ code: 400, message: msg }, 400 as 200);
  }

  return c.json({ code: defaultStatus, message: msg }, defaultStatus as 200);
}

// ---------------------------------------------------------------------------
// Static-path routes (MUST be before /:id parameterized routes)
// ---------------------------------------------------------------------------

canvasRoutes.get('/canvas/templates', async (c) => {
  const service = getCanvasService(c);
  try {
    const result = await service.listTemplates(resolveTenantContext(c));
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/tags', async (c) => {
  const service = getCanvasService(c);
  try {
    const result = await service.listTags(resolveTenantContext(c));
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/prompts', async (c) => {
  const service = getCanvasService(c);
  try {
    const result = await service.listPrompts(resolveTenantContext(c));
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas/test_db_connection', async (c) => {
  const service = getCanvasService(c);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await service.testDbConnection(resolveTenantContext(c), body);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas/rerun', async (c) => {
  const service = getCanvasService(c);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await service.rerun(resolveTenantContext(c), body);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/download', async (c) => {
  const service = getCanvasService(c);
  try {
    const query = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
    const upstream = await service.downloadFile(resolveTenantContext(c), {
      headers: c.req.raw.headers,
      query,
    });
    return streamResponse(upstream);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/attachments/:docId/download', async (c) => {
  const service = getCanvasService(c);
  try {
    const docId = c.req.param('docId');
    const query = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
    const upstream = await service.downloadAttachment(resolveTenantContext(c), docId, query);
    return streamResponse(upstream);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas/tasks/:taskId/cancel', async (c) => {
  const service = getCanvasService(c);
  try {
    const taskId = c.req.param('taskId');
    await service.cancelTask(resolveTenantContext(c), taskId);
    return c.json({ code: 0, message: 'ok' });
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

// ---------------------------------------------------------------------------
// /canvas (list + create)
// ---------------------------------------------------------------------------

canvasRoutes.get('/canvas', async (c) => {
  const service = getCanvasService(c);
  try {
    const result = await service.listCanvas(resolveTenantContext(c));
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas', async (c) => {
  const service = getCanvasService(c);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await service.createCanvas(resolveTenantContext(c), body);
    return c.json(result, 201);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

// ---------------------------------------------------------------------------
// /canvas/:id — parameterized routes
// ---------------------------------------------------------------------------

canvasRoutes.get('/canvas/:id', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const result = await service.getCanvas(resolveTenantContext(c), id);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.put('/canvas/:id', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const result = await service.saveCanvas(resolveTenantContext(c), id, body);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.delete('/canvas/:id', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    await service.deleteCanvas(resolveTenantContext(c), id);
    return c.json({ code: 0, message: 'ok' });
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas/:id/reset', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    await service.resetCanvas(resolveTenantContext(c), id);
    return c.json({ code: 0, message: 'ok' });
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.put('/canvas/:id/tags', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    await service.updateTags(resolveTenantContext(c), id, body);
    return c.json({ code: 0, message: 'ok' });
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/:id/versions', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const result = await service.listVersions(resolveTenantContext(c), id);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/:id/versions/:vid', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const vid = c.req.param('vid');
    const result = await service.getVersion(resolveTenantContext(c), id, vid);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/:id/components/:cid/input-form', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const cid = c.req.param('cid');
    const result = await service.getInputForm(resolveTenantContext(c), id, cid);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas/:id/components/:cid/debug', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const cid = c.req.param('cid');
    const body = await c.req.json().catch(() => ({}));
    const result = await service.debugComponent(resolveTenantContext(c), id, cid, body);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/:id/logs/:messageId', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const messageId = c.req.param('messageId');
    const result = await service.trace(resolveTenantContext(c), id, messageId);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.post('/canvas/:id/webhook/test', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const result = await service.testWebhook(resolveTenantContext(c), id, body);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/:id/webhook/logs', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const result = await service.fetchWebhookLogs(resolveTenantContext(c), id);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

canvasRoutes.get('/canvas/:id/external-inputs', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const result = await service.fetchExternalInputs(resolveTenantContext(c), id);
    return c.json(result);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

// Streaming multipart upload
canvasRoutes.post('/canvas/:id/upload', async (c) => {
  const service = getCanvasService(c);
  try {
    const id = c.req.param('id');
    const query = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
    const upstream = await service.uploadAttachment(resolveTenantContext(c), id, {
      headers: c.req.raw.headers,
      body: c.req.raw.body,
      query,
    });
    return streamResponse(upstream);
  } catch (err) {
    return handleCanvasError(c, err as Error);
  }
});

