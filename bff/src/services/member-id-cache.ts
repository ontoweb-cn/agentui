// v6-followup: token → member_id 解析缓存。
//
// 目的:避免每次请求都调 intellect-team /api/members/me。
// 用 (backendId, token) 复合 key,缓存 token → { memberId, role } 映射。
// 登出时通过 invalidate(backendId, token) 主动清除(由 /auth/logout 路由调用)。
//
// v9 (BFF-P2-2):缓存值从 string 扩展为 { memberId, role },
// 让 llm-auth 中间件也能共享缓存(消除 /chats/* 无缓存的双路径问题)。
//
// v9 (BFF-P2-3):TTL 从 5min 缩短到 60s(降低 member 禁用后的失效延迟窗口),
// 新增 invalidateByMemberId(memberId) 反向失效方法(遍历 cache,O(n) n≤1000,
// member 禁用是低频操作可接受),为未来 BFF 代理 member 管理端点预留。
//
// v9 (BFF-P2-4):cache key 从 token 改为 `${backendId}:${token}` 复合 key,
// 防御多实例部署时不同 backend 下 token 碰撞(虽然 member_id 在每个实例内独立生成,
// 但多实例部署场景下不同实例可能返回相同 member_id 字符串,造成跨实例身份混淆)。
// 当前单实例配置下无实际影响,但作为防御性设计避免未来隐患。
//
// 安全要求:
// - token 仅作 cache key 部分,不持久化到磁盘
// - member_id 是服务端解析的可信身份,不是客户端 header
// - /api/members/me 调用失败时返回 undefined(不降级到 header)
// - TTL 过期后自动重新解析

export interface MemberCacheEntry {
  memberId: string;
  role: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60 * 1000; // 60 秒(v9:从 5min 缩短,降低 member 禁用延迟窗口)
const MAX_ENTRIES = 1000; // 防止内存无限增长

class MemberIdCache {
  private cache = new Map<string, MemberCacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * 生成复合 cache key(v9 BFF-P2-4):`${backendId}:${token}`。
   * 防御多实例部署时不同 backend 下 token 碰撞。
   */
  private buildKey(backendId: string, token: string): string {
    return `${backendId}:${token}`;
  }

  /**
   * 获取 (backendId, token) 对应的缓存条目(命中且未过期时返回 { memberId, role })。
   * 不触发解析:调用方需在缓存未命中时调 resolveAndCache()。
   */
  get(backendId: string, token: string): MemberCacheEntry | undefined {
    const key = this.buildKey(backendId, token);
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  /**
   * 写入 (backendId, token) → { memberId, role } 映射。
   * 超过 MAX_ENTRIES 时清理最早过期的条目。
   */
  set(backendId: string, token: string, memberId: string, role: string): void {
    const key = this.buildKey(backendId, token);
    if (this.cache.size >= MAX_ENTRIES) {
      this.evictExpired();
      // 如果清理后仍超限,移除最早写入的条目
      if (this.cache.size >= MAX_ENTRIES) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
    }
    this.cache.set(key, {
      memberId,
      role,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** 主动失效单个 (backendId, token)(登出时调用)。 */
  invalidate(backendId: string, token: string): void {
    this.cache.delete(this.buildKey(backendId, token));
  }

  /**
   * 按 memberId 反向失效所有关联 token(v9 BFF-P2-3 新增)。
   *
   * 用途:member 被禁用/删除时,清除该 member 所有 token 的缓存条目,
   * 避免在 TTL 窗口内仍允许已禁用 member 访问。
   *
   * 复杂度:O(n),n ≤ MAX_ENTRIES(1000)。member 禁用是低频操作(管理员手动),
   * 可接受遍历开销。
   *
   * @returns 被清除的条目数
   */
  invalidateByMemberId(memberId: string): number {
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.memberId === memberId) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
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
export const memberIdCache = new MemberIdCache();

/** 测试用:重置全局单例。 */
export function resetMemberIdCacheForTesting(): void {
  memberIdCache.clear();
}

export { MemberIdCache };
