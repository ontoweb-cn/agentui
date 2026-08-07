import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KagAdapter } from './kag-adapter';
import type { HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';

// 用 vi.hoisted 确保 spy 在 vi.mock 工厂执行时已定义且引用稳定
const { mockListTools, mockCallTool, mockConnect, mockClose, mockIsUrlSafe, mockSSETransport } =
  vi.hoisted(() => ({
    mockListTools: vi.fn(),
    mockCallTool: vi.fn(),
    mockConnect: vi.fn(),
    mockClose: vi.fn().mockResolvedValue(undefined),
    mockIsUrlSafe: vi.fn().mockResolvedValue(true),
    mockSSETransport: vi.fn().mockImplementation(() => ({})),
  }));

// Mock ssrf-guard:绕过真实 DNS 解析(测试用 127.0.0.1 会被私有 IP 拦截)
vi.mock('../../ssrf-guard', () => ({
  isUrlSafe: mockIsUrlSafe,
  SSRF_PRIVATE_IP_HINT: 'TEST_HINT',
}));

// Mock MCP SDK Client:工厂返回共享 spy
// 注意:vi.clearAllMocks 会清掉 mockImplementation,需在 beforeEach 中重置(见下方)
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

// Mock MCP SDK SSEClientTransport(用共享 spy 以便验证构造参数)
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mockSSETransport,
}));

const baseBackend: HarnessBackend = {
  id: 'kag-default',
  name: 'KAG (Default)',
  type: 'kag',
  endpoint: 'http://127.0.0.1:3000',
  adminTokenEnvVar: 'KAG_TOKEN',
  capabilities: {
    canvas: false,
    knowledgeBase: false, // v8.3:无 REST KB CRUD
    memory: false,
    mcp: true, // v8.3:全面拥抱 MCP
    multiTenant: false,
    modelManagement: false,
  },
  adminToken: 'test-kag-token',
};

const ctx: BackendContext = {
  backendId: 'tenant-001',
  userId: 'user-001',
};

