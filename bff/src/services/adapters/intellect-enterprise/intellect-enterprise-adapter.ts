// @see specs/004-intellect-enterprise-adapter/data-model.md (实体 1)
// @see specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts
/**
 * IntellectEnterpriseAdapter — Intellect 企业版(intellect-team)Adapter 实现。
 *
 * Authority source: specs/004-intellect-enterprise-adapter/data-model.md
 * Runtime: bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts
 *
 * Constitution references (v1.3.0):
 * - Principle II (Adapter Abstraction): Layer 1 所有后端必选实现
 * - Principle IV (SSE Dual-Protocol): sendMessage 用 parseIntellectEnterpriseRunEventsSSE
 *   (v1.3.0 /v1/runs events SSE 格式,不复用 parseIntellectEnterpriseSSE/parseCanvasWorkflowSSE)
 * - Principle V (Tenant Isolation): 注入 X-Intellect-Team / X-Intellect-Project 头
 *   (通过 httpClient 统一注入,BffTenant.intellectTenantId 映射到 BackendContext.intellectTeamId)
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract):
 *   v1.3.0 主通道 POST /v1/runs + GET /v1/runs/{run_id}/events,鉴权 API_SERVER_KEY
 *   审批端点 POST /v1/runs/{run_id}/approval
 *
 * Naming: 类名 IntellectEnterpriseAdapter,目录 intellect-enterprise/(Constitution 命名规范)
 */

import type { IHarnessAdapter } from '../../../types/adapter';
import type {
  AgentSummary,
  Session,
  SendMessageRequest,
} from '../../../types/domain';
import type { StreamIterable } from '../../../types/stream';
import type { HarnessCapabilities, HarnessBackend } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import {
  IntellectEnterpriseHttpClient,
  IntellectNotFoundError,
  IntellectBackendError,
} from './http-client';
import { parseIntellectEnterpriseRunEventsSSE } from './parse-intellect-enterprise-run-events-sse';

/**
 * 企业版默认能力(当 /v1/capabilities 端点不存在时降级返回)。
 * research.md R4 决策:canvas=false(Principle III),multiTenant=true(Principle V,实例内 Team/Project 组织模型)。
 * 注意:真正的租户隔离通过多实例部署实现,multiTenant flag 仅表示实例内 Team/Project 组织能力。
 */
const DEFAULT_ENTERPRISE_CAPABILITIES: HarnessCapabilities = {
  canvas: false,
  knowledgeBase: false,
  memory: true,
  mcp: true,
  multiTenant: true,
  modelManagement: false,
};

/**
 * 将时间值归一化为 ISO 字符串。
 * 兼容三种输入:
 * - number: Unix 秒(Gateway started_at/ended_at 字段,float)
 * - string: ISO 字符串或数字字符串
 * - undefined/null: 回退到当前时间
 */
