// P0-1: hiedu 断言代理路由单元测试。
// 覆盖:路径映射、成功代理(断言可验签 / X-Request-Id / Cookie 不转发)、
// 客户端伪造 X-Hiedu-* 被剥离、缺失/无效会话 → 403 + auth.reject 审计、
// 未启用 → 503。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';

import { createHieduRoutes } from './hiedu';
import { authSessionMiddleware } from '../middleware/auth-session';
import { authMiddleware } from '../middleware/auth';
import { AUTH_COOKIE_NAME } from '../types/auth';
import type {
  HieduAssertionConfig,
  HieduAssertionClaims,
  HieduConfigResult,
} from '../services/hiedu-assertion';
import type { HieduAuthRejectEvent, HieduAuditSink } from '../services/hiedu-audit';
import type { BackendStore, HarnessStore } from '../types/stores';

interface TestVariables {
  backendStore: BackendStore;
  harnessStore: HarnessStore;
}

const keyPair = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const config: HieduAssertionConfig = {
  baseUrl: 'http://hiedu.test',
  iss: 'agentui-bff',
  aud: 'hiedu',
  org: 'wust',
  keys: [
    {
      kid: 'primary-kid',
      privateKey: createPrivateKey(keyPair.privateKey),
    },
  ],
};

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function createFetchMock(
  body: unknown = { ok: true },
  status = 200,
): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

interface CreateAppOptions {
  configResult?: HieduConfigResult;
  resolveMemberId?: () => Promise<string | undefined>;
  auditSink?: HieduAuditSink;
  fetchImpl?: typeof fetch;
  requestIdFactory?: () => string;
  /** 模拟 index.ts:在 hiedu 路由之后挂载通用 /api/* authMiddleware */
  legacyAuthAfterRoutes?: boolean;
}

function createApp(options: CreateAppOptions = {}): Hono<{ Variables: TestVariables }> {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', authSessionMiddleware);
  app.route(
    '/',
    createHieduRoutes({
      configLoader: () => options.configResult ?? { ok: true, config },
      resolveMemberId: options.resolveMemberId ?? (async () => 'member-42'),
      auditSink: options.auditSink,
      fetchImpl: options.fetchImpl,
      requestIdFactory: options.requestIdFactory,
    }),
  );
  if (options.legacyAuthAfterRoutes) {
    app.use('/api/*', authMiddleware);
  }
  return app;
}

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

function verifyAssertion(assertion: string): boolean {
  const [header, payload, signature] = assertion.split('.');
  return verify(
    null,
    Buffer.from(`${header}.${payload}`, 'utf8'),
    keyPair.publicKey,
    Buffer.from(signature, 'base64url'),
  );
}

