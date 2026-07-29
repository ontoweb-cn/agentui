// Multi-Harness P3 US1: IntellectEnterpriseAdapter 单元测试。
// Constitution Principle VII (Test-First) + V (Tenant Isolation) + VIII (API_SERVER_KEY)。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntellectEnterpriseAdapter } from './intellect-enterprise-adapter';
import {
  IntellectNotFoundError,
  IntellectBackendError,
} from './http-client';
import type { HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';

// Mock httpClient 工厂方法
const httpClientMock = {
  request: vi.fn(),
  requestStream: vi.fn(),
  requestGetStream: vi.fn(),
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

const ctx: BackendContext = {
  backendId: 'tenant-001',
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

    // X-T1 P1-1: 兼容 Python 对齐后 {session_id} 格式(M1 核心目标)
    it('X-T1: POST 响应顶层 {session_id} 格式(Python 对齐后) → 提取 session_id', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        session_id: 'sess-python-1',
        title: 'Python 对齐格式',
      });
      const res = await adapter.createSession(ctx, 'agent-1', 'Python 对齐格式');
      expect(res.id).toBe('sess-python-1');
      expect(res.title).toBe('Python 对齐格式');
      expect(res.agentId).toBe('agent-1');
    });

    // X-T1 P1-1: 兼容 Python 当前 {session:{id}} 嵌套格式(M1 现状)
    it('X-T1: POST 响应 {session:{id}} 嵌套格式(Python 当前) → 解包并提取 id', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        object: 'intellect.session',
        session: {
          id: 'sess-nested-1',
          title: '嵌套格式',
          started_at: 1785241917.0,
          ended_at: 1785249148.0,
        },
      });
      const res = await adapter.createSession(ctx, 'agent-1', '嵌套格式');
      expect(res.id).toBe('sess-nested-1');
      expect(res.title).toBe('嵌套格式');
      // 1785241917 秒 → 2026-07-28T12:31:57.000Z
      expect(res.createdAt).toBe('2026-07-28T12:31:57.000Z');
    });

    // X-T1 P1-1: 兼容嵌套 + session_id 组合格式
    it('X-T1: POST 响应 {session:{session_id}} 嵌套+session_id 格式 → 解包并提取 session_id', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        object: 'intellect.session',
        session: {
          session_id: 'sess-nested-sid-1',
          title: '嵌套 session_id',
        },
      });
      const res = await adapter.createSession(ctx, 'agent-1');
      expect(res.id).toBe('sess-nested-sid-1');
      expect(res.title).toBe('嵌套 session_id');
    });

    // X-T1 P1-1: 响应缺少 id/session_id → 兜底为空字符串(防御性)
    it('X-T1: POST 响应既无 id 也无 session_id → 兜底空字符串', async () => {
      httpClientMock.request.mockResolvedValueOnce({ object: 'intellect.session' });
      const res = await adapter.createSession(ctx, 'agent-1');
      expect(res.id).toBe('');
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

    it('Gateway 实际响应 {session:{...}} 包裹格式 → 解包并归一化', async () => {
      // Gateway GET /api/sessions/{id} 实际返回 {object, session:{id, title, started_at, ended_at, ...}}
      httpClientMock.request.mockResolvedValueOnce({
        object: 'intellect.session',
        session: {
          id: 'api_1785241916_xxx',
          title: '继续任务待定',
          started_at: 1785241917.0,
          ended_at: 1785249148.0,
          message_count: 25,
        },
      });
      const res = await adapter.getSession(ctx, 'chat', 'api_1785241916_xxx');
      expect(res.id).toBe('api_1785241916_xxx');
      expect(res.title).toBe('继续任务待定');
      // 1785241917 秒 (Unix) → 2026-07-28T12:31:57.000Z
      expect(res.createdAt).toBe('2026-07-28T12:31:57.000Z');
      // 1785249148 秒 (Unix) → 2026-07-28T14:32:28.000Z
      expect(res.updatedAt).toBe('2026-07-28T14:32:28.000Z');
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

  // X-T1 P1-2: updateSession 调用 normalizeSession,需覆盖嵌套格式
  describe('updateSession', () => {
    it('PATCH /api/sessions/{id} 扁平响应 → 返回 Session', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        id: 'sess-1',
        title: '新标题',
        updated_at: '2026-07-29T10:00:00Z',
      });
      const res = await adapter.updateSession(ctx, 'agent-1', 'sess-1', {
        title: '新标题',
      });
      expect(httpClientMock.request).toHaveBeenCalledWith(
        'PATCH',
        '/api/sessions/sess-1',
        ctx,
        { title: '新标题' },
      );
      expect(res.id).toBe('sess-1');
      expect(res.title).toBe('新标题');
      expect(res.agentId).toBe('agent-1');
    });

    it('X-T1: PATCH 响应 {session:{...}} 嵌套格式 → 解包并归一化', async () => {
      // Gateway PATCH /api/sessions/{id} 实际返回 {object, session:{id, title, started_at, ended_at}}
      httpClientMock.request.mockResolvedValueOnce({
        object: 'intellect.session',
        session: {
          id: 'sess-nested-patch',
          title: 'PATCH 嵌套标题',
          started_at: 1785241917.0,
          ended_at: 1785249148.0,
        },
      });
      const res = await adapter.updateSession(
        ctx,
        'agent-1',
        'sess-nested-patch',
        { title: 'PATCH 嵌套标题' },
      );
      expect(res.id).toBe('sess-nested-patch');
      expect(res.title).toBe('PATCH 嵌套标题');
      // 1785241917 秒 → 2026-07-28T12:31:57.000Z
      expect(res.createdAt).toBe('2026-07-28T12:31:57.000Z');
      expect(res.updatedAt).toBe('2026-07-28T14:32:28.000Z');
    });

    it('title 为 undefined 时 body 不含 title 字段', async () => {
      httpClientMock.request.mockResolvedValueOnce({ id: 'sess-1', title: 't' });
      await adapter.updateSession(ctx, 'agent-1', 'sess-1', {});
      const [, , , body] = httpClientMock.request.mock.calls[0];
      expect(body).toEqual({});
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

    // X-T1 P1-3: Rust gateway 实际返回 {sessions:[...]} 格式
    it('X-T1: Rust gateway 响应 {sessions:[...]} 格式 → 正确提取', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        sessions: [
          { id: 'gw-1', title: 'gateway 会话 1', started_at: 1785241917.0 },
          { id: 'gw-2', title: 'gateway 会话 2', started_at: 1785249148.0 },
        ],
      });
      const res = await adapter.listSessions(ctx, 'agent-1');
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe('gw-1');
      expect(res[0].title).toBe('gateway 会话 1');
      // 1785241917 秒 → 2026-07-28T12:31:57.000Z
      expect(res[0].createdAt).toBe('2026-07-28T12:31:57.000Z');
      expect(res[1].id).toBe('gw-2');
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
  // US3: sendMessage (v1.3.0 /v1/runs 流式对话)
  // -----------------------------------------------------------------------

  describe('sendMessage', () => {
    it('v1.3.0 /v1/runs 流程:POST /v1/runs + GET /v1/runs/{run_id}/events', async () => {
      // Step 1: mock POST /v1/runs 返回 run_id
      httpClientMock.request.mockResolvedValueOnce({
        run_id: 'run-abc',
        status: 'started',
        session_id: 'sess-1',
      });
      // Step 2: mock GET /v1/runs/{run_id}/events 返回 SSE 流(run.completed 终态)
      const sseBytes = new TextEncoder().encode(
        `data: ${JSON.stringify({
          event: 'run.completed',
          run_id: 'run-abc',
          timestamp: 2.0,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })}\n\n`,
      );
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseBytes);
          controller.close();
        },
      });
      httpClientMock.requestGetStream.mockResolvedValueOnce(mockStream);

      const iterable = await adapter.sendMessage(ctx, {
        sessionId: 'sess-1',
        content: '你好',
        agentId: 'agent-1',
      });

      // 验证 POST /v1/runs 调用参数
      expect(httpClientMock.request).toHaveBeenCalledWith(
        'POST',
        '/v1/runs',
        ctx,
        expect.objectContaining({
          input: '你好',
          session_id: 'sess-1',
        }),
      );

      // 验证 GET /v1/runs/{run_id}/events 调用参数
      expect(httpClientMock.requestGetStream).toHaveBeenCalledWith(
        '/v1/runs/run-abc/events',
        ctx,
      );

      // 消费迭代器,应产出 usage + done chunks
      const chunks: unknown[] = [];
      for await (const c of iterable) chunks.push(c);
      expect(chunks).toHaveLength(2);
      expect((chunks[0] as { type: string }).type).toBe('usage');
      expect((chunks[1] as { type: string }).type).toBe('done');
    });

    it('POST /v1/runs 响应缺 run_id → 抛 IntellectBackendError', async () => {
      httpClientMock.request.mockResolvedValueOnce({ status: 'started' });

      await expect(
        adapter.sendMessage(ctx, {
          sessionId: 'sess-1',
          content: 'hi',
        }),
      ).rejects.toThrow(IntellectBackendError);
    });

    it('Team/Project 组织隔离头通过 ctx 传入(Principle V)', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        run_id: 'run-ctx',
        status: 'started',
      });
      const sseBytes = new TextEncoder().encode(
        `data: ${JSON.stringify({
          event: 'run.completed',
          run_id: 'run-ctx',
          timestamp: 2.0,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })}\n\n`,
      );
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseBytes);
          controller.close();
        },
      });
      httpClientMock.requestGetStream.mockResolvedValueOnce(mockStream);

      await adapter.sendMessage(ctx, {
        sessionId: 'sess-1',
        content: 'hi',
      });

      // ctx 含 intellectTeamId/intellectProjectId,httpClient 内部注入头
      const [method, path, passedCtx] = httpClientMock.request.mock.calls[0];
      expect(method).toBe('POST');
      expect(path).toBe('/v1/runs');
      expect(passedCtx.intellectTeamId).toBe('team-abc');
      expect(passedCtx.intellectProjectId).toBe('project-xyz');
    });
  });

  // -----------------------------------------------------------------------
  // v1.3.0: submitApproval
  // -----------------------------------------------------------------------

  describe('submitApproval', () => {
    it('POST /v1/runs/{run_id}/approval → 返回审批响应', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        object: 'intellect.run.approval_response',
        run_id: 'run-3',
        choice: 'once',
        resolved: 1,
      });

      const res = await adapter.submitApproval(ctx, 'run-3', 'once');

      expect(httpClientMock.request).toHaveBeenCalledWith(
        'POST',
        '/v1/runs/run-3/approval',
        ctx,
        { choice: 'once' },
      );
      expect(res).toEqual({
        runId: 'run-3',
        choice: 'once',
        resolved: 1,
      });
    });

    it('响应缺 run_id → 用入参 runId 兜底', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        choice: 'deny',
        resolved: 0,
      });

      const res = await adapter.submitApproval(ctx, 'run-fallback', 'deny');
      expect(res.runId).toBe('run-fallback');
      expect(res.choice).toBe('deny');
      expect(res.resolved).toBe(0);
    });

    it('响应 choice 无效 → 抛 IntellectBackendError', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        run_id: 'run-bad',
        choice: 'invalid',
        resolved: 0,
      });

      await expect(
        adapter.submitApproval(ctx, 'run-bad', 'once'),
      ).rejects.toThrow(IntellectBackendError);
    });

    it('响应缺 resolved → 默认 0', async () => {
      httpClientMock.request.mockResolvedValueOnce({
        run_id: 'run-no-resolved',
        choice: 'session',
      });

      const res = await adapter.submitApproval(ctx, 'run-no-resolved', 'session');
      expect(res.resolved).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // v1.4.0: submitClarify
  // -----------------------------------------------------------------------

  describe('submitClarify', () => {
    it('POST /v1/chat/completions/{session_id}/clarify → 返回 {status:"ok"}', async () => {
      httpClientMock.request.mockResolvedValueOnce({ status: 'ok' });

      const res = await adapter.submitClarify(
        ctx,
        'sess-1',
        'sess-1:1700000000000',
        '使用 React 实现',
      );

      expect(httpClientMock.request).toHaveBeenCalledWith(
        'POST',
        '/v1/chat/completions/sess-1/clarify',
        ctx,
        { clarify_id: 'sess-1:1700000000000', answer: '使用 React 实现' },
      );
      expect(res).toEqual({ status: 'ok' });
    });

    it('响应缺 status → 兜底返回 "ok"', async () => {
      // Gateway 异常响应不含 status 字段时,adapter 兜底为 "ok"
      httpClientMock.request.mockResolvedValueOnce({});

      const res = await adapter.submitClarify(
        ctx,
        'sess-2',
        'sess-2:1700000000001',
        '自由文本答案',
      );
      expect(res.status).toBe('ok');
    });

    it('sessionId 含特殊字符 → URL 编码', async () => {
      httpClientMock.request.mockResolvedValueOnce({ status: 'ok' });

      await adapter.submitClarify(
        ctx,
        'sess/with:special',
        'sess/with:special:1',
        'answer',
      );

      const [, path] = httpClientMock.request.mock.calls[0];
      // encodeURIComponent 编码 / 和 :
      expect(path).toBe('/v1/chat/completions/sess%2Fwith%3Aspecial/clarify');
    });

    it('上游 404(无活跃 clarify)→ 抛 IntellectBackendError(由 http-client 转)', async () => {
      httpClientMock.request.mockRejectedValueOnce(
        new IntellectBackendError(
          'POST /v1/chat/completions/sess-1/clarify → 404',
          404,
        ),
      );

      await expect(
        adapter.submitClarify(ctx, 'sess-1', 'sess-1:1', 'answer'),
      ).rejects.toThrow(IntellectBackendError);
    });

    it('响应 status 为非 string 类型(如 null/object)→ 抛 IntellectBackendError(不掩盖上游错误)', async () => {
      // M9 修复:非 string status 表示上游异常,不应兜底为 "ok" 掩盖错误
      httpClientMock.request.mockResolvedValueOnce({ status: { error: 'internal' } });

      await expect(
        adapter.submitClarify(ctx, 'sess-1', 'sess-1:1', 'answer'),
      ).rejects.toThrow(IntellectBackendError);
    });
  });
});
