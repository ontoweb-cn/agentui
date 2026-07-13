// Multi-Harness P3 US1: IntellectEnterpriseAdapter 单元测试。
// Constitution Principle VII (Test-First) + V (Tenant Isolation) + VIII (API_SERVER_KEY)。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntellectEnterpriseAdapter } from './intellect-enterprise-adapter';
import {
  IntellectNotFoundError,
  IntellectBackendError,
} from './http-client';
import type { HarnessBackend } from '../../../types/harness';
import type { TenantContext } from '../../../types/tenant';

// Mock httpClient 工厂方法
const httpClientMock = {
  request: vi.fn(),
  requestStream: vi.fn(),
};

vi.mock('./http-client', () => ({
  IntellectEnterpriseHttpClient: vi.fn(() => httpClientMock),
  IntellectNotFoundError: class IntellectNotFoundError extends Error {
    readonly status = 404;
    constructor(m: string) {
      super(m);
      this.name = 'IntellectNotFoundError';
    }
  },
  IntellectBackendError: class IntellectBackendError extends Error {
    readonly status: number;
    constructor(m: string, s: number) {
      super(m);
      this.name = 'IntellectBackendError';
      this.status = s;
    }
  },
}));

const backend: HarnessBackend = {
  id: 'intellect-enterprise-default',
  name: 'Intellect Enterprise Default',
  type: 'intellect-enterprise',
  endpoint: 'http://localhost:8642',
  adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_ADMIN_TOKEN',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: true,
    mcp: true,
    multiTenant: true,
    modelManagement: false,
  },
  adminToken: 'test-api-server-key',
};

const ctx: TenantContext = {
  tenantId: 'tenant-001',
  userId: 'user-001',
  intellectTeamId: 'team-abc',
  intellectProjectId: 'project-xyz',
};

