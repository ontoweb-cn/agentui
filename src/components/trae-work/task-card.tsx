// spec-013 P0-3: TaskCard 任务卡片组件
// 对齐 components-api.md §2.1
// 视觉规范:边框 var(--trae-line),圆角 var(--trae-radius-xl),悬停 translateY(-2px)
//
// Route B 评审 Q5:操作按钮不再嵌套在 role="button" 的卡片主体内,
// 改为卡片主体的 sibling + 绝对定位;既保留视觉位置,又消除嵌套交互元素的 ARIA 问题。

import * as React from 'react';
import { Loader2, RotateCw, Trash2, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TaskCardProps } from './types';
import {
  TASK_STATUS_COLOR,
  TASK_STATUS_LABEL_KEY,
  TASK_STATUS_TEXT_COLOR,
} from './constants';

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
    const { t } = useTranslation();
    const statusColor = TASK_STATUS_COLOR[status];
    const statusTextColor = TASK_STATUS_TEXT_COLOR[status];
    const statusLabel = t(TASK_STATUS_LABEL_KEY[status]);
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
      <div className="group relative transition-transform duration-trae-base hover:-translate-y-0.5">
        <div
          ref={ref}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
          // spec-013 P1-A1: 提供 aria-label 提升屏幕阅读器体验
          aria-label={onClick ? title : undefined}
          onClick={handleClick}
          onKeyDown={(e) => {
            // 防御:嵌套内容上的 Enter/Space 不触发整卡点击
            if (e.target !== e.currentTarget) return;
            if (onClick && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onClick(id);
            }
          }}
          style={{
            // 仅选中时覆盖左边框;未选中保留 border-trae-line 的 1px 边框,
            // 避免 transparent 2px 把整卡左边框擦掉。
            borderInlineStart: selected
              ? `2px solid var(--trae-green)`
              : undefined,
          }}
          className={cn(
            'relative border border-trae-line rounded-trae-xl',
            'bg-trae-card transition-all duration-trae-base',
            // spec-013 P2-Q6: cursor-pointer 仅在可点击时生效
            onClick && 'cursor-pointer',
            'group-hover:border-trae-line-strong',
            'group-hover:bg-trae-card-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary-text',
            compact ? 'p-3' : 'p-[18px] ps-[22px]',
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
              style={{
                backgroundColor: isRunning ? 'transparent' : statusColor,
              }}
              aria-hidden
            >
              {isRunning && (
                <Loader2
                  className="size-2 animate-spin"
                  style={{ color: statusTextColor }}
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
                    style={{ color: statusTextColor }}
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
          {isRunning &&
            typeof progress === 'number' &&
            progress >= 0 &&
            progress <= 100 && (
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

          {/* 底部:时间戳(操作按钮在卡片主体外,见下方 sibling) */}
          {!compact && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <time
                className="font-mono text-trae-xs text-trae-grey-2"
                dateTime={updatedAt ?? createdAt}
              >
                {formatTime(updatedAt ?? createdAt)}
              </time>
            </div>
          )}

          {/* compact 模式右侧箭头 */}
          {compact && (
            <ChevronRight className="absolute end-2 top-1/2 size-3 -translate-y-1/2 text-trae-grey-2 rtl:rotate-180" />
          )}
        </div>

        {/* 操作区:卡片主体 sibling,避免 role="button" 内嵌 button */}
        {!compact && (
          <div className="absolute bottom-[18px] end-[18px] z-10 flex items-center gap-1 opacity-0 transition-opacity duration-trae-fast group-hover:opacity-100 group-focus-within:opacity-100">
            {isFailed && onRetry && (
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex size-6 items-center justify-center rounded-trae-sm text-trae-grey transition-colors hover:bg-trae-green-soft hover:text-accent-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary-text"
                aria-label={t('taskCard.retry')}
                title={t('taskCard.retry')}
              >
                <RotateCw className="size-3" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex size-6 items-center justify-center rounded-trae-sm text-trae-grey transition-colors hover:bg-trae-error/10 hover:text-trae-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary-text"
                aria-label={t('taskCard.delete')}
                title={t('taskCard.delete')}
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
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
