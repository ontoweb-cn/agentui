import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MembershipCache, membershipCache, resetMembershipCacheForTesting } from './membership-cache';

const DEFAULT_BACKEND = '0';

describe('MembershipCache', () => {
  let cache: MembershipCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MembershipCache(1000); // 1 秒 TTL,方便测试
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('set + get 基本读写', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: ['proj-a'] });
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toEqual({ teamIds: ['team-a'], projectIds: ['proj-a'] });
  });

  it('get 未命中返回 undefined', () => {
    expect(cache.get(DEFAULT_BACKEND, 'not-exist')).toBeUndefined();
  });

  it('TTL 过期后返回 undefined 并删除条目', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: [] });
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toEqual({ teamIds: ['team-a'], projectIds: [] });

    vi.advanceTimersByTime(1001);
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('TTL 未过期时仍可读取', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: ['proj-a'] });
    vi.advanceTimersByTime(500);
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toEqual({ teamIds: ['team-a'], projectIds: ['proj-a'] });
  });

  it('invalidate 主动失效单个 token', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: [] });
    cache.set(DEFAULT_BACKEND, 'token-2', { teamIds: ['team-b'], projectIds: [] });
    cache.invalidate(DEFAULT_BACKEND, 'token-1');
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toBeUndefined();
    expect(cache.get(DEFAULT_BACKEND, 'token-2')).toEqual({ teamIds: ['team-b'], projectIds: [] });
  });

  it('不同 backendId 不会互相干扰', () => {
    cache.set('backend-a', 'token-1', { teamIds: ['team-a'], projectIds: [] });
    cache.set('backend-b', 'token-1', { teamIds: ['team-b'], projectIds: [] });
    expect(cache.get('backend-a', 'token-1')).toEqual({ teamIds: ['team-a'], projectIds: [] });
    expect(cache.get('backend-b', 'token-1')).toEqual({ teamIds: ['team-b'], projectIds: [] });

    cache.invalidate('backend-a', 'token-1');
    expect(cache.get('backend-a', 'token-1')).toBeUndefined();
    expect(cache.get('backend-b', 'token-1')).toEqual({ teamIds: ['team-b'], projectIds: [] });
  });

  it('clear 清空全部缓存', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: [] });
    cache.set(DEFAULT_BACKEND, 'token-2', { teamIds: ['team-b'], projectIds: [] });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toBeUndefined();
  });

  it('超过 MAX_ENTRIES 时清理最早过期条目', () => {
    const smallCache = new MembershipCache(10000);
    for (let i = 0; i < 1000; i++) {
      smallCache.set(DEFAULT_BACKEND, `token-${i}`, { teamIds: [`team-${i}`], projectIds: [] });
    }
    expect(smallCache.size).toBe(1000);

    smallCache.set(DEFAULT_BACKEND, 'token-new', { teamIds: ['team-new'], projectIds: [] });
    expect(smallCache.size).toBeLessThanOrEqual(1000);
    expect(smallCache.get(DEFAULT_BACKEND, 'token-new')).toEqual({ teamIds: ['team-new'], projectIds: [] });
  });

  it('evictExpired 清理所有过期条目', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: [] });
    cache.set(DEFAULT_BACKEND, 'token-2', { teamIds: ['team-b'], projectIds: [] });

    vi.advanceTimersByTime(1001);
    cache.set(DEFAULT_BACKEND, 'token-3', { teamIds: ['team-c'], projectIds: [] });

    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toBeUndefined();
    expect(cache.get(DEFAULT_BACKEND, 'token-2')).toBeUndefined();
    expect(cache.get(DEFAULT_BACKEND, 'token-3')).toEqual({ teamIds: ['team-c'], projectIds: [] });
  });

  it('size 返回当前缓存条目数', () => {
    expect(cache.size).toBe(0);
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: ['team-a'], projectIds: [] });
    expect(cache.size).toBe(1);
    cache.set(DEFAULT_BACKEND, 'token-2', { teamIds: ['team-b'], projectIds: [] });
    expect(cache.size).toBe(2);
  });

  it('空 teamIds/projectIds 数组也能正常缓存', () => {
    cache.set(DEFAULT_BACKEND, 'token-1', { teamIds: [], projectIds: [] });
    expect(cache.get(DEFAULT_BACKEND, 'token-1')).toEqual({ teamIds: [], projectIds: [] });
  });
});

describe('全局单例 membershipCache', () => {
  beforeEach(() => {
    resetMembershipCacheForTesting();
  });

  afterEach(() => {
    resetMembershipCacheForTesting();
  });

  it('全局单例可正常使用', () => {
    membershipCache.set(DEFAULT_BACKEND, 'global-token', { teamIds: ['global-team'], projectIds: [] });
    expect(membershipCache.get(DEFAULT_BACKEND, 'global-token')).toEqual({ teamIds: ['global-team'], projectIds: [] });
  });
});
