import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasService } from './canvas-service';
import type { IAdapterRegistry } from './adapter-registry-types';
import type { IntellectRagAdapter } from './adapters/intellect-rag/intellect-rag-adapter';
import type { BackendContext } from '../types/tenant';
import { CanvasBackendNotBoundError } from './adapter-registry-errors';

const ctx: BackendContext = {
  backendId: 'tenant-001',
  userId: 'user-001',
};

function createMockAdapter(): IntellectRagAdapter {
  // Minimal mock: only the methods CanvasService calls
  const mockRequest = vi.fn();
  const mockProxy = vi.fn();
  return {
    backendId: 'intellect-rag-default',
    request: mockRequest,
    proxy: mockProxy,
    // CanvasService doesn't call these, but IntellectRagAdapter requires them
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    healthCheck: vi.fn(),
    discoverCapabilities: vi.fn(),
  } as unknown as IntellectRagAdapter;
}

function createMockRegistry(adapter: IntellectRagAdapter): IAdapterRegistry {
  return {
    getAdapterForBackend: vi.fn(),
    registerFactory: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    invalidate: vi.fn(),
    getCanvasBackendForBackend: vi.fn().mockReturnValue(adapter),
  };
}

describe('CanvasService', () => {
  let service: CanvasService;
  let mockAdapter: IntellectRagAdapter;
  let mockRegistry: IAdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockRegistry = createMockRegistry(mockAdapter);
    service = new CanvasService(mockRegistry);
  });

  // -----------------------------------------------------------------------
  // JSON 方法 — 画布 CRUD
  // -----------------------------------------------------------------------

  describe('listCanvas', () => {
    it('调用 adapter.request GET /api/v1/agents', async () => {
      const agents = [{ id: 'a1', name: 'Agent 1' }];
      mockAdapter.request = vi.fn().mockResolvedValue(agents);

      const result = await service.listCanvas(ctx);

      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents');
      expect(result).toEqual(agents);
    });
  });

  describe('getCanvas', () => {
    it('调用 adapter.request GET /api/v1/agents/:id', async () => {
      const agent = { id: 'a1', name: 'Agent 1' };
      mockAdapter.request = vi.fn().mockResolvedValue(agent);

      const result = await service.getCanvas(ctx, 'a1');

      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/a1');
      expect(result).toEqual(agent);
    });
  });

  describe('createCanvas', () => {
    it('调用 adapter.request POST /api/v1/agents 并透传 body', async () => {
      const body = { name: 'New Canvas', dsl: { nodes: [] } };
      const created = { id: 'new-id', ...body };
      mockAdapter.request = vi.fn().mockResolvedValue(created);

      const result = await service.createCanvas(ctx, body);

      expect(mockAdapter.request).toHaveBeenCalledWith('POST', '/api/v1/agents', body);
      expect(result).toEqual(created);
    });
  });

  describe('saveCanvas', () => {
    it('调用 adapter.request PUT /api/v1/agents/:id 并透传 body', async () => {
      const body = { name: 'Updated Canvas', dsl: { nodes: [] } };
      const saved = { id: 'a1', ...body };
      mockAdapter.request = vi.fn().mockResolvedValue(saved);

      const result = await service.saveCanvas(ctx, 'a1', body);

      expect(mockAdapter.request).toHaveBeenCalledWith('PUT', '/api/v1/agents/a1', body);
      expect(result).toEqual(saved);
    });
  });

  describe('deleteCanvas', () => {
    it('调用 adapter.request DELETE /api/v1/agents/:id', async () => {
      mockAdapter.request = vi.fn().mockResolvedValue(undefined);

      await service.deleteCanvas(ctx, 'a1');

      expect(mockAdapter.request).toHaveBeenCalledWith('DELETE', '/api/v1/agents/a1');
    });
  });

  describe('resetCanvas', () => {
    it('调用 adapter.request POST /api/v1/agents/:id/reset', async () => {
      mockAdapter.request = vi.fn().mockResolvedValue(undefined);

      await service.resetCanvas(ctx, 'a1');

      expect(mockAdapter.request).toHaveBeenCalledWith('POST', '/api/v1/agents/a1/reset');
    });
  });

  // -----------------------------------------------------------------------
  // JSON 方法 — 模板与 Tags
  // -----------------------------------------------------------------------

  describe('listTemplates', () => {
    it('调用 adapter.request GET /api/v1/agents/templates', async () => {
      const templates = [{ id: 't1', name: 'Template 1' }];
      mockAdapter.request = vi.fn().mockResolvedValue(templates);

      const result = await service.listTemplates(ctx);

      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/templates');
      expect(result).toEqual(templates);
    });
  });

  describe('listTags', () => {
    it('调用 adapter.request GET /api/v1/agents/tags', async () => {
      const tags = [{ id: 'tag1', name: 'tag1' }];
      mockAdapter.request = vi.fn().mockResolvedValue(tags);

      const result = await service.listTags(ctx);

      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/tags');
      expect(result).toEqual(tags);
    });
  });

  describe('updateTags', () => {
    it('调用 adapter.request PUT /api/v1/agents/:id/tags 并透传 body', async () => {
      const body = { tags: ['tag1', 'tag2'] };
      mockAdapter.request = vi.fn().mockResolvedValue(undefined);

      await service.updateTags(ctx, 'a1', body);

      expect(mockAdapter.request).toHaveBeenCalledWith('PUT', '/api/v1/agents/a1/tags', body);
    });
  });

  // -----------------------------------------------------------------------
  // JSON 方法 — 版本
  // -----------------------------------------------------------------------

  describe('listVersions', () => {
    it('调用 adapter.request GET /api/v1/agents/:id/versions', async () => {
      const versions = [{ id: 'v1', agent_id: 'a1' }];
      mockAdapter.request = vi.fn().mockResolvedValue(versions);

      const result = await service.listVersions(ctx, 'a1');

      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/a1/versions');
      expect(result).toEqual(versions);
    });
  });

  describe('getVersion', () => {
    it('调用 adapter.request GET /api/v1/agents/:id/versions/:vid', async () => {
      const version = { id: 'v1', agent_id: 'a1' };
      mockAdapter.request = vi.fn().mockResolvedValue(version);

      const result = await service.getVersion(ctx, 'a1', 'v1');

      expect(mockAdapter.request).toHaveBeenCalledWith('GET', '/api/v1/agents/a1/versions/v1');
      expect(result).toEqual(version);
    });
  });

  // -----------------------------------------------------------------------
  // JSON 方法 — 组件
  // -----------------------------------------------------------------------

  describe('getInputForm', () => {
    it('调用 adapter.request GET /api/v1/agents/:id/components/:cid/input-form', async () => {
      mockAdapter.request = vi.fn().mockResolvedValue({ fields: [] });

      await service.getInputForm(ctx, 'a1', 'c1');

      expect(mockAdapter.request).toHaveBeenCalledWith(
        'GET',
        '/api/v1/agents/a1/components/c1/input-form',
      );
    });
  });

  describe('debugComponent', () => {
    it('调用 adapter.request POST /api/v1/agents/:id/components/:cid/debug 并透传 body', async () => {
      const body = { inputs: {} };
      mockAdapter.request = vi.fn().mockResolvedValue({ result: 'ok' });

      await service.debugComponent(ctx, 'a1', 'c1', body);

      expect(mockAdapter.request).toHaveBeenCalledWith(
        'POST',
        '/api/v1/agents/a1/components/c1/debug',
        body,
      );
    });
  });

  // -----------------------------------------------------------------------
  // JSON 方法 — Trace / Webhook / Rerun / Cancel / External
  // -----------------------------------------------------------------------

  describe('cancelTask', () => {
    it('调用 adapter.request POST /api/v1/tasks/:taskId/cancel', async () => {
      mockAdapter.request = vi.fn().mockResolvedValue(undefined);

      await service.cancelTask(ctx, 'task-123');

      expect(mockAdapter.request).toHaveBeenCalledWith('POST', '/api/v1/tasks/task-123/cancel');
    });
  });

  describe('testWebhook', () => {
    it('调用 adapter.request POST /api/v1/agents/:id/webhook/test 并透传 body', async () => {
      const body = { url: 'https://example.com' };
      mockAdapter.request = vi.fn().mockResolvedValue({ ok: true });

      await service.testWebhook(ctx, 'a1', body);

      expect(mockAdapter.request).toHaveBeenCalledWith(
        'POST',
        '/api/v1/agents/a1/webhook/test',
        body,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 流式透传方法
  // -----------------------------------------------------------------------

  describe('uploadAttachment', () => {
    it('调用 adapter.proxy POST /api/v1/agents/:id/upload 并透传 req', async () => {
      const mockRes = { ok: true, status: 200 } as Response;
      mockAdapter.proxy = vi.fn().mockResolvedValue(mockRes);

      const req = { headers: new Headers(), body: null, query: '' };
      const result = await service.uploadAttachment(ctx, 'a1', req);

      expect(mockAdapter.proxy).toHaveBeenCalledWith(
        'POST',
        '/api/v1/agents/a1/upload',
        req,
        ctx,
      );
      expect(result).toBe(mockRes);
    });
  });

  describe('downloadAttachment', () => {
    it('调用 adapter.proxy GET /api/v1/agents/attachments/:docId/download', async () => {
      const mockRes = { ok: true, status: 200 } as Response;
      mockAdapter.proxy = vi.fn().mockResolvedValue(mockRes);

      const result = await service.downloadAttachment(ctx, 'doc1', '?v=1');

      expect(mockAdapter.proxy).toHaveBeenCalledWith(
        'GET',
        '/api/v1/agents/attachments/doc1/download',
        { headers: expect.any(Headers), query: '?v=1' },
        ctx,
      );
      expect(result).toBe(mockRes);
    });
  });

  // -----------------------------------------------------------------------
  // 错误传播
  // -----------------------------------------------------------------------

  describe('error propagation', () => {
    it('registry.getCanvasBackendForBackend 抛错时向上传播', async () => {
      const registry = createMockRegistry(mockAdapter);
      registry.getCanvasBackendForBackend = vi.fn().mockImplementation(() => {
        throw new CanvasBackendNotBoundError('tenant-404');
      });
      const s = new CanvasService(registry);

      await expect(s.listCanvas(ctx)).rejects.toThrow(CanvasBackendNotBoundError);
    });

    it('adapter.request 抛错时向上传播', async () => {
      mockAdapter.request = vi.fn().mockRejectedValue(new Error('Upstream 500'));

      await expect(service.listCanvas(ctx)).rejects.toThrow('Upstream 500');
    });
  });
});
