/**
 * window.AgentUI.chat 客户端单测(chat SDK P1)。
 * 流式原语由 jest-setup-env 注入(Node stream/web);fetch 用 stub 替换。
 */
import { ReadableStream } from 'node:stream/web';

import { createChatApi } from '../chat-client';

const okResponse = (frames: string[]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
};

const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const fn = jest.fn(impl);
  (globalThis as { fetch?: unknown }).fetch = fn;
  return () => {
    delete (globalThis as { fetch?: unknown }).fetch;
  };
};

describe('AgentUI.chat 客户端(chat SDK P1)', () => {
  it('completions:逐帧递已解析对象,帧序与 BFF SSE 一致', async () => {
    const restoreFetch = stubFetch(async () =>
      okResponse([
        'data: {"event":"message","data":{"content":"你","answer":"你"}}\n\n',
        'data: {"event":"message_end","data":{"usage":{"promptTokens":1}}}\n\n',
        'data: {"event":"workflow_finished","data":true}\n\n',
      ]),
    );
    try {
      const chat = createChatApi();
      const frames = [];
      for await (const frame of chat.completions('my-app', {
        sessionId: 's1',
        content: '你好',
      })) {
        frames.push(frame);
      }
      expect(frames).toEqual([
        { event: 'message', data: { content: '你', answer: '你' } },
        { event: 'message_end', data: { usage: { promptTokens: 1 } } },
        { event: 'workflow_finished', data: true },
      ]);
    } finally {
      restoreFetch();
    }
  });

  it('completions:请求体映射 session_id/content/model_id', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const restoreFetch = stubFetch(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return okResponse([]);
    });
    try {
      const chat = createChatApi();
      for await (const _frame of chat.completions('my-app', {
        sessionId: 's1',
        content: 'hi',
        modelId: 'deepseek-chat',
      })) {
        // 空流,不消费帧
      }
      expect(capturedBody).toEqual({
        session_id: 's1',
        content: 'hi',
        model_id: 'deepseek-chat',
      });
    } finally {
      restoreFetch();
    }
  });

  it('completions:提前 break 中断上游(fetch signal 已 abort)', async () => {
    let fetchSignal: AbortSignal | null | undefined;
    const restoreFetch = stubFetch(async (_url, init) => {
      fetchSignal = init?.signal;
      // 永不结束的流:迫使消费方主动 break
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"event":"message","data":{}}\n\n'),
          );
          // 不 close——模拟长流
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });
    try {
      const chat = createChatApi();
      for await (const frame of chat.completions('my-app', {
        sessionId: 's1',
        content: 'hi',
      })) {
        expect(frame.event).toBe('message');
        break; // 插件典型用法:满足条件即停止
      }
      expect(fetchSignal?.aborted).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it('completions:外部 signal abort 后流终止(不 throw)', async () => {
    const controller = new AbortController();
    const restoreFetch = stubFetch(async (_url, init) => {
      const encoder = new TextEncoder();
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      // 内部 controller abort(由外部 signal 透传触发)时关闭流,pending read 结束
      init?.signal?.addEventListener('abort', () => streamController?.close(), {
        once: true,
      });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
          c.enqueue(encoder.encode('data: {"event":"message","data":{}}\n\n'));
          // 不 close——模拟长流
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });
    try {
      const chat = createChatApi();
      const frames = [];
      for await (const frame of chat.completions(
        'my-app',
        { sessionId: 's1', content: 'hi' },
        { signal: controller.signal },
      )) {
        frames.push(frame);
        controller.abort(); // 消费一帧后外部中止
      }
      expect(frames).toHaveLength(1);
    } finally {
      restoreFetch();
    }
  });

  it('completions:真实 abort(fetch reject AbortError)收口为正常终止(评审 P2)', async () => {
    // 模拟 undici 语义:signal abort 时挂起的 fetch reject AbortError——
    // 此前 stub 手动 close 流,掩盖了该路径(测试替身不得再绕过)
    const controller = new AbortController();
    const restoreFetch = stubFetch(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });
    try {
      const chat = createChatApi();
      const frames: unknown[] = [];
      const drain = (async () => {
        for await (const frame of chat.completions(
          'my-app',
          { sessionId: 's1', content: 'hi' },
          { signal: controller.signal },
        )) {
          frames.push(frame);
        }
      })();
      controller.abort();
      await expect(drain).resolves.toBeUndefined(); // 不 throw
      expect(frames).toHaveLength(0);
    } finally {
      restoreFetch();
    }
  });

  it('completions:预先中止的 signal 不发起请求(评审 P2)', async () => {
    const restoreFetch = stubFetch(async () => {
      throw new Error('不应发起请求');
    });
    try {
      const chat = createChatApi();
      const controller = new AbortController();
      controller.abort();
      const frames: unknown[] = [];
      for await (const frame of chat.completions(
        'my-app',
        { sessionId: 's1', content: 'hi' },
        { signal: controller.signal },
      )) {
        frames.push(frame);
      }
      expect(frames).toHaveLength(0);
    } finally {
      restoreFetch();
    }
  });

  it('completions:HTTP 错误(403 未声明能力)→ reject 且消息含状态码', async () => {
    const restoreFetch = stubFetch(async () =>
      ({ ok: false, status: 403, text: async () => '未声明 chat 能力' }) as unknown as Response,
    );
    try {
      const chat = createChatApi();
      await expect(async () => {
        for await (const _frame of chat.completions('my-app', {
          sessionId: 's1',
          content: 'hi',
        })) {
          // 不会到达
        }
      }).rejects.toThrow('HTTP 403');
    } finally {
      restoreFetch();
    }
  });

  it('createSession:POST 会话路由并返回 {id,title};HTTP 失败 reject', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let callsCount = 0;
    const restoreFetch = stubFetch(async (url, init) => {
      calls.push({ url, init });
      callsCount += 1;
      if (callsCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'gw-1', title: 'plugin:my-app:demo' }),
        } as unknown as Response;
      }
      return { ok: false, status: 500, text: async () => '' } as unknown as Response;
    });
    try {
      const chat = createChatApi();
      const session = await chat.createSession('my-app', 'demo');
      expect(session).toEqual({ id: 'gw-1', title: 'plugin:my-app:demo' });
      expect(calls[0]?.init?.method).toBe('POST');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ title: 'demo' });

      await expect(chat.createSession('my-app')).rejects.toThrow('HTTP 500');
    } finally {
      restoreFetch();
    }
  });

  it('P2 方法:submitApproval/submitClarify/history 的路由与请求体(P1 评审)', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const restoreFetch = stubFetch(async (url, init) => {
      calls.push({ url, init });
      if (String(init?.method) === 'POST' && String(url).includes('/approval')) {
        return { ok: true, status: 200, json: async () => ({ resolved: 1 }) } as unknown as Response;
      }
      if (String(url).includes('/clarify')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ code: 0, data: { status: 'ok' } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ role: 'user', content: 'hi' }] }),
      } as unknown as Response;
    });
    try {
      const chat = createChatApi();
      const approval = await chat.submitApproval('my-app', 'run-1', 'once');
      expect(approval).toEqual({ resolved: 1 });
      const clarify = await chat.submitClarify('my-app', 's1', '选 A', 'cl-1');
      expect(clarify).toEqual({ status: 'ok' });
      const history = await chat.history('my-app', 's1');
      expect(history.messages).toHaveLength(1);

      expect(calls[0]?.url).toBe('/api/bff/plugins/my-app/chat/runs/run-1/approval');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ choice: 'once' });
      expect(calls[1]?.url).toBe('/api/bff/plugins/my-app/chat/sessions/s1/clarify');
      expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
        clarify_id: 'cl-1',
        answer: '选 A',
      });
      expect(calls[2]?.url).toBe('/api/bff/plugins/my-app/chat/sessions/s1/history');
      expect(calls[2]?.init?.method).toBeUndefined();
    } finally {
      restoreFetch();
    }
  });
});
