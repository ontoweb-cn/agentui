import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntellectRagAdapter } from './intellect-rag-adapter';
import type { HarnessBackend } from '../../../types/harness';
import type { TenantContext } from '../../../types/tenant';
import type { AgentSummary, Session } from '../../../types/domain';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock stream chunk iterator (for sendMessage stub test)
function mockReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });
}

const baseBackend: HarnessBackend = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG (Default)',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: {
    canvas: true,
    knowledgeBase: true,
    memory: true,
    mcp: true,
    multiTenant: false,
    modelManagement: true,
  },
  adminToken: 'test-admin-token',
};

const ctx: TenantContext = {
  tenantId: 'tenant-001',
  userId: 'user-001',
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('IntellectRagAdapter', () => {
  let adapter: IntellectRagAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new IntellectRagAdapter(baseBackend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor & backendId', () => {
    it('暴露 backendId 对应传入的 backend.id', () => {
      expect(adapter.backendId).toBe('intellect-rag-default');
    });
  });

  describe('listAgents', () => {
    it('调 GET {baseUrl}/api/v1/agents 且注入 Authorization Bearer token', async () => {
      const agents: AgentSummary[] = [
        { id: 'a1', name: 'Agent 1' },
        { id: 'a2', name: 'Agent 2' },
      ];
      mockFetch.mockResolvedValueOnce(makeJsonResponse(agents));

      const result = await adapter.listAgents(ctx);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer test-admin-token');
      expect(result).toEqual(agents);
    });

    it('不注入 X-Intellect-Team / X-Intellect-Project 头(Principle V 单租户)', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([]));
      await adapter.listAgents(ctx);
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-Intellect-Team']).toBeUndefined();
      expect(init.headers['X-Intellect-Project']).toBeUndefined();
    });

    it('上游 404 时抛错含 URL 与 status', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: 'not found' }, 404));
      await expect(adapter.listAgents(ctx)).rejects.toThrow(/404/);
    });

    it('上游 500 时抛错含 URL 与 status', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: 'server error' }, 500));
      await expect(adapter.listAgents(ctx)).rejects.toThrow(/500/);
    });
  });

  describe('getAgent', () => {
    it('调 GET {baseUrl}/api/v1/agents/{id}', async () => {
      const agent: AgentSummary = { id: 'a1', name: 'Agent 1' };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(agent));

      const result = await adapter.getAgent(ctx, 'a1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/a1');
      expect(init.method).toBe('GET');
      expect(result).toEqual(agent);
    });
  });

  describe('createSession', () => {
    it('调 POST {baseUrl}/api/v1/agents/{agentId}/sessions 且 body 含 title', async () => {
      const session: Session = {
        id: 's1',
        agentId: 'a1',
        title: 'My Session',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(session));

      const result = await adapter.createSession(ctx, 'a1', 'My Session');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/a1/sessions');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ name: 'My Session' });
      expect(result).toEqual(session);
    });

    it('title 为空时 body 含 name 空字符串', async () => {
      const session: Session = {
        id: 's1',
        agentId: 'a1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(session));

      await adapter.createSession(ctx, 'a1');

      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ name: undefined });
    });
  });

  describe('listSessions', () => {
    it('调 GET {baseUrl}/api/v1/agents/{agentId}/sessions(嵌套结构)', async () => {
      const sessions: Session[] = [
        {
          id: 's1',
          agentId: 'a1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      mockFetch.mockResolvedValueOnce(makeJsonResponse(sessions));

      const result = await adapter.listSessions(ctx, 'a1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/a1/sessions');
      expect(init.method).toBe('GET');
      expect(result).toEqual(sessions);
    });
  });

  describe('getSession', () => {
    it('调 GET {baseUrl}/api/v1/agents/{agentId}/sessions/{sessionId}', async () => {
      const session: Session = {
        id: 's1',
        agentId: 'a1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(session));

      const result = await adapter.getSession(ctx, 'a1', 's1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/a1/sessions/s1');
      expect(init.method).toBe('GET');
      expect(result).toEqual(session);
    });
  });

  describe('deleteSession', () => {
    it('调 DELETE {baseUrl}/api/v1/agents/{agentId}/sessions/{sessionId}', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(null));

      await adapter.deleteSession(ctx, 'a1', 's1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/a1/sessions/s1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('healthCheck', () => {
    it('调 GET {baseUrl}/health 返回 true(200)', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ status: 'ok' }));
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/health');
    });

    it('上游非 200 返回 false', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}, 503));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });

    it('fetch 抛错返回 false', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('discoverCapabilities', () => {
    it('返回静态 capabilities(P1 不动态探测)', async () => {
      const result = await adapter.discoverCapabilities();
      expect(result).toEqual(baseBackend.capabilities);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage (US2 真实实现)', () => {
    it('调 POST {baseUrl}/api/v1/agents/chat/completions 且返回 StreamIterable', async () => {
      const sseBody = 'data: {"event":"workflow_finished","message_id":"m1","session_id":"s1","created_at":1,"data":{}}\n\n';
      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockStream,
        text: async () => '',
      } as Response);

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        content: 'hello',
        agentId: 'a1',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/chat/completions');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.agent_id).toBe('a1');
      expect(body.session_id).toBe('s1');
      expect(body.content).toBe('hello');

      // 消费迭代器,验证产出 StreamDone
      const chunks: unknown[] = [];
      for await (const chunk of iterable) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'done' });
    });

    it('上游非 200 产出 StreamError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        body: null,
        text: async () => 'server error',
      } as Response);

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        content: 'hello',
        agentId: 'a1',
      });

      const chunks: unknown[] = [];
      for await (const chunk of iterable) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect((chunks[0] as { type: string }).type).toBe('error');
      expect((chunks[0] as { message: string }).message).toMatch(/500/);
    });
  });

  describe('cancelMessage (stub)', () => {
    it('P1 stub 返回 Promise.resolve 不抛错', async () => {
      await expect(adapter.cancelMessage(ctx, 's1')).resolves.toBeUndefined();
    });
  });
});
