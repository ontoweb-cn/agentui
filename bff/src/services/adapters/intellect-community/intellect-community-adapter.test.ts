import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntellectCommunityAdapter } from './intellect-community-adapter';
import type { HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';

// Mock safeFetch:绕过 SSRF DNS 解析(测试用 127.0.0.1 会被私有 IP 拦截),
// 直接透传给被 mock 的全局 fetch。safeFetch 行为由 ssrf-guard.test.ts 覆盖。
vi.mock('../../ssrf-guard', () => ({
  safeFetch: vi.fn((url: string, options: RequestInit = {}) =>
    fetch(url, options),
  ),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock OpenAI SSE 字节流
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
  id: 'intellect-community-default',
  name: 'Intellect Community (Default)',
  type: 'intellect-community',
  endpoint: 'http://127.0.0.1:8642',
  adminTokenEnvVar: 'INTELLECT_COMMUNITY_TOKEN',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: false,
    mcp: false,
    multiTenant: false,
    modelManagement: false,
  },
  adminToken: 'test-community-token',
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

describe('IntellectCommunityAdapter', () => {
  let adapter: IntellectCommunityAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new IntellectCommunityAdapter(baseBackend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor & identity', () => {
    it('暴露 backendId 对应传入的 backend.id', () => {
      expect(adapter.backendId).toBe('intellect-community-default');
    });

    it('adapterKind 为 harness-core(无扩展能力)', () => {
      expect(adapter.adapterKind).toBe('harness-core');
    });
  });

  describe('listAgents', () => {
    it('返回单个默认 agent，modelId 为 intellect-agent', async () => {
      const agents = await adapter.listAgents(ctx);
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('intellect-agent');
      expect(agents[0].name).toBe('intellect-community');
    });
  });

  describe('getAgent', () => {
    it('返回指定 agentId 的 agent', async () => {
      const agent = await adapter.getAgent(ctx, 'custom-agent');
      expect(agent.id).toBe('custom-agent');
      expect(agent.modelId).toBe('intellect-agent');
    });
  });

  describe('session lifecycle (内存 Map)', () => {
    it('createSession 返回带 UUID 的 session', async () => {
      const s = await adapter.createSession(ctx, 'intellect-agent', 'Test');
      expect(s.id).toBeTruthy();
      expect(s.agentId).toBe('intellect-agent');
      expect(s.title).toBe('Test');
    });

    it('getSession 返回已创建的 session', async () => {
      const created = await adapter.createSession(ctx, 'intellect-agent');
      const got = await adapter.getSession(ctx, 'intellect-agent', created.id);
      expect(got.id).toBe(created.id);
    });

    it('getSession 未找到时抛错', async () => {
      await expect(
        adapter.getSession(ctx, 'intellect-agent', 'nonexistent'),
      ).rejects.toThrow(/Session not found/);
    });

    it('deleteSession 移除 session', async () => {
      const created = await adapter.createSession(ctx, 'intellect-agent');
      await adapter.deleteSession(ctx, 'intellect-agent', created.id);
      await expect(
        adapter.getSession(ctx, 'intellect-agent', created.id),
      ).rejects.toThrow();
    });

    it('updateSession 修改 title', async () => {
      const created = await adapter.createSession(ctx, 'intellect-agent', 'Old');
      const updated = await adapter.updateSession(ctx, 'intellect-agent', created.id, { title: 'New' });
      expect(updated.title).toBe('New');
    });

    it('updateSession 未找到时抛错', async () => {
      await expect(
        adapter.updateSession(ctx, 'intellect-agent', 'nonexistent', { title: 'x' }),
      ).rejects.toThrow(/Session not found/);
    });

    it('getSessionMessages 返回空数组(无持久化)', async () => {
      const msgs = await adapter.getSessionMessages(ctx, 'intellect-agent', 's1');
      expect(msgs).toEqual([]);
    });
  });

  describe('sendMessage (doChat)', () => {
    it('调用 /v1/chat/completions 并返回 parseOpenAISSE 迭代器', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          body: mockOpenAIStream([
            { data: { choices: [{ delta: { content: 'Hello' } }] } },
            { done: true },
          ]),
        }),
      );

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        content: 'hi',
      });

      const chunks: unknown[] = [];
      for await (const c of iterable) chunks.push(c);

      // 第一条 fetch 调用 /v1/chat/completions
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8642/v1/chat/completions');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('intellect-agent');
      expect(body.stream).toBe(true);
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);

      // 评审 S5 修复:验证 Authorization 头注入
      expect(init.headers.get('Authorization')).toBe('Bearer test-community-token');

      // 验证 chunk 流
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0]).toMatchObject({ type: 'delta', content: 'Hello' });
      const last = chunks[chunks.length - 1] as { type: string };
      expect(last.type).toBe('done');
    });

    it('非 200 响应抛错', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ok: false, status: 503, text: 'upstream down' }),
      );
      await expect(
        adapter.sendMessage(ctx, { sessionId: 's1', content: 'hi' }),
      ).rejects.toThrow(/503/);
    });

    it('网络错误时抛错(safeFetch 透传 fetch 异常)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(
        adapter.sendMessage(ctx, { sessionId: 's1', content: 'hi' }),
      ).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('healthCheck', () => {
    it('GET /v1/models 返回 200 时为 true', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}));
      const ok = await adapter.healthCheck();
      expect(ok).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://127.0.0.1:8642/v1/models',
      );
    });

    it('非 200 时为 false', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ok: false, status: 401 }),
      );
      const ok = await adapter.healthCheck();
      expect(ok).toBe(false);
    });

    it('网络错误时为 false', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const ok = await adapter.healthCheck();
      expect(ok).toBe(false);
    });
  });

  describe('discoverCapabilities', () => {
    it('返回传入的 capabilities', async () => {
      const caps = await adapter.discoverCapabilities();
      expect(caps).toEqual(baseBackend.capabilities);
    });
  });

  describe('cancelMessage', () => {
    it('no-op 不抛错', async () => {
      await expect(adapter.cancelMessage(ctx, 's1')).resolves.toBeUndefined();
    });
  });

  // 评审 S4 修复:buildHeaders B3 安全约束测试
  describe('buildHeaders B3 安全约束', () => {
    it('注入 Authorization Bearer token', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          body: mockOpenAIStream([{ done: true }]),
        }),
      );
      await adapter.sendMessage(ctx, { sessionId: 's1', content: 'hi' });
      const init = mockFetch.mock.calls[0][1];
      expect(init.headers.get('Authorization')).toBe('Bearer test-community-token');
    });

    it('强制删除 X-Intellect-* 头(即使 extra 中包含)', async () => {
      // 通过反射访问 protected buildHeaders
      const adapterAny = adapter as unknown as {
        buildHeaders: (extra?: Record<string, string>) => Headers;
      };
      const headers = adapterAny.buildHeaders({
        'X-Intellect-Team': 'evil-team',
        'X-Intellect-User': 'evil-user',
        'X-Intellect-Project': 'evil-project',
        'X-Intellect-Tenant': 'evil-tenant',
        'X-Intellect-Session-Id': 'evil-session',
        'X-Intellect-Session-Key': 'evil-key',
        'X-Custom': 'keep',
      });
      expect(headers.get('X-Intellect-Team')).toBeNull();
      expect(headers.get('X-Intellect-User')).toBeNull();
      expect(headers.get('X-Intellect-Project')).toBeNull();
      expect(headers.get('X-Intellect-Tenant')).toBeNull();
      expect(headers.get('X-Intellect-Session-Id')).toBeNull();
      expect(headers.get('X-Intellect-Session-Key')).toBeNull();
      // 非 X-Intellect- 头保留
      expect(headers.get('X-Custom')).toBe('keep');
    });

    it('空 adminToken 时不设置 Authorization 头(评审 S6)', async () => {
      const noTokenBackend = { ...baseBackend, adminToken: '' };
      const noTokenAdapter = new IntellectCommunityAdapter(noTokenBackend);
      const adapterAny = noTokenAdapter as unknown as {
        buildHeaders: (extra?: Record<string, string>) => Headers;
      };
      const headers = adapterAny.buildHeaders();
      expect(headers.get('Authorization')).toBeNull();
    });
  });
});
