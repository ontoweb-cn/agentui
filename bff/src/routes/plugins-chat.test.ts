/**
 * 插件 chat 路由测试(plugins-chat.ts,chat SDK P1+P2):
 * - 能力门控(鉴权 401 / capabilities 403 / 停用断路 404 / 未安装 404 / 503);
 * - 快乐路径:会话标题前缀、sendMessage 透传(含 model_id)、帧协议;
 * - P2:审批(runId 归属校验)/ 澄清 / 历史。
 * 守卫链与生产挂载一致(测试环境企业 flag 关闭,authMiddleware 走
 * Authorization 分支);接线模式仿 bff-agents.test.ts。
 */
import { Hono } from 'hono';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { IHarnessAdapter } from '../types/adapter';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import { registerRun } from '../services/run-registry';
import { authMiddleware } from '../middleware/auth';
import { backendContextMiddleware } from '../middleware/backend-context';
import { requireValidImtSession } from '../middleware/imt-session-guard';

let api: typeof import('./plugins-chat');
let pluginsApi: typeof import('./plugins');
let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'agentui-plugins-chat-test-'));
  process.env.BFF_PLUGINS_DIR = fixtureDir;
  process.env.BFF_PLUGIN_STATE_FILE = join(fixtureDir, 'plugin-state.json');
  process.env.BFF_PLUGIN_AUDIT_FILE = join(fixtureDir, 'plugin-audit.jsonl');
  process.env.BFF_PLUGIN_INSTALL_TOKEN = 'test-admin-token';
  // 先加载 plugin-store/plugins(状态目录 env 求值),再加载 chat 路由;
  // enable/disable 管理操作在 pluginsRoutes 上,chat 在 pluginsChatRoutes 上
  pluginsApi = await import('./plugins');
  api = await import('./plugins-chat');

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

function createFakeAdapter(extra: Record<string, unknown> = {}): IHarnessAdapter {
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
    ...extra,
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
  app.route('/', api.pluginsChatRoutes as never);
  return app;
}

describe('插件 chat 能力门控(P1)', () => {
  const authHeaders = {
    Authorization: 'rag-jwt',
    'Content-Type': 'application/json',
  };
  const adminHeaders = { 'X-Plugin-Admin-Token': 'test-admin-token' };

  it('未携带鉴权 → 401(守卫链挂在 chat 子路径)', async () => {
    const res = await api.pluginsChatRoutes.request(
      '/plugins/chat-app/chat/sessions',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(res.status).toBe(401);
  });

  it('未声明 chat 能力 → 403(逐请求校验)', async () => {
    // 无 capabilities 的插件(直接落盘,绕过 install)
    const dir = join(fixtureDir, 'plain-plugin');
    await mkdir(join(dir, 'ui/dist'), { recursive: true });
    await writeFile(
      join(dir, 'app.json'),
      JSON.stringify({
        id: 'plain-plugin',
        path: '/plain-plugin',
        label: 'x',
        entry: 'ui/dist/index.js',
      }),
    );
    await writeFile(join(dir, 'ui/dist/index.js'), 'export {}');

    const res = await api.pluginsChatRoutes.request('/plugins/plain-plugin/chat/sessions', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('未声明 chat 能力');
  });

  it('停用插件 chat 通道 404(断路覆盖 chat);未安装插件 404', async () => {
    await pluginsApi.pluginsRoutes.request('/plugins/chat-app/disable', {
      method: 'POST',
      headers: adminHeaders,
    });
    const disabled = await api.pluginsChatRoutes.request(
      '/plugins/chat-app/chat/completions',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ session_id: 's', content: 'x' }),
      },
    );
    expect(disabled.status).toBe(404);
    await pluginsApi.pluginsRoutes.request('/plugins/chat-app/enable', {
      method: 'POST',
      headers: adminHeaders,
    });

    const missing = await api.pluginsChatRoutes.request('/plugins/ghost/chat/sessions', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });
    expect(missing.status).toBe(404);
  });

  it('通过全部门控后进入 adapter 解析(测试 harness 无 registry → 503)', async () => {
    const res = await api.pluginsChatRoutes.request('/plugins/chat-app/chat/sessions', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: number }).code).toBe(503);
  });
});

describe('插件 chat 路由(P1 快乐路径)', () => {
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
    app.route('/', api.pluginsChatRoutes as never);
    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 's1', content: 'hi' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: number }).code).toBe(503);
  });
});