function toIsoString(v: unknown): string {
  if (v == null) {
    return new Date().toISOString();
  }
  if (typeof v === 'number') {
    // Unix 秒 → ISO 字符串(Gateway 使用秒,JS Date 使用毫秒)
    return new Date(v * 1000).toISOString();
  }
  if (typeof v === 'string') {
    // 数字字符串 → 当作 Unix 秒处理
    const num = Number(v);
    if (!Number.isNaN(num) && /^\d+(\.\d+)?$/.test(v)) {
      return new Date(num * 1000).toISOString();
    }
    // 已是 ISO 字符串或其它可解析格式
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * session→run / clarify→run 映射的容量上限(防内存泄漏,超限清理最早条目)。
 */
const MAX_TRACKED_RUNS = 512;

/**
 * sessionRuns 的租户作用域键(S1 加固):`<backendId>:<sessionId>`。
 * 同一 adapter 实例可能被多个租户共享(Registry 按 harness backendId 缓存),
 * 不带租户前缀会跨租户命中他人 run。
 */
function sessionRunKey(backendId: string, sessionId: string): string {
  return `${backendId}:${sessionId}`;
}

/**
 * Intellect 企业版 Adapter 实现。
 * 封装 intellect-team REST API 调用,baseUrl 形如 'http://localhost:9091'。
 */
export class IntellectEnterpriseAdapter implements IHarnessAdapter {
  readonly backendId: string;
  readonly adapterKind = 'multi-tenant' as const;
  private readonly httpClient: IntellectEnterpriseHttpClient;
  private readonly capabilities: HarnessCapabilities;
  /**
   * sessionId → 最近一次 run_id(cancelMessage → POST /v1/runs/{run_id}/stop 用)。
   * S1 加固:键含 BackendContext.backendId(租户作用域)。AdapterRegistry 按 harness
   * backendId 缓存实例,多租户绑定同一后端时共享实例——不带租户前缀会导致
   * 跨租户可停他人 run(评审 S1)。
   */
  private readonly sessionRuns = new Map<string, string>();
  /**
   * clarifyId → run 信息(社区版 clarify 提交走 /v1/runs/{run_id}/clarify,需要 run_id)。
   * S1 加固:值携带 ownerBackendId,submitClarify 时校验租户一致才走社区分支。
   */
  private readonly clarifyRuns = new Map<
    string,
    { runId: string; ownerBackendId: string }
  >();

  constructor(backend: HarnessBackend) {
    this.backendId = backend.id;
    const baseUrl = backend.endpoint.replace(/\/$/, '');
    // Constitution Principle VIII: adminToken 字段承载 API_SERVER_KEY(env 注入)
    this.httpClient = new IntellectEnterpriseHttpClient(baseUrl, backend.adminToken);
    // AdapterRegistry 按 backend.type 路由,enterprise 后端 capabilities 必为 HarnessCapabilities
    this.capabilities = backend.capabilities as HarnessCapabilities;
  }

  /**
   * 方案 2 (P2):清除 tenant 健康度缓存。
   * 由 AdapterRegistry.invalidate() 调用,管理操作后立即重新校验。
   */
  clearTenantCache(): void {
    this.httpClient.clearTenantCache();
  }

  // -----------------------------------------------------------------------
  // Agent methods (US1)
  // -----------------------------------------------------------------------

  async listAgents(ctx: BackendContext): Promise<AgentSummary[]> {
    try {
      const data = await this.httpClient.request<{ data: unknown[] } | unknown[]>(
        'GET',
        '/v1/models',
        ctx,
      );
      // intellect-team /v1/models 可能返回 {data:[...]} 或 [...] 兼容两种
      const arr = Array.isArray(data) ? data : data?.data ?? [];
      return arr.map((m) => this.normalizeAgent(m));
    } catch (err) {
      // Principle VII:后端不可达返回空数组 + console.warn,不抛异常
      if (
        err instanceof IntellectNotFoundError ||
        err instanceof IntellectBackendError
      ) {
        console.warn(
          `[IntellectEnterpriseAdapter] listAgents failed: ${(err as Error).message}`,
        );
        return [];
      }
      throw err;
    }
  }

  async getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    const data = await this.httpClient.request<unknown>(
      'GET',
      `/v1/models/${encodeURIComponent(agentId)}`,
      ctx,
    );
    return this.normalizeAgent(data);
  }

  // -----------------------------------------------------------------------
  // Session methods (US2, intellect-team /api/sessions 不嵌套在 agent 下)
  // -----------------------------------------------------------------------

  async createSession(
    ctx: BackendContext,
    _agentId: string,
    title?: string,
    kbIds?: string[],
    promptConfig?: Record<string, unknown>,
  ): Promise<Session> {
    // intellect-team POST /api/sessions, body 可带 title, kb_ids, prompt_config
    const body: Record<string, unknown> = {};
    if (title) body.title = title;
    if (kbIds?.length) body.kb_ids = kbIds;
    if (promptConfig) body.prompt_config = promptConfig;
    const data = await this.httpClient.request<
      { id?: string; session_id?: string; title?: string } | { session: { id?: string; session_id?: string; title?: string } }
    >(
      'POST',
      '/api/sessions',
      ctx,
      Object.keys(body).length > 0 ? body : {},
    );
    return this.normalizeSession(data, _agentId);
  }

  async listSessions(ctx: BackendContext, agentId: string): Promise<Session[]> {
    const data = await this.httpClient.request<
      { data?: unknown[]; sessions?: unknown[] } | unknown[]
    >('GET', '/api/sessions', ctx);
    // gateway 返回 { sessions: [...] },兼容 { data: [...] } 和 [...] 两种格式
    const arr = Array.isArray(data)
      ? data
      : data?.sessions ?? data?.data ?? [];
    return arr.map((s) => this.normalizeSession(s, agentId));
  }

  async getSession(
    ctx: BackendContext,
    agentId: string,
    sessionId: string,
  ): Promise<Session> {
    const data = await this.httpClient.request<unknown>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      ctx,
    );
    // Gateway GET /api/sessions/{id} 响应格式: { object: "intellect.session", session: {...} }
    // 与 PATCH 响应格式一致,需解包 session 字段后再归一化。
    const session = (data as { session?: unknown })?.session ?? data;
    return this.normalizeSession(session, agentId);
  }

  async deleteSession(
    ctx: BackendContext,
    _agentId: string,
    sessionId: string,
  ): Promise<void> {
    await this.httpClient.request<void>(
      'DELETE',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      ctx,
    );
  }

  async updateSession(
    ctx: BackendContext,
    agentId: string,
    sessionId: string,
    params: { title?: string },
  ): Promise<Session> {
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) {
      body.title = params.title;
    }
    const data = await this.httpClient.request<unknown>(
      'PATCH',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      ctx,
      body,
    );
    // Gateway PATCH 响应格式: { object: "intellect.session", session: {...} }
    const session = (data as { session?: unknown })?.session ?? data;
    return this.normalizeSession(session, agentId);
  }

  async getSessionMessages(
    ctx: BackendContext,
    _agentId: string,
    sessionId: string,
  ): Promise<unknown[]> {
    const data = await this.httpClient.request<
      { messages?: unknown[] } | unknown[]
    >('GET', `/api/sessions/${encodeURIComponent(sessionId)}/messages`, ctx);
    // Gateway 返回 { messages: [...] },兼容裸数组
    return Array.isArray(data) ? data : data?.messages ?? [];
  }

  // -----------------------------------------------------------------------
  // Message streaming (v1.3.0: sendMessage via /v1/runs flow)
  // -----------------------------------------------------------------------

  /**
   * 发送消息并返回流式响应(v1.3.0 /v1/runs 主通道)。
   *
   * Constitution Principle VIII v1.3.0 三步流程:
   * 1. POST /v1/runs 创建 run,body {input, session_id, model?, instructions?}
   * 2. 响应 {run_id, status: "started", session_id}(HTTP 202)
   * 3. GET /v1/runs/{run_id}/events 订阅 SSE 流(长连接,终态事件后自动关闭)
   *
   * 与 v1.2.0 legacy 通道(/api/sessions/{id}/chat/stream)的差异:
   * - 事件格式:data: {event:"<name>",...}(无独立 event: 行)
   * - 事件名:message.delta / tool.progress / approval.request / run.completed
   * - 原生支持 approval 事件(legacy 通道不发射 approval 事件)
   *
   * Run ID 管理:
   * - BFF 保存 POST /v1/runs 响应中的 run_id
   * - 前端通过 StreamApprovalRequest.runId 字段获取,提交审批时回传
   * - 不存在 GET /v1/runs?session_id= 查询端点,丢失 run_id 后无法反查
   */
  async sendMessage(
    ctx: BackendContext,
    req: SendMessageRequest,
  ): Promise<StreamIterable> {
    // Step 1: POST /v1/runs 创建 run
    const runResponse = await this.httpClient.request<{
      run_id: string;
      status?: string;
      session_id?: string;
    }>('POST', '/v1/runs', ctx, {
      input: req.content,
      session_id: req.sessionId,
      // model 仅来自 modelId；agentId 是会话/agent 标识符（如占位常量 'chat'），不是模型名。
      // 不传 model 时 Gateway 使用 config.yaml 中配置的默认模型（如 deepseek-chat）。
      ...(req.modelId ? { model: req.modelId } : {}),
      ...(req.attachments ? { attachments: req.attachments } : {}),
    });

    const runId = runResponse.run_id;
    if (!runId) {
      throw new IntellectBackendError(
        'POST /v1/runs response missing run_id',
        502,
      );
    }

    // 记录 session → 最近 run(cancelMessage 停止生成用),租户作用域 + 容量上限防泄漏
    if (req.sessionId) {
      this.sessionRuns.set(sessionRunKey(ctx.backendId, req.sessionId), runId);
      if (this.sessionRuns.size > MAX_TRACKED_RUNS) {
        const oldest = this.sessionRuns.keys().next().value;
        if (oldest !== undefined) this.sessionRuns.delete(oldest);
      }
    }

    // Step 2: GET /v1/runs/{run_id}/events 订阅 SSE 流
    const eventsPath = `/v1/runs/${encodeURIComponent(runId)}/events`;
    const stream = await this.httpClient.requestGetStream(eventsPath, ctx);

    // Step 3: 用 /v1/runs events 解析器解析。
    // 外层包装拦截 clarify_request:记录 clarifyId → runId(含归属租户),
    // submitClarify 据此选择社区版(/v1/runs/{run_id}/clarify)或企业版提交路径。
    const self = this;
    const ownerBackendId = ctx.backendId;
    const inner = parseIntellectEnterpriseRunEventsSSE(stream);
    return (async function* () {
      for await (const chunk of inner) {
        if (chunk.type === 'clarify_request' && chunk.clarifyId) {
          self.clarifyRuns.set(chunk.clarifyId, { runId, ownerBackendId });
          if (self.clarifyRuns.size > MAX_TRACKED_RUNS) {
            const oldest = self.clarifyRuns.keys().next().value;
            if (oldest !== undefined) self.clarifyRuns.delete(oldest);
          }
        }
        yield chunk;
      }
    })();
  }

  async cancelMessage(ctx: BackendContext, sessionId: string): Promise<void> {
    // 停止生成:社区版与企业版均提供 POST /v1/runs/{run_id}/stop
    // (社区版实证:community adapter.py:4674;仅断开客户端 SSE 时网关侧 run 会继续跑完)
    const key = sessionRunKey(ctx.backendId, sessionId);
    const runId = this.sessionRuns.get(key);
    if (!runId) {
      // 无映射:常见于 BFF 重启丢内存态、registry 未就绪的每请求 adapter 兜底路径,
      // 或其他租户上下文的会话(租户隔离,评审 S1)。回退为仅断开客户端流。
      console.warn(
        `[IntellectEnterpriseAdapter] cancelMessage: no run tracked for ${key} (client abort only)`,
      );
      return;
    }
    this.sessionRuns.delete(key);
    try {
      await this.httpClient.request<unknown>(
        'POST',
        `/v1/runs/${encodeURIComponent(runId)}/stop`,
        ctx,
        {},
      );
    } catch (err) {
      // stop 失败(404 run 已结束/409 已停止)不影响客户端取消流程,记日志即可
      console.warn(
        `[IntellectEnterpriseAdapter] cancelMessage stop run ${runId} failed: ${(err as Error).message}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Approval (v1.3.0 新增,Constitution Principle VIII)
  // -----------------------------------------------------------------------

  /**
   * 提交工具审批(v1.3.0 新增)。
   *
   * Constitution Principle VIII v1.3.0:
   * - 调用 intellect-team POST /v1/runs/{run_id}/approval 端点
   * - 请求体:{choice: "once"|"session"|"always"|"deny", all?, resolve_all?}
   * - 响应体:{object: "intellect.run.approval_response", run_id, choice, resolved}
   * - 错误码:400 invalid_approval_choice / 404 run_not_found / 409 approval_not_active / 409 approval_not_pending
   *
   * @param ctx 租户上下文
   * @param runId Run ID(从 StreamApprovalRequest.runId 获取)
   * @param choice 审批选项
   */
  async submitApproval(
    ctx: BackendContext,
    runId: string,
    choice: 'once' | 'session' | 'always' | 'deny',
  ): Promise<{
    runId: string;
    choice: 'once' | 'session' | 'always' | 'deny';
    resolved: number;
  }> {
    const path = `/v1/runs/${encodeURIComponent(runId)}/approval`;
    const data = await this.httpClient.request<{
      run_id?: string;
      choice?: string;
      resolved?: number;
    }>('POST', path, ctx, { choice });

    // 校验响应
    const respChoice = data.choice;
    if (
      respChoice !== 'once' &&
      respChoice !== 'session' &&
      respChoice !== 'always' &&
      respChoice !== 'deny'
    ) {
      throw new IntellectBackendError(
        `POST ${path} invalid choice in response: ${String(respChoice)}`,
        502,
      );
    }

    return {
      runId: typeof data.run_id === 'string' ? data.run_id : runId,
      choice: respChoice,
      resolved: typeof data.resolved === 'number' ? data.resolved : 0,
    };
  }

  // -----------------------------------------------------------------------
  // Clarify (v1.4.0 新增,Gateway set_clarify_fn 注入的 clarify 工具回调)
  // -----------------------------------------------------------------------

  /**
   * 提交 clarify 答案(v1.4.0 新增)。
   *
   * Gateway `set_clarify_fn` 注入的 clarify 工具回调:
   * - 调用 intellect-team `POST /v1/chat/completions/{session_id}/clarify` 端点
   * - 请求体:`{clarify_id, answer}`
   * - 响应体:`{status: "ok"}` / 400 缺字段 / 403 session 归属错 / 404 无活跃 clarify
   *
   * 注:此端点走 /v1/chat/completions 路径提交答案(与 sendMessage 的 /v1/runs 主通道不同)。
   * clarify_fn 必须在 /v1/runs handler 注入,BFF 才能通过 /v1/runs/{run_id}/events 收到 clarify 事件;
   * 提交答案端点 /v1/chat/completions/{session_id}/clarify 是独立的 REST 端点,与 clarify_fn 注入位置无关。
   * BFF 走 Adapter 抽象,前端不感知路径差异。
   *
   * @param ctx 租户上下文
   * @param sessionId Session ID(从 StreamClarifyRequest.sessionId 获取)
   * @param clarifyId clarify ID(从 StreamClarifyRequest.clarifyId 获取)
   * @param answer 用户输入的答案文本
   */
  async submitClarify(
    ctx: BackendContext,
    sessionId: string,
    clarifyId: string,
    answer: string,
  ): Promise<{ status: string }> {
    // 双网关路径自适应:
    // - 社区版 api_server:POST /v1/runs/{run_id}/clarify,body {response, clarify_id?}
    //   (community adapter.py:4444,clarifyId→runId 由 sendMessage 流拦截记录)
    // - 企业版网关:POST /v1/chat/completions/{session_id}/clarify,body {clarify_id, answer}
    // S1/S2 加固:仅当 clarify 归属当前租户上下文(backendId 一致)才走社区分支;
    // 不匹配时视为未记录(不删除条目、不泄露存在性),落入企业版路径由网关校验归属。
    const tracked = this.clarifyRuns.get(clarifyId);
    if (tracked && tracked.ownerBackendId === ctx.backendId) {
      this.clarifyRuns.delete(clarifyId);
      const communityPath = `/v1/runs/${encodeURIComponent(tracked.runId)}/clarify`;
      const data = await this.httpClient.request<{ status?: string }>(
        'POST',
        communityPath,
        ctx,
        { response: answer, clarify_id: clarifyId },
      );
      if (data.status === undefined) {
        return { status: 'ok' };
      }
      if (typeof data.status !== 'string') {
        throw new IntellectBackendError(
          `submitClarify ${communityPath}: upstream returned non-string status: ${JSON.stringify(data.status)}`,
          502,
        );
      }
      return { status: data.status };
    }

    const path = `/v1/chat/completions/${encodeURIComponent(sessionId)}/clarify`;
    const data = await this.httpClient.request<{ status?: string }>(
      'POST',
      path,
      ctx,
      { clarify_id: clarifyId, answer },
    );
    // Gateway 正常响应 {status: "ok"}。仅当 status 字段缺失时兜底为 "ok"
    // (兼容上游省略字段的合法情况);若 status 为非 string 类型则视为异常,抛出错误。
    if (data.status === undefined) {
      return { status: 'ok' };
    }
    if (typeof data.status !== 'string') {
      throw new IntellectBackendError(
        `submitClarify ${path}: upstream returned non-string status: ${JSON.stringify(data.status)}`,
        502,
      );
    }
    return { status: data.status };
  }

  // -----------------------------------------------------------------------
  // Health & discovery (US1)
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      await this.httpClient.request('GET', '/health', {
        backendId: '',
        userId: '',
      });
      return true;
    } catch {
      // Principle VII:不抛异常,返回 false
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    try {
      const data = await this.httpClient.request<Partial<HarnessCapabilities>>(
        'GET',
        '/v1/capabilities',
        { backendId: '', userId: '' },
      );
      // 合并默认能力(确保所有字段存在)
      return { ...DEFAULT_ENTERPRISE_CAPABILITIES, ...data };
    } catch (err) {
      if (
        err instanceof IntellectNotFoundError ||
        err instanceof IntellectBackendError
      ) {
        // research.md R4:端点不存在降级返回默认能力
        console.warn(
          `[IntellectEnterpriseAdapter] discoverCapabilities fallback to defaults: ${(err as Error).message}`,
        );
        return { ...DEFAULT_ENTERPRISE_CAPABILITIES };
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * 归一化 intellect-team /v1/models 响应为 AgentSummary。
   * 兼容 {id,name,description} 和 {id,object,owned_by} 两种格式。
   */
  private normalizeAgent(raw: unknown): AgentSummary {
    const m = raw as Record<string, unknown>;
    return {
      id: String(m.id ?? ''),
      name: String(m.name ?? m.id ?? ''),
      description: m.description ? String(m.description) : undefined,
    };
  }

  /**
   * 归一化 intellect-team /api/sessions 响应为 Session。
   *
   * 兼容三种上游响应格式:
   * 1. POST /api/sessions 响应(Rust + Python 对齐后):
   *    { session_id: "xxx", title?: "..." }
   * 2. GET /api/sessions/{id} 响应(Rust + Python 对齐后):
   *    { session: { id: "xxx", title?: "...", started_at?, ... } }
   * 3. GET /api/sessions 列表项(扁平结构):
   *    { id: "xxx", title?: "...", started_at?, ... }
   *
   * 时间字段:Gateway 使用 started_at/ended_at(Unix 秒,float),
   * 兼容 created_at/updated_at(ISO 字符串)与 createdAt/updatedAt(camelCase)。
   */
  private normalizeSession(raw: unknown, agentId: string): Session {
    const s = raw as Record<string, unknown>;
    // X-T1: 兼容 {session: {...}} 嵌套格式(GET /{id} 响应)
    const sessionObj = (s.session && typeof s.session === 'object'
      ? s.session
      : s) as Record<string, unknown>;
    const id = String(
      sessionObj.id ??        // GET 列表项 / GET /{id} 嵌套对象
      s.session_id ??         // POST 响应(顶层 session_id)
      sessionObj.session_id ?? // POST 响应(若包裹在 session 内)
      '',
    );
    const startedAt = sessionObj.started_at ?? sessionObj.created_at ?? sessionObj.createdAt;
    const endedAt = sessionObj.ended_at ?? sessionObj.updated_at ?? sessionObj.updatedAt ?? startedAt;
    return {
      id,
      agentId,
      title: sessionObj.title ? String(sessionObj.title) : (sessionObj.name as string | undefined),
      createdAt: toIsoString(startedAt),
      updatedAt: toIsoString(endedAt),
    };
  }
}
