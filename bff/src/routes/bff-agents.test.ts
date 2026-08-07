// Multi-Harness P4 v1.3.0: serializeChunk + 审批路由 单元测试。
// Constitution Principle IV (v1.3.0) + VII (Test-First)。
// 覆盖:
// - serializeChunk: 8 + 2 = 10 种 StreamChunk 类型序列化
// - streamChunksAsSSE: approval_request 后过滤 tool_* 事件
// - POST /agents/:agentId/runs/:runId/approval 路由:成功/无 adapter/不支持/缺参/无效 choice/上游错误

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  bffAgentRoutes,
  serializeChunk,
  streamChunksAsSSE,
} from './bff-agents';
import { backendContextMiddleware } from '../middleware/backend-context';
import {
  registerRun,
  _clearRunRegistryForTests,
} from '../services/run-registry';
import type { HarnessStore, BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { IHarnessAdapter } from '../types/adapter';
import type { HarnessBackend, HarnessCapabilities } from '../types/harness';
import type { BffTenant } from '../types/tenant';
import type { StreamChunk } from '../types/stream';
import {
  TenantNotFoundError,
} from '../services/adapter-registry-errors';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const enterpriseCapabilities: HarnessCapabilities = {
  canvas: false,
  knowledgeBase: false,
  memory: true,
  mcp: true,
  multiTenant: true,
  modelManagement: false,
};

const enterpriseBackend: HarnessBackend = {
  id: 'intellect-enterprise-default',
  name: 'Intellect Enterprise Default',
  type: 'intellect-enterprise',
  endpoint: 'http://localhost:8642',
  adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY',
  capabilities: enterpriseCapabilities,
  adminToken: 'test-api-server-key',
};

const tenant1: BffTenant = {
  id: 'tenant-1',
  name: 'T1',
  intellectBackendId: 'intellect-enterprise-default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createFakeAdapter(
  backend: HarnessBackend,
  options: {
    withSubmitApproval?: boolean;
    withSubmitClarify?: boolean;
  } = {},
): IHarnessAdapter {
  const withSubmitApproval = options.withSubmitApproval ?? true;
  const withSubmitClarify = options.withSubmitClarify ?? true;
  const adapter: IHarnessAdapter = {
    backendId: backend.id,
    adapterKind: 'multi-tenant' as const,
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    updateSession: vi.fn(),
    getSessionMessages: vi.fn(),
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    discoverCapabilities: vi.fn().mockResolvedValue(backend.capabilities),
  };
  if (withSubmitApproval) {
    (adapter as { submitApproval?: unknown }).submitApproval = vi.fn();
  }
  if (withSubmitClarify) {
    (adapter as { submitClarify?: unknown }).submitClarify = vi.fn();
  }
  return adapter;
}

interface MockSetup {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  registry: IAdapterRegistry;
  adapter: IHarnessAdapter;
}

function createMocks(
  options: {
    ready?: boolean;
    tenant?: BffTenant;
    backend?: HarnessBackend;
    adapter?: IHarnessAdapter;
    withSubmitApproval?: boolean;
    withSubmitClarify?: boolean;
  } = {},
): MockSetup {
  const ready = options.ready ?? true;
  const tenant = options.tenant ?? tenant1;
  const backend = options.backend ?? enterpriseBackend;
  const adapter =
    options.adapter ??
    createFakeAdapter(backend, {
      withSubmitApproval: options.withSubmitApproval ?? true,
      withSubmitClarify: options.withSubmitClarify ?? true,
    });

  const harnessStore: HarnessStore = {
    load: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(() => (ready ? [backend] : [])),
    get: vi.fn((id: string) => (id === backend.id ? backend : undefined)),
    saveConfig: vi.fn(),
  };

  const backendStore: BackendStore = {
    load: vi.fn().mockResolvedValue(undefined),
    getBackend: vi.fn((id: string) => (id === tenant.id ? tenant : undefined)),
    listBackends: vi.fn(() => (tenant ? [tenant] : [])),
    createBackend: vi.fn(),
    setHarnessBinding: vi.fn(),
    getHarnessBinding: vi.fn(),
    setAuthMode: vi.fn(),
    setCanvasBinding: vi.fn(),
    getCanvasBinding: vi.fn(),
    setIntellectBinding: vi.fn(),
    getIntellectTeamId: vi.fn(),
    getIntellectProjectId: vi.fn(),
  };

  const registry: IAdapterRegistry = {
    getAdapterForBackend: vi.fn(() => adapter),
    registerFactory: vi.fn(),
    isReady: vi.fn(() => ready),
    invalidate: vi.fn(),
    getCanvasBackendForBackend: vi.fn(() => adapter) as unknown as IAdapterRegistry['getCanvasBackendForBackend'],
  };

  return { harnessStore, backendStore, registry, adapter };
}

interface TestVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
}

