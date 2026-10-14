/**
 * 插件 chat 路由快乐路径测试(chat SDK P1,docs/chat-sse-sdk-design.md §4.2):
 * 完整守卫链 + 假 adapter(registry 直返),验证——
 * - 会话标题前缀 plugin:<id>:(归因,设计 R1 缓解);
 * - sendMessage 请求透传(sessionId/content/agentId='chat');
 * - SSE 帧协议与宿主 /agents/chat/completions 完全一致(streamChunksAsSSE 复用)。
 * 接线模式仿 bff-agents.test.ts(变量注入中间件 + 子 app 挂载)。
 */
import { Hono } from 'hono';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IHarnessAdapter } from '../types/adapter';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import { authMiddleware } from '../middleware/auth';
import { backendContextMiddleware } from '../middleware/backend-context';
import { requireValidImtSession } from '../middleware/imt-session-guard';

let api: typeof import('./plugins');
let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'agentui-plugins-chat-test-'));
  process.env.BFF_PLUGINS_DIR = fixtureDir;
  process.env.BFF_PLUGIN_STATE_FILE = join(fixtureDir, 'plugin-state.json');
  process.env.BFF_PLUGIN_AUDIT_FILE = join(fixtureDir, 'plugin-audit.jsonl');
  process.env.BFF_PLUGIN_INSTALL_TOKEN = 'test-admin-token';
  api = await import('./plugins');

  const dir = join(fixtureDir, 'chat-app');
  await mkdir(join(dir, 'ui/dist'), { recursive: true });
  await writeFile(
    join(dir, 'app.json'),
    JSON.stringify({
      id: 'chat-app',
      path: '/chat-app',
      label: 'chat 插件',
      entry: 'ui/dist/index.js',
      capabilities: ['chat'],
    }),
  );
  await writeFile(join(dir, 'ui/dist/index.js'), 'export {}');
});

afterAll(async () => {
  delete process.env.BFF_PLUGINS_DIR;
  delete process.env.BFF_PLUGIN_STATE_FILE;
  delete process.env.BFF_PLUGIN_AUDIT_FILE;
  delete process.env.BFF_PLUGIN_INSTALL_TOKEN;
  await rm(fixtureDir, { recursive: true, force: true });
});

function createFakeAdapter(): IHarnessAdapter {
  return {
    backendId: 'b1',
    adapterKind: 'multi-tenant' as const,
    createSession: vi.fn(
      async (_ctx: unknown, agentId: string, title?: string) => ({
        id: 'gw-session-1',
        agentId,
        title,
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z',
      }),
    ),
    sendMessage: vi.fn(async () => {
      // 与宿主 chat 相同的 StreamChunk 序列(≠ SSE 帧,帧由 streamChunksAsSSE 重序列化)
      async function* gen() {
        yield { type: 'delta', content: '你' };
        yield { type: 'delta', content: '好' };
        yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 2 } };
        yield { type: 'done' };
      }
      return gen();
    }),
  } as unknown as IHarnessAdapter;
}

function createApp(adapter: IHarnessAdapter) {
  const registry = {
    getAdapterForBackend: vi.fn(() => adapter),
    isReady: vi.fn(() => true),
  } as unknown as IAdapterRegistry;
  type TestVariables = {
    adapterRegistry: IAdapterRegistry;
    backendStore: unknown;
    harnessStore: unknown;
  };
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('adapterRegistry', registry);
    c.set('backendStore', { getBackend: vi.fn(() => undefined) } as never);
    c.set('harnessStore', { get: vi.fn(() => undefined) } as never);
    await next();
  });
  // 守卫链与生产挂载一致(flag 关闭时 authSessionMiddleware 不在 chatGuards 内)
  app.use('/plugins/:id/chat/*', authMiddleware);
  app.use('/plugins/:id/chat/*', requireValidImtSession);
  app.use('/plugins/:id/chat/*', backendContextMiddleware);
  app.route('/', api.pluginsRoutes as never);
  return app;
}

describe('插件 chat 路由(chat SDK P1 快乐路径)', () => {
  const authHeaders = {
    Authorization: 'rag-jwt',
    'Content-Type': 'application/json',
  };

  it('chat/sessions:标题强制 plugin:<id>: 前缀,返回 gateway 会话', async () => {
    const adapter = createFakeAdapter();
    const app = createApp(adapter);

    const res = await app.request('/plugins/chat-app/chat/sessions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: '推演会话' }),
    });
    expect(res.status).toBe(200);
    expect(adapter.createSession).toHaveBeenCalledWith(
      expect.anything(),
      'chat',
      'plugin:chat-app:推演会话',
    );
    expect(await res.json()).toMatchObject({
      id: 'gw-session-1',
      title: 'plugin:chat-app:推演会话',
    });
  });

  it('chat/completions:请求透传 adapter(含 model_id),帧协议与宿主 chat 一致', async () => {
    const adapter = createFakeAdapter();
    const app = createApp(adapter);

    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        session_id: 's1',
        content: '你好',
        model_id: 'deepseek-chat',
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 's1',
        content: '你好',
        agentId: 'chat',
        modelId: 'deepseek-chat',
      }),
    );

    // 帧序列:delta×2 → message;usage → message_end;done → workflow_finished
    const frames = (await res.text())
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    expect(frames).toEqual([
      { event: 'message', data: { content: '你', answer: '你' } },
      { event: 'message', data: { content: '好', answer: '好' } },
      {
        event: 'message_end',
        data: { usage: { promptTokens: 1, completionTokens: 2 } },
      },
      { event: 'workflow_finished', data: true },
    ]);
  });

  it('chat/sessions:超长 title 截断到 200 字符(含 plugin: 前缀,评审 P3)', async () => {
    const adapter = createFakeAdapter();
    const app = createApp(adapter);

    await app.request('/plugins/chat-app/chat/sessions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'x'.repeat(500) }),
    });
    const passedTitle = (adapter.createSession as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[2] as string;
    expect(passedTitle.startsWith('plugin:chat-app:')).toBe(true);
    expect(passedTitle.length).toBe(200);
  });

  it('缺 content/session_id → 400', async () => {
    const app = createApp(createFakeAdapter());
    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 's1' }),
    });
    expect(res.status).toBe(400);
  });

  it('chat/completions:无 adapter(裸 app 无 registry)→ 503', async () => {
    // 不注入 harnessStore/adapterRegistry 变量:守卫链照常放行(flag 关闭),
    // getAdapter 返回 null → 与宿主 /agents/chat/completions 同语义 503
    const app = new Hono();
    app.use('/plugins/:id/chat/*', authMiddleware);
    app.use('/plugins/:id/chat/*', requireValidImtSession);
    app.use('/plugins/:id/chat/*', backendContextMiddleware);
    app.route('/', api.pluginsRoutes as never);
    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 's1', content: 'hi' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: number }).code).toBe(503);
  });
});
