import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntellectRagAdapter } from './intellect-rag-adapter';
import type { HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import type { AgentSummary, Session } from '../../../types/domain';

// Mock ragTokenProvider:避免测试中触发真实 login 流程(会 console.warn 污染输出)
// fetchWithRagToken 会降级到 fallbackStaticToken(即 backend.adminToken)
vi.mock('../../../services/rag-token-provider', () => ({
  ragTokenProvider: {
    login: vi.fn().mockRejectedValue(new Error('not configured in test')),
    getToken: vi.fn().mockReturnValue(null),
    invalidate: vi.fn(),
  },
}));

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

const ctx: BackendContext = {
  backendId: 'tenant-001',
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
      // fetchWithRagToken 内部用 Headers 实例,需用 .get() 访问
      // token 优先级:动态 token(ragTokenProvider,被 mock 抛错)→ fallbackStaticToken(test-admin-token)
      expect(init.headers.get('Authorization')).toBe('Bearer test-admin-token');
      expect(result).toEqual(agents);
    });

    it('不注入 X-Intellect-Team / X-Intellect-Project 头(Principle V 单租户)', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([]));
      await adapter.listAgents(ctx);
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('X-Intellect-Team')).toBeNull();
      expect(init.headers.get('X-Intellect-Project')).toBeNull();
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

  // -------------------------------------------------------------------------
  // spec-008: request() (public) + proxy() (新增)
  // -------------------------------------------------------------------------

  describe('request (spec-008 — public, CanvasService JSON 方法)', () => {
    it('调 GET 返回 JSON', async () => {
      const data = [{ id: 'a1' }];
      mockFetch.mockResolvedValueOnce(makeJsonResponse(data));

      const result = await adapter.request<{ id: string }[]>('GET', '/api/v1/agents');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents');
      expect(init.method).toBe('GET');
      expect(result).toEqual(data);
    });

    it('调 POST 发送 JSON body', async () => {
      const created = { id: 'new-agent' };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(created));

      const result = await adapter.request('POST', '/api/v1/agents', { name: 'test' });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ name: 'test' });
      expect(result).toEqual(created);
    });

    it('DELETE 返回 undefined(204 无 body)', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(null, 204));

      const result = await adapter.request('DELETE', '/api/v1/agents/a1');

      expect(result).toBeUndefined();
    });

    it('上游错误抛错含 URL 与 status', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: 'not found' }, 404));

      await expect(
        adapter.request('GET', '/api/v1/agents/nonexistent'),
      ).rejects.toThrow(/404/);
    });
  });

  describe('proxy (spec-008 — streaming)', () => {
    it('构造正确的 URL(baseUrl + path + query)', async () => {
      const mockResponse = { ok: true, status: 200, headers: new Headers(), body: null } as Response;
      mockFetch.mockResolvedValueOnce(mockResponse);

      const headers = new Headers();
      headers.set('content-type', 'multipart/form-data');
      await adapter.proxy('POST', '/api/v1/agents/a1/upload', {
        headers,
        body: null,
        query: '?overwrite=true',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9380/api/v1/agents/a1/upload?overwrite=true');
    });

    it('覆盖 Authorization 为 adminToken', async () => {
      const mockResponse = { ok: true, status: 200, headers: new Headers(), body: null } as Response;
      mockFetch.mockResolvedValueOnce(mockResponse);

      const headers = new Headers();
      headers.set('authorization', 'Bearer user-token-should-be-overwritten');
      await adapter.proxy('GET', '/api/v1/agents/download', {
        headers,
        query: '',
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('authorization')).toBe('Bearer test-admin-token');
    });

    it('删除 host 头', async () => {
      const mockResponse = { ok: true, status: 200, headers: new Headers(), body: null } as Response;
      mockFetch.mockResolvedValueOnce(mockResponse);

      const headers = new Headers();
      headers.set('host', 'localhost:9391');
      await adapter.proxy('GET', '/api/v1/agents/download', {
        headers,
        query: '',
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('host')).toBeNull();
    });

    it('返回上游 Response 原样(不消费 body)', async () => {
      const upstreamHeaders = new Headers();
      upstreamHeaders.set('content-type', 'application/octet-stream');
      const mockResponse = {
        ok: true,
        status: 200,
        headers: upstreamHeaders,
        body: new ReadableStream(),
      } as Response;
      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await adapter.proxy('GET', '/api/v1/agents/attachments/doc1/download', {
        headers: new Headers(),
        query: '',
      });

      expect(result).toBe(mockResponse);
      expect(result.status).toBe(200);
      expect(result.headers.get('content-type')).toBe('application/octet-stream');
    });

    it('没有 adminToken 时不设置 Authorization', async () => {
      const backendNoToken = { ...baseBackend, adminToken: '' };
      const adapterNoToken = new IntellectRagAdapter(backendNoToken);
      const mockResponse = { ok: true, status: 200, headers: new Headers(), body: null } as Response;
      mockFetch.mockResolvedValueOnce(mockResponse);

      const headers = new Headers();
      await adapterNoToken.proxy('GET', '/api/v1/agents/download', {
        headers,
        query: '',
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('authorization')).toBeNull();
    });
  });
});
