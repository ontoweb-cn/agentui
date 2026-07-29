import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentScopeAdapter } from './agent-scope-adapter';
import type { HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';

// Mock safeFetch:绕过 SSRF DNS 解析(测试用 127.0.0.1 会被私有 IP 拦截)
vi.mock('../../ssrf-guard', () => ({
  safeFetch: vi.fn((url: string, options: RequestInit = {}) =>
    fetch(url, options),
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockOpenAIStream(
  chunks: Array<{ data?: unknown; done?: boolean }>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames: string[] = [];
  for (const c of chunks) {
    if (c.done) {
      frames.push('data: [DONE]\n\n');
    } else if (c.data) {
      frames.push(`data: ${JSON.stringify(c.data)}\n\n`);
    }
  }
  return new ReadableStream({
    start(controller) {
      frames.forEach((f) => controller.enqueue(encoder.encode(f)));
      controller.close();
    },
  });
}

const baseBackend: HarnessBackend = {
  id: 'agent-scope-default',
  name: 'AgentScope (Default)',
  type: 'agent-scope',
  endpoint: 'http://127.0.0.1:5000',
  adminTokenEnvVar: 'AGENT_SCOPE_TOKEN',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: true,
    mcp: true,
    multiTenant: false,
    modelManagement: false,
  },
  adminToken: 'test-scope-token',
};

const ctx: BackendContext = {
  backendId: 'tenant-001',
  userId: 'user-001',
};

function makeResponse(opts: {
  ok?: boolean;
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
  text?: string;
}): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    body: opts.body ?? null,
    text: async () => opts.text ?? '',
  } as Response;
}

describe('AgentScopeAdapter', () => {
  let adapter: AgentScopeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AgentScopeAdapter(baseBackend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor & identity', () => {
    it('暴露 backendId', () => {
      expect(adapter.backendId).toBe('agent-scope-default');
    });

    it('adapterKind 为 harness-core', () => {
      expect(adapter.adapterKind).toBe('harness-core');
    });
  });

  describe('listAgents', () => {
    it('返回默认 agent，modelId 为 agent-scope', async () => {
      const agents = await adapter.listAgents(ctx);
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-scope');
    });
  });

  describe('sendMessage (doChat)', () => {
    it('调用 /v1/chat/completions，model=agent-scope，endpoint=5000', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          body: mockOpenAIStream([
            { data: { choices: [{ delta: { content: 'A' } }] } },
            { done: true },
          ]),
        }),
      );

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        content: 'q',
      });

      const chunks: unknown[] = [];
      for await (const c of iterable) chunks.push(c);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:5000/v1/chat/completions');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('agent-scope');

      // 评审 S5 修复:验证 Authorization 头
      expect(init.headers.get('Authorization')).toBe('Bearer test-scope-token');

      expect(chunks[0]).toMatchObject({ type: 'delta', content: 'A' });
    });

    it('404 响应抛错', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ok: false, status: 404, text: 'nf' }),
      );
      await expect(
        adapter.sendMessage(ctx, { sessionId: 's1', content: 'hi' }),
      ).rejects.toThrow(/404/);
    });

    it('网络错误时抛错(评审 Q4 修复:补齐)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(
        adapter.sendMessage(ctx, { sessionId: 's1', content: 'hi' }),
      ).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('healthCheck', () => {
    it('200 时 true', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}));
      expect(await adapter.healthCheck()).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://127.0.0.1:5000/v1/models',
      );
    });

    it('非 200 时 false(评审 Q4 修复:补齐)', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ok: false, status: 500 }),
      );
      expect(await adapter.healthCheck()).toBe(false);
    });

    it('网络错误时 false(评审 Q4 修复:补齐)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await adapter.healthCheck()).toBe(false);
    });
  });

  describe('discoverCapabilities', () => {
    it('返回 memory+mcp=true', async () => {
      const caps = await adapter.discoverCapabilities();
      expect(caps.memory).toBe(true);
      expect(caps.mcp).toBe(true);
    });
  });

  describe('session lifecycle(评审 Q5 修复:补齐)', () => {
    it('createSession + listSessions + deleteSession', async () => {
      const s = await adapter.createSession(ctx, 'agent-scope', 'T');
      expect(await adapter.listSessions(ctx, 'agent-scope')).toHaveLength(1);
      await adapter.deleteSession(ctx, 'agent-scope', s.id);
      expect(await adapter.listSessions(ctx, 'agent-scope')).toHaveLength(0);
    });

    it('updateSession 修改 title', async () => {
      const created = await adapter.createSession(ctx, 'agent-scope', 'Old');
      const updated = await adapter.updateSession(ctx, 'agent-scope', created.id, { title: 'New' });
      expect(updated.title).toBe('New');
    });

    it('getSessionMessages 返回空数组', async () => {
      const msgs = await adapter.getSessionMessages(ctx, 'agent-scope', 's1');
      expect(msgs).toEqual([]);
    });
  });

  describe('cancelMessage(评审 Q4 修复:补齐)', () => {
    it('no-op 不抛错', async () => {
      await expect(adapter.cancelMessage(ctx, 's1')).resolves.toBeUndefined();
    });
  });

  // 评审 S4 修复:buildHeaders B3 安全约束测试
  describe('buildHeaders B3 安全约束', () => {
    it('强制删除 X-Intellect-* 头', () => {
      const adapterAny = adapter as unknown as {
        buildHeaders: (extra?: Record<string, string>) => Headers;
      };
      const headers = adapterAny.buildHeaders({
        'X-Intellect-Team': 'evil',
        'X-Custom': 'keep',
      });
      expect(headers.get('X-Intellect-Team')).toBeNull();
      expect(headers.get('X-Custom')).toBe('keep');
    });
  });
});
