/**
 * 宿主 chat 能力实现(window.AgentUI.chat,docs/chat-sse-sdk-design.md)。
 *
 * 设计参照 QwenPaw 前端 SDK(pawapp-sdk):流式递送用 AsyncGenerator 递已解析
 * 的事件对象,SSE 解析由宿主完成,插件零解析依赖。通道是 BFF 插件 chat 路由
 * (POST /api/bff/plugins/<id>/chat/*,同源 cookie 鉴权),gateway 凭据
 * (API_SERVER_KEY/X-Intellect-User)全程在 BFF 服务端注入,插件不接触。
 *
 * 本文件不得引入 React——host-global 在动态 import App 之前安装。
 */

import { EventSourceParserStream } from 'eventsource-parser/stream';

import type {
  AgentUIChatApi,
  ChatCompletionsRequest,
  ChatFrame,
  ChatStreamOptions,
} from './types';

function chatUrl(pluginId: string, path: string): string {
  return `/api/bff/plugins/${encodeURIComponent(pluginId)}/chat/${path}`;
}

/** createSession 超时兜底(评审 P3):普通请求不至因 gateway 挂起而永久悬挂。 */
const CREATE_SESSION_TIMEOUT_MS = 15_000;

function createSessionTimeoutSignal(): AbortSignal | undefined {
  // 生产浏览器均支持 AbortSignal.timeout;jsdom/旧环境无此静态方法则不设
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS)
    : undefined;
}

async function readError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => '');
  return new Error(
    `chat request failed: HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
  );
}

/**
 * completions 流:fetch SSE → EventSourceParserStream → 逐帧 JSON.parse →
 * yield。生成器 finally 中 abort 上游——消费方 for-await 提前 break 即中断
 * 网关流(BFF 检测客户端断连后退出,释放上游连接)。
 */
async function* completions(
  pluginId: string,
  request: ChatCompletionsRequest,
  options?: ChatStreamOptions,
): AsyncGenerator<ChatFrame, void, undefined> {
  // 预先已中止的 signal 不会触发 addEventListener(DOM 规范),入口显式检查
  // (评审 P2)
  if (options?.signal?.aborted) {
    return;
  }
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const response = await fetch(chatUrl(pluginId, 'completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: request.sessionId,
        content: request.content,
        ...(request.modelId !== undefined ? { model_id: request.modelId } : {}),
        ...(request.attachments !== undefined
          ? { attachments: request.attachments }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw await readError(response);
    }
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        if (!value?.data) {
          continue;
        }
        try {
          yield JSON.parse(value.data) as ChatFrame;
        } catch {
          // 坏帧跳过(与宿主 chat hook 的容错一致)
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  } catch (err) {
    // 中止语义收口(契约 D7,评审 P2):abort 时真实 fetch 的挂起
    // fetch()/reader.read() 会 reject AbortError,此处转为正常终止——
    // abort = 流结束,不是错误;非中止的真错误(含 HTTP 错误)照常抛出
    if (controller.signal.aborted || options?.signal?.aborted) {
      return;
    }
    throw err;
  } finally {
    options?.signal?.removeEventListener('abort', onOuterAbort);
    // 正常完成后 abort 是无害的;提前 break/throw 时它负责中断上游
    controller.abort();
  }
}

export function createChatApi(): AgentUIChatApi {
  return {
    async createSession(pluginId, title) {
      const response = await fetch(chatUrl(pluginId, 'sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(title ? { title } : {}),
        signal: createSessionTimeoutSignal(),
      });
      if (!response.ok) {
        throw await readError(response);
      }
      const session = (await response.json()) as {
        id: string;
        title?: string;
      };
      return { id: session.id, title: session.title };
    },
    completions,
  };
}
