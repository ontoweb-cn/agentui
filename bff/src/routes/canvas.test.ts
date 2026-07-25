// spec-008: Canvas 路由集成测试
// Constitution Principle VII (Test-First): 测试先于实现。
// 覆盖: 正常 CRUD / 静态路由不冲突 / 错误码映射 / 流式透传

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { canvasRoutes } from './canvas';
import { CanvasService } from '../services/canvas-service';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { IntellectRagAdapter } from '../services/adapters/intellect-rag/intellect-rag-adapter';
import { CanvasBackendNotBoundError } from '../services/adapter-registry-errors';

const ctx = { backendId: 'tenant-001', userId: 'user-001' };

function createMockCanvasService(): CanvasService {
  const mockRequest = vi.fn();
  const mockProxy = vi.fn();
  const mockAdapter = {
    backendId: 'intellect-rag-default',
    request: mockRequest,
    proxy: mockProxy,
  } as unknown as IntellectRagAdapter;
  const mockRegistry = {
    getCanvasBackendForBackend: vi.fn().mockReturnValue(mockAdapter),
  } as unknown as IAdapterRegistry;
  const svc = new CanvasService(mockRegistry);
  // Hang mockAdapter off the service for test introspection
  (svc as unknown as { _mockAdapter: typeof mockAdapter })._mockAdapter = mockAdapter;
  return svc;
}

function createTestApp(svc: CanvasService) {
  const app = new Hono();
  // Inject canvasService into context (simulates index.ts middleware)
  // Use type assertion to bypass strict Hono variable typing in tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', async (c: any, next: any) => {
    c.set('canvasService', svc);
    c.set('backendContext', ctx);
    await next();
  });
  app.route('/', canvasRoutes);
  return app;
}

