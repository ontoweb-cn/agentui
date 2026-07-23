import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemberIdCache, memberIdCache, resetMemberIdCacheForTesting } from './member-id-cache';

// v9 BFF-P2-4:所有 cache 操作传入 backendId,内部 key 为 `${backendId}:${token}`
const B1 = 'backend-1';
const B2 = 'backend-2';

describe('MemberIdCache', () => {
  let cache: MemberIdCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MemberIdCache(1000); // 1 秒 TTL,方便测试
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('set + get 基本读写', () => {
    cache.set(B1, 'token-1', 'member-1', 'member');
    expect(cache.get(B1, 'token-1')?.memberId).toBe('member-1');
    expect(cache.get(B1, 'token-1')?.role).toBe('member');
  });

  it('get 未命中返回 undefined', () => {
    expect(cache.get(B1, 'not-exist')).toBeUndefined();
  });

  it('TTL 过期后返回 undefined 并删除条目', () => {
    cache.set(B1, 'token-1', 'member-1', 'member');
    expect(cache.get(B1, 'token-1')?.memberId).toBe('member-1');

    // 推进时间超过 TTL
    vi.advanceTimersByTime(1001);
    expect(cache.get(B1, 'token-1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('TTL 未过期时仍可读取', () => {
    cache.set(B1, 'token-1', 'member-1', 'admin');
    vi.advanceTimersByTime(500); // 0.5 秒,未过期
    expect(cache.get(B1, 'token-1')?.memberId).toBe('member-1');
    expect(cache.get(B1, 'token-1')?.role).toBe('admin');
  });

  it('invalidate 主动失效单个 (backendId, token)', () => {
    cache.set(B1, 'token-1', 'member-1', 'member');
    cache.set(B1, 'token-2', 'member-2', 'admin');
    cache.invalidate(B1, 'token-1');
    expect(cache.get(B1, 'token-1')).toBeUndefined();
    expect(cache.get(B1, 'token-2')?.memberId).toBe('member-2');
  });

  it('clear 清空全部缓存', () => {
    cache.set(B1, 'token-1', 'member-1', 'member');
    cache.set(B1, 'token-2', 'member-2', 'admin');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get(B1, 'token-1')).toBeUndefined();
  });

  it('超过 MAX_ENTRIES 时清理最早过期条目', () => {
    const smallCache = new MemberIdCache(10000);
    // 填满到 MAX_ENTRIES(1000)
    for (let i = 0; i < 1000; i++) {
      smallCache.set(B1, `token-${i}`, `member-${i}`, 'member');
    }
    expect(smallCache.size).toBe(1000);

    // 加一个,应触发 evict
    smallCache.set(B1, 'token-new', 'member-new', 'admin');
    expect(smallCache.size).toBeLessThanOrEqual(1000);
    expect(smallCache.get(B1, 'token-new')?.memberId).toBe('member-new');
  });

  it('evictExpired 清理所有过期条目', () => {
    cache.set(B1, 'token-1', 'member-1', 'member');
    cache.set(B1, 'token-2', 'member-2', 'admin');

    // 推进时间,让 token-1 过期
    vi.advanceTimersByTime(1001);
    cache.set(B1, 'token-3', 'member-3', 'member'); // 触发 evict

    expect(cache.get(B1, 'token-1')).toBeUndefined();
    expect(cache.get(B1, 'token-2')).toBeUndefined();
    expect(cache.get(B1, 'token-3')?.memberId).toBe('member-3');
  });

  it('size 返回当前缓存条目数', () => {
    expect(cache.size).toBe(0);
    cache.set(B1, 'token-1', 'member-1', 'member');
    expect(cache.size).toBe(1);
    cache.set(B1, 'token-2', 'member-2', 'admin');
    expect(cache.size).toBe(2);
  });

  // ── v9 BFF-P2-3: invalidateByMemberId ──────────────────────────

  it('invalidateByMemberId 清除指定 member 的所有 token 缓存', () => {
    // member-A 有 2 个 token,member-B 有 1 个 token
    cache.set(B1, 'token-a1', 'member-A', 'member');
    cache.set(B1, 'token-a2', 'member-A', 'admin');
    cache.set(B1, 'token-b1', 'member-B', 'member');

    const removed = cache.invalidateByMemberId('member-A');

    expect(removed).toBe(2);
    expect(cache.get(B1, 'token-a1')).toBeUndefined();
    expect(cache.get(B1, 'token-a2')).toBeUndefined();
    expect(cache.get(B1, 'token-b1')?.memberId).toBe('member-B');
    expect(cache.size).toBe(1);
  });

  it('invalidateByMemberId 未命中时返回 0 且不影响其他条目', () => {
    cache.set(B1, 'token-1', 'member-1', 'member');
    cache.set(B1, 'token-2', 'member-2', 'admin');

    const removed = cache.invalidateByMemberId('member-not-exist');

    expect(removed).toBe(0);
    expect(cache.size).toBe(2);
  });

  it('invalidateByMemberId 空缓存时返回 0', () => {
    const removed = cache.invalidateByMemberId('member-X');
    expect(removed).toBe(0);
    expect(cache.size).toBe(0);
  });

  // ── v9 BFF-P2-4: 复合 key 跨 backend 隔离 ──────────────────────────

  it('BFF-P2-4:相同 token 在不同 backendId 下独立缓存(不串号)', () => {
    // 场景:多实例部署,不同 backend 可能返回相同 member_id 字符串
    // 但同一 token 在不同 backend 下应独立缓存,不互相覆盖
    cache.set(B1, 'shared-token', 'member-in-b1', 'member');
    cache.set(B2, 'shared-token', 'member-in-b2', 'admin');

    // 两个 backend 各自读自己的缓存
    expect(cache.get(B1, 'shared-token')?.memberId).toBe('member-in-b1');
    expect(cache.get(B1, 'shared-token')?.role).toBe('member');
    expect(cache.get(B2, 'shared-token')?.memberId).toBe('member-in-b2');
    expect(cache.get(B2, 'shared-token')?.role).toBe('admin');
    expect(cache.size).toBe(2);
  });

  it('BFF-P2-4:invalidate 仅失效指定 backend 下的 token', () => {
    cache.set(B1, 'shared-token', 'member-1', 'member');
    cache.set(B2, 'shared-token', 'member-2', 'admin');

    // 登出 backend-1,只失效 B1 的缓存,B2 不受影响
    cache.invalidate(B1, 'shared-token');

    expect(cache.get(B1, 'shared-token')).toBeUndefined();
    expect(cache.get(B2, 'shared-token')?.memberId).toBe('member-2');
    expect(cache.size).toBe(1);
  });

  it('BFF-P2-4:invalidateByMemberId 跨 backend 清除同 member 的所有 token', () => {
    // member-A 在两个 backend 下都有 token(虽然实际中 member_id 跨实例可能不同,
    // 但假设配置导致相同,反向失效应跨 backend 清除)
    cache.set(B1, 'token-a1', 'member-A', 'member');
    cache.set(B2, 'token-a2', 'member-A', 'admin');
    cache.set(B1, 'token-b1', 'member-B', 'member');

    const removed = cache.invalidateByMemberId('member-A');

    expect(removed).toBe(2);
    expect(cache.get(B1, 'token-a1')).toBeUndefined();
    expect(cache.get(B2, 'token-a2')).toBeUndefined();
    expect(cache.get(B1, 'token-b1')?.memberId).toBe('member-B');
  });
});

describe('全局单例 memberIdCache', () => {
  beforeEach(() => {
    resetMemberIdCacheForTesting();
  });

  afterEach(() => {
    resetMemberIdCacheForTesting();
  });

  it('全局单例可正常使用', () => {
    memberIdCache.set(B1, 'global-token', 'global-member', 'member');
    expect(memberIdCache.get(B1, 'global-token')?.memberId).toBe('global-member');
  });
});
