import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backendContextMiddleware } from './backend-context';
import type { BackendContext } from '../types/tenant';

interface MockContext {
  req: {
    header: (name: string) => string | undefined;
  };
  set: (key: 'backendContext', value: BackendContext) => void;
  get: (key: string) => unknown;
  json: (body: unknown, status?: number) => { body: unknown; status: number };
  storedContext?: BackendContext;
}

function createMockContext(
  headers: Record<string, string>,
  backendStore?: unknown,
  harnessStore?: unknown,
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
    get: (key: string) => {
      if (key === 'backendStore') return backendStore;
      if (key === 'harnessStore') return harnessStore;
      return undefined;
    },
    json: (body, status) => ({ body, status: status ?? 200 }),
  };
  return ctx;
}

describe('backendContextMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('提取 X-Backend-Id 和 X-User-Id header,构造 BackendContext 并注入', async () => {
    const ctx = createMockContext({
      'X-Backend-Id': 'tenant-001',
      'X-User-Id': 'user-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext).toEqual({
      backendId: 'tenant-001',
      userId: 'user-001',
    });
  });

  it('缺失 X-Backend-Id 降级使用默认值 default 并调用 next(P1 兼容)', async () => {
    const ctx = createMockContext({
      'X-User-Id': 'user-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext?.backendId).toBe('default');
    expect(ctx.storedContext?.userId).toBe('user-001');
  });

  it('缺失 X-User-Id 降级使用默认值 bff-default 并调用 next(P1 兼容)', async () => {
    const ctx = createMockContext({
      'X-Backend-Id': 'tenant-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext?.backendId).toBe('tenant-001');
    expect(ctx.storedContext?.userId).toBe('bff-default');
  });

  it('两个 header 都缺失降级使用默认值并调用 next(P1 兼容)', async () => {
    const ctx = createMockContext({});
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext?.backendId).toBe('default');
    expect(ctx.storedContext?.userId).toBe('bff-default');
  });

  it('P3:store 无 BffTenant 绑定时不注入 intellectTeamId(单租户场景兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-001',
        'X-User-Id': 'user-001',
        // 直接传 header 不应被提取(P3 从 store 读,不从 header 读)
        'X-Intellect-Team': 'team-1',
        'X-Intellect-Project': 'proj-1',
      },
      // backendStore.getTenant 返回 undefined(无绑定)
      { getBackend: () => undefined },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    // P3:store 无绑定 → 不注入企业版头字段
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.intellectProjectId).toBeUndefined();
  });

  it('P3:store 含 BffTenant.intellectTenantId → 注入 intellectTeamId(企业版)', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectTenantId: 'team-abc' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    // research.md R3:intellectTenantId 映射到 intellectTeamId
    expect(ctx.storedContext?.intellectTeamId).toBe('team-abc');
  });

  it('header 大小写不敏感(经 Hono 标准化)', async () => {
    const ctx = createMockContext({
      'x-backend-id': 'tenant-001',
      'x-user-id': 'user-001',
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext?.backendId).toBe('tenant-001');
  });

  it('P4b (FR-006):intellectTenantId="0" 时不注入 intellectTeamId(缺省 TenantID 兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise-default',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-enterprise-default'
            ? { id, intellectTenantId: '0' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    // intellectTenantId="0" → 不注入 intellectTeamId(intellect-team 走全局默认)
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.backendId).toBe('tenant-enterprise-default');
  });

  it('P5 (FR-005):BffTenant.intellectProjectId 存在时注入 intellectProjectId', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
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

    await backendContextMiddleware(ctx as never, next);

    // team_id + project_id 都注入
    expect(ctx.storedContext?.intellectTeamId).toBe('team-abc');
    expect(ctx.storedContext?.intellectProjectId).toBe('project-xyz');
  });

  it('P5 (FR-005):BffTenant 无 intellectProjectId 时不注入(向后兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectTenantId: 'team-abc' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(ctx.storedContext?.intellectTeamId).toBe('team-abc');
    expect(ctx.storedContext?.intellectProjectId).toBeUndefined();
  });

  it('P5:intellectTenantId="0" 但 intellectProjectId 存在 → project 仍注入(透传灵活性)', async () => {
    // 边界场景:intellect-team 侧校验 team/project 依赖,BFF 不强制
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-edge',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-edge'
            ? { id, intellectTenantId: '0', intellectProjectId: 'project-orphan' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    // team_id="0" 不注入,但 project_id 仍注入(透传,intellect-team 侧决定是否拒绝)
    expect(ctx.storedContext?.intellectTeamId).toBeUndefined();
    expect(ctx.storedContext?.intellectProjectId).toBe('project-orphan');
  });

  // 方案 B: intellectTenantId (实例级 tenant_id) 和 sessionToken 注入测试
  it('方案 B:HarnessBackend.intellectTenantId 存在时注入到 ctx.intellectTenantId', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectBackendId: 'backend-enterprise-1' }
            : undefined,
      },
      {
        get: (id: string) =>
          id === 'backend-enterprise-1'
            ? { id, intellectTenantId: 'default' }
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    // HarnessBackend.intellectTenantId 注入到 ctx.intellectTenantId (非 intellectTeamId)
    expect(ctx.storedContext?.intellectTenantId).toBe('default');
  });

  it('方案 B:HarnessBackend 无 intellectTenantId 时不注入(向后兼容)', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectBackendId: 'backend-enterprise-1' }
            : undefined,
      },
      {
        get: (id: string) =>
          id === 'backend-enterprise-1'
            ? { id }  // 无 intellectTenantId
            : undefined,
      },
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(ctx.storedContext?.intellectTenantId).toBeUndefined();
  });

  it('方案 B:harnessStore 未挂载时不阻塞,intellectTenantId 留空', async () => {
    const ctx = createMockContext(
      {
        'X-Backend-Id': 'tenant-enterprise',
        'X-User-Id': 'user-001',
      },
      {
        getBackend: (id: string) =>
          id === 'tenant-enterprise'
            ? { id, intellectBackendId: 'backend-enterprise-1' }
            : undefined,
      },
      // 不传 harnessStore
    );
    const next = vi.fn().mockResolvedValue(undefined);

    await backendContextMiddleware(ctx as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.storedContext?.intellectTenantId).toBeUndefined();
  });
});
