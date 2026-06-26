import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantContextMiddleware } from './tenant-context';
import type { TenantContext } from '../types/tenant';

interface MockContext {
  req: {
    header: (name: string) => string | undefined;
  };
  set: (key: 'tenantContext', value: TenantContext) => void;
  json: (body: unknown, status?: number) => { body: unknown; status: number };
  storedContext?: TenantContext;
}

function createMockContext(headers: Record<string, string>): MockContext {
  // 模拟 Hono req.header() 大小写不敏感匹配
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  const ctx: MockContext = {
    req: {
      header: (name: string) => normalized[name.toLowerCase()],
    },
    set: (_key, value) => {
      ctx.storedContext = value;
    },
    json: (body, status) => ({ body, status: status ?? 200 }),
  };
  return ctx;
}

describe('tenantContextMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('提取 X-Tenant-Id 和 X-User-Id header,构造 TenantContext 并注入', async () => {
    const ctx = createMockContext({
      'X-Tenant-Id': 'tenant-001',
      'X-User-Id': 'user-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext).toEqual({
      tenantId: 'tenant-001',
      userId: 'user-001',
    });
  });

  it('缺失 X-Tenant-Id 返回 400,不调用 next', async () => {
    const ctx = createMockContext({
      'X-User-Id': 'user-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    const result = await tenantContextMiddleware(ctx as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      body: expect.objectContaining({
        code: 400,
        message: expect.stringContaining('X-Tenant-Id'),
      }),
      status: 400,
    });
  });

  it('缺失 X-User-Id 返回 400', async () => {
    const ctx = createMockContext({
      'X-Tenant-Id': 'tenant-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    const result = await tenantContextMiddleware(ctx as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      body: expect.objectContaining({
        code: 400,
        message: expect.stringContaining('X-User-Id'),
      }),
      status: 400,
    });
  });

  it('两个 header 都缺失返回 400', async () => {
    const ctx = createMockContext({});
    const next = vi.fn().mockResolvedValue(undefined);

    const result = await tenantContextMiddleware(ctx as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      body: expect.objectContaining({ code: 400 }),
      status: 400,
    });
  });

  it('不提取 X-Intellect-Team / X-Intellect-Project(P1 单租户场景,Principle V)', async () => {
    const ctx = createMockContext({
      'X-Tenant-Id': 'tenant-001',
      'X-User-Id': 'user-001',
      'X-Intellect-Team': 'team-1',
      'X-Intellect-Project': 'proj-1',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    // P1 不提取企业版头,intellectTeamId/intellectProjectId 应为 undefined
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.intellectProjectId).toBeUndefined();
  });

  it('header 大小写不敏感(经 Hono 标准化)', async () => {
    const ctx = createMockContext({
      'x-tenant-id': 'tenant-001',
      'x-user-id': 'user-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext?.tenantId).toBe('tenant-001');
  });
});
