import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveMemberId, resolveMemberIdFromContext, resolveMemberInfo } from './member-id-resolver';
import { memberIdCache, resetMemberIdCacheForTesting } from './member-id-cache';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// v9 BFF-P2-4:所有 resolver 调用传入 backendId
const BACKEND_ID = 'b1';

describe('resolveMemberId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemberIdCacheForTesting();
  });

  afterEach(() => {
    resetMemberIdCacheForTesting();
  });

  it('缓存命中时直接返回 member_id,不调 fetch', async () => {
    memberIdCache.set(BACKEND_ID, 'cached-token', 'cached-member-id', 'member');

    const result = await resolveMemberId(BACKEND_ID, 'cached-token', 'http://localhost:9381');

    expect(result).toBe('cached-member-id');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('缓存未命中时调 /api/members/me 并缓存结果', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'resolved-member', role: 'member' }),
    });

    const result = await resolveMemberId(BACKEND_ID, 'new-token', 'http://localhost:9381');

    expect(result).toBe('resolved-member');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9381/api/members/me',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer new-token',
          'Content-Type': 'application/json',
        },
      }),
    );
    // 缓存已写入
    expect(memberIdCache.get(BACKEND_ID, 'new-token')?.memberId).toBe('resolved-member');
  });

  it('401 时返回 undefined 且不缓存', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const result = await resolveMemberId(BACKEND_ID, 'invalid-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
    expect(memberIdCache.get(BACKEND_ID, 'invalid-token')).toBeUndefined();
  });

  it('500 时返回 undefined 且不缓存', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await resolveMemberId(BACKEND_ID, 'token-500', 'http://localhost:9381');

    expect(result).toBeUndefined();
    expect(memberIdCache.get(BACKEND_ID, 'token-500')).toBeUndefined();
  });

  it('fetch 网络错误时返回 undefined', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await resolveMemberId(BACKEND_ID, 'network-error-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  it('响应缺少 member_id 时返回 undefined', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ role: 'member' }), // 缺少 member_id
    });

    const result = await resolveMemberId(BACKEND_ID, 'missing-id-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
    expect(memberIdCache.get(BACKEND_ID, 'missing-id-token')).toBeUndefined();
  });

  it('member_id 为空字符串时返回 undefined', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: '', role: 'member' }),
    });

    const result = await resolveMemberId(BACKEND_ID, 'empty-id-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  it('JSON 解析失败时返回 undefined', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    const result = await resolveMemberId(BACKEND_ID, 'bad-json-token', 'http://localhost:9381');

    expect(result).toBeUndefined();
  });

  // ── v9 BFF-P2-4: 跨 backend 隔离 ──────────────────────────

  it('BFF-P2-4:不同 backendId 下相同 token 独立解析(不命中对方缓存)', async () => {
    // 在 backend-A 下缓存 token-X → member-A
    memberIdCache.set('backend-A', 'shared-token', 'member-A', 'member');

    // backend-B 用相同 token 应不命中缓存,调 fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'member-B', role: 'admin' }),
    });

    const result = await resolveMemberId('backend-B', 'shared-token', 'http://localhost:9381');

    expect(result).toBe('member-B');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 两个 backend 各自缓存
    expect(memberIdCache.get('backend-A', 'shared-token')?.memberId).toBe('member-A');
    expect(memberIdCache.get('backend-B', 'shared-token')?.memberId).toBe('member-B');
  });
});

describe('resolveMemberInfo (v9 新增)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemberIdCacheForTesting();
  });

  afterEach(() => {
    resetMemberIdCacheForTesting();
  });

  it('缓存命中时返回 { memberId, role },不调 fetch', async () => {
    memberIdCache.set(BACKEND_ID, 'cached-token', 'cached-member-id', 'admin');

    const result = await resolveMemberInfo(BACKEND_ID, 'cached-token', 'http://localhost:9381');

    expect(result).toEqual({ memberId: 'cached-member-id', role: 'admin' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('缓存未命中时调 /api/members/me 并返回 { memberId, role }', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'member-1', role: 'admin' }),
    });

    const result = await resolveMemberInfo(BACKEND_ID, 'new-token', 'http://localhost:9381');

    expect(result).toEqual({ memberId: 'member-1', role: 'admin' });
    expect(memberIdCache.get(BACKEND_ID, 'new-token')?.role).toBe('admin');
  });

  it('role 缺失时兜底为 member', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'member-2' }), // 无 role
    });

    const result = await resolveMemberInfo(BACKEND_ID, 'no-role-token', 'http://localhost:9381');

    expect(result).toEqual({ memberId: 'member-2', role: 'member' });
  });
});

describe('resolveMemberIdFromContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemberIdCacheForTesting();
  });

  afterEach(() => {
    resetMemberIdCacheForTesting();
  });

  it('无 session 时返回 undefined', async () => {
    const ctx = { get: () => undefined };
    const result = await resolveMemberIdFromContext(ctx);
    expect(result).toBeUndefined();
  });

  it('企业版 session 缺少 backendStore 时返回 undefined', async () => {
    const ctx = {
      get: (key: string) => {
        if (key === 'authSession') {
          return { token: 'shared-token', backendId: 'b1' };
        }
        return undefined; // 无 backendStore / harnessStore
      },
    };
    const result = await resolveMemberIdFromContext(ctx);
    expect(result).toBeUndefined();
  });

  it('企业版 session 完整时调 /api/members/me 解析', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'ent-member-001', role: 'member' }),
    });

    const ctx = {
      get: (key: string) => {
        if (key === 'authSession') {
          return { token: 'shared-token', backendId: 'b1' };
        }
        if (key === 'backendStore') {
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

    const result = await resolveMemberIdFromContext(ctx);

    expect(result).toBe('ent-member-001');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://ent:9381/api/members/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer ent-token', 'Content-Type': 'application/json' },
      }),
    );
    // v9 BFF-P2-4:缓存以 (backendId, token) 为复合 key
    expect(memberIdCache.get('b1', 'ent-token')?.memberId).toBe('ent-member-001');
  });

  it('BFF-P2-4:同一 token 在不同 backend session 下独立缓存', async () => {
    // 两个 session 用相同 token 但不同 backendId,应独立解析
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'member-in-b1', role: 'member' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ member_id: 'member-in-b2', role: 'admin' }),
    });

    const ctxB1 = {
      get: (key: string) => {
        if (key === 'authSession') return { token: 'shared-token', backendId: 'b1' };
        if (key === 'backendStore') return { getBackend: () => ({ intellectBackendId: 'h1' }) };
        if (key === 'harnessStore') return { get: () => ({ endpoint: 'http://ent:9381' }) };
        return undefined;
      },
    };
    const ctxB2 = {
      get: (key: string) => {
        if (key === 'authSession') return { token: 'ent-token', backendId: 'b2' };
        if (key === 'backendStore') return { getBackend: () => ({ intellectBackendId: 'h1' }) };
        if (key === 'harnessStore') return { get: () => ({ endpoint: 'http://ent:9381' }) };
        return undefined;
      },
    };

    const r1 = await resolveMemberIdFromContext(ctxB1);
    const r2 = await resolveMemberIdFromContext(ctxB2);

    expect(r1).toBe('member-in-b1');
    expect(r2).toBe('member-in-b2');
    expect(mockFetch).toHaveBeenCalledTimes(2); // 两次都未命中缓存
    expect(memberIdCache.get('b1', 'shared-token')?.memberId).toBe('member-in-b1');
    expect(memberIdCache.get('b2', 'shared-token')?.memberId).toBe('member-in-b2');
  });
});
