/**
 * OpenAICompatibleBaseAdapter — OpenAI 兼容后端的抽象基类。
 *
 * 复用对象(spec-008 A3-3 / spec-010 v8.3): intellect-community / hermes / agent-scope 三个 OpenAI 兼容后端。
 * (v8.3:KAG 移出,改继承 MCPBaseAdapter,见 spec-012)
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction): Layer 1 所有后端必选实现,本基类提供默认实现
 * - Principle IV (SSE Dual-Protocol): sendMessage 返回 AsyncIterable<StreamChunk>,
 *   基类 doChat() 调用上游 /v1/chat/completions,用 parseOpenAISSE 解析
 * - B3 安全约束: 强制删除客户端 X-Intellect- 与 Authorization 头,统一由 BFF 注入可信 token
 * - M6 SSRF 防护(评审 S1/S2/S3 修复): doChat/healthCheck 统一走 safeFetch,含 DNS rebinding 校验、
 *   私有 IP 过滤、redirect: manual、超时控制
 * - M7 sendMessage: 多轮对话走前端 history 方案(OpenAI 兼容后端无 session 持久化,
 *   messages 数组由前端构造)
 *
 * 设计说明(评审 Q1 修复):
 * - doChat 上提到基类,子类仅需提供 modelId/protocolFamily getter,消除重复代码
 * - session 相关方法提供内存 Map 默认实现(YAGNI,多轮对话走前端 history)
 * - 不实现 submitApproval/submitClarify(OpenAI 兼容后端无审批/澄清语义)
 * - cancelMessage 为 no-op(OpenAI 兼容后端通常不支持取消)
 */

import type { IHarnessAdapter } from '../../../types/adapter';
import type { AgentSummary, Session, SendMessageRequest } from '../../../types/domain';
import type { StreamIterable } from '../../../types/stream';
import type { HarnessCapabilities, HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import { safeFetch } from '../../ssrf-guard';
import { parseOpenAISSE } from './sse-parser';

/** doChat 默认连接+首字节超时(毫秒) */
const DOCHAT_TIMEOUT_MS = 30_000;
/** healthCheck 默认超时(毫秒) */
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

export abstract class OpenAICompatibleBaseAdapter implements IHarnessAdapter {
  readonly adapterKind = 'harness-core' as const;
  readonly backendId: string;
  protected readonly baseUrl: string;
  protected readonly adminToken: string;
  protected readonly capabilities: HarnessCapabilities;

  // 内存 session 存储(YAGNI,多轮对话走前端 history)
  private readonly sessions = new Map<string, Session>();

  constructor(backend: HarnessBackend) {
    this.backendId = backend.id;
    this.baseUrl = backend.endpoint.replace(/\/$/, '');
    this.adminToken = backend.adminToken;
    // AdapterRegistry 按 backend.type 路由,OpenAI 兼容后端 capabilities 必为 HarnessCapabilities
    this.capabilities = backend.capabilities as HarnessCapabilities;
  }

  // -----------------------------------------------------------------------
  // 子类必须实现的抽象方法
  // -----------------------------------------------------------------------

  /** 上游模型 ID,如 'gpt-4o' / 'deepseek-chat' */
  protected abstract get modelId(): string;

  /**
   * 后端显示标识,用于默认 agent 名称,如 'intellect-community' / 'hermes'。
   * 注意:此处返回后端标识用于显示,非 spec §3.1 ProtocolFamily 枚举值
   * (评审 Q2:语义澄清,避免与 ProtocolFamily 类型混淆)
   */
  protected abstract get protocolFamily(): string;

  // -----------------------------------------------------------------------
  // Agent methods
  // -----------------------------------------------------------------------

  async listAgents(_ctx: BackendContext): Promise<AgentSummary[]> {
    // OpenAI 兼容后端通常无 agent 列表,返回单个默认 agent
    return [
      {
        id: this.modelId,
        name: this.protocolFamily,
        description: 'OpenAI-compatible default agent',
        modelId: this.modelId,
      },
    ];
  }

  async getAgent(_ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    return {
      id: agentId,
      name: this.protocolFamily,
      description: 'OpenAI-compatible agent',
      modelId: this.modelId,
    };
  }

  // -----------------------------------------------------------------------
  // Session methods (内存 Map 默认实现,YAGNI)
  // -----------------------------------------------------------------------

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
    // OpenAI 兼容后端无 session 持久化,消息历史由前端维护
    return [];
  }

  // -----------------------------------------------------------------------
  // Message streaming (M7: 多轮对话走前端 history)
  // -----------------------------------------------------------------------

  async sendMessage(ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable> {
    // M7: messages 数组由前端构造(走前端 history 方案),基类 doChat 负责调用上游
    return this.doChat(ctx, req);
  }

  /**
   * 实际调用上游 /v1/chat/completions 并返回 StreamChunk 迭代器。
   *
   * 评审 Q1 修复:doChat 上提到基类,子类无需重复实现。
   * 评审 S1/S2/S3 修复:统一走 safeFetch,含 SSRF 防护 + 30s 超时 + redirect: manual。
   *
   * 子类如需自定义请求体(如注入工具调用参数),可覆盖此方法。
   */
  protected async doChat(_ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable> {
    // M7: 单轮 user message(多轮对话走前端 history 方案,YAGNI)
    const body = {
      model: this.modelId,
      messages: [{ role: 'user', content: req.content }],
      stream: true,
    };
    const resp = await safeFetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      timeoutMs: DOCHAT_TIMEOUT_MS,
      // safeFetch 内部强制 redirect: 'manual'(SSRF 防护)
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(
        `${this.protocolFamily} chat completions failed: ${resp.status} ${text}`,
      );
    }
    return parseOpenAISSE(resp.body);
  }

  async cancelMessage(_ctx: BackendContext, _sessionId: string): Promise<void> {
    // OpenAI 兼容后端通常不支持 cancel,no-op
  }

  // -----------------------------------------------------------------------
  // Health & discovery
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      // 评审 S1/S3 修复:healthCheck 也走 safeFetch(SSRF + redirect: manual)
      const resp = await safeFetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
        timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    return this.capabilities;
  }

  // -----------------------------------------------------------------------
  // B3 安全约束: 构建 headers,强制删除客户端注入
  // -----------------------------------------------------------------------

  /**
   * 构建发往上游的 headers。
   *
   * B3 安全约束:
   * - 统一由 BFF 注入可信 Authorization token,不透传客户端凭证
   * - 强制删除 X-Intellect-* 头,防止客户端伪造租户/用户身份
   *
   * 评审 S6 修复:adminToken 为空时不设置 Authorization 头(避免发送 "Bearer " 尾空格)
   *
   * @param extra 额外 headers(子类可传入,但 X-Intellect- 与 Authorization 会被覆盖)
   */
  protected buildHeaders(extra?: Record<string, string>): Headers {
    const headers = new Headers();
    // 评审 S6:仅当 adminToken 非空时注入 Authorization
    if (this.adminToken) {
      headers.set('Authorization', `Bearer ${this.adminToken}`);
    }
    headers.set('Content-Type', 'application/json');
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        headers.set(k, v);
      }
    }
    // B3: 强制不透传客户端 X-Intellect-* 头(即使 extra 中包含也删除)
    headers.delete('X-Intellect-User');
    headers.delete('X-Intellect-Team');
    headers.delete('X-Intellect-Project');
    headers.delete('X-Intellect-Tenant');
    headers.delete('X-Intellect-Session-Id');
    headers.delete('X-Intellect-Session-Key');
    return headers;
  }
}
