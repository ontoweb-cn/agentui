// @see specs/002-multi-harness-p1/data-model.md (实体 6)
/**
 * BFF Agent 原生路由 — Multi-Harness P1 US1。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF 调用,不直连 Intellect RAG
 * - Principle II (Adapter Abstraction): 路由层调 Adapter,不感知具体后端
 *
 * 路径映射:
 * - GET    /api/bff/agents                   → adapter.listAgents(ctx)
 * - GET    /api/bff/agents/:id               → adapter.getAgent(ctx, id)
 * - GET    /api/bff/agents/:agentId/sessions → adapter.listSessions(ctx, agentId)
 * - POST   /api/bff/agents/:agentId/sessions → adapter.createSession(ctx, agentId, title)
 * - GET    /api/bff/agents/:agentId/sessions/:sessionId → adapter.getSession(ctx, agentId, sessionId)
 * - DELETE /api/bff/agents/:agentId/sessions/:sessionId → adapter.deleteSession(ctx, agentId, sessionId)
 * - POST   /api/bff/agents/chat/completions  → adapter.sendMessage(US2 实现)
 * - POST   /api/bff/agents/:agentId/runs/:runId/approval → adapter.submitApproval(v1.3.0)
 * - POST   /api/bff/agents/:agentId/sessions/:sessionId/clarify → adapter.submitClarify(v1.4.0)
 *
 * spec-008: 画布 DSL 创建/编辑/删除(POST/PUT/DELETE /agents)已迁到 /canvas/* 路由。
 *
 * P1 占位 Registry:从 HarnessStore 获取首个 intellect-rag backend,直接 new IntellectRagAdapter。
 * US3 替换为 AdapterRegistry.getAdapterForBackend(tenantId)。
 */

import { Hono, type Context } from 'hono';
import { IntellectRagAdapter } from '../services/adapters/intellect-rag/intellect-rag-adapter';
import { IntellectEnterpriseAdapter } from '../services/adapters/intellect-enterprise/intellect-enterprise-adapter';
import type { HarnessStore, BackendStore } from '../types';
import type { BackendContext } from '../types/tenant';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import { getBackendContext, resolveBackendContext } from '../middleware/backend-context';
import type { IHarnessAdapter } from '../types/adapter';
import { safeJsonSerialize } from '../utils/serialize';
import { registerRun, verifyRunOwnership } from '../services/run-registry';

// Hono context variables for BFF agent routes
interface BffAgentVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  backendContext?: BackendContext;
}

export const bffAgentRoutes = new Hono<{ Variables: BffAgentVariables }>();

/**
 * US3:从 AdapterRegistry 按 tenantId 获取 Adapter(替换 US1 占位直接 new IntellectRagAdapter)。
 *
 * Constitution Principle II:Registry 按 tenantId 选择 Adapter,路由层不感知后端。
 * Constitution Principle V:tenantId 从 BackendContext 中间件注入的 ctx 提取。
 *
 * 安全约束(P3 评审 H1 修复):
 * - 不再有"首个 intellect-rag/enterprise backend"兜底,避免多租户环境下跨租户路由。
 *   原兜底从 harnessStore.list() 取第一个匹配类型的 backend,在多租户部署下可能将
 *   请求路由到其他租户的 intellect-team 实例,违反"一个实例=一个租户"的隔离约束。
 * - Registry 主路径失败时,通过 BackendContext.backendId → BackendStore → BffTenant.intellectBackendId
 *   → HarnessStore.get 解析对应 backend,确保每个请求只能访问其绑定的实例。
 * - BackendContext 缺失(中间件未挂载或前端未传 X-Backend-Id)时返回 null,路由层返回 503。
 *
 * 注:P1 阶段仅注册 intellect-rag factory,P3 起注册 intellect-enterprise factory,
 * 因此返回类型为 IHarnessAdapter(非具体 IntellectRagAdapter),路由层按接口调用。
 */
