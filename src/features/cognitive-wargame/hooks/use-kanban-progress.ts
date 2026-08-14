/**
 * KANBAN 进度轮询 Hook（v3.1 阶段二）。
 *
 * 2s 轮询 wargamesrv 代理端点 /api/v1/wargame/kanban/progress?scenario_id=<id>，
 * 获取 task 树 + status_counts。stale closure 防护参考 use-sse-events.ts 的 onEventRef 模式
 * + ReportViewPage 的 setInterval + 卸载清理模式。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';
import type { KanbanTask, KanbanStatusCounts } from '../api';

export type { KanbanTask, KanbanStatusCounts };

const POLL_INTERVAL = 2000;

export function useKanbanProgress(scenarioId: string | null | undefined) {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [statusCounts, setStatusCounts] = useState<KanbanStatusCounts | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // stale closure 防护：用 ref 保持最新 scenarioId
  const scenarioIdRef = useRef(scenarioId);
  scenarioIdRef.current = scenarioId;

  const stopPollingRef = useRef<(() => void) | null>(null);

  const poll = useCallback(async () => {
    const sid = scenarioIdRef.current;
    if (!sid) return;
    try {
      setLoading(true);
      const [tasksResp, statsResp] = await Promise.all([
        api.getKanbanProgress(sid),
        api.getKanbanStats(sid),
      ]);
      setTasks(tasksResp);
      setStatusCounts(statsResp);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (stopPollingRef.current) {
      stopPollingRef.current();
      stopPollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!scenarioId) {
      setTasks([]);
      setStatusCounts(null);
      return;
    }

    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    stopPollingRef.current = () => clearInterval(timer);

    // 卸载清理（参考 ReportViewPage 的 useEffect(() => () => stopPolling(), [stopPolling])）
    return () => {
      clearInterval(timer);
      stopPollingRef.current = null;
    };
  }, [scenarioId, poll]);

  return { tasks, statusCounts, loading, error, refresh: poll, stopPolling };
}
