import type { TaskCardProps, TaskStatus } from '@/components/trae-work';
import type { IDialog } from '@/interfaces/database/chat';
import { formatDuration } from '@/utils/format-duration';
import { toEpochMs } from '@/utils/message-time';
import dayjs from 'dayjs';

export type SessionTaskGroupKey = 'today' | 'yesterday' | 'earlier';

export interface SessionTask extends TaskCardProps {
  /** 会话 ID(Task 投影的稳定标识) */
  sessionId: string;
  /** 会话持续时间(update - create,毫秒) */
  durationMs: number;
  /** 分组用日期(YYYY-MM-DD) */
  groupDate: string;
}

/**
 * 会话 → Task 投影。
 *
 * 后端暂无独立 task 实体;这里用 Gateway Session 作为只读任务视图,
 * 字段与 TaskCardProps 对齐,后续可替换为真实 task API 而不改 UI。
 */
export function mapSessionToTask(
  session: IDialog,
  options: { now?: number } = {},
): SessionTask {
  const now = options.now ?? Date.now();
  const createdAt = toEpochMs(session.create_date) ?? now;
  const updatedAt = toEpochMs(session.update_date) ?? createdAt;
  const durationMs = Math.max(0, updatedAt - createdAt);

  return {
    id: session.id,
    sessionId: session.id,
    title: session.name,
    description: '',
    status: 'completed' as TaskStatus,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    durationMs,
    groupDate: dayjs(updatedAt).format('YYYY-MM-DD'),
  };
}

/** 按今天/昨天/更早分组,保持任务按更新时间倒序。 */
export function groupSessionTasks(
  tasks: SessionTask[],
  now = Date.now(),
): Array<{ key: SessionTaskGroupKey; tasks: SessionTask[] }> {
  const today = dayjs(now).format('YYYY-MM-DD');
  const yesterday = dayjs(now).subtract(1, 'day').format('YYYY-MM-DD');

  const sorted = [...tasks].sort(
    (a, b) =>
      new Date(b.updatedAt ?? b.createdAt).getTime() -
      new Date(a.updatedAt ?? a.createdAt).getTime(),
  );

  const buckets: Record<SessionTaskGroupKey, SessionTask[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const task of sorted) {
    if (task.groupDate === today) buckets.today.push(task);
    else if (task.groupDate === yesterday) buckets.yesterday.push(task);
    else buckets.earlier.push(task);
  }

  return (['today', 'yesterday', 'earlier'] as const)
    .map((key) => ({ key, tasks: buckets[key] }))
    .filter((group) => group.tasks.length > 0);
}

/** 会话时长文案(用于 TaskCard description);超过 1 小时用 h/m 表示,避免 120:00 歧义。 */
export function formatSessionTaskDuration(task: SessionTask): string {
  const safeMs = Math.max(0, task.durationMs);
  const totalMinutes = Math.floor(safeMs / 60_000);
  if (totalMinutes < 60) {
    return formatDuration(safeMs);
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
