// 改进 1 (P0):tenant-validator 单元测试
// 覆盖 4 种场景:配置一致 / 配置不一致 / 未配置自动填充 / endpoint 不可达

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { validateTenantConfigs } from './tenant-validator';
import type { HarnessStore } from '../types';
import type { HarnessBackend } from '../types/harness';

function makeBackend(overrides: Partial<HarnessBackend> = {}): HarnessBackend {
  return {
    id: 'intellect-enterprise-default',
    name: 'Intellect Enterprise (Default)',
    type: 'intellect-enterprise',
    endpoint: 'http://localhost:8642',
    adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY',
    capabilities: {
      canvas: false,
      knowledgeBase: false,
      memory: true,
      mcp: true,
      multiTenant: true,
      modelManagement: false,
    },
    defaultForTenant: false,
    adminToken: 'test-api-server-key',
    ...overrides,
  } as HarnessBackend;
}

function makeStore(backends: HarnessBackend[]): HarnessStore {
  return {
    list: () => backends,
    get: (id: string) => backends.find((b) => b.id === id),
  } as unknown as HarnessStore;
}

function makeTenantInfoResponse(tenantId: string, source: 'env' | 'default' = 'env'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      tenant_id: tenantId,
      display_name: tenantId,
      enabled: true,
      source,
    }),
  } as Response;
}

describe('validateTenantConfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('配置一致时返回 true', async () => {
    const backend = makeBackend({ intellectTenantId: '00000000000000000000000000000000' });
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000000', 'env'));

    const ok = await validateTenantConfigs(makeStore([backend]));

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:8642/api/tenant/info');
    expect(init.method).toBe('GET');
    // 公开端点,不注入 Authorization
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('配置不一致时返回 false(fail-fast)', async () => {
    const backend = makeBackend({ intellectTenantId: '00000000000000000000000000000001' });
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000000', 'env'));

    const ok = await validateTenantConfigs(makeStore([backend]));

    expect(ok).toBe(false);
    // 不应自动覆盖配置(配置不一致视为致命错误)
    expect(backend.intellectTenantId).toBe('00000000000000000000000000000001');
  });

  it('未配置 intellectTenantId 时自动从 endpoint 拉取并填充运行时对象', async () => {
    const backend = makeBackend({ intellectTenantId: undefined });
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000002', 'env'));

    const ok = await validateTenantConfigs(makeStore([backend]));

    expect(ok).toBe(true);
    // 自动填充到运行时对象(不修改 JSON 文件)
    expect(backend.intellectTenantId).toBe('00000000000000000000000000000002');
  });

  it('endpoint 不可达时返回 true(降级放行)', async () => {
    const backend = makeBackend({ intellectTenantId: '00000000000000000000000000000000' });
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const ok = await validateTenantConfigs(makeStore([backend]));

    expect(ok).toBe(true);
  });

  it('endpoint 返回非 200 时返回 true(降级放行)', async () => {
    const backend = makeBackend({ intellectTenantId: '00000000000000000000000000000000' });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const ok = await validateTenantConfigs(makeStore([backend]));

    expect(ok).toBe(true);
  });

  it('endpoint 返回空 tenant_id 时返回 true(降级放行)', async () => {
    const backend = makeBackend({ intellectTenantId: '00000000000000000000000000000000' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tenant_id: '' }),
    } as Response);

    const ok = await validateTenantConfigs(makeStore([backend]));

    expect(ok).toBe(true);
  });

  it('无 intellect-enterprise backend 时跳过校验', async () => {
    const ragBackend = makeBackend({
      id: 'intellect-rag-default',
      type: 'intellect-rag' as const,
      intellectTenantId: undefined,
    });
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000000'));

    const ok = await validateTenantConfigs(makeStore([ragBackend]));

    expect(ok).toBe(true);
    // 不应调用 fetch(非 enterprise backend 不校验)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('多个 backend,任一不一致则返回 false', async () => {
    const backend1 = makeBackend({
      id: 'enterprise-1',
      intellectTenantId: '00000000000000000000000000000000',
    });
    const backend2 = makeBackend({
      id: 'enterprise-2',
      intellectTenantId: '00000000000000000000000000000001',
      endpoint: 'http://localhost:8643',
    });
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000000'));
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000003'));

    const ok = await validateTenantConfigs(makeStore([backend1, backend2]));

    expect(ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('endpoint 去掉尾部斜杠', async () => {
    const backend = makeBackend({
      endpoint: 'http://localhost:8642/',
      intellectTenantId: '00000000000000000000000000000000',
    });
    mockFetch.mockResolvedValueOnce(makeTenantInfoResponse('00000000000000000000000000000000'));

    await validateTenantConfigs(makeStore([backend]));

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:8642/api/tenant/info');
  });
});