describe('插件 chat P2(审批/澄清/历史)', () => {
  const authHeaders = {
    Authorization: 'rag-jwt',
    'Content-Type': 'application/json',
  };

  it('chat/runs/:runId/approval:runId 归属校验通过后提交,返回审批结果', async () => {
    const adapter = createFakeAdapter({
      submitApproval: vi.fn(async () => ({ resolved: 1 })),
    });
    const app = createApp(adapter);
    registerRun('run-ok', '0', ''); // completions 流产出 approval_request 时的注册语义

    const res = await app.request('/plugins/chat-app/chat/runs/run-ok/approval', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ choice: 'once' }),
    });
    expect(res.status).toBe(200);
    expect(adapter.submitApproval).toHaveBeenCalledWith(
      expect.anything(),
      'run-ok',
      'once',
    );
    expect(await res.json()).toEqual({ resolved: 1 });
  });

  it('chat/runs/:runId/approval:未注册 runId → 403;非法 choice → 400', async () => {
    const adapter = createFakeAdapter({
      submitApproval: vi.fn(async () => ({ resolved: 1 })),
    });
    const app = createApp(adapter);

    const forbidden = await app.request(
      '/plugins/chat-app/chat/runs/run-ghost/approval',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ choice: 'once' }),
      },
    );
    expect(forbidden.status).toBe(403);

    registerRun('run-choice', '0', '');
    const badChoice = await app.request(
      '/plugins/chat-app/chat/runs/run-choice/approval',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ choice: 'forever' }),
      },
    );
    expect(badChoice.status).toBe(400);
  });

  it('chat/sessions/:sid/clarify:提交澄清答案', async () => {
    const adapter = createFakeAdapter({
      submitClarify: vi.fn(async () => ({ status: 'ok' })),
    });
    const app = createApp(adapter);

    const res = await app.request(
      '/plugins/chat-app/chat/sessions/s1/clarify',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ clarify_id: 'cl-1', answer: '选 A' }),
      },
    );
    expect(res.status).toBe(200);
    expect(adapter.submitClarify).toHaveBeenCalledWith(
      expect.anything(),
      's1',
      'cl-1',
      '选 A',
    );
    expect(await res.json()).toEqual({ code: 0, data: { status: 'ok' } });

    const bad = await app.request('/plugins/chat-app/chat/sessions/s1/clarify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ answer: '缺 clarify_id' }),
    });
    expect(bad.status).toBe(400);
  });

  it('chat/sessions/:sid/history:读取会话消息', async () => {
    const adapter = createFakeAdapter({
      getSessionMessages: vi.fn(async () => [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好,需要什么帮助?' },
      ]),
    });
    const app = createApp(adapter);

    const res = await app.request('/plugins/chat-app/chat/sessions/s1/history', {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(adapter.getSessionMessages).toHaveBeenCalledWith(
      expect.anything(),
      'chat',
      's1',
    );
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(2);
  });
});

describe('插件 chat P3 数据面(模型白名单 + 用量审计)', () => {
  const authHeaders = {
    Authorization: 'rag-jwt',
    'Content-Type': 'application/json',
  };

  afterEach(() => {
    delete process.env.BFF_PLUGIN_CHAT_ALLOWED_MODELS;
  });

  async function readAuditLines(): Promise<Array<Record<string, unknown>>> {
    let raw: string;
    try {
      raw = await readFile(join(fixtureDir, 'plugin-audit.jsonl'), 'utf-8');
    } catch {
      return []; // 首次写入前文件不存在是正常形态
    }
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** 审计写入是 fire-and-forget promise;且更早测试未消费的响应流也会延迟
   * 落盘同类行——必须按谓词等待**目标行**出现,任何"有行就返回"的判定都会
   * 被旧行提前满足(已踩坑:2ms 即返回导致断言读到旧行)。 */
  async function waitForChatCompletionAudit(
    match: (line: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown> | undefined> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const mine = (await readAuditLines()).find(match);
      if (mine) {
        return mine;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return undefined;
  }

  it('白名单命中 → 200 且 model_id 透传(逗号分隔 + 空格容错)', async () => {
    process.env.BFF_PLUGIN_CHAT_ALLOWED_MODELS = 'deepseek-chat, qwen-max';
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
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelId: 'deepseek-chat' }),
    );
  });

  it('白名单未命中(model_id 与 modelId 两种写法)→ 403 且不触达 adapter', async () => {
    process.env.BFF_PLUGIN_CHAT_ALLOWED_MODELS = 'deepseek-chat';
    const adapter = createFakeAdapter();
    const app = createApp(adapter);

    const snake = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        session_id: 's1',
        content: '你好',
        model_id: 'gpt-x',
      }),
    });
    expect(snake.status).toBe(403);
    expect(await snake.text()).toContain('BFF_PLUGIN_CHAT_ALLOWED_MODELS');

    const camel = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        session_id: 's1',
        content: '你好',
        modelId: 'gpt-x',
      }),
    });
    expect(camel.status).toBe(403);
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  it('白名单设置但未传 model_id → 放行(走部署默认模型,不受名单约束)', async () => {
    process.env.BFF_PLUGIN_CHAT_ALLOWED_MODELS = 'deepseek-chat';
    const adapter = createFakeAdapter();
    const app = createApp(adapter);

    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 's1', content: '你好' }),
    });
    expect(res.status).toBe(200);
    const call = (adapter.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as { modelId?: string };
    expect(call?.modelId).toBeUndefined();
  });

  it('完整流结束后落 chat_completion 审计(含 pluginId/session/model/usage)', async () => {
    const adapter = createFakeAdapter();
    const app = createApp(adapter);

    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        session_id: 's-audit-full',
        content: '你好',
        model_id: 'deepseek-chat',
      }),
    });
    expect(res.status).toBe(200);
    await res.text(); // 消费完整流,触发生成器 finally 落审计

    // 早期测试未消费的响应流其审计行可能延迟落盘,故按唯一 sessionId 定位本行
    const mine = await waitForChatCompletionAudit(
      (l) => l.sessionId === 's-audit-full',
    );
    expect(mine).toMatchObject({
      pluginId: 'chat-app',
      model: 'deepseek-chat',
      usage: { promptTokens: 1, completionTokens: 2 },
    });
  });

  it('流中断(上游抛错)→ 仍落审计,usage 为 null', async () => {
    const adapter = createFakeAdapter({
      sendMessage: vi.fn(async () =>
        (async function* () {
          yield { type: 'delta', content: 'x' };
          throw new Error('upstream boom');
        })(),
      ),
    });
    const app = createApp(adapter);

    const res = await app.request('/plugins/chat-app/chat/completions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: 's-audit-abort', content: '你好' }),
    });
    expect(res.status).toBe(200); // SSE 通道本身建立,错误以 error 帧传递
    expect(await res.text()).toContain('"error"');

    const mine = await waitForChatCompletionAudit(
      (l) => l.sessionId === 's-audit-abort',
    );
    expect(mine).toMatchObject({
      pluginId: 'chat-app',
      model: null,
      usage: null,
    });
  });
});
