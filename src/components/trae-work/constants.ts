// spec-013 P0-3: TRAE Work 组件共享常量
// 状态色映射、图标映射等

import type { TaskStatus, ProgressNodeStatus, WorkMode } from './types';

/** TaskStatus → 状态色 token 映射(使用 TRAE Work Token) */
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  running: 'var(--trae-green)',
  completed: 'var(--trae-green-dim)',
  failed: '#ef4444',
  cancelled: 'var(--trae-grey-2)',
  pending: 'var(--trae-grey-2)',
};

/** TaskStatus → i18n key 映射(在组件中用 t() 解析) */
export const TASK_STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  running: 'taskCard.statusRunning',
  completed: 'taskCard.statusCompleted',
  failed: 'taskCard.statusFailed',
  cancelled: 'taskCard.statusCancelled',
  pending: 'taskCard.statusPending',
};

/** ProgressNodeStatus → 圆点色 token 映射 */
export const PROGRESS_NODE_COLOR: Record<ProgressNodeStatus, string> = {
  running: 'var(--trae-green)',
  completed: 'var(--trae-green)',
  failed: '#ef4444',
  skipped: 'var(--trae-grey-2)',
};

/** WorkMode → 标签文案 */
export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  work: 'Work',
  code: 'Code',
  canvas: 'Canvas',
};

/** 默认可用模式(全量) */
export const DEFAULT_AVAILABLE_MODES: WorkMode[] = ['work', 'code', 'canvas'];

/** ModeSwitcher 尺寸 → 内边距映射 */
export const MODE_SWITCHER_SIZE_PADDING: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'px-2 py-1 text-trae-xs',
  md: 'px-3 py-1.5 text-trae-sm',
  lg: 'px-4 py-2 text-trae-base',
};

/** ModeSwitcher 尺寸 → 图标尺寸映射 */
export const MODE_SWITCHER_SIZE_ICON: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-3',
  md: 'size-3.5',
  lg: 'size-4',
};