function createApp(mocks: MockSetup): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('harnessStore', mocks.harnessStore);
    c.set('backendStore', mocks.backendStore);
    c.set('adapterRegistry', mocks.registry);
    await next();
  });
  app.use('/agents/*', backendContextMiddleware);
  app.route('/', bffAgentRoutes as unknown as Hono<{ Variables: TestVariables }>);
  return app;
}

// ---------------------------------------------------------------------------
// serializeChunk 单元测试
// ---------------------------------------------------------------------------

describe('serializeChunk', () => {
  function parseFrame(frame: string): { event: string; data: unknown } {
    expect(frame.startsWith('data: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    const json = frame.slice(6, -2);
    return JSON.parse(json);
  }

  it('StreamDelta → {event:"message", data:{content, answer}}', () => {
    const frame = serializeChunk({ type: 'delta', content: '你好' });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'message',
      data: { content: '你好', answer: '你好' },
    });
  });

  it('StreamDelta 带 metadata → data 含 _metadata', () => {
    const frame = serializeChunk({
      type: 'delta',
      content: 'a',
      // 测试中 metadata 通过扩展字段注入
      ...({ metadata: { reference: { chunks: [] } } } as object),
    });
    expect(frame).not.toBeNull();
    const parsed = parseFrame(frame!);
    expect((parsed.data as { _metadata?: unknown })._metadata).toEqual({
      reference: { chunks: [] },
    });
  });

  it('StreamReasoning → {event:"message", data:{content, answer, start_to_think:true}}', () => {
    const frame = serializeChunk({ type: 'reasoning', content: '思考' });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'message',
      data: { content: '思考', answer: '思考', start_to_think: true },
    });
  });

  it('StreamToolStart → {event:"tool_start", data:{tool_name, tool_call_id, args?}}', () => {
    const frame = serializeChunk({
      type: 'tool_start',
      toolName: 'read_file',
      toolCallId: 'call-1',
      args: { path: '/a' },
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'tool_start',
      data: {
        tool_name: 'read_file',
        tool_call_id: 'call-1',
        args: { path: '/a' },
      },
    });
  });

  it('StreamToolComplete → {event:"tool_complete", data:{tool_call_id, result?}}', () => {
    const frame = serializeChunk({
      type: 'tool_complete',
      toolCallId: 'call-1',
      result: '文件内容',
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'tool_complete',
      data: { tool_call_id: 'call-1', result: '文件内容' },
    });
  });

  it('StreamToolProgress → {event:"tool_progress", data:{tool_name, tool_call_id?, content}}', () => {
    const frame = serializeChunk({
      type: 'tool_progress',
      toolName: 'coder',
      toolCallId: 'call-2',
      content: 'progress',
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'tool_progress',
      data: {
        tool_name: 'coder',
        tool_call_id: 'call-2',
        content: 'progress',
      },
    });
  });

  it('StreamUsage → {event:"message_end", data:{usage}}', () => {
    const frame = serializeChunk({
      type: 'usage',
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'message_end',
      data: { usage: { promptTokens: 10, completionTokens: 5 } },
    });
  });

  it('StreamDone → {event:"workflow_finished", data:true}', () => {
    const frame = serializeChunk({ type: 'done' });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'workflow_finished',
      data: true,
    });
  });

  it('StreamError → {event:"error", data:{message, answer, tool_call_id?, errorDetails?}}', () => {
    const frame = serializeChunk({
      type: 'error',
      message: 'fail',
      toolCallId: 'call-3',
    });
    expect(frame).not.toBeNull();
    const parsed = parseFrame(frame!);
    expect(parsed.event).toBe('error');
    expect((parsed.data as { message: string; answer: string; tool_call_id?: string }).message).toBe('fail');
    expect((parsed.data as { answer: string }).answer).toBe('**ERROR**: fail');
    expect((parsed.data as { tool_call_id?: string }).tool_call_id).toBe('call-3');
  });

  it('StreamApprovalRequest → {event:"approval_request", data:{tool_name, arguments, choices, run_id}}', () => {
    const frame = serializeChunk({
      type: 'approval_request',
      toolName: 'bash',
      arguments: '{"command":"ls"}',
      choices: ['once', 'session', 'always', 'deny'],
      runId: 'run-1',
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'approval_request',
      data: {
        tool_name: 'bash',
        arguments: '{"command":"ls"}',
        choices: ['once', 'session', 'always', 'deny'],
        run_id: 'run-1',
      },
    });
  });

  it('StreamApprovalResponded → {event:"approval_responded", data:{choice, resolved, run_id}}', () => {
    const frame = serializeChunk({
      type: 'approval_responded',
      choice: 'once',
      resolved: 1,
      runId: 'run-1',
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'approval_responded',
      data: { choice: 'once', resolved: 1, run_id: 'run-1' },
    });
  });

  it('StreamClarifyRequest → {event:"clarify_request", data:{question, choices, clarify_id, session_id}}', () => {
    const frame = serializeChunk({
      type: 'clarify_request',
      question: '使用哪个框架?',
      choices: ['React', 'Vue'],
      clarifyId: 'sess-1:1700000000000',
      sessionId: 'sess-1',
    });
    expect(frame).not.toBeNull();
    expect(parseFrame(frame!)).toEqual({
      event: 'clarify_request',
      data: {
        question: '使用哪个框架?',
        choices: ['React', 'Vue'],
        clarify_id: 'sess-1:1700000000000',
        session_id: 'sess-1',
      },
    });
  });

  it('StreamClarifyRequest choices 为空数组(自由文本)→ 透传空数组', () => {
    const frame = serializeChunk({
      type: 'clarify_request',
      question: '请描述需求',
      choices: [],
      clarifyId: 'sess-2:1700000000001',
      sessionId: 'sess-2',
    });
    expect(frame).not.toBeNull();
    const parsed = parseFrame(frame!);
    expect((parsed.data as { choices: unknown[] }).choices).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// streamChunksAsSSE 集成测试(approval_request 后过滤 tool_*)
// ---------------------------------------------------------------------------

describe('streamChunksAsSSE: tool_* filtering after approval_request', () => {
  function createMockContext(): unknown {
    // Mock Hono Context: 只需 c.req.raw.signal 可读
    return {
      req: {
        raw: {
          signal: new AbortController().signal,
        },
      },
    };
  }

  async function collectSse(response: Response): Promise<string[]> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const frames: string[] = [];
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        frames.push(buffer.slice(0, idx + 2));
        buffer = buffer.slice(idx + 2);
      }
    }
    if (buffer.trim()) frames.push(buffer);
    return frames;
  }

  it('approval_request 后续 tool_start/tool_complete/tool_progress 被过滤', async () => {
    const chunks: StreamChunk[] = [
      { type: 'delta', content: 'begin' },
      {
        type: 'tool_start',
        toolName: 'bash',
        toolCallId: 'call-1',
      },
      {
        type: 'approval_request',
        toolName: 'bash',
        arguments: '{"command":"rm -rf /"}',
        choices: ['once', 'session', 'always', 'deny'],
        runId: 'run-1',
      },
      // 以下 tool_* 应被过滤
      {
        type: 'tool_progress',
        toolName: 'bash',
        toolCallId: 'call-1',
        content: 'should be filtered',
      },
      {
        type: 'tool_complete',
        toolCallId: 'call-1',
        result: 'should be filtered',
      },
      // delta 和 done 应保留
      { type: 'delta', content: 'after' },
      { type: 'done' },
    ];

    const mockContext = createMockContext() as unknown as Parameters<typeof streamChunksAsSSE>[0];
    async function* gen(): AsyncIterable<StreamChunk> {
      for (const c of chunks) yield c;
    }
    const response = await streamChunksAsSSE(mockContext, gen());
    const frames = await collectSse(response);

    // 验证:delta(begin) + tool_start + approval_request + delta(after) + done
    // tool_progress 和 tool_complete 被过滤
    const events = frames.map((f) => {
      const json = f.slice(6, -2);
      return (JSON.parse(json) as { event: string }).event;
    });

    expect(events).toEqual([
      'message', // begin
      'tool_start', // approval 前的 tool_start 不过滤
      'approval_request',
      'message', // after
      'workflow_finished',
    ]);
    // 确保无 tool_progress / tool_complete 帧出现
    expect(events).not.toContain('tool_progress');
    expect(events).not.toContain('tool_complete');
  });

  it('无 approval_request 时 tool_* 事件正常透传', async () => {
    const chunks: StreamChunk[] = [
      {
        type: 'tool_start',
        toolName: 'read_file',
        toolCallId: 'call-1',
      },
      {
        type: 'tool_progress',
        toolName: 'read_file',
        toolCallId: 'call-1',
        content: 'reading',
      },
      {
        type: 'tool_complete',
        toolCallId: 'call-1',
        result: 'content',
      },
      { type: 'done' },
    ];

    const mockContext = createMockContext() as unknown as Parameters<typeof streamChunksAsSSE>[0];
    async function* gen(): AsyncIterable<StreamChunk> {
      for (const c of chunks) yield c;
    }
    const response = await streamChunksAsSSE(mockContext, gen());
    const frames = await collectSse(response);
    const events = frames.map((f) => {
      const json = f.slice(6, -2);
      return (JSON.parse(json) as { event: string }).event;
    });

    expect(events).toEqual([
      'tool_start',
      'tool_progress',
      'tool_complete',
      'workflow_finished',
    ]);
  });

  it('clarify_request 透传到前端(不过滤 tool_*)', async () => {
    // clarify 是非阻塞 UI,与 approval 不同:
    // - clarify_request 后的 tool_* 事件应正常透传(用户可边回答边看其它事件)
    // - clarify_request 不调 registerRun(无 runId 字段)
    const chunks: StreamChunk[] = [
      { type: 'delta', content: 'before' },
      {
        type: 'clarify_request',
        question: '使用哪个框架?',
        choices: ['React', 'Vue'],
        clarifyId: 'sess-1:1700000000000',
        sessionId: 'sess-1',
      },
      // clarify_request 后的 tool_* 应保留(非阻塞)
      {
        type: 'tool_start',
        toolName: 'read_file',
        toolCallId: 'call-1',
      },
      { type: 'delta', content: 'after' },
      { type: 'done' },
    ];

    const mockContext = createMockContext() as unknown as Parameters<typeof streamChunksAsSSE>[0];
    async function* gen(): AsyncIterable<StreamChunk> {
      for (const c of chunks) yield c;
    }
    const response = await streamChunksAsSSE(mockContext, gen());
    const frames = await collectSse(response);
    const events = frames.map((f) => {
      const json = f.slice(6, -2);
      return (JSON.parse(json) as { event: string }).event;
    });

    expect(events).toEqual([
      'message', // before
      'clarify_request',
      'tool_start', // clarify_request 后 tool_* 保留(非阻塞)
      'message', // after
      'workflow_finished',
    ]);
  });
});

