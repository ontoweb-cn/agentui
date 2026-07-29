import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesAdapter } from './hermes-adapter';
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
  id: 'hermes-default',
  name: 'Hermes (Default)',
  type: 'hermes',
  endpoint: 'http://127.0.0.1:8642',
  adminTokenEnvVar: 'HERMES_TOKEN',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: true,
    mcp: true,
    multiTenant: false,
    modelManagement: false,
  },
  adminToken: 'test-hermes-token',
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

describe('HermesAdapter', () => {
  let adapter: HermesAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new HermesAdapter(baseBackend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor & identity', () => {
    it('暴露 backendId', () => {
      expect(adapter.backendId).toBe('hermes-default');
    });

    it('adapterKind 为 harness-core', () => {
      expect(adapter.adapterKind).toBe('harness-core');
    });
  });

  describe('listAgents', () => {
    it('返回默认 agent，modelId 为 hermes', async () => {
      const agents = await adapter.listAgents(ctx);
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('hermes');
      expect(agents[0].name).toBe('hermes');
    });
  });

  describe('sendMessage (doChat)', () => {
    it('调用 /v1/chat/completions，model=hermes', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          body: mockOpenAIStream([
            { data: { choices: [{ delta: { content: 'Hi' } }] } },
            { done: true },
          ]),
        }),
      );

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        content: 'hello',
      });

      const chunks: unknown[] = [];
      for await (const c of iterable) chunks.push(c);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8642/v1/chat/completions');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('hermes');
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);

      // 评审 S5 修复:验证 Authorization 头
      expect(init.headers.get('Authorization')).toBe('Bearer test-hermes-token');

      expect(chunks[0]).toMatchObject({ type: 'delta', content: 'Hi' });
      expect((chunks[chunks.length - 1] as { type: string }).type).toBe('done');
    });

    it('500 响应抛错', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ok: false, status: 500, text: 'err' }),
      );
      await expect(
        adapter.sendMessage(ctx, { sessionId: 's1', content: 'hi' }),
      ).rejects.toThrow(/500/);
    });

    it('网络错误时抛错', async () => {
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
    });

    it('401 时 false', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ok: false, status: 401 }),
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
      expect(caps.canvas).toBe(false);
    });
  });

  describe('session lifecycle', () => {
    it('createSession + listSessions + deleteSession', async () => {
      const s = await adapter.createSession(ctx, 'hermes', 'T');
      expect(await adapter.listSessions(ctx, 'hermes')).toHaveLength(1);
      await adapter.deleteSession(ctx, 'hermes', s.id);
      expect(await adapter.listSessions(ctx, 'hermes')).toHaveLength(0);
    });

    it('updateSession 修改 title(评审 Q5 修复:补齐)', async () => {
      const created = await adapter.createSession(ctx, 'hermes', 'Old');
      const updated = await adapter.updateSession(ctx, 'hermes', created.id, { title: 'New' });
      expect(updated.title).toBe('New');
    });

    it('getSessionMessages 返回空数组(评审 Q5 修复:补齐)', async () => {
      const msgs = await adapter.getSessionMessages(ctx, 'hermes', 's1');
      expect(msgs).toEqual([]);
    });
  });

  describe('cancelMessage', () => {
    it('no-op 不抛错(评审 Q4 修复:补齐)', async () => {
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
