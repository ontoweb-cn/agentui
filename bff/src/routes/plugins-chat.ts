/**
 * 插件 chat 路由(宿主 chat 能力,docs/chat-sse-sdk-design.md;自 plugins.ts
 * 拆出)。与会话/文件/代理路由同挂于 /plugins/*,但**第一批挂会话守卫**——
 * chat 花的是用户身份下的 gateway 额度,凭据(API_SERVER_KEY/X-Intellect-User)
 * 全程在 BFF 服务端注入,插件不接触。
 *
 * 路由面(均经守卫链 + checkChatCapability 逐请求校验):
 *   POST /plugins/:id/chat/sessions                建 gateway 会话(标题 plugin:<id>: 前缀)
 *   POST /plugins/:id/chat/completions             流式补全(与宿主 chat 同帧协议)
 *   POST /plugins/:id/chat/runs/:runId/approval    工具审批响应(P2,runId 归属校验)
 *   POST /plugins/:id/chat/sessions/:sid/clarify   澄清答案提交(P2)
 *   GET  /plugins/:id/chat/sessions/:sid/history   会话历史读取(P2)
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';

import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { authMiddleware } from '../middleware/auth';
import { authSessionMiddleware } from '../middleware/auth-session';
import {
  backendContextMiddleware,
  getBackendContext,
  resolveBackendContext,
} from '../middleware/backend-context';
import { requireValidImtSession } from '../middleware/imt-session-guard';
import { isPluginDisabled, PLUGINS_DIR, appendPluginAudit } from '../services/plugin-store';
import { verifyRunOwnership } from '../services/run-registry';
import { isImtCanvasAgentsEnabled } from '../utils/feature-flags';
import type { StreamIterable, TokenUsage } from '../types/stream';
// 复用宿主 chat 通道的 adapter 解析/错误文案/SSE 重序列化/审批校验(同一
// 租户隔离语义,插件面不另起一套)——见 docs/chat-sse-sdk-design.md §4.2
import {
  getAdapter,
  handleAdapterError,
  streamChunksAsSSE,
  VALID_APPROVAL_CHOICES,
} from './bff-agents';
import { readPluginMeta } from './plugins';

/** 与宿主 chat 相同的占位 agentId(session=chat 一对一,adapter 层仅透传)。 */
const CHAT_AGENT_ID = 'chat';

/** 会话标题总长上限(含前缀):防无界透传 gateway(评审 P3)。 */
const SESSION_TITLE_MAX = 200;

/** 会话标题前缀:插件创建的会话在宿主会话列表可辨识(设计 R1 缓解)。 */
function pluginSessionTitle(pluginId: string, title?: string): string {
  const full = `plugin:${pluginId}:${title ?? pluginId}`;
  return full.length > SESSION_TITLE_MAX
    ? full.slice(0, SESSION_TITLE_MAX)
    : full;
}

/**
 * 模型白名单(chat SDK P3,设计 R2 缓解):env `BFF_PLUGIN_CHAT_ALLOWED_MODELS`
 * 逗号分隔;未设置 = 不管控(透传,部署侧靠 gateway 配额兜底)。未显式传
 * model_id 的请求走部署默认模型,不受白名单约束。逐请求读 env(测试可动态设置)。
 */
function isModelAllowed(modelId: string | undefined): boolean {
  const raw = process.env.BFF_PLUGIN_CHAT_ALLOWED_MODELS;
  if (!raw || raw.trim() === '') {
    return true;
  }
  if (!modelId) {
    return true;
  }
  const allowed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(modelId);
}

/**
 * 用量审计包装(chat SDK P3 数据面):逐 chunk 透传不变,流终止(正常结束/
 * 出错/客户端断连触发的提前关闭)后在 finally 落一行 chat_completion 审计
 * 事件。appendPluginAudit 内部自捕获写失败,不影响主流程;usage 仅在流完整
 * 走到 usage chunk 时有值(客户端断连的半截流记 null usage,同样计入归因)。
 */
