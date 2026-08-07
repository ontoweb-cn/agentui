/**
 * MCPBaseAdapter — MCP 协议后端的抽象基类。
 *
 * spec-012 Phase 1(T1-2)实施:封装 MCP SDK 客户端连接、工具调用、会话管理。
 *
 * 与 OpenAICompatibleBaseAdapter 的差异:
 * - 不走 HTTP /v1/chat/completions,经 MCP SDK 调用远程工具
 * - 工具调用同步返回(非 SSE 流),BFF 包装为 delta + done StreamChunk
 * - listAgents 返回 MCP 工具列表(非 /v1/models)
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction): 路由层经 AdapterRegistry 获取 IHarnessAdapter,
 *   不感知后端是 OpenAI 兼容还是 MCP 协议
 * - Principle IV (SSE Dual-Protocol): MCP 后端产出 delta + done + error 三种 chunk
 *   (MCP 工具同步返回,无 reasoning/usage/tool_progress 等)
 *
 * 安全(spec-012 §7):
 * - SSRF 防护:getClient 前用 isUrlSafe() 预校验 endpoint(评审 D3 修复)
 * - 超时:MCP 工具调用 30s 超时(AbortSignal.timeout)
 * - 鉴权:adminToken 非空时注入 Authorization 头(SDK SSEClientTransport 支持 headers)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IHarnessAdapter } from '../../../types/adapter';
import type { AgentSummary, Session, SendMessageRequest } from '../../../types/domain';
import type { StreamChunk, StreamIterable } from '../../../types/stream';
import type { HarnessCapabilities, HarnessBackend, BackendType } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import { isUrlSafe, SSRF_PRIVATE_IP_HINT } from '../../ssrf-guard';

/** MCP 工具调用超时(毫秒,spec-012 §7.3) */
const MCP_TOOL_TIMEOUT_MS = 30_000;

/** MCP 客户端连接超时(毫秒,评审 S1 修复:防止 connect 永久挂起) */
const MCP_CONNECT_TIMEOUT_MS = 30_000;

export abstract class MCPBaseAdapter implements IHarnessAdapter {
  readonly adapterKind = 'mcp' as const;
  readonly backendId: string;
  protected readonly baseUrl: string;
  protected readonly adminToken: string;
  protected readonly capabilities: HarnessCapabilities;

  // 内存 session 存储(MCP 无状态,与 OpenAI 兼容后端方案 A 一致)
  private readonly sessions = new Map<string, Session>();

  // MCP Client 缓存(惰性连接,首次调用 getClient 时创建)
  private mcpClient: Client | null = null;
  private mcpTransport: SSEClientTransport | null = null;

  constructor(backend: HarnessBackend) {
    this.backendId = backend.id;
    this.baseUrl = backend.endpoint.replace(/\/$/, '');
    this.adminToken = backend.adminToken;
    this.capabilities = backend.capabilities as HarnessCapabilities;
  }

  // -----------------------------------------------------------------------
  // 子类必须实现的抽象方法
  // -----------------------------------------------------------------------

  abstract readonly backendType: BackendType;
  protected abstract readonly defaultCapabilities: HarnessCapabilities;

  // -----------------------------------------------------------------------
  // MCP Client 生命周期管理
  // -----------------------------------------------------------------------

  /**
   * 获取或创建 MCP Client(惰性连接)。
   *
   * 首次调用时:
   * 1. isUrlSafe() 预校验 endpoint(SSRF 防护,评审 D3 修复)
   * 2. 创建 SSEClientTransport + Client 并 connect
   * 3. adminToken 非空时注入 Authorization 头
   *
   * 后续调用复用缓存实例。
   *
   * 连接失败时抛错,由调用方捕获返回 false(healthCheck)或 error chunk(sendMessage)。
   */
  protected async getClient(): Promise<Client> {
    if (this.mcpClient && this.mcpTransport) {
      return this.mcpClient;
    }

    // SSRF 预校验(评审 D3 修复:实际代码无 validateEndpoint,用 isUrlSafe)
    const safe = await isUrlSafe(this.baseUrl);
    if (!safe) {
      throw new Error(`MCP endpoint blocked by SSRF guard: ${this.baseUrl}。${SSRF_PRIVATE_IP_HINT}`);
    }

    // 构造 headers(adminToken 非空时注入,评审 S6 同款修复)
    const headers: Record<string, string> = {};
    if (this.adminToken) {
      headers['Authorization'] = `Bearer ${this.adminToken}`;
    }

    // 评审 S3 修复:设置 redirect: 'manual',防止 3xx 重定向 SSRF
    this.mcpTransport = new SSEClientTransport(new URL(`${this.baseUrl}/sse`), {
      requestInit: { headers, redirect: 'manual' },
    });
    this.mcpClient = new Client(
      { name: 'agentui-bff', version: '1.0.0' },
      { capabilities: {} },
    );
    // 评审 S1 修复:连接超时 30s,防止 connect 永久挂起
    await this.mcpClient.connect(this.mcpTransport, {
      signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
    });
    return this.mcpClient;
  }

  /**
   * 清理 MCP Client 缓存(healthCheck 失败或错误恢复时调用)。
   *
   * 注意:此方法仅清理引用,不关闭连接。如需释放连接资源,
   * 调用 dispose()(评审 Q3 修复)。
   */
  protected clearClient(): void {
    this.mcpClient = null;
    this.mcpTransport = null;
  }

