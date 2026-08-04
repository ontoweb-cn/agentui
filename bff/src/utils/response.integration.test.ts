// spec-013 P2: streamResponse 集成测试。
// 覆盖 P2 修复:为 SSE 流自动添加 X-Accel-Buffering: no 头,
// 防止 Nginx 缓冲 SSE chunk 导致实时性丢失。
// 同时验证 transfer-encoding / content-encoding 过滤、status 保留等边界场景。

import { describe, it, expect } from 'vitest';
import { streamResponse } from './response';

// ── Helpers ────────────────────────────────────────────────────────────

function makeUpstream(
  body: ReadableStream<Uint8Array> | null,
  init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {},
): Response {
  const { status = 200, statusText = 'OK', headers = {} } = init;
  return new Response(body, {
    status,
    statusText,
    headers,
  });
}

function makeBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(new TextEncoder().encode(c)));
      controller.close();
    },
  });
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

// ===========================================================================
// 1. X-Accel-Buffering 头(P2 修复点)
// ===========================================================================

describe('streamResponse - X-Accel-Buffering 头注入', () => {
  it('SSE 响应(text/event-stream)自动添加 X-Accel-Buffering: no', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('SSE 响应带 charset 仍被识别为 SSE 流', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('非 SSE 响应(application/json)不添加 X-Accel-Buffering', () => {
    const upstream = makeUpstream(makeBody(['{"ok":true}']), {
      headers: { 'Content-Type': 'application/json' },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Accel-Buffering')).toBeNull();
  });

  it('非 SSE 响应(text/html)不添加 X-Accel-Buffering', () => {
    const upstream = makeUpstream(makeBody(['<html></html>']), {
      headers: { 'Content-Type': 'text/html' },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Accel-Buffering')).toBeNull();
  });

  it('上游已设置 X-Accel-Buffering 时不覆盖原值', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'yes',
      },
    });
    const result = streamResponse(upstream);
    // 已存在时不覆盖
    expect(result.headers.get('X-Accel-Buffering')).toBe('yes');
  });

  it('无 Content-Type 头时不添加 X-Accel-Buffering', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']));
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Accel-Buffering')).toBeNull();
  });

  it('Content-Type 值大小写敏感:TEXT/EVENT-STREAM(大写)不被识别为 SSE', () => {
    // Headers API 归一化 header 名为小写,但不改变 header 值的大小写。
    // streamResponse 用 contentType.includes('text/event-stream') 做大小写敏感匹配,
    // 因此大写的 TEXT/EVENT-STREAM 不被识别为 SSE,不添加 X-Accel-Buffering。
    // (HTTP 规范允许 Content-Type 值大小写不敏感,但上游应发送规范小写)
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: { 'Content-Type': 'TEXT/EVENT-STREAM' },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Accel-Buffering')).toBeNull();
  });
});

// ===========================================================================
// 2. transfer-encoding / content-encoding 过滤
// ===========================================================================

describe('streamResponse - 危险头过滤', () => {
  it('过滤 transfer-encoding 头(由 HTTP 服务器层处理)', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
      },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('Transfer-Encoding')).toBeNull();
    expect(result.headers.get('transfer-encoding')).toBeNull();
  });

  it('过滤 content-encoding 头(避免双重解压)', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Content-Encoding': 'gzip',
      },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('Content-Encoding')).toBeNull();
    expect(result.headers.get('content-encoding')).toBeNull();
  });

  it('同时过滤 transfer-encoding 和 content-encoding', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
        'Content-Encoding': 'br',
      },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('Transfer-Encoding')).toBeNull();
    expect(result.headers.get('Content-Encoding')).toBeNull();
    // SSE 头仍被添加
    expect(result.headers.get('X-Accel-Buffering')).toBe('no');
  });
});

// ===========================================================================
// 3. 状态码与 body 透传
// ===========================================================================

describe('streamResponse - 状态码与 body 透传', () => {
  it('保留上游 status 和 statusText', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const result = streamResponse(upstream);
    expect(result.status).toBe(200);
    expect(result.statusText).toBe('OK');
  });

  it('保留上游错误状态码(如 500)', () => {
    const upstream = makeUpstream(makeBody(['error']), {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = streamResponse(upstream);
    expect(result.status).toBe(500);
    expect(result.statusText).toBe('Internal Server Error');
  });

  it('body ReadableStream 完整透传', async () => {
    const bodyChunks = ['data: chunk1\n\n', 'data: chunk2\n\n', 'data: [DONE]\n\n'];
    const upstream = makeUpstream(makeBody(bodyChunks), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const result = streamResponse(upstream);
    const body = await readBody(result);
    expect(body).toBe(bodyChunks.join(''));
  });

  it('空 body 透传不报错', async () => {
    const upstream = makeUpstream(null, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const result = streamResponse(upstream);
    expect(result.body).toBeNull();
    expect(result.headers.get('X-Accel-Buffering')).toBe('no');
  });
});

// ===========================================================================
// 4. 其他 header 保留
// ===========================================================================

describe('streamResponse - 其他 header 保留', () => {
  it('保留上游的自定义 header', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Custom-Header': 'custom-value',
        'X-Request-Id': 'req-123',
      },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('X-Custom-Header')).toBe('custom-value');
    expect(result.headers.get('X-Request-Id')).toBe('req-123');
  });

  it('保留 Cache-Control 头', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('Cache-Control')).toBe('no-cache, no-transform');
  });

  it('保留 Connection 头(SSE 常用 keep-alive)', () => {
    const upstream = makeUpstream(makeBody(['data: hi\n\n']), {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
      },
    });
    const result = streamResponse(upstream);
    expect(result.headers.get('Connection')).toBe('keep-alive');
  });
});

// ===========================================================================
// 5. 集成场景:SSE 完整响应链路
// ===========================================================================

describe('streamResponse - SSE 完整响应链路', () => {
  it('完整 SSE 响应:Content-Type + X-Accel-Buffering + body 透传', async () => {
    const sseBody = [
      'data: {"event":"message","data":{"content":"Hello"}}\n\n',
      'data: {"event":"workflow_finished","data":{}}\n\n',
    ];
    const upstream = makeUpstream(makeBody(sseBody), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    });

    const result = streamResponse(upstream);

    // 状态码保留
    expect(result.status).toBe(200);
    // Content-Type 保留
    expect(result.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    // X-Accel-Buffering 自动添加(P2 修复)
    expect(result.headers.get('X-Accel-Buffering')).toBe('no');
    // Cache-Control 保留
    expect(result.headers.get('Cache-Control')).toBe('no-cache');
    // Connection 保留
    expect(result.headers.get('Connection')).toBe('keep-alive');
    // Transfer-Encoding 被过滤
    expect(result.headers.get('Transfer-Encoding')).toBeNull();
    // body 完整透传
    const body = await readBody(result);
    expect(body).toBe(sseBody.join(''));
  });

  it('非 SSE JSON 响应:无 X-Accel-Buffering,其他头保留', async () => {
    const jsonBody = ['{"message":"ok","status":200}'];
    const upstream = makeUpstream(makeBody(jsonBody), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-Id': 'req-abc',
      },
    });

    const result = streamResponse(upstream);

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(result.headers.get('X-Request-Id')).toBe('req-abc');
    // 非 SSE 不添加 X-Accel-Buffering
    expect(result.headers.get('X-Accel-Buffering')).toBeNull();
    const body = await readBody(result);
    expect(body).toBe(jsonBody[0]);
  });
});
