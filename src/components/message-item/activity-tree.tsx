/**
 * ActivityTree — 聊天流中的工具活动聚合。
 *
 * 把平铺的 ToolCallCard 列表收敛为一行 `Activity · N tools`,
 * 运行中默认展开,完成后默认折叠;展开后复用 ToolCallCard 渲染每个工具。
 *
 * Route B（工作台类交互）:对应 TRAE/Intellect webui 的 `Activity: N tools` 折叠行。
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToolCallRecord } from '@/interfaces/database/chat';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/utils/format-duration';
import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolCallCard } from '../next-message-item/tool-call-card';

export interface ActivityTreeProps {
  records: ToolCallRecord[];
  /** 是否仍在流式输出;运行中默认展开 */
  isStreaming?: boolean;
  /** 覆盖默认展开状态(受控初始化) */
  defaultOpen?: boolean;
  className?: string;
}

type ActivityStatus = 'running' | 'completed' | 'failed';

function getActivityStatus(records: ToolCallRecord[]): ActivityStatus {
  if (records.some((record) => record.status === 'running')) return 'running';
  if (records.some((record) => record.status === 'failed')) return 'failed';
  return 'completed';
}

const ACTIVITY_RENDER_LIMIT = 50;

export function ActivityTree({
  records,
  isStreaming = false,
  defaultOpen,
  className,
}: ActivityTreeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen ?? isStreaming);
  const [showAll, setShowAll] = useState(false);
  const userToggledRef = useRef(false);

  // 流式结束后自动折叠;用户手动操作过则不打扰
  useEffect(() => {
    if (!isStreaming && defaultOpen === undefined && !userToggledRef.current) {
      setOpen(false);
    }
  }, [isStreaming, defaultOpen]);

  // 新 turn 开始时重置“展开全部”,避免上一轮展开后绕过 50 条上限
  useEffect(() => {
    if (isStreaming) setShowAll(false);
  }, [isStreaming]);

  const handleOpenChange = (nextOpen: boolean) => {
    userToggledRef.current = true;
    setOpen(nextOpen);
  };

  const status = useMemo(() => getActivityStatus(records), [records]);
  const totalDuration = useMemo(
    () =>
      records.reduce(
        (total, record) => total + (record.durationMs ?? 0),
        0,
      ),
    [records],
  );

  if (records.length === 0) return null;

  const visibleRecords = showAll
    ? records
    : records.slice(0, ACTIVITY_RENDER_LIMIT);
  const hiddenCount = records.length - visibleRecords.length;

  const statusLabel =
    status === 'running'
      ? t('toolCall.running')
      : status === 'failed'
        ? t('toolCall.failed')
        : t('toolCall.completed');

  const statusIcon =
    status === 'running' ? (
      <Loader2
        className="h-3 w-3 shrink-0 animate-spin text-accent-primary-text"
        aria-hidden
      />
    ) : status === 'completed' ? (
      <CheckCircle2
        className="h-3 w-3 shrink-0 text-accent-primary-text"
        aria-hidden
      />
    ) : (
      <XCircle className="h-3 w-3 shrink-0 text-trae-error" aria-hidden />
    );

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn(
        'my-1 rounded-md border border-border-button bg-muted/20 text-xs',
        className,
      )}
      data-testid="activity-tree"
      data-status={status}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 p-2 text-start hover:bg-muted/50"
          title={open ? t('activity.collapse') : t('activity.expand')}
          data-testid="activity-toggle"
        >
          {statusIcon}
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-text-secondary transition-transform rtl:rotate-180',
              open && 'rotate-90 rtl:rotate-90',
            )}
            aria-hidden
          />
          <span className="shrink-0 font-medium text-text-primary">
            {t('activity.title')}
          </span>
          <span className="shrink-0 text-text-secondary">
            {t('activity.summary', { count: records.length })}
          </span>
          <span className="ms-auto flex shrink-0 items-center gap-2 text-text-secondary">
            {totalDuration > 0 && (
              <span className="font-mono">{formatDuration(totalDuration)}</span>
            )}
            <span>{statusLabel}</span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 border-t border-border-button p-1" data-testid="activity-content">
          {visibleRecords.map((record) => (
            <ToolCallCard key={record.toolCallId} record={record} />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full rounded px-2 py-1.5 text-xs text-accent-primary-text transition-colors hover:bg-muted/50"
              data-testid="activity-show-more"
            >
              {t('activity.showMore', { count: hiddenCount })}
            </button>
          )}
          {showAll && records.length > ACTIVITY_RENDER_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="w-full rounded px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-muted/50"
              data-testid="activity-show-less"
            >
              {t('activity.showLess')}
            </button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