function getAdapter(c: Context): IHarnessAdapter | null {
  const ctx = getBackendContext(c);
  if (!ctx) {
    // BackendContext 缺失:中间件未挂载或前端未传 X-Backend-Id。
    // 不再回退到"首个 backend",避免多租户环境跨租户路由。
    return null;
  }

  // US3 主路径:经 AdapterRegistry + BackendContext
  const registry = c.get('adapterRegistry');
  if (registry && registry.isReady()) {
    try {
      // Registry 按 backend.type 动态返回 IntellectRagAdapter 或 IntellectEnterpriseAdapter
      return registry.getAdapterForBackend(ctx.backendId);
    } catch (err) {
      console.warn(
        `[bff-agents] Registry lookup failed for tenant ${ctx.backendId}:`,
        (err as Error).message,
      );
      // 落入 BackendContext 解析路径(保持租户隔离)
    }
  }

  // 安全兜底:通过 BackendContext.backendId 解析绑定的 HarnessBackend。
  // 不再扫描 harnessStore.list() 取首个匹配,确保仅访问当前请求绑定的实例。
  const harnessStore = c.get('harnessStore');
  const backendStore = c.get('backendStore');
  if (!harnessStore || !backendStore) {
    return null;
  }
  const bffTenant = backendStore.getBackend(ctx.backendId);
  if (!bffTenant) {
    return null;
  }
  const backend = harnessStore.get(bffTenant.intellectBackendId);
  if (!backend) {
    return null;
  }
  if (backend.type === 'intellect-enterprise') {
    return new IntellectEnterpriseAdapter(backend);
  }
  return new IntellectRagAdapter(backend);
}

// --- Agent CRUD (listAgents / getAgent 经 Adapter;create/update/delete 已迁到 canvas routes) ---

/**
 * M2 修复:统一处理 adapter 错误响应,避免向客户端泄露内部信息。
 *
 * - adapter 的 err.message 可能包含内部路径、tenant ID、上游 URL 等敏感信息,
 *   直接透传到前端响应会泄露架构细节,辅助攻击者定位弱点。
 * - 404 检测保留(基于 err.message 包含 "404"),但响应文案统一为 "Not found"。
 * - 其他错误响应使用通用文案 "Adapter error",详细信息记入服务端 console.error。
 * - 503 / 配置错误响应不泄露具体 backendId,避免暴露租户标识。
 */
function handleAdapterError(
  c: Context,
  err: unknown,
  route: string,
): Response {
  const msg = err instanceof Error ? err.message : String(err);
  // 详细错误信息记入服务端日志(含 stack 便于排查)
  console.error(`[bff-agents] ${route} adapter error:`, err);
  // 404 检测:基于 err.message 包含 "404"(adapter 抛出的上游 404)
  if (/404/.test(msg)) {
    return c.json({ code: 404, message: 'Not found' }, 404);
  }
  // 其他错误:返回通用文案,不透传 err.message
  return c.json({ code: 502, message: 'Adapter error' }, 502);
}

bffAgentRoutes.get('/agents', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  try {
    const agents = await adapter.listAgents(resolveBackendContext(c));
    return c.json(agents);
  } catch (err) {
    return handleAdapterError(c, err, 'GET /agents');
  }
});

bffAgentRoutes.get('/agents/:id', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const id = c.req.param('id');
  try {
    const agent = await adapter.getAgent(resolveBackendContext(c), id);
    return c.json(agent);
  } catch (err) {
    return handleAdapterError(c, err, 'GET /agents/:id');
  }
});

// --- Agent Sessions (全部经 Adapter) ---

bffAgentRoutes.get('/agents/:agentId/sessions', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  try {
    const sessions = await adapter.listSessions(resolveBackendContext(c), agentId);
    return c.json(sessions);
  } catch (err) {
    return handleAdapterError(c, err, 'GET /agents/:agentId/sessions');
  }
});

bffAgentRoutes.post('/agents/:agentId/sessions', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body?.name === 'string' ? body.name : body?.title;
  try {
    const session = await adapter.createSession(
      resolveBackendContext(c),
      agentId,
      title,
    );
    return c.json(session);
  } catch (err) {
    return handleAdapterError(c, err, 'POST /agents/:agentId/sessions');
  }
});

bffAgentRoutes.get('/agents/:agentId/sessions/:sessionId', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');
  try {
    const session = await adapter.getSession(
      resolveBackendContext(c),
      agentId,
      sessionId,
    );
    return c.json(session);
  } catch (err) {
    return handleAdapterError(c, err, 'GET /agents/:agentId/sessions/:sessionId');
  }
});