function withCompletionAudit(
  pluginId: string,
  sessionId: string,
  model: string | undefined,
  iterable: StreamIterable,
): StreamIterable {
  let usage: TokenUsage | undefined;
  async function* observed() {
    try {
      for await (const chunk of iterable) {
        if (chunk.type === 'usage') {
          usage = chunk.usage;
        }
        yield chunk;
      }
    } finally {
      void appendPluginAudit({
        action: 'chat_completion',
        pluginId,
        sessionId,
        model: model ?? null,
        usage: usage ?? null,
      });
    }
  }
  return observed();
}

/**
 * chat 路由共用校验(逐请求):id 白名单 → 停用断路(404,评审 P1) →
 * 安装存在 → 清单合法 → capabilities 含 'chat'(403)。顺序经过评审:
 * 404 先于 403,不向匿名探测者泄露「存在但未声明/已停用」。
 * 返回 null 表示放行。
 */
async function checkChatCapability(
  id: string,
): Promise<{ status: 403 | 404; message: string } | null> {
  if (/[^\w.-]/.test(id)) {
    return { status: 403, message: 'Forbidden' };
  }
  if (await isPluginDisabled(id)) {
    return { status: 404, message: 'Not Found' };
  }
  const pluginDir = resolve(PLUGINS_DIR, id);
  if (!pluginDir.startsWith(`${PLUGINS_DIR}${sep}`) || !existsSync(pluginDir)) {
    return { status: 404, message: 'Not Found' };
  }
  const meta = await readPluginMeta(pluginDir);
  if (!meta) {
    return { status: 404, message: 'Not Found' };
  }
  if (!meta.capabilities?.includes('chat')) {
    return {
      status: 403,
      message: `插件 ${id} 未声明 chat 能力(app.json capabilities)`,
    };
  }
  return null;
}

/**
 * chat 路由守卫链:与 /agents/* 一致(auth → imt 会话真实验证 →
 * AuthSession(随企业 flag 条件挂载) → 租户上下文)。
 */
const chatGuards: MiddlewareHandler[] = [
  authMiddleware,
  requireValidImtSession,
  ...(isImtCanvasAgentsEnabled() ? [authSessionMiddleware] : []),
  backendContextMiddleware,
];

// 守卫经 .use 挂在 chat 子路径上(与 index.ts 对 /agents/* 的挂载方式一致),
// 本文件全部路由自动继承
export const pluginsChatRoutes = new Hono();

for (const guard of chatGuards) {
  pluginsChatRoutes.use('/plugins/:id/chat/*', guard);
}

pluginsChatRoutes.post('/plugins/:id/chat/sessions', async (c) => {
  const id = c.req.param('id') ?? '';
  const denied = await checkChatCapability(id);
  if (denied) {
    return c.text(denied.message, denied.status);
  }
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title : undefined;
  try {
    const session = await adapter.createSession(
      resolveBackendContext(c),
      CHAT_AGENT_ID,
      pluginSessionTitle(id, title),
    );
    return c.json(session);
  } catch (err) {
    return handleAdapterError(c, err, 'POST /plugins/:id/chat/sessions');
  }
});

pluginsChatRoutes.post('/plugins/:id/chat/completions', async (c) => {
  const id = c.req.param('id') ?? '';
  const denied = await checkChatCapability(id);
  if (denied) {
    return c.text(denied.message, denied.status);
  }
  const adapter = getAdapter(c);
  if (!adapter) {
    return c.json({ code: 503, message: 'No backend configured' }, 503);
  }
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body?.session_id ?? body?.sessionId;
  const content = body?.content;
  if (
    typeof sessionId !== 'string' ||
    sessionId === '' ||
    typeof content !== 'string' ||
    content === ''
  ) {
    return c.text('session_id 与 content 必填', 400);
  }
  const requestedModel =
    typeof body?.model_id === 'string' && body.model_id !== ''
      ? body.model_id
      : typeof body?.modelId === 'string' && body.modelId !== ''
        ? body.modelId
        : undefined;
  if (!isModelAllowed(requestedModel)) {
    return c.text(
      `model_id "${requestedModel}" 不在 BFF_PLUGIN_CHAT_ALLOWED_MODELS 白名单`,
      403,
    );
  }
  try {
    const iterable = await adapter.sendMessage(resolveBackendContext(c), {
      sessionId,
      content,
      agentId: CHAT_AGENT_ID,
      attachments: body?.attachments,
      modelId: requestedModel,
    });
    // 与宿主 /agents/chat/completions 完全相同的帧协议({event,data});
    // 外面套用量审计(P3 数据面),对帧序零影响
    return streamChunksAsSSE(
      c,
      withCompletionAudit(id, sessionId, requestedModel, iterable),
    );
  } catch (err) {
    return handleAdapterError(c, err, 'POST /plugins/:id/chat/completions');
  }
});