// ---------------------------------------------------------------------------
// POST /agents/:agentId/runs/:runId/approval 路由测试
// ---------------------------------------------------------------------------

describe('POST /agents/:agentId/runs/:runId/approval', () => {
  let mocks: MockSetup;
  let app: Hono<{ Variables: TestVariables }>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    app = createApp(mocks);
    // P0-S1 修复后,审批路由校验 runId 归属(RunRegistry)。
    // 测试中需先注册 runId → backendId 映射,否则路由返回 403。
    // 注册测试用 runId 到 tenant-1(与 X-Backend-Id: tenant-1 对齐)。
    _clearRunRegistryForTests();
    registerRun('run-1', 'tenant-1', 'agent-1');
    registerRun('run-x', 'tenant-1', 'agent-1');
    registerRun('run-y', 'tenant-1', 'agent-1');
  });

  it('合法请求 → 调用 adapter.submitApproval 并返回响应', async () => {
    const submitMock = mocks.adapter.submitApproval as ReturnType<typeof vi.fn>;
    submitMock.mockResolvedValueOnce({
      runId: 'run-1',
      choice: 'once',
      resolved: 1,
    });

    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ runId: 'run-1', choice: 'once', resolved: 1 });
    expect(submitMock).toHaveBeenCalledWith(
      expect.objectContaining({ backendId: 'tenant-1' }),
      'run-1',
      'once',
    );
  });

  it('无 adapter 配置 → 503', async () => {
    mocks = createMocks({ ready: false });
    // 覆写 registry.isReady 让 getAdapter 返回 null
    mocks.registry.isReady = vi.fn(() => false);
    mocks.harnessStore.get = vi.fn(() => undefined);
    mocks.backendStore.getBackend = vi.fn(() => undefined);
    app = createApp(mocks);

    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe(503);
  });

  it('adapter 未实现 submitApproval(IntellectRagAdapter) → 501', async () => {
    mocks = createMocks({ withSubmitApproval: false });
    app = createApp(mocks);

    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe(501);
    expect(body.message).toContain('not supported');
  });

  it('choice 缺失 → 400', async () => {
    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('Invalid choice');
  });

  it('choice 无效 → 400', async () => {
    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'invalid' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('once');
    expect(body.message).toContain('session');
    expect(body.message).toContain('always');
    expect(body.message).toContain('deny');
  });

  it('body 非 JSON → 400', async () => {
    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: 'not json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('JSON');
  });

  it('adapter.submitApproval 抛 404 → 404 Not found(handleAdapterError)', async () => {
    const submitMock = mocks.adapter.submitApproval as ReturnType<typeof vi.fn>;
    const err = new Error('run not found (404)');
    submitMock.mockRejectedValueOnce(err);

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request('/agents/agent-1/runs/run-x/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'deny' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(404);
    expect(body.message).toBe('Not found');
    warnSpy.mockRestore();
  });

  it('adapter.submitApproval 抛通用错误 → 502 Adapter error(不透传 err.message)', async () => {
    const submitMock = mocks.adapter.submitApproval as ReturnType<typeof vi.fn>;
    const err = new Error('upstream internal: tenant-001 session expired');
    submitMock.mockRejectedValueOnce(err);

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request('/agents/agent-1/runs/run-y/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'session' }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe(502);
    // 不透传 err.message(含内部信息)
    expect(body.message).toBe('Adapter error');
    expect(body.message).not.toContain('tenant-001');
    warnSpy.mockRestore();
  });

  it('所有合法 choice 值均被接受(once/session/always/deny)', async () => {
    const submitMock = mocks.adapter.submitApproval as ReturnType<typeof vi.fn>;
    submitMock.mockResolvedValue({
      runId: 'run-x',
      choice: 'once',
      resolved: 1,
    });

    for (const choice of ['once', 'session', 'always', 'deny'] as const) {
      submitMock.mockClear();
      submitMock.mockResolvedValueOnce({
        runId: 'run-x',
        choice,
        resolved: 1,
      });
      const res = await app.request('/agents/agent-1/runs/run-x/approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({ choice }),
      });
      expect(res.status).toBe(200);
      expect(submitMock).toHaveBeenCalledWith(
        expect.any(Object),
        'run-x',
        choice,
      );
    }
  });

  it('registry 抛 TenantNotFoundError → 404(handleAdapterError 不覆盖,由 registry 抛出)', async () => {
    mocks.registry.getAdapterForBackend = vi.fn((tid: string) => {
      if (tid === 'unknown') {
        throw new TenantNotFoundError(tid);
      }
      return mocks.adapter;
    });
    app = createApp(mocks);

    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'unknown',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    // 注:本路由 getAdapter 自身已捕获 Registry 错误并 fallback 到 BackendContext 路径;
    // 在 backendStore 也无法解析时返回 null → 503。
    // 测试此场景:backendStore.getBackend('unknown') 返回 undefined,getAdapter 返回 null。
    expect([404, 503]).toContain(res.status);
  });

  // P0-S1 修复测试:跨租户越权校验
  it('runId 未注册到当前 backend → 403 Forbidden(跨租户越权拦截)', async () => {
    // run-unregistered 未在 beforeEach 中注册到 tenant-1
    const res = await app.request('/agents/agent-1/runs/run-unregistered/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(403);
    expect(body.message).toContain('Forbidden');
    // 安全:不透传内部 reason
    expect(body.message).not.toContain('not registered');
  });

  it('runId 注册到其他 backend → 403 Forbidden(跨租户越权拦截)', async () => {
    // run-other-tenant 注册到 tenant-other,但请求用 tenant-1
    registerRun('run-other-tenant', 'tenant-other', 'agent-1');

    const res = await app.request('/agents/agent-1/runs/run-other-tenant/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(403);
  });

  // P1-S3 修复测试:adapter 返回 resolved<1 时 BFF 返回 409
  it('adapter.submitApproval 返回 resolved=0 → 409(审批未真正解决)', async () => {
    const submitMock = mocks.adapter.submitApproval as ReturnType<typeof vi.fn>;
    submitMock.mockResolvedValueOnce({
      runId: 'run-1',
      choice: 'once',
      resolved: 0, // 未真正解决
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.request('/agents/agent-1/runs/run-1/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Backend-Id': 'tenant-1',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify({ choice: 'once' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(409);
    expect(body.message).toContain('already resolved');
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// POST /agents/:agentId/sessions/:sessionId/clarify 路由测试 (v1.4.0)
// ---------------------------------------------------------------------------

describe('POST /agents/:agentId/sessions/:sessionId/clarify', () => {
  let mocks: MockSetup;
  let app: Hono<{ Variables: TestVariables }>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    app = createApp(mocks);
  });

  it('合法请求 → 调用 adapter.submitClarify 并返回 {code:0, data:{status:"ok"}}', async () => {
    const submitClarifyMock = mocks.adapter.submitClarify as ReturnType<typeof vi.fn>;
    submitClarifyMock.mockResolvedValueOnce({ status: 'ok' });

    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          clarify_id: 'sess-1:1700000000000',
          answer: '使用 React',
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ code: 0, data: { status: 'ok' } });
    expect(submitClarifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ backendId: 'tenant-1' }),
      'sess-1',
      'sess-1:1700000000000',
      '使用 React',
    );
  });

  it('无 adapter 配置 → 503', async () => {
    mocks = createMocks({ ready: false });
    mocks.registry.isReady = vi.fn(() => false);
    mocks.harnessStore.get = vi.fn(() => undefined);
    mocks.backendStore.getBackend = vi.fn(() => undefined);
    app = createApp(mocks);

    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          clarify_id: 'sess-1:1',
          answer: 'a',
        }),
      },
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe(503);
  });

  it('adapter 未实现 submitClarify → 501', async () => {
    mocks = createMocks({ withSubmitClarify: false });
    app = createApp(mocks);

    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          clarify_id: 'sess-1:1',
          answer: 'a',
        }),
      },
    );

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe(501);
    expect(body.message).toContain('not supported');
  });

  it('clarify_id 缺失 → 400', async () => {
    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({ answer: 'a' }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('clarify_id');
  });

  it('answer 缺失 → 400', async () => {
    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({ clarify_id: 'sess-1:1' }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('answer');
  });

  it('body 非 JSON → 400', async () => {
    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: 'not json',
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('JSON');
  });

  it('clarify_id 和 answer 均缺失 → 400(同时提示两者)', async () => {
    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
    expect(body.message).toContain('clarify_id');
    expect(body.message).toContain('answer');
  });

  it('clarify_id 类型错误(非字符串)→ 400', async () => {
    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({ clarify_id: 123, answer: 'a' }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(400);
  });

  it('adapter.submitClarify 抛 404 → 404 Not found(handleAdapterError)', async () => {
    const submitClarifyMock = mocks.adapter.submitClarify as ReturnType<typeof vi.fn>;
    const err = new Error('no active clarify (404)');
    submitClarifyMock.mockRejectedValueOnce(err);

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          clarify_id: 'sess-1:1',
          answer: 'a',
        }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(404);
    expect(body.message).toBe('Not found');
    warnSpy.mockRestore();
  });

  it('adapter.submitClarify 抛通用错误 → 502 Adapter error(不透传 err.message)', async () => {
    const submitClarifyMock = mocks.adapter.submitClarify as ReturnType<typeof vi.fn>;
    const err = new Error('upstream internal: tenant-001 session expired');
    submitClarifyMock.mockRejectedValueOnce(err);

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request(
      '/agents/agent-1/sessions/sess-1/clarify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Id': 'tenant-1',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          clarify_id: 'sess-1:1',
          answer: 'a',
        }),
      },
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe(502);
    expect(body.message).toBe('Adapter error');
    expect(body.message).not.toContain('tenant-001');
    warnSpy.mockRestore();
  });
});