bffAgentRoutes.delete('/agents/:agentId/sessions/:sessionId', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');
  try {
    await adapter.deleteSession(resolveBackendContext(c), agentId, sessionId);
    return c.json({ code: 0, message: 'ok' });
  } catch (err) {
    return handleAdapterError(c, err, 'DELETE /agents/:agentId/sessions/:sessionId');
  }
});

// PATCH /agents/:agentId/sessions/:sessionId — 重命名 session(Gateway PATCH /api/sessions/{id})
bffAgentRoutes.patch('/agents/:agentId/sessions/:sessionId', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const params: { title?: string } = {};
  if (typeof body?.name === 'string') {
    params.title = body.name;
  } else if (typeof body?.title === 'string') {
    params.title = body.title;
  }
  if (params.title === undefined) {
    return c.json({ code: 400, message: 'title is required' }, 400);
  }
  try {
    const session = await adapter.updateSession(
      resolveBackendContext(c),
      agentId,
      sessionId,
      params,
    );
    return c.json(session);
  } catch (err) {
    return handleAdapterError(c, err, 'PATCH /agents/:agentId/sessions/:sessionId');
  }
});

// GET /agents/:agentId/sessions/:sessionId/messages — 获取会话消息历史
bffAgentRoutes.get('/agents/:agentId/sessions/:sessionId/messages', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');
  try {
    const messages = await adapter.getSessionMessages(
      resolveBackendContext(c),
      agentId,
      sessionId,
    );
    return c.json({ messages });
  } catch (err) {
    return handleAdapterError(c, err, 'GET /agents/:agentId/sessions/:sessionId/messages');
  }
});

// --- Agent chat completions (US2: 流式经 Adapter + parseCanvasWorkflowSSE) ---
bffAgentRoutes.post('/agents/chat/completions', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const body = await c.req.json().catch(() => ({}));
  const req = {
    sessionId: body?.session_id ?? body?.sessionId ?? '',
    content: body?.content ?? body?.inputs?.content ?? '',
    agentId: body?.agent_id ?? body?.agentId,
    attachments: body?.attachments,
    modelId: body?.model_id ?? body?.modelId,
  };
  try {
    const iterable = await adapter.sendMessage(resolveBackendContext(c), req);
    // 用 SSE 透传 StreamChunk 序列到前端
    return streamChunksAsSSE(c, iterable);
  } catch (err) {
    return handleAdapterError(c, err, 'POST /agents/chat/completions');
  }
});

// --- Agent run approval (v1.3.0: 仅 IntellectEnterpriseAdapter 实现 submitApproval) ---

/**
 * 合法审批选项(Constitution Principle VIII v1.3.0)。
 * 与 intellect-team POST /v1/runs/{run_id}/approval 契约对齐。
 */
const VALID_APPROVAL_CHOICES = ['once', 'session', 'always', 'deny'] as const;
type ApprovalChoice = (typeof VALID_APPROVAL_CHOICES)[number];

function isApprovalChoice(value: unknown): value is ApprovalChoice {
  return (
    typeof value === 'string' &&
    (VALID_APPROVAL_CHOICES as readonly string[]).includes(value)
  );
}

