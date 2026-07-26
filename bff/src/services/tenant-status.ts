// 方案 3 (P2):tenant 健康度状态存储。
//
// 由 setInterval 后台校验定期更新,/health/readiness 端点读取。
// 避免全局变量污染,封装在独立模块中。
//
// 状态语义:
//   - 'ok':tenant 校验通过
//   - 'disabled':tenant 被禁用或 tenant_id 不一致
//   - 'unknown':尚未校验,或上次校验超过 5 分钟(状态过期)
//
// 设计要点:
//   - 状态带 lastCheckedAt 时间戳,超过 5 分钟标记为 'unknown'
//   - 启动时为 'unknown'(尚未校验),首次 setInterval 执行后更新
//   - 后台校验失败时不调 process.exit(与启动校验不同),只更新状态

export type TenantHealthStatus = 'ok' | 'disabled' | 'unknown';

interface TenantStatusEntry {
  status: TenantHealthStatus;
  reason?: string;
  lastCheckedAt: number;
}

/** 状态过期阈值:5 分钟 */
const STATUS_EXPIRY_MS = 5 * 60 * 1000;

/** 全局 tenant 状态(模块级单例) */
const tenantStatus = new Map<string, TenantStatusEntry>();

/**
 * 获取 tenant 健康度状态(自动过期)。
 * 超过 5 分钟未校验 → 返回 'unknown'。
 */
export function getTenantStatus(backendId: string): TenantHealthStatus {
  const entry = tenantStatus.get(backendId);
  if (!entry) return 'unknown';
  if (Date.now() - entry.lastCheckedAt > STATUS_EXPIRY_MS) return 'unknown';
  return entry.status;
}

/**
 * 获取所有 tenant 状态快照(用于 /health/readiness)。
 */
export function getAllTenantStatuses(): Record<string, { status: TenantHealthStatus; reason?: string; lastCheckedAt: string }> {
  const now = Date.now();
  const result: Record<string, { status: TenantHealthStatus; reason?: string; lastCheckedAt: string }> = {};
  for (const [backendId, entry] of tenantStatus.entries()) {
    const isExpired = now - entry.lastCheckedAt > STATUS_EXPIRY_MS;
    result[backendId] = {
      status: isExpired ? 'unknown' : entry.status,
      reason: entry.reason,
      lastCheckedAt: new Date(entry.lastCheckedAt).toISOString(),
    };
  }
  return result;
}

/**
 * 更新 tenant 状态(由 setInterval 后台校验调用)。
 */
export function setTenantStatus(backendId: string, status: TenantHealthStatus, reason?: string): void {
  tenantStatus.set(backendId, {
    status,
    reason,
    lastCheckedAt: Date.now(),
  });
}

/**
 * 整体 readiness 状态:任一 tenant 非 ok(且非 unknown)→ not_ready。
 * unknown 不影响整体状态(可能尚未首次校验)。
 */
export function getOverallReadiness(): 'ok' | 'not_ready' {
  const now = Date.now();
  for (const entry of tenantStatus.values()) {
    const isExpired = now - entry.lastCheckedAt > STATUS_EXPIRY_MS;
    if (!isExpired && entry.status === 'disabled') {
      return 'not_ready';
    }
  }
  return 'ok';
}
