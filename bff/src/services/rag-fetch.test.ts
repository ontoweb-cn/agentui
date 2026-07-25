import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ragTokenProvider:测试中通过 vi.mocked 控制行为
vi.mock('./rag-token-provider', () => ({
  ragTokenProvider: {
    login: vi.fn(),
    getToken: vi.fn(),
    invalidate: vi.fn(),
  },
}));

import { fetchWithRagToken, resolveRagToken } from './rag-fetch';
import { ragTokenProvider } from './rag-token-provider';

const mockLogin = vi.mocked(ragTokenProvider.login);
const mockGetToken = vi.mocked(ragTokenProvider.getToken);
const mockInvalidate = vi.mocked(ragTokenProvider.invalidate);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(status = 200, body: unknown = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
  } as Response;
}

describe('rag-fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认:getToken 返回 null(无动态 token)
    mockGetToken.mockReturnValue(null);
    // 默认:login 抛错(未配置)
    mockLogin.mockRejectedValue(new Error('not configured'));
    // 默认:无 env var
    delete process.env.HARNESS_INTELLECT_RAG_ADMIN_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // resolveRagToken
  // -------------------------------------------------------------------------

  describe('resolveRagToken', () => {
    it('动态 token 可用时返回动态 token(完整 Authorization 头值)', async () => {
      mockLogin.mockResolvedValue('Bearer dynamic-jwt-token');
      const token = await resolveRagToken();
      expect(token).toBe('Bearer dynamic-jwt-token');
      expect(mockLogin).toHaveBeenCalledTimes(1);
    });

    it('动态 login 抛错时降级到 HARNESS_INTELLECT_RAG_ADMIN_TOKEN env var', async () => {
      mockLogin.mockRejectedValue(new Error('login failed'));
      process.env.HARNESS_INTELLECT_RAG_ADMIN_TOKEN = 'static-env-token';
      const token = await resolveRagToken();
      expect(token).toBe('Bearer static-env-token');
    });

    it('动态 login 失败且 env var 未设置时返回 null', async () => {
      mockLogin.mockRejectedValue(new Error('login failed'));
      const token = await resolveRagToken();
      expect(token).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // fetchWithRagToken — token 优先级
  // -------------------------------------------------------------------------

  describe('token 优先级', () => {
    it('调用方显式 Authorization 优先级最高,不覆盖', async () => {
      mockLogin.mockResolvedValue('Bearer dynamic-jwt');
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: { Authorization: 'Bearer explicit-token' },
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('Authorization')).toBe('Bearer explicit-token');
      // 不调用 login(因为已有显式 token)
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('无显式 Authorization 时优先用动态 token', async () => {
      mockLogin.mockResolvedValue('Bearer dynamic-jwt');
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('Authorization')).toBe('Bearer dynamic-jwt');
    });

    it('动态 token 不可用时降级到 fallbackStaticToken', async () => {
      mockLogin.mockRejectedValue(new Error('not configured'));
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      }, { fallbackStaticToken: 'static-admin-token' });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('Authorization')).toBe('Bearer static-admin-token');
    });

    it('动态 token 与 fallbackStaticToken 都不可用时不注入 Authorization', async () => {
      mockLogin.mockRejectedValue(new Error('not configured'));
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('Authorization')).toBeNull();
    });

    it('Headers 实例中显式设置 Authorization 也算 explicit', async () => {
      mockLogin.mockResolvedValue('Bearer dynamic-jwt');
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      const headers = new Headers();
      headers.set('Authorization', 'Bearer header-explicit');
      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers,
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('Authorization')).toBe('Bearer header-explicit');
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // fetchWithRagToken — 401 重试
  // -------------------------------------------------------------------------

  describe('401 重试', () => {
    it('动态 token 场景下 401 自动 invalidate + 重新 login + 重试', async () => {
      // 首次 login 成功,返回过期 token
      mockLogin.mockResolvedValueOnce('Bearer expired-jwt');
      // 重试时 getToken 返回非 null(表示之前有动态 token)
      mockGetToken.mockReturnValue('Bearer expired-jwt');
      // 重试时 login 返回新 token
      mockLogin.mockResolvedValueOnce('Bearer refreshed-jwt');

      // 首次 fetch 返回 401,重试返回 200
      mockFetch.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(makeResponse(200, { ok: true }));

      const result = await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockInvalidate).toHaveBeenCalledTimes(1);
      // 重试时 Authorization 用新 token
      const [, retryInit] = mockFetch.mock.calls[1];
      expect(retryInit.headers.get('Authorization')).toBe('Bearer refreshed-jwt');
      expect(result.status).toBe(200);
    });

    it('动态 token 场景下重试 login 失败时不重试,返回原 401', async () => {
      mockLogin.mockResolvedValueOnce('Bearer expired-jwt');
      mockGetToken.mockReturnValue('Bearer expired-jwt');
      // 重试 login 失败
      mockLogin.mockRejectedValueOnce(new Error('login service down'));

      mockFetch.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'));

      const result = await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(401);
    });

    it('动态 token 场景下 getToken() 返回 null 时不重试(首次 login 已失败)', async () => {
      // login 成功(动态 token 注入),但 getToken 在 401 时返回 null
      // 实际场景:login 成功后 getToken 应返回 token,此处模拟边界
      mockLogin.mockResolvedValueOnce('Bearer dynamic-jwt');
      mockGetToken.mockReturnValue(null); // 边界:模拟 token 已被清除

      mockFetch.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'));

      const result = await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockInvalidate).not.toHaveBeenCalled();
      expect(result.status).toBe(401);
    });

    it('静态 token (fallbackStaticToken) 场景下 401 不重试', async () => {
      mockLogin.mockRejectedValue(new Error('not configured'));
      mockFetch.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'));

      const result = await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      }, { fallbackStaticToken: 'static-token' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockInvalidate).not.toHaveBeenCalled();
      expect(result.status).toBe(401);
    });

    it('显式 Authorization 场景下 401 不重试(由调用方管理)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'));

      const result = await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: { Authorization: 'Bearer explicit-token' },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockInvalidate).not.toHaveBeenCalled();
      expect(result.status).toBe(401);
    });

    it('无 token 场景下 401 不重试', async () => {
      mockLogin.mockRejectedValue(new Error('not configured'));
      mockFetch.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'));

      const result = await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockInvalidate).not.toHaveBeenCalled();
      expect(result.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // fetchWithRagToken — body 缓冲
  // -------------------------------------------------------------------------

  describe('body 缓冲', () => {
    it('ReadableStream body 被缓冲到 Buffer 以支持重试', async () => {
      mockLogin.mockResolvedValueOnce('Bearer expired-jwt');
      mockGetToken.mockReturnValue('Bearer expired-jwt');
      mockLogin.mockResolvedValueOnce('Bearer refreshed-jwt');

      mockFetch.mockResolvedValueOnce(makeResponse(401));
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"k":"v"}'));
          controller.close();
        },
      });

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // 两次 fetch 的 body 应该都是 Buffer,且内容一致
      const [, firstInit] = mockFetch.mock.calls[0];
      const [, retryInit] = mockFetch.mock.calls[1];
      expect(Buffer.isBuffer(firstInit.body)).toBe(true);
      expect(Buffer.isBuffer(retryInit.body)).toBe(true);
      expect(firstInit.body.toString()).toBe('{"k":"v"}');
      expect(retryInit.body.toString()).toBe('{"k":"v"}');
      // duplex 应该被设置(Node fetch stream body 要求)
      expect(firstInit.duplex).toBe('half');
      expect(retryInit.duplex).toBe('half');
    });

    it('string body 被缓冲到 Buffer', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'POST',
        headers: {},
        body: '{"k":"v"}',
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(Buffer.isBuffer(init.body)).toBe(true);
      expect(init.body.toString()).toBe('{"k":"v"}');
    });

    it('无 body 时不缓冲,fetch 收到 undefined', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: {},
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.body).toBeUndefined();
      expect(init.duplex).toBeUndefined();
    });

    it('bufferBody=false 时不缓冲 body(用于不需要重试的 GET 场景)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello'));
          controller.close();
        },
      });

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'POST',
        headers: {},
        body: stream,
      }, { bufferBody: false });

      const [, init] = mockFetch.mock.calls[0];
      // body 未缓冲,原样透传 ReadableStream
      expect(init.body).toBe(stream);
    });
  });

  // -------------------------------------------------------------------------
  // fetchWithRagToken — headers 处理
  // -------------------------------------------------------------------------

  describe('headers 处理', () => {
    it('删除 host 头避免上游冲突', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: { host: 'localhost:9391' },
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('host')).toBeNull();
    });

    it('保留调用方设置的其他头(Content-Type / X-Intellect-*)', async () => {
      mockLogin.mockResolvedValue('Bearer dynamic-jwt');
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Intellect-User': 'member-123',
          'X-Intellect-Team': 'team-456',
        },
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.get('Content-Type')).toBe('application/json');
      expect(init.headers.get('X-Intellect-User')).toBe('member-123');
      expect(init.headers.get('X-Intellect-Team')).toBe('team-456');
      expect(init.headers.get('Authorization')).toBe('Bearer dynamic-jwt');
    });

    it('不修改调用方传入的 Headers 实例(构造副本)', async () => {
      mockLogin.mockResolvedValue('Bearer dynamic-jwt');
      mockFetch.mockResolvedValueOnce(makeResponse(200));

      const original = new Headers();
      original.set('Content-Type', 'application/json');
      await fetchWithRagToken('http://up/api/v1/agents', {
        method: 'GET',
        headers: original,
      });

      // 调用方的 Headers 实例不应被注入 Authorization
      expect(original.get('Authorization')).toBeNull();
    });
  });
});