  /**
   * 释放 MCP Client 连接资源(评审 Q3 修复)。
   *
   * 在 AdapterRegistry.invalidate() 移除本 adapter 时调用,
   * 确保 MCP SSE 长连接被正确关闭,避免资源泄露。
   *
   * 安全性:
   * - close() 失败时仅记录日志,不抛出(避免影响 invalidate 流程)
   * - 清理引用后即使 close 失败,adapter 也不再持有有效连接
   */
  async dispose(): Promise<void> {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close();
      } catch (err) {
        console.error('Failed to close MCP client:', err);
      }
    }
    this.clearClient();
  }

  // -----------------------------------------------------------------------
  // IHarnessAdapter 实现
  // -----------------------------------------------------------------------

  /**
   * 列出所有 Agent(MCP 后端语义:列出 MCP 工具)。
   *
   * 每个工具映射为一个 AgentSummary:
   * - id = 工具名(如 "qa-pipeline")
   * - name = 工具名
   * - description = 工具描述(从 MCP tool schema 获取)
   */
  async listAgents(_ctx: BackendContext): Promise<AgentSummary[]> {
    const client = await this.getClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      id: t.name,
      name: t.name,
      description: t.description ?? '',
    }));
  }

  async getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    const agents = await this.listAgents(ctx);
    const found = agents.find((a) => a.id === agentId);
    if (!found) throw new Error(`MCP tool not found: ${agentId}`);
    return found;
  }

  // 会话管理:BFF 本地生成(MCP 无状态,与 OpenAI 兼容方案 A 一致)
  async createSession(_ctx: BackendContext, agentId: string, title?: string): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: crypto.randomUUID(),
      agentId,
      title: title ?? 'New Session',
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async listSessions(_ctx: BackendContext, agentId: string): Promise<Session[]> {
    return Array.from(this.sessions.values()).filter((s) => s.agentId === agentId);
  }

  async getSession(_ctx: BackendContext, _agentId: string, sessionId: string): Promise<Session> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    return s;
  }

  async deleteSession(_ctx: BackendContext, _agentId: string, sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async updateSession(
    _ctx: BackendContext,
    _agentId: string,
    sessionId: string,
    params: { title?: string },
  ): Promise<Session> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    if (params.title !== undefined) {
      s.title = params.title;
    }
    s.updatedAt = new Date().toISOString();
    return s;
  }

  async getSessionMessages(
    _ctx: BackendContext,
    _agentId: string,
    _sessionId: string,
  ): Promise<unknown[]> {
    // MCP 无状态,消息历史由前端维护
    return [];
  }

  /**
   * 发送消息(MCP 语义:调用 agentId 对应的 MCP 工具)。
   *
   * D3 决策(spec-012):非流式。MCP 工具同步返回结果,BFF 包装为:
   * 1. delta chunk(工具返回的文本)
   * 2. done chunk(标记结束)
   *
   * @param ctx 租户上下文
   * @param req.agentId MCP 工具名(如 "qa-pipeline")
   * @param req.content 用户查询文本,作为工具的 query 参数
   */
  async sendMessage(ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable> {
    try {
      // MCP 语义:agentId 即工具名;缺失时回退到首个可用工具
      const toolName = req.agentId ?? '';
      if (!toolName) {
        return this.errorStream('MCP sendMessage requires agentId (tool name)');
      }
      const text = await this.callMCPTool(toolName, { query: req.content });
      return this.wrapAsStream(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.errorStream(`MCP tool call failed: ${message}`);
    }
  }

  async cancelMessage(_ctx: BackendContext, _sessionId: string): Promise<void> {
    // no-op,MCP 工具调用同步返回,无法中途取消
  }

  /**
   * 健康检查:尝试连接 MCP Server 并 listTools。
   * 失败时清理缓存,下次重试。
   */
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.listTools();
      return true;
    } catch {
      // 连接失败时清理缓存,下次重试
      this.clearClient();
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    return this.defaultCapabilities;
  }

  // -----------------------------------------------------------------------
  // 供子类复用的工具方法
  // -----------------------------------------------------------------------

  /**
   * 通用 MCP 工具调用(供 IMCPAdapter 方法使用)。
   *
   * 设置 30s 超时(spec-012 §7.3),超时抛错。
   *
   * @param name 工具名(如 "qa-pipeline")
   * @param args 工具参数(如 { query: "..." })
   * @returns 工具返回的文本内容
   */
  protected async callMCPTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const client = await this.getClient();
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { signal: AbortSignal.timeout(MCP_TOOL_TIMEOUT_MS) },
    );
    // callTool 返回联合类型(task 模式分支无 content);extractToolResultText
    // 内部有 !result.content 运行时守卫,安全断言为 CallToolResult
    return this.extractToolResultText(result as CallToolResult);
  }

  /**
   * 从 MCP tool result 提取文本内容。
   *
   * MCP 工具返回格式:{ content: [{ type: 'text', text: '...' }] }
   *
   * 评审 Q2 修复:使用 SDK 的 CallToolResult 类型替代宽松的 unknown 断言,
   * 防止 SDK API 变更时编译器无法捕获。
   */
  protected extractToolResultText(result: CallToolResult): string {
    if (!result.content) return '';
    return result.content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          c.type === 'text' && typeof c.text === 'string',
      )
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * 将同步文本包装为 StreamChunk 流(delta + done)。
   * 空文本时仅产出 done chunk。
   *
   * 评审 Q4 修复:返回类型显式标注为 AsyncGenerator<StreamChunk>,
   * 替代宽松的 StreamIterable,提升类型可读性。
   */
  protected async *wrapAsStream(text: string): AsyncGenerator<StreamChunk> {
    if (text) {
      yield { type: 'delta' as const, content: text };
    }
    yield { type: 'done' as const };
  }

  /**
   * 产出 error chunk 流(工具调用失败时使用)。
   *
   * 评审 Q4 修复:同 wrapAsStream,显式 AsyncGenerator<StreamChunk>。
   */
  protected async *errorStream(message: string): AsyncGenerator<StreamChunk> {
    yield { type: 'error' as const, message };
  }
}