bffAgentRoutes.post(
  '/agents/:agentId/runs/:runId/approval',
  async (c) => {
    const adapter = getAdapter(c);
    if (!adapter) {
      return c.json({ code: 503, message: 'No backend configured' }, 503);
    }

    // 仅 IntellectEnterpriseAdapter 实现 submitApproval(IntellectRagAdapter 不产出 approval 事件)
    if (typeof adapter.submitApproval !== 'function') {
      return c.json(
        { code: 501, message: 'Approval not supported by current backend' },
        501,
      );
    }

    const runId = c.req.param('runId');
    if (!runId) {
      return c.json({ code: 400, message: 'Missing runId' }, 400);
    }

    // P0-S1 修复:校验 runId 归属当前 backend,避免跨租户越权。
    // streamChunksAsSSE 在 approval_request 产出时调 registerRun 注册 runId→backendId,
    // 此处校验请求中的 runId 是否在当前 BackendContext.backendId 下注册过。
    // 未注册/过期/归属不一致均拒绝,防止用户 A 对 tenant-B 的 runId 提交审批。
    const ctx = getBackendContext(c);
    const backendIdForCheck = ctx?.backendId;
    if (!backendIdForCheck) {
      return c.json({ code: 403, message: 'Forbidden: missing backend context' }, 403);
    }
    const ownership = verifyRunOwnership(runId, backendIdForCheck);
    if (!ownership.valid) {
      // 安全:不透传具体 reason(含内部信息),仅服务端日志
      console.warn(
        `[bff-agents] POST /agents/:agentId/runs/${runId}/approval runId ownership check failed: ${ownership.reason}`,
      );
      return c.json({ code: 403, message: 'Forbidden: runId not owned by current backend' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ code: 400, message: 'Request body must be JSON' }, 400);
    }
    const choice = (body as { choice?: unknown }).choice;
    if (!isApprovalChoice(choice)) {
      return c.json(
        {
          code: 400,
          message: `Invalid choice, must be one of: ${VALID_APPROVAL_CHOICES.join(', ')}`,
        },
        400,
      );
    }

    try {
      const result = await adapter.submitApproval(
        resolveBackendContext(c),
        runId,
        choice,
      );
      // P1-S3 修复:校验响应的 resolved>=1,否则视为审批未真正解决,返回 409
      // 防止 adapter 吞了上游 409 后返回 200+resolved=0 误导前端
      if (typeof result.resolved !== 'number' || result.resolved < 1) {
        console.warn(
          `[bff-agents] POST /agents/:agentId/runs/${runId}/approval adapter returned resolved<1:`,
          result,
        );
        return c.json(
          { code: 409, message: 'Approval not active or already resolved' },
          409,
        );
      }
      return c.json(result);
    } catch (err) {
      return handleAdapterError(
        c,
        err,
        `POST /agents/:agentId/runs/${runId}/approval`,
      );
    }
  },
);

// --- Agent session clarify (v1.4.0: 仅 IntellectEnterpriseAdapter 实现 submitClarify) ---

/**
 * POST /agents/:agentId/sessions/:sessionId/clarify — 提交 clarify 答案。
 *
 * Gateway `set_clarify_fn` 注入的 clarify 工具回调:
 * - 前端从 StreamClarifyRequest 事件获取 {clarifyId, sessionId, question, choices}
 * - 用户提交答案后,POST 到此端点,BFF 转发到 intellect-team
 *   `POST /v1/chat/completions/{session_id}/clarify`
 * - 请求体:`{clarify_id, answer}`
 * - 响应体:`{status: "ok"}` / 400 缺字段 / 403 session 归属错 / 404 无活跃 clarify
 *
 * 与 approval 路由的差异:
 * - clarify 没有 runId 归属注册(streamChunksAsSSE 不调 registerRun),
 *   因 clarify 走 /v1/chat/completions 路径,sessionId 已在 URL 中,
 *   且 clarify 是非阻塞 UI(无需像 approval 那样严格防越权)。
 *   安全性依赖 intellect-team 侧 session 归属校验(403)。
 * - clarify 不要求二阶段 responded 事件,适配器直接返回 {status}。
 */
bffAgentRoutes.post(
  '/agents/:agentId/sessions/:sessionId/clarify',
  async (c) => {
    const adapter = getAdapter(c);
    if (!adapter) {
      return c.json({ code: 503, message: 'No backend configured' }, 503);
    }

    // 仅 IntellectEnterpriseAdapter 实现 submitClarify
    if (typeof adapter.submitClarify !== 'function') {
      return c.json(
        { code: 501, message: 'Clarify not supported by current backend' },
        501,
      );
    }

    const sessionId = c.req.param('sessionId');
    if (!sessionId) {
      return c.json({ code: 400, message: 'Missing sessionId' }, 400);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ code: 400, message: 'Request body must be JSON' }, 400);
    }
    const clarifyId =
      typeof (body as { clarify_id?: unknown }).clarify_id === 'string'
        ? (body as { clarify_id: string }).clarify_id
        : '';
    const answer =
      typeof (body as { answer?: unknown }).answer === 'string'
        ? (body as { answer: string }).answer
        : '';
    if (!clarifyId || !answer) {
      return c.json(
        { code: 400, message: 'clarify_id and answer are required' },
        400,
      );
    }

    try {
      const result = await adapter.submitClarify(
        resolveBackendContext(c),
        sessionId,
        clarifyId,
        answer,
      );
      return c.json({ code: 0, data: result });
    } catch (err) {
      return handleAdapterError(
        c,
        err,
        `POST /agents/:agentId/sessions/${sessionId}/clarify`,
      );
    }
  },
);