describe('hiedu 断言代理路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功代理:路径映射正确,断言可验签,客户端 Cookie/Authorization 不转发', async () => {
    const { calls, fetchImpl } = createFetchMock();
    const app = createApp({ fetchImpl });

    const res = await app.request('/api/bff/hiedu/api/me?x=1', {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=imt_valid_token`,
        Authorization: 'Bearer client-token',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': 'req-client-1',
        'X-Hiedu-Assertion': 'forged-assertion',
        'X-Hiedu-User': 'attacker',
      },
    });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://hiedu.test/api/me?x=1');

    const headers = new Headers(calls[0].init?.headers);
    // 客户端伪造的断言/额外 X-Hiedu-* 全部被剥离
    expect(headers.get('X-Hiedu-Assertion')).not.toBe('forged-assertion');
    expect(headers.get('X-Hiedu-User')).toBeNull();
    // 浏览器 Cookie / Authorization 不转发
    expect(headers.get('Cookie')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
    // 白名单头保留
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
    // 合法 X-Request-Id 保留
    expect(headers.get('X-Request-Id')).toBe('req-client-1');

    // 注入的断言结构/claims 正确且可验签
    const assertion = headers.get('X-Hiedu-Assertion') ?? '';
    const [header, payload, signature] = assertion.split('.');
    expect(decodePart(header)).toEqual({ alg: 'EdDSA', kid: 'primary-kid' });
    expect(verifyAssertion(assertion)).toBe(true);
    const claims = decodePart<HieduAssertionClaims>(payload);
    expect(claims.sub).toBe('intellect:member-42');
    expect(claims.iss).toBe('agentui-bff');
    expect(claims.aud).toBe('hiedu');
    expect(claims.org).toBe('wust');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
    expect(signature).not.toBe('');
  });

  it('无客户端 X-Request-Id → 生成并注入', async () => {
    const { calls, fetchImpl } = createFetchMock();
    const app = createApp({ fetchImpl, requestIdFactory: () => 'bff-generated-id' });

    const res = await app.request('/hiedu/api/me', {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=imt_valid_token` },
    });

    expect(res.status).toBe(200);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('X-Request-Id')).toBe('bff-generated-id');
  });

  it('客户端 X-Request-Id 非法(含空格)→ 重新生成', async () => {
    const { calls, fetchImpl } = createFetchMock();
    const app = createApp({ fetchImpl, requestIdFactory: () => 'bff-generated-id' });

    const res = await app.request('/hiedu/api/me', {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=imt_valid_token`,
        'X-Request-Id': 'not valid id',
      },
    });

    expect(res.status).toBe(200);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('X-Request-Id')).toBe('bff-generated-id');
  });

  it('无 session → 403 + auth.reject(missing_session)', async () => {
    const auditEvents: HieduAuthRejectEvent[] = [];
    const app = createApp({
      auditSink: (event) => auditEvents.push(event),
      requestIdFactory: () => 'req-missing-session',
    });

    const res = await app.request('/hiedu/api/me');

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: number; error: string; reason: string };
    expect(body.code).toBe(403);
    expect(body.error).toBe('HIEDU_AUTH_REJECTED');
    expect(body.reason).toBe('missing_session');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      event: 'auth.reject',
      requestId: 'req-missing-session',
      method: 'GET',
      path: '/hiedu/api/me',
      reason: 'missing_session',
    });
  });

  it('token 无效(memberId 解析失败)→ 403 + auth.reject(invalid_session)', async () => {
    const auditEvents: HieduAuthRejectEvent[] = [];
    const app = createApp({
      resolveMemberId: async () => undefined,
      auditSink: (event) => auditEvents.push(event),
      requestIdFactory: () => 'req-invalid-session',
    });

    const res = await app.request('/api/bff/hiedu/api/me', {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=imt_invalid_token` },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('invalid_session');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      event: 'auth.reject',
      requestId: 'req-invalid-session',
      reason: 'invalid_session',
    });
  });

  it('memberId 为空 → 403 + auth.reject(missing_member_id)', async () => {
    const auditEvents: HieduAuthRejectEvent[] = [];
    const app = createApp({
      resolveMemberId: async () => '   ',
      auditSink: (event) => auditEvents.push(event),
      requestIdFactory: () => 'req-missing-member',
    });

    const res = await app.request('/hiedu/api/me', {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=imt_valid_token` },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('missing_member_id');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].reason).toBe('missing_member_id');
  });

  it('注册顺序:通用 /api/* authMiddleware 不抢先拦截 hiedu 路由(403 而非 401)', async () => {
    const auditEvents: HieduAuthRejectEvent[] = [];
    const app = createApp({
      legacyAuthAfterRoutes: true,
      auditSink: (event) => auditEvents.push(event),
      requestIdFactory: () => 'req-order',
    });

    const res = await app.request('/api/bff/hiedu/api/me');

    expect(res.status).toBe(403);
    expect(auditEvents).toHaveLength(1);
  });

  it('未启用(HIEDU_AUTH_MODE!=gateway)→ 503,不触发上游/审计', async () => {
    const { calls, fetchImpl } = createFetchMock();
    const auditSink = vi.fn<HieduAuditSink>();
    const app = createApp({
      configResult: {
        ok: false,
        statusCode: 503,
        error: 'HIEDU_PROXY_DISABLED',
        message: 'HIEDU_AUTH_MODE is not gateway',
      },
      fetchImpl,
      auditSink,
    });

    const res = await app.request('/api/bff/hiedu/api/me');

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: number; error: string };
    expect(body.code).toBe(503);
    expect(body.error).toBe('HIEDU_PROXY_DISABLED');
    expect(calls).toHaveLength(0);
    expect(auditSink).not.toHaveBeenCalled();
  });
});
