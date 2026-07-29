// spec-010 v8 修改 6(D2 软阻断):RunRegistry 单元测试。
// 覆盖:
// - registerRun 后 hasActiveRuns / getActiveRunCount 返回正确
// - markRunCompleted 后 hasActiveRuns 不再计入活跃
// - hasRunsForBackend 不论状态匹配
// - verifyRunOwnership 回归(P0-S1 不变)
// - 多 backend 隔离

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRun,
  verifyRunOwnership,
  hasActiveRuns,
  getActiveRunCount,
  hasRunsForBackend,
  markRunCompleted,
  _clearRunRegistryForTests,
} from './run-registry';

const B1 = 'backend-1';
const B2 = 'backend-2';

describe('RunRegistry — D2 软阻断扩展', () => {
  beforeEach(() => {
    _clearRunRegistryForTests();
  });

  // -------------------------------------------------------------------------
  // hasActiveRuns / getActiveRunCount
  // -------------------------------------------------------------------------

  describe('hasActiveRuns / getActiveRunCount', () => {
    it('registerRun 后 hasActiveRuns 返回 true', () => {
      registerRun('run-1', B1, 'agent-1');
      expect(hasActiveRuns(B1)).toBe(true);
    });

    it('registerRun 后 getActiveRunCount 返回 1', () => {
      registerRun('run-1', B1, 'agent-1');
      expect(getActiveRunCount(B1)).toBe(1);
    });

    it('多个活跃 run 计数正确', () => {
      registerRun('run-1', B1, 'agent-1');
      registerRun('run-2', B1, 'agent-1');
      registerRun('run-3', B1, 'agent-1');
      expect(getActiveRunCount(B1)).toBe(3);
      expect(hasActiveRuns(B1)).toBe(true);
    });

    it('未注册任何 run 时 hasActiveRuns 返回 false', () => {
      expect(hasActiveRuns(B1)).toBe(false);
      expect(getActiveRunCount(B1)).toBe(0);
    });

    it('不同 backend 之间隔离', () => {
      registerRun('run-1', B1, 'agent-1');
      registerRun('run-2', B2, 'agent-1');
      expect(getActiveRunCount(B1)).toBe(1);
      expect(getActiveRunCount(B2)).toBe(1);
      expect(hasActiveRuns(B1)).toBe(true);
      expect(hasActiveRuns(B2)).toBe(true);
    });

    it('同一 runId 重复 registerRun 不重复计数(覆盖更新)', () => {
      registerRun('run-1', B1, 'agent-1');
      registerRun('run-1', B1, 'agent-1');
      expect(getActiveRunCount(B1)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // markRunCompleted
  // -------------------------------------------------------------------------

  describe('markRunCompleted', () => {
    it('markRunCompleted 后 hasActiveRuns 返回 false', () => {
      registerRun('run-1', B1, 'agent-1');
      expect(hasActiveRuns(B1)).toBe(true);

      markRunCompleted('run-1');
      expect(hasActiveRuns(B1)).toBe(false);
      expect(getActiveRunCount(B1)).toBe(0);
    });

    it('多个 run 中只标记一个,其余仍活跃', () => {
      registerRun('run-1', B1, 'agent-1');
      registerRun('run-2', B1, 'agent-1');
      registerRun('run-3', B1, 'agent-1');

      markRunCompleted('run-2');
      expect(getActiveRunCount(B1)).toBe(2);
      expect(hasActiveRuns(B1)).toBe(true);
    });

    it('支持 cancelled 状态标记', () => {
      registerRun('run-1', B1, 'agent-1');
      markRunCompleted('run-1', 'cancelled');
      expect(hasActiveRuns(B1)).toBe(false);
      expect(getActiveRunCount(B1)).toBe(0);
    });

    it('支持 failed 状态标记', () => {
      registerRun('run-1', B1, 'agent-1');
      markRunCompleted('run-1', 'failed');
      expect(hasActiveRuns(B1)).toBe(false);
      expect(getActiveRunCount(B1)).toBe(0);
    });

    it('未注册的 runId 静默忽略,不抛异常', () => {
      expect(() => markRunCompleted('non-existent')).not.toThrow();
      expect(hasActiveRuns(B1)).toBe(false);
    });

    it('仅标记指定 backend 的 run,不影响其他 backend', () => {
      registerRun('run-1', B1, 'agent-1');
      registerRun('run-2', B2, 'agent-1');

      markRunCompleted('run-1');
      expect(hasActiveRuns(B1)).toBe(false);
      expect(hasActiveRuns(B2)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // hasRunsForBackend
  // -------------------------------------------------------------------------

  describe('hasRunsForBackend', () => {
    it('活跃 run 存在时返回 true', () => {
      registerRun('run-1', B1, 'agent-1');
      expect(hasRunsForBackend(B1)).toBe(true);
    });

    it('run 完成后仍返回 true(匹配所有状态)', () => {
      registerRun('run-1', B1, 'agent-1');
      markRunCompleted('run-1');
      expect(hasActiveRuns(B1)).toBe(false);
      expect(hasRunsForBackend(B1)).toBe(true);
    });

    it('run 取消后仍返回 true', () => {
      registerRun('run-1', B1, 'agent-1');
      markRunCompleted('run-1', 'cancelled');
      expect(hasRunsForBackend(B1)).toBe(true);
    });

    it('未注册任何 run 时返回 false', () => {
      expect(hasRunsForBackend(B1)).toBe(false);
    });

    it('不同 backend 之间隔离', () => {
      registerRun('run-1', B1, 'agent-1');
      expect(hasRunsForBackend(B1)).toBe(true);
      expect(hasRunsForBackend(B2)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // verifyRunOwnership 回归(P0-S1 不变)
  // -------------------------------------------------------------------------

  describe('verifyRunOwnership 回归', () => {
    it('已注册 runId + 一致 backendId 校验通过', () => {
      registerRun('run-1', B1, 'agent-1');
      const result = verifyRunOwnership('run-1', B1);
      expect(result.valid).toBe(true);
    });

    it('runId 未注册时返回 invalid', () => {
      const result = verifyRunOwnership('non-existent', B1);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not registered/);
    });

    it('backendId 不一致时返回 invalid', () => {
      registerRun('run-1', B1, 'agent-1');
      const result = verifyRunOwnership('run-1', B2);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/belongs to backend/);
    });

    it('run 完成后(marked completed)归属仍可校验(status 不影响 ownership)', () => {
      registerRun('run-1', B1, 'agent-1');
      markRunCompleted('run-1');
      // status 变化不影响 ownership 校验(审批可在 run 完成后短时间内仍提交)
      const result = verifyRunOwnership('run-1', B1);
      expect(result.valid).toBe(true);
    });

    it('缺 runId 或 backendId 返回 invalid', () => {
      expect(verifyRunOwnership('', B1).valid).toBe(false);
      expect(verifyRunOwnership('run-1', '').valid).toBe(false);
    });
  });
});