function makeToolResult(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

describe('KagAdapter', () => {
  let adapter: KagAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 重置 mock 默认实现(clearAllMocks 会清掉 mockResolvedValue/mockImplementation)
    mockIsUrlSafe.mockResolvedValue(true);
    mockClose.mockResolvedValue(undefined);
    mockSSETransport.mockImplementation(() => ({}));
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool,
      close: mockClose,
    }));
    adapter = new KagAdapter(baseBackend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor & properties', () => {
    it('暴露 backendId 对应 backend.id', () => {
      expect(adapter.backendId).toBe('kag-default');
    });

    it('adapterKind 为 "mcp"', () => {
      expect(adapter.adapterKind).toBe('mcp');
    });

    it('backendType 为 "kag"', () => {
      expect(adapter.backendType).toBe('kag');
    });

    it('defaultCapabilities 中 mcp=true, knowledgeBase=false', async () => {
      const caps = await adapter.discoverCapabilities();
      expect(caps.mcp).toBe(true);
      expect(caps.knowledgeBase).toBe(false);
    });
  });

  describe('listAgents (MCP listTools 映射)', () => {
    it('调 MCP listTools 并映射为 AgentSummary[]', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [
          { name: 'qa-pipeline', description: 'QA pipeline' },
          { name: 'kb-retrieve', description: 'KB retrieve' },
        ],
      });
      const agents = await adapter.listAgents(ctx);
      expect(agents).toEqual([
        { id: 'qa-pipeline', name: 'qa-pipeline', description: 'QA pipeline' },
        { id: 'kb-retrieve', name: 'kb-retrieve', description: 'KB retrieve' },
      ]);
    });

    it('工具描述缺失时回退为空字符串', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'qa-pipeline' }],
      });
      const agents = await adapter.listAgents(ctx);
      expect(agents[0].description).toBe('');
    });

    it('MCP 连接失败时抛错', async () => {
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));
      await expect(adapter.listAgents(ctx)).rejects.toThrow('connection refused');
    });
  });

  describe('getAgent', () => {
    it('返回指定工具的 AgentSummary', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'qa-pipeline', description: 'QA' }],
      });
      const agent = await adapter.getAgent(ctx, 'qa-pipeline');
      expect(agent).toEqual({ id: 'qa-pipeline', name: 'qa-pipeline', description: 'QA' });
    });

    it('工具不存在时抛错', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'qa-pipeline', description: 'QA' }],
      });
      await expect(adapter.getAgent(ctx, 'unknown')).rejects.toThrow('MCP tool not found: unknown');
    });
  });

  describe('IMCPAdapter: listTools', () => {
    it('返回 MCPTool[] 含 inputSchema', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'qa-pipeline', description: 'QA' }],
      });
      const tools = await adapter.listTools(ctx);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('qa-pipeline');
      expect(tools[0].inputSchema).toEqual({
        type: 'object',
        properties: { query: { type: 'string', description: 'Query text' } },
        required: ['query'],
      });
    });
  });

  describe('IMCPAdapter: callTool', () => {
    it('调 MCP callTool 并返回文本', async () => {
      mockCallTool.mockResolvedValueOnce(makeToolResult('result text'));
      const text = await adapter.callTool(ctx, 'qa-pipeline', { query: 'hello' });
      expect(text).toBe('result text');
      expect(mockCallTool).toHaveBeenCalledWith(
        { name: 'qa-pipeline', arguments: { query: 'hello' } },
        undefined,
        { signal: expect.any(AbortSignal) },
      );
    });

    it('工具返回空 content 时返回空字符串', async () => {
      mockCallTool.mockResolvedValueOnce({ content: [] });
      const text = await adapter.callTool(ctx, 'qa-pipeline', { query: 'hello' });
      expect(text).toBe('');
    });

    it('工具返回多段 text content 时用 \\n 连接', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'line1' },
          { type: 'text', text: 'line2' },
        ],
      });
      const text = await adapter.callTool(ctx, 'qa-pipeline', { query: 'hello' });
      expect(text).toBe('line1\nline2');
    });

    it('过滤非 text 类型的 content', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'image', text: 'ignored' },
          { type: 'text', text: 'kept' },
        ],
      });
      const text = await adapter.callTool(ctx, 'qa-pipeline', { query: 'hello' });
      expect(text).toBe('kept');
    });
  });

  describe('IMCPAdapter: qaPipeline / kbRetrieve', () => {
    it('qaPipeline 调 qa-pipeline 工具', async () => {
      mockCallTool.mockResolvedValueOnce(makeToolResult('answer'));
      const text = await adapter.qaPipeline(ctx, 'what is KAG?');
      expect(text).toBe('answer');
      expect(mockCallTool.mock.calls[0][0]).toEqual({
        name: 'qa-pipeline',
        arguments: { query: 'what is KAG?' },
      });
    });

    it('kbRetrieve 调 kb-retrieve 工具', async () => {
      mockCallTool.mockResolvedValueOnce(makeToolResult('{"summary":"..."}'));
      const text = await adapter.kbRetrieve(ctx, 'search term');
      expect(text).toBe('{"summary":"..."}');
      expect(mockCallTool.mock.calls[0][0]).toEqual({
        name: 'kb-retrieve',
        arguments: { query: 'search term' },
      });
    });
  });

  describe('sendMessage (StreamChunk 流)', () => {
    it('工具成功时产出 delta + done chunk', async () => {
      mockCallTool.mockResolvedValueOnce(makeToolResult('hello world'));
      const stream = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        agentId: 'qa-pipeline',
        content: 'hi',
      });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      expect(chunks).toEqual([
        { type: 'delta', content: 'hello world' },
        { type: 'done' },
      ]);
    });

    it('工具返回空文本时仅产出 done chunk', async () => {
      mockCallTool.mockResolvedValueOnce({ content: [] });
      const stream = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        agentId: 'qa-pipeline',
        content: 'hi',
      });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      expect(chunks).toEqual([{ type: 'done' }]);
    });

    it('工具失败时产出 error chunk', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('tool error'));
      const stream = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        agentId: 'qa-pipeline',
        content: 'hi',
      });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      expect(chunks).toEqual([
        { type: 'error', message: 'MCP tool call failed: tool error' },
      ]);
    });

    it('agentId 缺失时产出 error chunk', async () => {
      const stream = await adapter.sendMessage(ctx, {
        sessionId: 's1',
        content: 'hi',
      });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      expect(chunks).toEqual([
        { type: 'error', message: 'MCP sendMessage requires agentId (tool name)' },
      ]);
    });
  });

  describe('healthCheck', () => {
    it('listTools 成功时返回 true', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [] });
      const ok = await adapter.healthCheck();
      expect(ok).toBe(true);
    });

    it('连接失败时返回 false 并清理 client 缓存', async () => {
      // 评审 Q5 修复:用 mockRejectedValueOnce 而非 mockRejectedValue,
      // 确保仅模拟单次失败,不影响后续测试用例的默认行为
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));
      // 第一次失败
      const ok1 = await adapter.healthCheck();
      expect(ok1).toBe(false);
      // 清理后第二次重新尝试 connect(再失败)
      mockConnect.mockRejectedValueOnce(new Error('still down'));
      const ok2 = await adapter.healthCheck();
      expect(ok2).toBe(false);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('Session 管理(本地内存)', () => {
    it('createSession 生成 UUID 并存储', async () => {
      const s = await adapter.createSession(ctx, 'qa-pipeline', 'Test');
      expect(s.id).toBeTruthy();
      expect(s.agentId).toBe('qa-pipeline');
      expect(s.title).toBe('Test');
      expect(s.createdAt).toBeTruthy();
    });

    it('listSessions 按 agentId 过滤', async () => {
      await adapter.createSession(ctx, 'qa-pipeline', 'S1');
      await adapter.createSession(ctx, 'kb-retrieve', 'S2');
      const list = await adapter.listSessions(ctx, 'qa-pipeline');
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe('S1');
    });

    it('getSession 返回存储的会话', async () => {
      const created = await adapter.createSession(ctx, 'qa-pipeline', 'Test');
      const got = await adapter.getSession(ctx, 'qa-pipeline', created.id);
      expect(got.id).toBe(created.id);
    });

    it('getSession 不存在时抛错', async () => {
      await expect(
        adapter.getSession(ctx, 'qa-pipeline', 'nonexistent'),
      ).rejects.toThrow('Session not found: nonexistent');
    });

    it('updateSession 修改 title', async () => {
      const created = await adapter.createSession(ctx, 'qa-pipeline', 'Old');
      const updated = await adapter.updateSession(ctx, 'qa-pipeline', created.id, {
        title: 'New',
      });
      expect(updated.title).toBe('New');
    });

    it('deleteSession 删除后 getSession 抛错', async () => {
      const created = await adapter.createSession(ctx, 'qa-pipeline', 'Test');
      await adapter.deleteSession(ctx, 'qa-pipeline', created.id);
      await expect(
        adapter.getSession(ctx, 'qa-pipeline', created.id),
      ).rejects.toThrow('Session not found');
    });

    it('getSessionMessages 返回空数组(MCP 无状态)', async () => {
      const created = await adapter.createSession(ctx, 'qa-pipeline', 'Test');
      const msgs = await adapter.getSessionMessages(ctx, 'qa-pipeline', created.id);
      expect(msgs).toEqual([]);
    });
  });

  describe('cancelMessage', () => {
    it('no-op,不抛错', async () => {
      await expect(adapter.cancelMessage(ctx, 'any-session')).resolves.toBeUndefined();
    });
  });

  describe('SSRF 防护', () => {
    it('endpoint 被 isUrlSafe 拦截时抛错', async () => {
      mockIsUrlSafe.mockResolvedValueOnce(false);
      await expect(adapter.listAgents(ctx)).rejects.toThrow('blocked by SSRF guard');
    });

    it('SSEClientTransport requestInit 设置 redirect: manual(评审 S3 修复)', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [] });
      await adapter.listAgents(ctx);
      expect(mockSSETransport).toHaveBeenCalledTimes(1);
      const [, transportOpts] = mockSSETransport.mock.calls[0];
      expect(transportOpts.requestInit.redirect).toBe('manual');
    });

    it('connect 调用携带 30s 超时 signal(评审 S1 修复)', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [] });
      await adapter.listAgents(ctx);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      const [, connectOpts] = mockConnect.mock.calls[0];
      expect(connectOpts).toBeDefined();
      expect(connectOpts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('dispose (评审 Q3 修复)', () => {
    it('未连接时 dispose 不抛错(no-op)', async () => {
      await expect(adapter.dispose()).resolves.toBeUndefined();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('已连接时 dispose 调用 close 并清理缓存', async () => {
      // 先触发 getClient 建立连接
      mockListTools.mockResolvedValueOnce({ tools: [] });
      await adapter.listAgents(ctx);
      // dispose 应调用 close
      await adapter.dispose();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('close 失败时 dispose 不抛错(仅记录日志)', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [] });
      await adapter.listAgents(ctx);
      mockClose.mockRejectedValueOnce(new Error('close failed'));
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });

    it('dispose 后再次 getClient 创建新连接', async () => {
      mockListTools.mockResolvedValue({ tools: [] });
      await adapter.listAgents(ctx);
      await adapter.dispose();
      // 第二次 getClient 应重新 connect
      await adapter.listAgents(ctx);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('类型守卫', () => {
    it('isMCPAdapter 返回 true', async () => {
      const { isMCPAdapter } = await import('../../../types/adapter');
      expect(isMCPAdapter(adapter)).toBe(true);
    });
  });
});
