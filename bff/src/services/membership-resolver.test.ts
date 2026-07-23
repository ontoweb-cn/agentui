import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveMemberships, resolveMembershipsFromContext } from './membership-resolver';
import { membershipCache, resetMembershipCacheForTesting } from './membership-cache';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('resolveMemberships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMembershipCacheForTesting();
  });

  afterEach(() => {
    resetMembershipCacheForTesting();
  });

  it('缓存命中时直接返回成员关系,不调 fetch', async () => {
    membershipCache.set('0', 'cached-token', { teamIds: ['cached-team'], projectIds: ['cached-proj'] });

    const result = await resolveMemberships('0', 'cached-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: ['cached-team'], projectIds: ['cached-proj'] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('缓存未命中时并行调 /api/teams + /api/projects 并缓存结果', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'team-a', slug: 'team-a', display_name: 'Team A' },
            { id: 'team-b', slug: 'team-b', display_name: 'Team B' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'proj-a', slug: 'proj-a', display_name: 'Project A' }],
        }),
      });

    const result = await resolveMemberships('0', 'new-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: ['team-a', 'team-b'], projectIds: ['proj-a'] });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9381/api/teams',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer new-token',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9381/api/projects',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer new-token',
          'Content-Type': 'application/json',
        },
      }),
    );
    // 缓存已写入
    expect(membershipCache.get('0', 'new-token')).toEqual({
      teamIds: ['team-a', 'team-b'],
      projectIds: ['proj-a'],
    });
  });

  it('teams 返回 401 时返回 undefined 且不缓存', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

    const result = await resolveMemberships('0', 'invalid-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
    expect(membershipCache.get('0', 'invalid-token')).toBeUndefined();
  });

  it('projects 返回 401 时返回 undefined(保守处理)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'team-a', slug: 'team-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

    const result = await resolveMemberships('0', 'invalid-proj-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  it('teams 返回 500 时返回 undefined', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

    const result = await resolveMemberships('0', 'server-error-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  it('teams 网络错误时返回 undefined', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

    const result = await resolveMemberships('0', 'network-error-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  it('projects 网络错误时不阻塞,仍返回 teams 结果(空 projectIds)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'team-a', slug: 'team-a' }] }),
      })
      .mockRejectedValueOnce(new Error('projects ECONNREFUSED'));

    const result = await resolveMemberships('0', 'projects-fail-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: ['team-a'], projectIds: [] });
  });

  it('projects 返回 503(功能未启用)时不阻塞,仍返回 teams 结果', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'team-a', slug: 'team-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

    const result = await resolveMemberships('0', 'projects-503-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: ['team-a'], projectIds: [] });
  });

  it('teams JSON 解析失败时返回 undefined', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

    const result = await resolveMemberships('0', 'bad-json-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  it('projects JSON 解析失败时不阻塞,仍返回 teams 结果(空 projectIds)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'team-a', slug: 'team-a' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

    const result = await resolveMemberships('0', 'bad-proj-json-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: ['team-a'], projectIds: [] });
  });

  it('teams 和 projects 都为空列表时返回空成员关系', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

    const result = await resolveMemberships('0', 'empty-memberships-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: [], projectIds: [] });
  });

  it('id 和 slug 字段都提取并去重', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'team-a', slug: 'team-a' },
            { id: 'team-b', slug: 'team-b-alt-slug' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

    const result = await resolveMemberships('0', 'dedup-token', 'http://localhost:9381');

    // team-a: id 和 slug 相同,去重为一个
    // team-b: id 和 slug 不同,都加入
    expect(result?.teamIds.sort()).toEqual(['team-a', 'team-b', 'team-b-alt-slug'].sort());
  });

  it('响应 data 字段缺失时返回空数组', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}), // 缺 data 字段
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

    const result = await resolveMemberships('0', 'no-data-token', 'http://localhost:9381');

    expect(result).toEqual({ teamIds: [], projectIds: [] });
  });
});

describe('resolveMembershipsFromContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMembershipCacheForTesting();
  });

  afterEach(() => {
    resetMembershipCacheForTesting();
  });

  it('无 session 时返回 undefined', async () => {
    const ctx = { get: () => undefined };
    const result = await resolveMembershipsFromContext(ctx);
    expect(result).toBeUndefined();
  });

  it('企业版 session 缺少 backendStore 时返回 undefined', async () => {
    const ctx = {
      get: (key: string) => {
        if (key === 'authSession') {
          return { token: 'ent-token', tenantId: 'b1' };
        }
        return undefined;
      },
    };
    const result = await resolveMembershipsFromContext(ctx);
    expect(result).toBeUndefined();
  });

  it('企业版 session 完整时调 /api/teams + /api/projects 解析', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'team-ent', slug: 'team-ent' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'proj-ent', slug: 'proj-ent' }] }),
      });

    const ctx = {
      get: (key: string) => {
        if (key === 'authSession') {
          return { token: 'ent-token', tenantId: 'b1' };
        }
        if (key === 'tenantStore') {
          return {
            getBackend: (id: string) =>
              id === 'b1' ? { id, intellectBackendId: 'h1' } : undefined,
          };
        }
        if (key === 'harnessStore') {
          return {
            get: (id: string) =>
              id === 'h1' ? { endpoint: 'http://ent:9381' } : undefined,
          };
        }
        return undefined;
      },
    };

    const result = await resolveMembershipsFromContext(ctx);

    expect(result).toEqual({ teamIds: ['team-ent'], projectIds: ['proj-ent'] });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://ent:9381/api/teams',
      expect.objectContaining({
        headers: { Authorization: 'Bearer ent-token', 'Content-Type': 'application/json' },
      }),
    );
  });
});
