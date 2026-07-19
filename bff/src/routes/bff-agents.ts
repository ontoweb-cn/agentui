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
 *
 * spec-008: 画布 DSL 创建/编辑/删除(POST/PUT/DELETE /agents)已迁到 /canvas/* 路由。
 *
 * P1 占位 Registry:从 HarnessStore 获取首个 intellect-rag backend,直接 new IntellectRagAdapter。
 * US3 替换为 AdapterRegistry.getAdapterForTenant(tenantId)。
 */

import { Hono, type Context } from 'hono';
import { IntellectRagAdapter } from '../services/adapters/intellect-rag/intellect-rag-adapter';
import type { HarnessStore, TenantStore } from '../types';
import type { TenantContext } from '../types/tenant';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import { getTenantContext, resolveTenantContext } from '../middleware/tenant-context';

// Hono context variables for BFF agent routes
interface BffAgentVariables {
  harnessStore: HarnessStore;
  tenantStore: TenantStore;
  adapterRegistry: IAdapterRegistry;
  tenantContext?: TenantContext;
}

export const bffAgentRoutes = new Hono<{ Variables: BffAgentVariables }>();

/**
 * US3:从 AdapterRegistry 按 tenantId 获取 Adapter(替换 US1 占位直接 new IntellectRagAdapter)。
 *
 * Constitution Principle II:Registry 按 tenantId 选择 Adapter,路由层不感知后端。
 * Constitution Principle V:tenantId 从 TenantContext 中间件注入的 ctx 提取。
 *
 * 兜底:若 tenantId 缺失或 Registry 未就绪,回退到占位逻辑(首个 intellect-rag backend),
 * 保持 US1 行为兼容,避免阻塞 P1 验收。P3 强制要求 TenantContext。
 */
function getAdapter(c: Context): IntellectRagAdapter | null {
  // US3 主路径:经 AdapterRegistry + TenantContext
  const registry = c.get('adapterRegistry');
  const ctx = getTenantContext(c);
  if (registry && ctx && registry.isReady()) {
    try {
      const adapter = registry.getAdapterForTenant(ctx.tenantId);
      // P1 阶段返回的 adapter 一定是 IntellectRagAdapter(仅注册了该 factory)
      return adapter as IntellectRagAdapter;
    } catch (err) {
      console.warn(
        `[bff-agents] Registry lookup failed for tenant ${ctx.tenantId}:`,
        (err as Error).message,
      );
      // 落入兜底逻辑
    }
  }

  // US1 占位兜底:从 HarnessStore 获取首个 intellect-rag backend
  const harnessStore = c.get('harnessStore');
  const backends = harnessStore.list();
  const ragBackend = backends.find((b: { type: string }) => b.type === 'intellect-rag');
  if (!ragBackend) {
    return null;
  }
  return new IntellectRagAdapter(ragBackend);
}

// --- Agent CRUD (listAgents / getAgent 经 Adapter;create/update/delete 已迁到 canvas routes) ---

bffAgentRoutes.get('/agents', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
  }
  try {
    const agents = await adapter.listAgents(resolveTenantContext(c));
    return c.json(agents);
  } catch (err) {
    return c.json(
      { code: 502, message: `Adapter error: ${(err as Error).message}` },
      502,
    );
  }
});

bffAgentRoutes.get('/agents/:id', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
  }
  const id = c.req.param('id');
  try {
    const agent = await adapter.getAgent(resolveTenantContext(c), id);
    return c.json(agent);
  } catch (err) {
    const msg = (err as Error).message;
    const status = /404/.test(msg) ? 404 : 502;
    return c.json({ code: status, message: msg }, status);
  }
});

// --- Agent Sessions (全部经 Adapter) ---

bffAgentRoutes.get('/agents/:agentId/sessions', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  try {
    const sessions = await adapter.listSessions(resolveTenantContext(c), agentId);
    return c.json(sessions);
  } catch (err) {
    return c.json(
      { code: 502, message: `Adapter error: ${(err as Error).message}` },
      502,
    );
  }
});

