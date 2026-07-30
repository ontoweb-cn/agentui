// spec-013 P0-3: TaskCard 任务卡片组件
// 对齐 components-api.md §2.1
// 视觉规范:边框 var(--trae-line),圆角 var(--trae-radius-xl),悬停 translateY(-2px)

import * as React from 'react';
import { Loader2, RotateCw, Trash2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskCardProps } from './types';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from './constants';

/**
 * TaskCard — 任务卡片,用于任务列表。
 * 5 种状态(running/completed/failed/cancelled/pending)对应不同视觉。
 * 使用 TRAE Work Token,不硬编码颜色。
 */
export const TaskCard = React.forwardRef<HTMLDivElement, TaskCardProps>(
  function TaskCard(
    {
      id,
      title,
      description,
      status,
      createdAt,
      updatedAt,
      currentStep,
      progress,
      onClick,
      onDelete,
      onRetry,
      selected = false,
      compact = false,
    },
    ref,
  ) {
    const statusColor = TASK_STATUS_COLOR[status];
    const statusLabel = TASK_STATUS_LABEL[status];
    const isRunning = status === 'running';
    const isFailed = status === 'failed';

    const handleClick = React.useCallback(() => {
      onClick?.(id);
    }, [id, onClick]);

    const handleDelete = React.useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete?.(id);
      },
      [id, onDelete],
    );

    const handleRetry = React.useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onRetry?.(id);
      },
      [id, onRetry],
    );

    return (
      <div
        ref={ref}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        // spec-013 P1-A1: 提供 aria-label 提升屏幕阅读器体验
        aria-label={onClick ? title : undefined}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick(id);
          }
        }}
        style={{
          borderLeft: selected ? `2px solid var(--trae-green)` : '2px solid transparent',
        }}
        className={cn(
          'group relative border border-trae-line rounded-trae-xl',
          'bg-trae-card transition-all duration-trae-base',
          // spec-013 P2-Q6: cursor-pointer 仅在可点击时生效
          onClick && 'cursor-pointer',
          'hover:border-trae-line-strong hover:-translate-y-0.5',
          'hover:bg-[image:var(--trae-card-bg-hover)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trae-green',
          compact ? 'p-3' : 'p-[18px] pl-[22px]',
        )}
        data-testid={`task-card-${id}`}
        data-status={status}
      >
        {/* 头部:状态圆点 + 标题 + 状态标签 */}
        <div className="flex items-start gap-2">
          {/* 状态圆点 / spinner */}
          <span
            className={cn(
              'mt-1 inline-flex size-2 shrink-0 items-center justify-center rounded-full',
            )}
            style={{ backgroundColor: isRunning ? 'transparent' : statusColor }}
            aria-hidden
          >
            {isRunning && (
              <Loader2
                className="size-2 animate-spin"
                style={{ color: statusColor }}
              />
            )}
          </span>

          {/* 标题区 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h4
                className={cn(
                  'truncate font-semibold text-trae-ink',
                  compact ? 'text-trae-sm' : 'text-trae-base',
                )}
                title={title}
              >
                {title}
              </h4>
              {!compact && (
                <span
                  className="shrink-0 font-mono text-trae-xs"
                  style={{ color: statusColor }}
                >
                  {statusLabel}
                </span>
              )}
            </div>

            {/* 描述(非 compact 模式) */}
            {!compact && description && (
              <p
                className="mt-1 line-clamp-2 text-trae-sm text-trae-grey"
                style={{ lineHeight: 'var(--trae-leading-relaxed)' }}
              >
                {description}
              </p>
            )}

            {/* 当前步骤(running 状态) */}
            {isRunning && currentStep && (
              <p
                className="mt-1 truncate font-mono text-trae-xs text-trae-grey-2"
                title={currentStep}
              >
                {currentStep}
              </p>
            )}
          </div>
        </div>

        {/* 进度条(running 状态且有 progress) */}
        {isRunning && typeof progress === 'number' && progress >= 0 && progress <= 100 && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-trae-line">
            <div
              className="h-full rounded-full transition-all duration-trae-base"
              style={{
                width: `${progress}%`,
                backgroundColor: 'var(--trae-green)',
              }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        )}

        {/* 底部:时间戳 + 操作按钮(非 compact) */}
        {!compact && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <time
              className="font-mono text-trae-xs text-trae-grey-2"
              dateTime={updatedAt ?? createdAt}
            >
              {formatTime(updatedAt ?? createdAt)}
            </time>

            <div className="flex items-center gap-1 opacity-0 transition-opacity duration-trae-fast group-hover:opacity-100">
              {isFailed && onRetry && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex size-6 items-center justify-center rounded-trae-sm text-trae-grey transition-colors hover:bg-trae-green-soft hover:text-trae-green"
                  aria-label="重试"
                  title="重试"
                >
                  <RotateCw className="size-3" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex size-6 items-center justify-center rounded-trae-sm text-trae-grey transition-colors hover:bg-[#ef4444]/10 hover:text-[#ef4444]"
                  aria-label="删除"
                  title="删除"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* compact 模式右侧箭头 */}
        {compact && (
          <ChevronRight className="absolute right-2 top-1/2 size-3 -translate-y-1/2 text-trae-grey-2" />
        )}
      </div>
    );
  },
);

/**
 * 格式化 ISO 时间为简短显示(MM-DD HH:mm)
 * spec-013 P2-Q8: 移除冗余 try/catch(Date 构造器不抛异常,isNaN 已覆盖无效输入)
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