/**
 * 将 StreamChunk 迭代器序列化为 SSE 事件流透传给前端。
 *
 * Constitution Principle IV v1.3.0:BFF 消费 Adapter 的 StreamChunk 迭代器,
 * 重新序列化为前端期望的 SSE 格式(eventsource-parser 兼容)。
 *
 * 序列化规则:
 * - 每个 StreamChunk 输出为 `data: {json}\n\n` 帧
 * - StreamDelta → {event: "message", data: {content}}
 * - StreamReasoning → {event: "message", data: {content, start_to_think/end_to_think}}
 * - StreamError → {event: "error", data: {message}}
 * - StreamDone → {event: "workflow_finished", data: {}}
 * - StreamApprovalRequest → {event: "approval_request", data: {...}}
 * - StreamApprovalResponded → {event: "approval_responded", data: {...}}
 * - StreamClarifyRequest → {event: "clarify_request", data: {...}}(v1.4.0)
 * - 终止 chunk(done/error)后关闭流
 *
 * tool_* 事件过滤(v1.3.0 新增,用户需求"BFF serializeChunk 过滤 tool_* 事件"):
 * - 当流中出现 approval_request 时,后续 tool_start/tool_complete/tool_progress 事件被过滤(不发送到前端)
 * - 避免前端同时显示 ToolCallCard 和 ApprovalCard 造成 UI 重复
 * - 前端通过 approval_request/approval_responded 事件渲染 ApprovalCard,涵盖工具调用生命周期
 * - 过滤策略:streamChunksAsSSE 维护 hasApproval 标志,approval_request 后置 true,后续 tool_* 不产出帧
 *
 * P1-Q5 修复:approval_responded 事件到达时重置 hasApproval=false,
 * 表示审批已解决,后续 tool_* 恢复透传(已批准的工具执行应让用户看到)。
 *
 * P0-S1 修复:approval_request 产出时调 registerRun 注册 runId→backendId,
 * 审批路由据 verifyRunOwnership 校验归属。
 *
 * P2-S6 修复:stream 错误帧携带最近一次 approval_request 的 runId,
 * 前端可关联审批上下文清理 pendingApproval 状态。
 */
