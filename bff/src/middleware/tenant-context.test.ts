import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantContextMiddleware } from './tenant-context';
import type { TenantContext } from '../types/tenant';

interface MockContext {
  req: {
    header: (name: string) => string | undefined;
  };
  set: (key: 'tenantContext', value: TenantContext) => void;
  get: (key: string) => unknown;
  json: (body: unknown, status?: number) => { body: unknown; status: number };
  storedContext?: TenantContext;
}

function createMockContext(
  headers: Record<string, string>,
  tenantStore?: unknown,
): MockContext {
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
    get: (key: string) => (key === 'tenantStore' ? tenantStore : undefined),
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

  it('P3:store 无 BffTenant 绑定时不注入 intellectTeamId(单租户场景兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Tenant-Id': 'tenant-001',
        'X-User-Id': 'user-001',
        // 直接传 header 不应被提取(P3 从 store 读,不从 header 读)
        'X-Intellect-Team': 'team-1',
        'X-Intellect-Project': 'proj-1',
      },
      // tenantStore.getTenant 返回 undefined(无绑定)
      { getTenant: () => undefined },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    // P3:store 无绑定 → 不注入企业版头字段
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.intellectProjectId).toBeUndefined();
  });

  it('P3:store 含 BffTenant.intellectTenantId → 注入 intellectTeamId(企业版)', async () => {
    const ctx = createMockContext(
      {
        'X-Tenant-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getTenant: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectTenantId: 'team-abc' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    // research.md R3:intellectTenantId 映射到 intellectTeamId
    expect(ctx.storedContext?.intellectTeamId).toBe('team-abc');
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

  it('P4b (FR-006):intellectTenantId="0" 时不注入 intellectTeamId(缺省 TenantID 兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Tenant-Id': 'tenant-enterprise-default',
        'X-User-Id': 'user-001',
      },
      {
        getTenant: (id: string) =>
          id === 'tenant-enterprise-default'
            ? { id, intellectTenantId: '0' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    // intellectTenantId="0" → 不注入 intellectTeamId(intellect-team 走全局默认)
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.tenantId).toBe('tenant-enterprise-default');
  });

  it('P5 (FR-005):BffTenant.intellectProjectId 存在时注入 intellectProjectId', async () => {
    const ctx = createMockContext(
      {
        'X-Tenant-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getTenant: (id: string) =>
          id === 'tenant-enterprise'
            ? {
                id,
                intellectTenantId: 'team-abc',
                intellectProjectId: 'project-xyz',
              }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    // team_id + project_id 都注入
    expect(ctx.storedContext?.intellectTeamId).toBe('team-abc');
    expect(ctx.storedContext?.intellectProjectId).toBe('project-xyz');
  });

  it('P5 (FR-005):BffTenant 无 intellectProjectId 时不注入(向后兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Tenant-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getTenant: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectTenantId: 'team-abc' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    expect(ctx.storedContext?.intellectTeamId).toBe('team-abc');
    expect(ctx.storedContext?.intellectProjectId).toBeUndefined();
  });

  it('P5:intellectTenantId="0" 但 intellectProjectId 存在 → project 仍注入(透传灵活性)', async () => {
    // 边界场景:intellect-team 侧校验 team/project 依赖,BFF 不强制
    const ctx = createMockContext(
      {
        'X-Tenant-Id': 'tenant-edge',
        'X-User-Id': 'user-001',
      },
      {
        getTenant: (id: string) =>
          id === 'tenant-edge'
            ? { id, intellectTenantId: '0', intellectProjectId: 'project-orphan' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await tenantContextMiddleware(ctx as never, next);

    // team_id="0" 不注入,但 project_id 仍注入(透传,intellect-team 侧决定是否拒绝)
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.intellectProjectId).toBe('project-orphan');
  });
});