// --- P2:审批 / 澄清 / 历史(契约见 docs/chat-sse-sdk-design.md §4.5) ---

pluginsChatRoutes.post(
  '/plugins/:id/chat/runs/:runId/approval',
  async (c) => {
    const id = c.req.param('id') ?? '';
    const denied = await checkChatCapability(id);
    if (denied) {
      return c.text(denied.message, denied.status);
    }
    const adapter = getAdapter(c);
    if (!adapter) {
      return c.json({ code: 503, message: 'No backend configured' }, 503);
    }
    // 仅 IntellectEnterpriseAdapter 实现 submitApproval
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
    // 与宿主审批路由同一归属校验:runId 须由本 backend 的 completions 流
    // (streamChunksAsSSE)注册过,防跨租户越权
    const backendIdForCheck = getBackendContext(c)?.backendId;
    if (!backendIdForCheck) {
      return c.json(
        { code: 403, message: 'Forbidden: missing backend context' },
        403,
      );
    }
    const ownership = verifyRunOwnership(runId, backendIdForCheck);
    if (!ownership.valid) {
      console.warn(
        `[plugins-chat] POST /plugins/${id}/chat/runs/${runId}/approval ownership check failed: ${ownership.reason}`,
      );
      return c.json(
        { code: 403, message: 'Forbidden: runId not owned by current backend' },
        403,
      );
    }
    const body = await c.req.json().catch(() => null);
    const choice = (body as { choice?: unknown } | null)?.choice;
    const isApprovalChoice = (
      value: unknown,
    ): value is (typeof VALID_APPROVAL_CHOICES)[number] =>
      typeof value === 'string' &&
      (VALID_APPROVAL_CHOICES as readonly string[]).includes(value);
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
      if (typeof result.resolved !== 'number' || result.resolved < 1) {
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
        `POST /plugins/:id/chat/runs/:runId/approval`,
      );
    }
  },
);

pluginsChatRoutes.post(
  '/plugins/:id/chat/sessions/:sessionId/clarify',
  async (c) => {
    const id = c.req.param('id') ?? '';
    const denied = await checkChatCapability(id);
    if (denied) {
      return c.text(denied.message, denied.status);
    }
    const adapter = getAdapter(c);
    if (!adapter) {
      return c.json({ code: 503, message: 'No backend configured' }, 503);
    }
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
    const clarifyId =
      typeof (body as { clarify_id?: unknown } | null)?.clarify_id === 'string'
        ? (body as { clarify_id: string }).clarify_id
        : '';
    const answer =
      typeof (body as { answer?: unknown } | null)?.answer === 'string'
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
        'POST /plugins/:id/chat/sessions/:sessionId/clarify',
      );
    }
  },
);

pluginsChatRoutes.get(
  '/plugins/:id/chat/sessions/:sessionId/history',
  async (c) => {
    const id = c.req.param('id') ?? '';
    const denied = await checkChatCapability(id);
    if (denied) {
      return c.text(denied.message, denied.status);
    }
    const adapter = getAdapter(c);
    if (!adapter) {
      return c.json({ code: 503, message: 'No backend configured' }, 503);
    }
    const sessionId = c.req.param('sessionId');
    if (!sessionId) {
      return c.json({ code: 400, message: 'Missing sessionId' }, 400);
    }
    try {
      const messages = await adapter.getSessionMessages(
        resolveBackendContext(c),
        CHAT_AGENT_ID,
        sessionId,
      );
      return c.json({ messages });
    } catch (err) {
      return handleAdapterError(
        c,
        err,
        'GET /plugins/:id/chat/sessions/:sessionId/history',
      );
    }
  },
);