describe('IntellectEnterpriseAdapter', () => {
  let adapter: IntellectEnterpriseAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new IntellectEnterpriseAdapter(backend);
  });

  // -----------------------------------------------------------------------
  // US1: healthCheck / listAgents / discoverCapabilities
  // -----------------------------------------------------------------------

  describe('healthCheck', () => {
    it('GET /health 返回 200 → true', async () => {
      httpClientMock.request.mockResolvedValueOnce({ status: 'ok' });
      const res = await adapter.healthCheck();
      expect(res).toBe(true);
      expect(httpClientMock.request).toHaveBeenCalledWith(
        'GET',
        '/health',
        expect.any(Object),
      );
    });

    it('healthCheck 不抛异常(后端不可达返回 false)', async () => {
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectBackendError('network error', 502),
      );
      const res = await adapter.healthCheck();
      expect(res).toBe(false);
    });

    it('healthCheck 404 也返回 false(不抛异常)', async () => {
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectNotFoundError('/health'),
      );
      const res = await adapter.healthCheck();
      expect(res).toBe(false);
    });
  });

  describe('listAgents', () => {
    it('GET /v1/models 返回 AgentSummary[]', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        data: [
          { id: 'coder', name: 'Coder Agent', description: '编码助手' },
          { id: 'analyst', name: 'Analyst' },
        ],
      });
      const res = await adapter.listAgents(ctx);
      expect(res).toHaveLength(2);
      expect(res[0]).toEqual({
        id: 'coder',
        name: 'Coder Agent',
        description: '编码助手',
      });
    });

    it('后端不可达(网络错误)返回空数组 + 不抛异常', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectBackendError('network', 502),
      );
      const res = await adapter.listAgents(ctx);
      expect(res).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('404 返回空数组 + 不抛异常', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectNotFoundError('/v1/models'),
      );
      const res = await adapter.listAgents(ctx);
      expect(res).toEqual([]);
      warnSpy.mockRestore();
    });
  });

  describe('discoverCapabilities', () => {
    it('GET /v1/capabilities 成功 → 映射为 HarnessCapabilities', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        canvas: false,
        knowledgeBase: false,
        memory: true,
        mcp: true,
        multiTenant: true,
        modelManagement: false,
      });
      const res = await adapter.discoverCapabilities();
      expect(res.multiTenant).toBe(true);
      expect(res.canvas).toBe(false);
    });

    it('404 → 降级返回硬编码默认能力', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectNotFoundError('/v1/capabilities'),
      );
      const res = await adapter.discoverCapabilities();
      // 默认能力(research.md R4)
      expect(res).toEqual({
        canvas: false,
        knowledgeBase: false,
        memory: true,
        mcp: true,
        multiTenant: true,
        modelManagement: false,
      });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // US2: Session CRUD (intellect-team /api/sessions,不嵌套在 agent 下)
  // -----------------------------------------------------------------------

  describe('createSession', () => {
    it('POST /api/sessions 带 title → 返回 Session', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        id: 'sess-1',
        title: '测试会话',
        created_at: '2026-06-26T10:00:00Z',
        updated_at: '2026-06-26T10:00:00Z',
      });
      const res = await adapter.createSession(ctx, 'agent-1', '测试会话');
      expect(res.id).toBe('sess-1');
      expect(res.title).toBe('测试会话');
      expect(res.agentId).toBe('agent-1');
      // body 含 title
      const [, , , body] = httpClientMock.request.mock.calls[0];
      expect(body).toEqual({ title: '测试会话' });
    });

    it('无 title 时 body 为空对象', async () => {
      httpClientMock.request.mockResolvedValueOnce({ id: 'sess-2' });
      await adapter.createSession(ctx, 'agent-1');
      const [, , , body] = httpClientMock.request.mock.calls[0];
      expect(body).toEqual({});
    });
  });

  describe('getSession', () => {
    it('GET /api/sessions/{id} → 返回 Session', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        id: 'sess-1',
        title: 't1',
        created_at: '2026-06-26T10:00:00Z',
        updated_at: '2026-06-26T10:00:00Z',
      });
      const res = await adapter.getSession(ctx, 'agent-1', 'sess-1');
      expect(res.id).toBe('sess-1');
      expect(res.agentId).toBe('agent-1');
    });

    it('404 抛 IntellectNotFoundError(不降级,与 listMessages 不同)', async () => {
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectNotFoundError('/api/sessions/x'),
      );
      await expect(
        adapter.getSession(ctx, 'agent-1', 'nonexistent'),
      ).rejects.toThrow(IntellectNotFoundError);
    });
  });

  describe('deleteSession', () => {
    it('DELETE /api/sessions/{id} → void', async () => {
      httpClientMock.request.mockResolvedValueOnce(undefined);
      await adapter.deleteSession(ctx, 'agent-1', 'sess-1');
      expect(httpClientMock.request).toHaveBeenCalledWith(
        'DELETE',
        '/api/sessions/sess-1',
        ctx,
      );
    });
  });

  describe('listSessions', () => {
    it('GET /api/sessions → 返回 Session[]', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        data: [
          { id: 's1', title: 't1', created_at: '2026-01-01T00:00:00Z' },
          { id: 's2', title: 't2', created_at: '2026-01-02T00:00:00Z' },
        ],
      });
      const res = await adapter.listSessions(ctx, 'agent-1');
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe('s1');
      expect(res[0].agentId).toBe('agent-1');
    });

    it('响应为数组格式也兼容', async () => {
      httpClientMock.request.mockResolvedValueOnce([
        { id: 's1', title: 't1' },
      ]);
      const res = await adapter.listSessions(ctx, 'agent-1');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('s1');
    });
  });

  // -----------------------------------------------------------------------
  // US3: sendMessage (流式对话)
  // -----------------------------------------------------------------------

  describe('sendMessage', () => {
    it('POST /api/sessions/{id}/chat/stream → 返回 StreamIterable', async () => {
      // mock requestStream 返回一个最小 SSE 流(done 事件)
      const sseBytes = new TextEncoder().encode(
        'event: done\ndata: {}\n\n',
      );
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseBytes);
          controller.close();
        },
      });
      httpClientMock.requestStream.mockResolvedValueOnce(mockStream);

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 'sess-1',
        content: '你好',
        agentId: 'agent-1',
      });

      // 验证 requestStream 调用参数
      expect(httpClientMock.requestStream).toHaveBeenCalledWith(
        '/api/sessions/sess-1/chat/stream',
        ctx,
        expect.objectContaining({
          message: '你好',
          agent_id: 'agent-1',
        }),
      );

      // 消费迭代器,应产出 done chunk
      const chunks: unknown[] = [];
      for await (const c of iterable) chunks.push(c);
      expect(chunks).toHaveLength(1);
      expect((chunks[0] as { type: string }).type).toBe('done');
    });

    it('Team/Project 组织隔离头通过 ctx 传入 requestStream(Principle V)', async () => {
      const sseBytes = new TextEncoder().encode('event: done\ndata: {}\n\n');
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseBytes);
          controller.close();
        },
      });
      httpClientMock.requestStream.mockResolvedValueOnce(mockStream);

      await adapter.sendMessage(ctx, {
        sessionId: 'sess-1',
        content: 'hi',
      });

      // ctx 含 intellectTeamId/intellectProjectId,httpClient 内部注入头
      const [, passedCtx] = httpClientMock.requestStream.mock.calls[0];
      expect(passedCtx.intellectTeamId).toBe('team-abc');
      expect(passedCtx.intellectProjectId).toBe('project-xyz');
    });
  });
});
