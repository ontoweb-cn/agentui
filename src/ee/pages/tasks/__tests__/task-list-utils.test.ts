import type { IDialog } from '@/interfaces/database/chat';
import {
  formatSessionTaskDuration,
  groupSessionTasks,
  mapSessionToTask,
} from '../task-list-utils';

function makeDialog(overrides: Partial<IDialog> = {}): IDialog {
  return {
    id: 's1',
    name: 'Session 1',
    create_date: '2026-10-18T10:00:00+08:00',
    update_date: '2026-10-18T10:05:00+08:00',
    ...overrides,
  } as IDialog;
}

describe('task-list-utils', () => {
  it('mapSessionToTask 计算时长与分组日期', () => {
    const task = mapSessionToTask(makeDialog());
    expect(task.id).toBe('s1');
    expect(task.title).toBe('Session 1');
    expect(task.durationMs).toBe(5 * 60 * 1000);
    expect(task.groupDate).toBe('2026-10-18');
    expect(task.status).toBe('completed');
  });

  it('groupSessionTasks 按今天/昨天/更早分组并倒序', () => {
    const now = new Date('2026-10-18T12:00:00+08:00').getTime();
    const tasks = [
      mapSessionToTask(
        makeDialog({
          id: 'old',
          update_date: '2026-10-10T10:00:00+08:00',
        }),
        { now },
      ),
      mapSessionToTask(
        makeDialog({
          id: 'yesterday',
          update_date: '2026-10-17T10:00:00+08:00',
        }),
        { now },
      ),
      mapSessionToTask(
        makeDialog({
          id: 'today',
          update_date: '2026-10-18T09:00:00+08:00',
        }),
        { now },
      ),
    ];

    const groups = groupSessionTasks(tasks, now);
    expect(groups.map((group) => group.key)).toEqual([
      'today',
      'yesterday',
      'earlier',
    ]);
    expect(groups[0].tasks[0].id).toBe('today');
    expect(groups[1].tasks[0].id).toBe('yesterday');
    expect(groups[2].tasks[0].id).toBe('old');
  });

  it('formatSessionTaskDuration 输出短时长', () => {
    const task = mapSessionToTask(makeDialog());
    expect(formatSessionTaskDuration(task)).toBe('5:00');
  });

  it('formatSessionTaskDuration 超过 1 小时用 h/m 表示', () => {
    const task = mapSessionToTask(
      makeDialog({
        create_date: '2026-10-18T10:00:00+08:00',
        update_date: '2026-10-18T12:30:00+08:00',
      }),
    );
    expect(formatSessionTaskDuration(task)).toBe('2h 30m');
  });
});
