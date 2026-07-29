/**
 * RunRegistry — runId 归属注册表(P0-S1 修复)。
 *
 * 安全约束:
 * - 审批路由 POST /agents/:agentId/runs/:runId/approval 必须校验 runId 归属,
 *   避免跨租户越权(用户 A 对 tenant-B 的 runId 提交审批)。
 * - adapter.sendMessage 产出 approval_request 时,由 streamChunksAsSSE 调用 registerRun
 *   注册 runId → backendId 映射;审批路由调用 verifyRunOwnership 校验。
 *
 * 设计:
 * - 内存 Map,TTL 30 分钟(run 完成后审批窗口有限,30 分钟足够)
 * - 容量上限 1024 条,超限时清理最早过期条目
 * - 不依赖 intellect-team 侧改动,纯 BFF 内部隔离层
 *
 * spec-010 v8 修改 6(D2 软阻断):backend 切换/删除时校验活跃 run。
 * - registerRun 时记录 status='running'
 * - markRunCompleted 标记 run 完成/取消/失败
 * - hasActiveRuns / getActiveRunCount / hasRunsForBackend 供软阻断决策
 *
 * 注:此为防御性校验,主路径仍依赖 intellect-team 侧 run_id 全局唯一性。
 * 若 attacker 能伪造 runId(如猜测),本注册表可拦截因 runId 未在当前 backend 注册的请求。
 */

const RUN_TTL_MS = 30 * 60 * 1000; // 30 分钟
const RUN_MAX_ENTRIES = 1024;

/**
 * Run 生命周期状态。
 * - running: run 进行中(包括等待审批),D2 软阻断时视为活跃
 * - completed: run 正常完成
 * - cancelled: run 被取消
 * - failed: run 失败
 */
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'failed';

interface RunEntry {
  backendId: string;
  agentId: string;
  expiresAt: number;
  status: RunStatus;
}

/**
 * runId → {backendId, agentId} 注册表。
 * 模块级单例,所有请求共享。
 */
const runRegistry = new Map<string, RunEntry>();

/**
 * 注册 runId 归属。
 * 在 streamChunksAsSSE 收到 approval_request 事件时调用。
 */
export function registerRun(
  runId: string,
  backendId: string,
  agentId: string,
): void {
  if (!runId || !backendId) return;

  // 容量检查:超限时先清理过期条目
  if (runRegistry.size >= RUN_MAX_ENTRIES && !runRegistry.has(runId)) {
    const now = Date.now();
    // 第一轮:清理已过期条目
    for (const [k, v] of runRegistry) {
      if (v.expiresAt <= now) {
        runRegistry.delete(k);
      }
    }
    // 第二轮:仍超限 → 清理 expiresAt 最小的条目
    if (runRegistry.size >= RUN_MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestExpiry = Infinity;
      for (const [k, v] of runRegistry) {
        if (v.expiresAt < oldestExpiry) {
          oldestExpiry = v.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        runRegistry.delete(oldestKey);
      }
    }
  }

  runRegistry.set(runId, {
    backendId,
    agentId,
    expiresAt: Date.now() + RUN_TTL_MS,
    status: 'running',
  });
}

/**
 * 校验 runId 是否属于指定 backendId。
 * 审批路由调用,返回 true 表示归属一致。
 *
 * 注:runId 未注册时返回 false(保守策略,拒绝未知名 runId)。
 * 这要求 streamChunksAsSSE 必须在 approval_request 时调用 registerRun,
 * 否则合法审批也会被拒绝。若 streamChunksAsSSE 未触发(如 RAG 路径不产出 approval),
 * 审批路由本就返回 501,不影响。
 */
export function verifyRunOwnership(
  runId: string,
  backendId: string,
): { valid: boolean; reason?: string } {
  if (!runId || !backendId) {
    return { valid: false, reason: 'missing runId or backendId' };
  }

  const entry = runRegistry.get(runId);
  if (!entry) {
    return { valid: false, reason: 'runId not registered' };
  }

  // 过期检查
  if (entry.expiresAt <= Date.now()) {
    runRegistry.delete(runId);
    return { valid: false, reason: 'runId expired' };
  }

  if (entry.backendId !== backendId) {
    return {
      valid: false,
      reason: `runId belongs to backend "${entry.backendId}", not "${backendId}"`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// spec-010 v8 修改 6(D2 软阻断):活跃 run 查询
// ---------------------------------------------------------------------------

/**
 * 查询指定 backend 是否存在活跃 run(status='running')。
 *
 * 用于 backend 切换/删除前的软阻断校验:
 * 存在活跃 run 时应提示用户先停止/等待完成,避免中断进行中的对话。
 *
 * 语义说明(P2-M1 修复):
 * - spec §9.6 原文为 hasActiveRuns(tenantId),实际实现为 hasActiveRuns(backendId)
 * - 在当前"单实例单租户"模型下(见 project_memory.md),backend ↔ tenant 是 1:1 绑定,
 *   即一个 BffBackend 绑定一个 intellect-team 实例(= 一个租户)
 * - 因此 backend 维度的活跃 run 检查 ≡ tenant 维度的活跃 run 检查
 * - 若未来扩展为"一个 backend 服务多 tenant",需在 RunEntry 新增 tenantId 字段
 *
 * @param backendId 待查询的 backend 标识(BffBackend.id)
 */
export function hasActiveRuns(backendId: string): boolean {
  for (const record of runRegistry.values()) {
    if (record.backendId === backendId && record.status === 'running') {
      return true;
    }
  }
  return false;
}

/**
 * 统计指定 backend 的活跃 run 数量。
 *
 * @param backendId 同 hasActiveRuns(语义见上方说明)
 */
export function getActiveRunCount(backendId: string): number {
  let count = 0;
  for (const record of runRegistry.values()) {
    if (record.backendId === backendId && record.status === 'running') {
      count++;
    }
  }
  return count;
}

/**
 * 查询指定 backend 是否存在任意 run(不论状态)。
 *
 * 与 hasActiveRuns 的差异:此函数匹配所有状态的 run,
 * 用于"该 backend 历史上有过 run"的判断(如软阻断提示是否需要二次确认)。
 *
 * @param backendId 待查询的 backend 标识
 */
export function hasRunsForBackend(backendId: string): boolean {
  for (const record of runRegistry.values()) {
    if (record.backendId === backendId) {
      return true;
    }
  }
  return false;
}

/**
 * 标记 run 为已完成/取消/失败。
 *
 * run 完成后应调用此方法更新 status,使 hasActiveRuns 不再将其计入活跃数。
 * 未注册的 runId 静默忽略(防御性,不抛异常)。
 *
 * @param runId 待标记的 run 标识
 * @param status 终态状态,默认 'completed'
 */
export function markRunCompleted(
  runId: string,
  status: 'completed' | 'cancelled' | 'failed' = 'completed',
): void {
  const record = runRegistry.get(runId);
  if (record) {
    record.status = status;
  }
}

/**
 * 测试辅助:清空注册表。
 * 仅在测试环境中使用,生产代码不应调用。
 */
export function _clearRunRegistryForTests(): void {
  runRegistry.clear();
}