export async function streamChunksAsSSE(
  c: Context,
  iterable: AsyncIterable<import('../types/stream').StreamChunk>,
): Promise<Response> {
  const encoder = new TextEncoder();
  // 客户端断连信号:Hono 的 c.req.raw.signal 在客户端关闭连接时被 abort。
  // 用于在循环中提前退出,避免继续消费上游 iterable 造成资源泄露。
  const abortSignal = c.req.raw.signal as AbortSignal | undefined;
  const iterator = iterable[Symbol.asyncIterator]();
  // v1.3.0:审批标志,approval_request 后过滤 tool_* 事件
  let hasApproval = false;
  // P2-S6 修复:记录最近一次 approval_request 的 runId,错误帧携带
  let lastApprovalRunId: string | undefined;
  // P0-S1 修复:从 BackendContext 获取 backendId,用于 registerRun
  // 注:streamChunksAsSSE 可能被测试以裸 Context 调用(无 backendContextMiddleware),
  // 此处做容错:getBackendContext 在 c.get 不存在时返回 undefined,backendIdForRegister 为空字符串,
  // registerRun 因 backendId 为空被跳过(不影响 streamChunksAsSSE 主流程)。
  let backendIdForRegister = '';
  try {
    const ctx = getBackendContext(c);
    backendIdForRegister = ctx?.backendId ?? '';
  } catch {
    // 测试场景下 c.get 可能不存在,静默跳过 runId 注册
  }
  // agentId 从路径参数提取(streamChunksAsSSE 主要在 /agents/chat/completions 调用,
  // 无 :agentId 路径参数;实际 agentId 在 body 中,Adapter 内部使用)。
  // registerRun 时用空字符串占位,verifyRunOwnership 仅校验 backendId 一致性。
  const agentIdForRegister = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          // 客户端断连时立即退出,不再消费上游
          if (abortSignal?.aborted) break;
          const { done, value: chunk } = await iterator.next();
          if (done) break;
          if (!chunk) continue;

          // v1.3.0:approval_request 后过滤 tool_* 事件
          // 避免 ToolCallCard 与 ApprovalCard 重复显示工具调用
          // P1-Q5 修复:approval_responded 后重置 hasApproval,恢复 tool_* 透传
          if (
            hasApproval &&
            (chunk.type === 'tool_start' ||
              chunk.type === 'tool_complete' ||
              chunk.type === 'tool_progress')
          ) {
            continue;
          }
          // approval_request 到达后设置过滤标志,并注册 runId 归属
          if (chunk.type === 'approval_request') {
            hasApproval = true;
            // P0-S1 修复:注册 runId → backendId 映射,审批路由据校验归属
            if (chunk.runId && backendIdForRegister) {
              registerRun(chunk.runId, backendIdForRegister, agentIdForRegister);
            }
            lastApprovalRunId = chunk.runId;
          }
          // P1-Q5 修复:approval_responded 到达后重置 hasApproval,
          // 后续 tool_* 恢复透传(已批准工具的执行过程应让用户看到)
          if (chunk.type === 'approval_responded') {
            hasApproval = false;
          }

          const frame = serializeChunk(chunk);
          if (frame) {
            controller.enqueue(encoder.encode(frame));
          }
          if (chunk.type === 'done' || chunk.type === 'error') {
            break;
          }
        }
      } catch (err) {
        // controller.error/enqueue 在客户端断连后会抛出,这里捕获避免 unhandledRejection
        if (!abortSignal?.aborted) {
          // M2: 流式错误不透传 err.message(可能含内部信息),用通用文案 + 服务端日志
          console.error('[bff-agents] streamChunksAsSSE stream error:', err);
          // P2-S6 修复:错误帧携带 lastApprovalRunId,前端可关联审批上下文
          const errPayload: Record<string, unknown> = {
            event: 'error',
            data: { message: 'Stream error' },
          };
          if (lastApprovalRunId) {
            (errPayload.data as Record<string, unknown>).run_id = lastApprovalRunId;
          }
          const errFrame = `data: ${JSON.stringify(errPayload)}\n\n`;
          try {
            controller.enqueue(encoder.encode(errFrame));
          } catch {
            // controller 已关闭,无法再 enqueue,静默退出
          }
        }
      } finally {
        // 主动调用 iterator.return() 中止上游(若 iterable 支持取消),
        // 释放 intellect-team 侧的流式资源(如 HTTP 连接、Buffer)。
        try {
          await iterator.return?.();
        } catch {
          // 上游已关闭或不可取消,静默退出
        }
        try {
          controller.close();
        } catch {
          // controller 已关闭,静默退出
        }
      }
    },
    // 客户端取消时(如浏览器 abort fetch)由 ReadableStream 触发 cancel,
    // 同样调用 iterator.return() 中止上游。
    async cancel() {
      try {
        await iterator.return?.();
      } catch {
        // 静默退出
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * 将单个 StreamChunk 序列化为 SSE 帧(`data: {json}\n\n`)。
 * 返回 null 表示该 chunk 不产出前端事件(内部状态)。
 *
 * 注:tool_start/tool_complete/tool_progress 为 P3 企业版事件(IntellectEnterpriseAdapter
 * 产出),透传到前端以支持工具调用展示。IntellectRagAdapter 不产出这些事件。
 *
 * v1.3.0 新增 approval_request/approval_responded 事件:
 * - approval_request:携带 toolName/arguments/choices/runId,前端渲染 ApprovalCard
 * - approval_responded:携带 choice/resolved/runId,前端更新 ApprovalCard 状态
 * - tool_* 事件在 approval_request 后由 streamChunksAsSSE 过滤(不调用 serializeChunk)
 */
export function serializeChunk(chunk: import('../types/stream').StreamChunk): string | null {
  let payload: unknown;
  switch (chunk.type) {
    case 'delta': {
      const d = chunk as import('../types/stream').StreamDelta & { metadata?: unknown };
      // 同时输出 content（canvas-plugin useSendMessageBySSE 读取）和 answer
      // （next-chats useSendMessageWithSse 读取），保持双前端 SSE 消费路径兼容。
      payload = {
        event: 'message',
        data: {
          content: d.content,
          answer: d.content,
          ...(d.metadata ? { _metadata: d.metadata } : {}),
        },
      };
      break;
    }
    case 'reasoning':
      payload = {
        event: 'message',
        data: {
          content: chunk.content,
          answer: chunk.content,
          start_to_think: true,
        },
      };
      break;
    case 'tool_start': {
      const t = chunk as import('../types/stream').StreamToolStart;
      payload = {
        event: 'tool_start',
        data: {
          tool_name: t.toolName,
          tool_call_id: t.toolCallId,
          ...(t.args !== undefined ? { args: t.args } : {}),
        },
      };
      break;
    }
    case 'tool_complete': {
      const t = chunk as import('../types/stream').StreamToolComplete;
      payload = {
        event: 'tool_complete',
        data: {
          tool_call_id: t.toolCallId,
          ...(t.result !== undefined ? { result: t.result } : {}),
        },
      };
      break;
    }
    case 'tool_progress': {
      const t = chunk as import('../types/stream').StreamToolProgress;
      payload = {
        event: 'tool_progress',
        data: {
          tool_name: t.toolName,
          ...(t.toolCallId ? { tool_call_id: t.toolCallId } : {}),
          content: t.content,
        },
      };
      break;
    }
    case 'usage':
      payload = { event: 'message_end', data: { usage: chunk.usage } };
      break;
    case 'done':
      // data: true 匹配 intellect-rag-app 的 done 信号格式，
      // useSendMessageWithSse 通过 typeof d !== 'boolean' 跳过更新并关闭流。
      payload = { event: 'workflow_finished', data: true };
      break;
    case 'error':
      payload = {
        event: 'error',
        data: {
          message: chunk.message,
          answer: `**ERROR**: ${chunk.message}`,
          // P0 修复：透传 toolCallId，前端用于关联 tool.failed 时的工具调用
          // Constitution Principle IV: StreamError 类型已定义 toolCallId?: string
          ...(chunk.toolCallId ? { tool_call_id: chunk.toolCallId } : {}),
          // P3: 透传 errorDetails，前端 ProviderErrorDetails 组件渲染折叠区块
          // 用 safeJsonSerialize 过滤不可序列化类型（function/symbol/circular）
          ...(chunk.details !== undefined
            ? { errorDetails: safeJsonSerialize(chunk.details) }
            : {}),
        },
      };
      break;
    case 'approval_request': {
      const a = chunk as import('../types/stream').StreamApprovalRequest;
      // P2-S5 修复:arguments 字段长度限制(64KB),避免上游异常发射超长 payload
      // 导致 SSE 帧过大、前端 OOM。截断时附加标记,前端可识别。
      const MAX_ARGS_LENGTH = 64 * 1024;
      let argsField: string = a.arguments;
      if (typeof argsField === 'string' && argsField.length > MAX_ARGS_LENGTH) {
        argsField =
          argsField.slice(0, MAX_ARGS_LENGTH) +
          `\n... (truncated by BFF, total ${argsField.length} chars)`;
      }
      payload = {
        event: 'approval_request',
        data: {
          tool_name: a.toolName,
          arguments: argsField,
          choices: a.choices,
          run_id: a.runId,
        },
      };
      break;
    }
    case 'approval_responded': {
      const a = chunk as import('../types/stream').StreamApprovalResponded;
      payload = {
        event: 'approval_responded',
        data: {
          choice: a.choice,
          resolved: a.resolved,
          run_id: a.runId,
        },
      };
      break;
    }
    case 'clarify_request': {
      const cl = chunk as import('../types/stream').StreamClarifyRequest;
      payload = {
        event: 'clarify_request',
        data: {
          question: cl.question,
          choices: cl.choices,
          clarify_id: cl.clarifyId,
          session_id: cl.sessionId,
        },
      };
      break;
    }
    default:
      return null;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}
