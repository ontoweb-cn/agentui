// Multi-Harness P3 (Phase 2 Foundational):HTTP 客户端单元测试。
// Constitution Principle V (头注入) + VIII (API_SERVER_KEY 鉴权) + VII (Test-First)。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IntellectEnterpriseHttpClient,
  IntellectNotFoundError,
  IntellectBackendError,
} from './http-client';
import type { TenantContext } from '../../../types/tenant';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ctx: TenantContext = {
  tenantId: 'tenant-001',
  userId: 'user-001',
  intellectTeamId: 'team-abc',
  intellectProjectId: 'project-xyz',
};

const ctxMinimal: TenantContext = {
  tenantId: 'tenant-001',
  userId: 'user-001',
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeStreamResponse(chunks: Uint8Array[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(c as Uint8Array<ArrayBuffer>));
        controller.close();
      },
    }),
    text: async () => '',
  } as Response;
}

describe('IntellectEnterpriseHttpClient', () => {
  let client: IntellectEnterpriseHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IntellectEnterpriseHttpClient(
      'http://localhost:8642',
      'test-api-server-key',
    );
  });

  describe('request - 头注入', () => {
    it('注入 Authorization + X-Intellect-Team + X-Intellect-Project', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
      await client.request('GET', '/health', ctx);
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer test-api-server-key');
      expect(init.headers['X-Intellect-Team']).toBe('team-abc');
      expect(init.headers['X-Intellect-Project']).toBe('project-xyz');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('TenantContext 无 team/project 时不注入多租户头', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));
      await client.request('GET', '/health', ctxMinimal);
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer test-api-server-key');
      expect(init.headers).not.toHaveProperty('X-Intellect-Team');
      expect(init.headers).not.toHaveProperty('X-Intellect-Project');
    });
  });

  describe('request - 错误转换', () => {
    it('404 转 IntellectNotFoundError', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ msg: 'not found' }, 404));
      await expect(client.request('GET', '/api/sessions/x', ctx)).rejects.toThrow(
        IntellectNotFoundError,
      );
    });

    it('500 转 IntellectBackendError (status=500)', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ msg: 'err' }, 500));
      const err = await client
        .request('GET', '/api/sessions', ctx)
        .catch((e) => e);
      expect(err).toBeInstanceOf(IntellectBackendError);
      expect((err as IntellectBackendError).status).toBe(500);
    });

    it('网络错误(fetch rejected)转 IntellectBackendError (status=502)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const err = await client
        .request('GET', '/health', ctx)
        .catch((e) => e);
      expect(err).toBeInstanceOf(IntellectBackendError);
      expect((err as IntellectBackendError).status).toBe(502);
    });

    it('AbortError(超时)转 IntellectBackendError (status=408)', async () => {
      const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      mockFetch.mockRejectedValueOnce(abortErr);
      const err = await client
        .request('GET', '/health', ctx)
        .catch((e) => e);
      expect(err).toBeInstanceOf(IntellectBackendError);
      expect((err as IntellectBackendError).status).toBe(408);
    });
  });

  describe('request - 响应解析', () => {
    it('2xx JSON 返回解析后的 body', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 'sess-1' }));
      const res = await client.request<{ id: string }>('GET', '/api/sessions/sess-1', ctx);
      expect(res).toEqual({ id: 'sess-1' });
    });

    it('204 / DELETE 返回 undefined', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(null, 204));
      const res = await client.request<void>('DELETE', '/api/sessions/x', ctx);
      expect(res).toBeUndefined();
    });

    it('POST 带 body 时序列化为 JSON', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 's1' }));
      await client.request('POST', '/api/sessions', ctx, { title: 't1' });
      const [, init] = mockFetch.mock.calls[0];
      expect(init.body).toBe(JSON.stringify({ title: 't1' }));
    });
  });

  describe('requestStream', () => {
    it('返回 ReadableStream', async () => {
      const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
      mockFetch.mockResolvedValueOnce(makeStreamResponse(chunks));
      const stream = await client.requestStream('/api/sessions/x/chat/stream', ctx, {
        message: 'hi',
      });
      expect(stream).toBeInstanceOf(ReadableStream);
      const reader = stream.getReader();
      const r1 = await reader.read();
      expect(Array.from(r1.value as Uint8Array)).toEqual([1, 2]);
    });

    it('非 2xx 抛 IntellectBackendError', async () => {
      mockFetch.mockResolvedValueOnce(makeStreamResponse([], 500));
      await expect(
        client.requestStream('/api/sessions/x/chat/stream', ctx, {}),
      ).rejects.toThrow(IntellectBackendError);
    });

    it('stream 请求不设超时 signal(长连接)', async () => {
      mockFetch.mockResolvedValueOnce(makeStreamResponse([]));
      await client.requestStream('/api/sessions/x/chat/stream', ctx, {});
      const [, init] = mockFetch.mock.calls[0];
      // stream 请求不带 AbortController signal(允许长连接)
      expect(init.signal).toBeUndefined();
    });
  });
});
