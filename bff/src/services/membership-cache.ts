// v6-followup-3: token → 团队/项目成员关系缓存。
//
// 目的:避免每次请求都调 intellect-team /api/teams + /api/projects。
// 用 (backendId, token) 复合 key,缓存 token → { teamIds, projectIds } 映射,TTL 5min。
// 登出时通过 invalidate(backendId, token) 主动清除(由 /auth/logout 路由调用)。
//
// v9 (BFF-P2-4-align):cache key 从 token 改为 `${backendId}:${token}` 复合 key,
// 与 memberIdCache 保持一致,防御多实例部署时不同 backend 下 token 碰撞。
//
// 安全要求:
// - token 仅作 cache key 部分,不持久化到磁盘
// - teamIds/projectIds 是服务端解析的可信成员关系,不是客户端 header
// - /api/teams 或 /api/projects 调用失败时返回 undefined(不降级到空列表)
// - TTL 过期后自动重新解析

export interface Memberships {
  /** 用户所属团队的 slug 列表(intellect-team API 返回的 id 字段即为 slug) */
  teamIds: string[];
  /** 用户所属项目的 slug 列表 */
  projectIds: string[];
}

interface CacheEntry {
  memberships: Memberships;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟
const MAX_ENTRIES = 1000; // 防止内存无限增长

class MembershipCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * 生成复合 cache key(v9 BFF-P2-4-align):`${backendId}:${token}`。
   * 防御多实例部署时不同 backend 下 token 碰撞。
   */
  private buildKey(backendId: string, token: string): string {
    return `${backendId}:${token}`;
  }

  /**
   * 获取 (backendId, token) 对应的成员关系(命中缓存且未过期时直接返回)。
   */
  get(backendId: string, token: string): Memberships | undefined {
    const key = this.buildKey(backendId, token);
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.memberships;
  }

  /**
   * 写入 (backendId, token) → 成员关系映射。
   * 超过 MAX_ENTRIES 时清理最早过期的条目。
   */
  set(backendId: string, token: string, memberships: Memberships): void {
    const key = this.buildKey(backendId, token);
    if (this.cache.size >= MAX_ENTRIES) {
      this.evictExpired();
      if (this.cache.size >= MAX_ENTRIES) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
    }
    this.cache.set(key, {
      memberships,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** 主动失效单个 (backendId, token)(登出时调用)。 */
  invalidate(backendId: string, token: string): void {
    this.cache.delete(this.buildKey(backendId, token));
  }

  /** 清空全部缓存(测试用)。 */
  clear(): void {
    this.cache.clear();
  }

  /** 当前缓存条目数(测试/监控用)。 */
  get size(): number {
    return this.cache.size;
  }

  /** 清理所有已过期条目。 */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

/** 全局单例(BFF 进程内共享)。 */
export const membershipCache = new MembershipCache();

/** 测试用:重置全局单例。 */
export function resetMembershipCacheForTesting(): void {
  membershipCache.clear();
}

export { MembershipCache };
