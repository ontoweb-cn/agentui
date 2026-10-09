// isRagUnavailableEnvelope 纯函数单测:稳定机器标记与 message 兜底两种匹配。
// 注:位于前端 Jest 域(src/),使用 jest 全局 API,勿导入 vitest。

import {
  isRagUnavailableEnvelope,
  isSilentRagUnavailableResponse,
} from './rag-unavailable';

describe('isRagUnavailableEnvelope', () => {
  it('code=503 且携带稳定标记 RAG_UNAVAILABLE → true', () => {
    expect(
      isRagUnavailableEnvelope({
        code: 503,
        error: 'RAG_UNAVAILABLE',
        message: 'Tenant 0 has no canvas backend bound',
      }),
    ).toBe(true);
  });

  it('code=503 且 message 兜底匹配(无标记的历史信封)→ true', () => {
    expect(
      isRagUnavailableEnvelope({
        code: 503,
        message: 'Tenant 0 has no canvas backend bound',
      }),
    ).toBe(true);
  });

  it('code=503 但 message 无关 → false', () => {
    expect(
      isRagUnavailableEnvelope({ code: 503, message: 'service degraded' }),
    ).toBe(false);
  });

  it('非 503 → false', () => {
    expect(
      isRagUnavailableEnvelope({
        code: 500,
        error: 'RAG_UNAVAILABLE',
        message: 'no canvas backend bound',
      }),
    ).toBe(false);
    expect(isRagUnavailableEnvelope(undefined)).toBe(false);
    expect(isRagUnavailableEnvelope(null)).toBe(false);
  });
});

// jsdom 环境无 Response 全局:函数仅消费 status 与 clone().json(),用最小 stub 即可
function makeFakeResponse(status: number, body: unknown): Response {
  return {
    status,
    clone() {
      return { json: async () => body };
    },
  } as unknown as Response;
}

describe('isSilentRagUnavailableResponse', () => {
  it('HTTP 503 且信封匹配 → true', async () => {
    const response = makeFakeResponse(503, {
      code: 503,
      error: 'RAG_UNAVAILABLE',
      message: 'x',
    });
    expect(await isSilentRagUnavailableResponse(response)).toBe(true);
  });

  it('HTTP 503 但信封不匹配 → false', async () => {
    const response = makeFakeResponse(503, { code: 503, message: 'other reason' });
    expect(await isSilentRagUnavailableResponse(response)).toBe(false);
  });

  it('非 503 状态 → false', async () => {
    const response = makeFakeResponse(200, { code: 0 });
    expect(await isSilentRagUnavailableResponse(response)).toBe(false);
  });
});