bffAgentRoutes.post('/agents/:agentId/sessions', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body?.name === 'string' ? body.name : body?.title;
  try {
    const session = await adapter.createSession(
      resolveTenantContext(c),
      agentId,
      title,
    );
    return c.json(session);
  } catch (err) {
    return c.json(
      { code: 502, message: `Adapter error: ${(err as Error).message}` },
      502,
    );
  }
});

bffAgentRoutes.get('/agents/:agentId/sessions/:sessionId', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');
  try {
    const session = await adapter.getSession(
      resolveTenantContext(c),
      agentId,
      sessionId,
    );
    return c.json(session);
  } catch (err) {
    const msg = (err as Error).message;
    const status = /404/.test(msg) ? 404 : 502;
    return c.json({ code: status, message: msg }, status);
  }
});

bffAgentRoutes.delete('/agents/:agentId/sessions/:sessionId', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
  }
  const agentId = c.req.param('agentId');
  const sessionId = c.req.param('sessionId');
  try {
    await adapter.deleteSession(resolveTenantContext(c), agentId, sessionId);
    return c.json({ code: 0, message: 'ok' });
  } catch (err) {
    return c.json(
      { code: 502, message: `Adapter error: ${(err as Error).message}` },
      502,
    );
  }
});

// --- Agent chat completions (US2: 流式经 Adapter + parseCanvasWorkflowSSE) ---
bffAgentRoutes.post('/agents/chat/completions', async (c) => {
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No intellect-rag backend configured' }, 503);
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
    const iterable = await adapter.sendMessage(resolveTenantContext(c), req);
    // 用 SSE 透传 StreamChunk 序列到前端
    return streamChunksAsSSE(c, iterable);
  } catch (err) {
    return c.json(
      { code: 502, message: `Adapter sendMessage error: ${(err as Error).message}` },
      502,
    );
  }
});

/**
 * 将 StreamChunk 迭代器序列化为 SSE 事件流透传给前端。
 *
 * Constitution Principle IV v1.2.0:BFF 消费 Adapter 的 StreamChunk 迭代器,
 * 重新序列化为前端期望的 SSE 格式(eventsource-parser 兼容)。
 *
 * 序列化规则:
 * - 每个 StreamChunk 输出为 `data: {json}\n\n` 帧
 * - StreamDelta → {event: "message", data: {content}}
 * - StreamReasoning → {event: "message", data: {content, start_to_think/end_to_think}}
 * - StreamError → {event: "error", data: {message}}
 * - StreamDone → {event: "workflow_finished", data: {}}
 * - 终止 chunk(done/error)后关闭流
 */
async function streamChunksAsSSE(
  _c: Context,
  iterable: AsyncIterable<import('../types/stream').StreamChunk>,
): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of iterable) {
          const frame = serializeChunk(chunk);
          if (frame) {
            controller.enqueue(encoder.encode(frame));
          }
          if (chunk.type === 'done' || chunk.type === 'error') {
            break;
          }
        }
      } catch (err) {
        const errFrame = `data: ${JSON.stringify({ event: 'error', data: { message: (err as Error).message } })}\n\n`;
        controller.enqueue(encoder.encode(errFrame));
      } finally {
        controller.close();
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
 */
function serializeChunk(chunk: import('../types/stream').StreamChunk): string | null {
  let payload: unknown;
  switch (chunk.type) {
    case 'delta': {
      const d = chunk as import('../types/stream').StreamDelta & { metadata?: unknown };
      payload = {
        event: 'message',
        data: {
          content: d.content,
          ...(d.metadata ? { _metadata: d.metadata } : {}),
        },
      };
      break;
    }
    case 'reasoning':
      payload = {
        event: 'message',
        data: { content: chunk.content, start_to_think: true },
      };
      break;
    case 'usage':
      payload = { event: 'message_end', data: { usage: chunk.usage } };
      break;
    case 'done':
      payload = { event: 'workflow_finished', data: {} };
      break;
    case 'error':
      payload = { event: 'error', data: { message: chunk.message } };
      break;
    default:
      // tool_start/tool_complete/tool_progress:P3 企业版事件,P1 不透传到前端
      return null;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}