describe('Canvas Routes (spec-008)', () => {
  let app: ReturnType<typeof createTestApp>;
  let svc: CanvasService;
  let mockAdapter: { request: ReturnType<typeof vi.fn>; proxy: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = createMockCanvasService();
    mockAdapter = (svc as unknown as { _mockAdapter: typeof mockAdapter })._mockAdapter;
    app = createTestApp(svc);
  });

  // -----------------------------------------------------------------------
  // Static path routes (must not be captured by /:id)
  // -----------------------------------------------------------------------

  describe('static path routes', () => {
    it('GET /canvas/templates 不匹配 /:id', async () => {
      mockAdapter.request.mockResolvedValue([{ id: 't1', name: 'T1' }]);

      const res = await app.request('/canvas/templates', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/templates', undefined, ctx);
    });

    it('GET /canvas/tags 不匹配 /:id', async () => {
      mockAdapter.request.mockResolvedValue([{ id: 'tag1', name: 'tag1' }]);

      const res = await app.request('/canvas/tags', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/tags', undefined, ctx);
    });

    it('GET /canvas/prompts 不匹配 /:id', async () => {
      mockAdapter.request.mockResolvedValue([]);

      const res = await app.request('/canvas/prompts', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/prompts', undefined, ctx);
    });

    it('POST /canvas/test_db_connection 不匹配 /:id', async () => {
      mockAdapter.request.mockResolvedValue({ success: true });

      const res = await app.request('/canvas/test_db_connection', {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001', 'content-type': 'application/json' },
        body: JSON.stringify({ host: 'localhost' }),
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('POST', '/api/v1/agents/test_db_connection', expect.any(Object), ctx);
    });

    it('POST /canvas/tasks/:taskId/cancel 不匹配 /:id', async () => {
      mockAdapter.request.mockResolvedValue(undefined);

      const res = await app.request('/canvas/tasks/task-123/cancel', {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('POST', '/api/v1/tasks/task-123/cancel', undefined, ctx);
    });

    it('GET /canvas/attachments/:docId/download 不匹配 /:id', async () => {
      const mockStream = new ReadableStream();
      mockAdapter.proxy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        body: mockStream,
      });

      const res = await app.request('/canvas/attachments/doc1/download', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.proxy).toHaveBeenCalledWith(
        'GET',
        '/api/v1/agents/attachments/doc1/download',
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // CRUD routes
  // -----------------------------------------------------------------------

  describe('GET /canvas (list)', () => {
    it('返回 200 且调用 listCanvas', async () => {
      mockAdapter.request.mockResolvedValue([{ id: 'a1' }]);

      const res = await app.request('/canvas', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([{ id: 'a1' }]);
    });
  });

  describe('POST /canvas (create)', () => {
    it('返回 201 且调用 createCanvas', async () => {
      mockAdapter.request.mockResolvedValue({ id: 'new-id', name: 'New' });

      const res = await app.request('/canvas', {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      });

      expect(res.status).toBe(201);
      expect(mockAdapter.request).toHaveBeenCalledWith('POST', '/api/v1/agents', expect.any(Object), ctx);
    });
  });

  describe('PUT /canvas/:id (save)', () => {
    it('返回 200 且调用 saveCanvas', async () => {
      mockAdapter.request.mockResolvedValue({ id: 'a1', name: 'Updated' });

      const res = await app.request('/canvas/a1', {
        method: 'PUT',
        headers: { 'x-tenant-id': 'tenant-001', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('PUT', '/api/v1/agents/a1', expect.any(Object), ctx);
    });
  });

  describe('DELETE /canvas/:id', () => {
    it('返回 200 且调用 deleteCanvas', async () => {
      mockAdapter.request.mockResolvedValue(undefined);

      const res = await app.request('/canvas/a1', {
        method: 'DELETE',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
    });
  });

  describe('POST /canvas/:id/reset', () => {
    it('返回 200 且调用 resetCanvas', async () => {
      mockAdapter.request.mockResolvedValue(undefined);

      const res = await app.request('/canvas/a1/reset', {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Component routes

  describe('GET /canvas/:id/components/:cid/input-form', () => {
    it('返回 200 且调用 getInputForm', async () => {
      mockAdapter.request.mockResolvedValue({ fields: [] });

      const res = await app.request('/canvas/a1/components/c1/input-form', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith(
        'GET',
        '/api/v1/agents/a1/components/c1/input-form',
        undefined,
        ctx,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error mapping', () => {
    it('CanvasBackendNotBoundError → 503', async () => {
      // Create a service whose adapter throws CanvasBackendNotBoundError
      const mockReg = {
        getCanvasBackendForBackend: vi.fn().mockImplementation(() => {
          throw new CanvasBackendNotBoundError('tenant-404');
        }),
      } as unknown as IAdapterRegistry;
      const errorSvc = new CanvasService(mockReg);
      const errorApp = createTestApp(errorSvc);

      const res = await errorApp.request('/canvas', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-404' },
      });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe(503);
      expect(body.message).toContain('has no canvas backend bound');
    });

    it('adapter 抛 404 → 响应 404', async () => {
      mockAdapter.request.mockRejectedValue(new Error('Intellect RAG API error 404'));

      const res = await app.request('/canvas', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(404);
    });

    it('adapter 抛 500 → 响应 502', async () => {
      mockAdapter.request.mockRejectedValue(new Error('Intellect RAG API error 500'));

      const res = await app.request('/canvas', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(502);
    });
  });

  // -----------------------------------------------------------------------
  // Version routes
  // -----------------------------------------------------------------------

  describe('GET /canvas/:id/versions', () => {
    it('返回 200 且调用 listVersions', async () => {
      mockAdapter.request.mockResolvedValue([{ id: 'v1', agent_id: 'a1' }]);

      const res = await app.request('/canvas/a1/versions', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/a1/versions', undefined, ctx);
    });
  });

  describe('GET /canvas/:id/versions/:vid', () => {
    it('返回 200 且调用 getVersion', async () => {
      mockAdapter.request.mockResolvedValue({ id: 'v1', agent_id: 'a1' });

      const res = await app.request('/canvas/a1/versions/v1', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/a1/versions/v1', undefined, ctx);
    });
  });

  // -----------------------------------------------------------------------
  // Webhook routes
  // -----------------------------------------------------------------------

  describe('GET /canvas/:id/webhook/logs', () => {
    it('返回 200 且调用 fetchWebhookLogs', async () => {
      mockAdapter.request.mockResolvedValue([]);

      const res = await app.request('/canvas/a1/webhook/logs', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-001' },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /canvas/:id/webhook/test', () => {
    it('返回 200 且透传 body', async () => {
      mockAdapter.request.mockResolvedValue({ ok: true });

      const res = await app.request('/canvas/a1/webhook/test', {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001', 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      expect(res.status).toBe(200);
    });
  });
});
