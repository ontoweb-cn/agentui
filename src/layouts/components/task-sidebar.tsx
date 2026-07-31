// spec-013 P1-2: TaskSidebar 任务列表侧栏
// 对接 ThreeColumnLayout 左侧任务列表区
// 集成 TaskCard (compact 模式),支持搜索/筛选/折叠/加载/空状态

import * as React from 'react';
import { Inbox, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TaskCard } from '@/components/trae-work';
import type { TaskCardProps, TaskStatus } from '@/components/trae-work';
import { Skeleton } from '@/components/ui/skeleton';

export interface TaskSidebarProps {
  /** 任务列表 */
  tasks: TaskCardProps[];
  /** 当前选中任务 ID */
  selectedTaskId?: string;
  /** 任务点击回调 */
  onTaskClick?: (id: string) => void;
  /** 新建任务回调(可选) */
  onCreateTask?: () => void;
  /** 搜索关键词(可选,受控) */
  searchQuery?: string;
  /** 搜索回调(可选) */
  onSearchChange?: (query: string) => void;
  /** 筛选状态(可选) */
  filter?: TaskStatus | 'all';
  /** 筛选回调(可选) */
  onFilterChange?: (filter: TaskStatus | 'all') => void;
  /** 顶部模式切换器(可选) */
  modeSwitcher?: React.ReactNode;
  /** 加载状态(可选) */
  loading?: boolean;
  /** 空状态内容(可选) */
  emptyState?: React.ReactNode;
  /** 折叠状态(可选,折叠时仅显示图标) */
  collapsed?: boolean;
}

/** 状态筛选器选项 */
const FILTER_OPTIONS: Array<{
  value: TaskStatus | 'all';
  labelKey: string;
  fallback: string;
}> = [
  { value: 'all', labelKey: 'taskSidebar.filterAll', fallback: '全部' },
  { value: 'running', labelKey: 'taskSidebar.filterRunning', fallback: '进行中' },
  { value: 'completed', labelKey: 'taskSidebar.filterCompleted', fallback: '已完成' },
  { value: 'failed', labelKey: 'taskSidebar.filterFailed', fallback: '失败' },
  { value: 'cancelled', labelKey: 'taskSidebar.filterCancelled', fallback: '已取消' },
  { value: 'pending', labelKey: 'taskSidebar.filterPending', fallback: '待处理' },
];

/**
 * TaskSidebar — 任务列表侧栏。
 * 集成 TaskCard (compact) 展示任务列表,支持搜索/筛选/折叠/加载/空状态。
 * 折叠时仅显示新建图标按钮,由父组件控制宽度。
 */
export function TaskSidebar({
  tasks,
  selectedTaskId,
  onTaskClick,
  onCreateTask,
  searchQuery,
  onSearchChange,
  filter = 'all',
  onFilterChange,
  modeSwitcher,
  loading = false,
  emptyState,
  collapsed = false,
}: TaskSidebarProps) {
  const { t } = useTranslation();
  const createLabel = t('taskSidebar.create', { defaultValue: '新建任务' });
  const searchPlaceholder = t('taskSidebar.search', { defaultValue: '搜索任务' });
  const emptyLabel = t('taskSidebar.empty', { defaultValue: '暂无任务' });

  // 折叠状态:仅显示新建图标按钮
  if (collapsed) {
    return (
      <div
        className="flex h-full flex-col items-center gap-2 border-r border-[var(--trae-line)] bg-[var(--trae-surface)] p-3"
        data-collapsed="true"
        data-testid="task-sidebar"
      >
        {onCreateTask && (
          <button
            type="button"
            onClick={onCreateTask}
            aria-label={createLabel}
            className="inline-flex size-9 items-center justify-center rounded-[var(--trae-radius-md)] text-black"
            style={{ backgroundColor: 'var(--trae-green-bright)' }}
            data-testid="task-sidebar-create"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
    );
  }

  const showEmpty = !loading && tasks.length === 0;

  return (
    <div
      className="flex h-full flex-col border-r border-[var(--trae-line)] bg-[var(--trae-surface)]"
      data-collapsed="false"
      data-testid="task-sidebar"
    >
      {/* 顶部区域:模式切换器 + 新建按钮 + 搜索框 */}
      <div className="flex flex-col gap-2 p-3">
        {modeSwitcher && <div className="flex">{modeSwitcher}</div>}

        {onCreateTask && (
          <button
            type="button"
            onClick={onCreateTask}
            aria-label={createLabel}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--trae-radius-md)] px-3 text-black"
            style={{ backgroundColor: 'var(--trae-green-bright)' }}
            data-testid="task-sidebar-create"
          >
            <Plus className="size-4" />
            <span>{createLabel}</span>
          </button>
        )}

        {onSearchChange && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-[var(--trae-grey)]" />
            <input
              type="text"
              value={searchQuery ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-full rounded-[var(--trae-radius-md)] border border-[var(--trae-line)] bg-[var(--trae-card-bg)] pl-8 pr-3 text-sm text-[var(--trae-ink)] outline-none focus:border-[var(--trae-green)]"
              data-testid="task-sidebar-search"
            />
          </div>
        )}
      </div>

      {/* 任务列表区域 */}
      {loading ? (
        <div className="flex-1 overflow-y-auto px-2 scrollbar-thin">
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton
                key={i}
                className="h-16 rounded-[var(--trae-radius-lg)] bg-[var(--trae-card-bg-hover)]"
                data-testid="task-sidebar-skeleton"
              />
            ))}
          </div>
        </div>
      ) : showEmpty ? (
        <div className="flex flex-1 items-center justify-center text-[var(--trae-grey)]">
          {emptyState ?? (
            <div className="flex flex-col items-center gap-2">
              <Inbox className="size-8" />
              <span>{emptyLabel}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 scrollbar-thin">
          <div className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                {...task}
                compact
                selected={task.id === selectedTaskId}
                onClick={onTaskClick}
              />
            ))}
          </div>
        </div>
      )}

      {/* 底部筛选器:仅当 onFilterChange 存在时渲染 */}
      {onFilterChange && (
        <div className="border-t border-[var(--trae-line)] p-3">
          <div className="flex flex-wrap gap-1">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onFilterChange(option.value)}
                data-active={filter === option.value ? 'true' : 'false'}
                data-testid={`task-sidebar-filter-${option.value}`}
                className={cn(
                  'rounded-[var(--trae-radius-sm)] px-2 py-1 text-xs transition-colors',
                  filter === option.value
                    ? 'bg-[var(--trae-green-soft)] text-[var(--trae-green)]'
                    : 'text-[var(--trae-grey)] hover:bg-[var(--trae-card-bg-hover)]',
                )}
              >
                {t(option.labelKey, { defaultValue: option.fallback })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
