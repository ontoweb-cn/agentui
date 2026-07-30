// spec-013 P0-4: TaskProgress 任务进度组件
// 对齐 components-api.md §2.2
// 视觉规范:节点间竖线连接,圆点状态色,支持嵌套,自动滚动到最新节点

import * as React from 'react';
import { ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { TaskProgressProps, ProgressNode } from './types';
import { PROGRESS_NODE_COLOR } from './constants';

/**
 * TaskProgress — 节点化进度展示。
 * 节点间用竖线连接,圆点显示状态色,支持嵌套和展开/折叠。
 *
 * spec-013 P1-Q3 修复:受控模式使用 ref 跟踪最新 expanded,避免闭包陷阱。
 * spec-013 P2-Q4 修复:递归查找最新节点(深度优先,最右下叶子为最新)。
 * spec-013 P1-A2 修复:节点添加 aria-label 提升可访问性。
 */
export const TaskProgress = React.forwardRef<HTMLDivElement, TaskProgressProps>(
  function TaskProgress(
    {
      nodes,
      defaultExpanded,
      expanded: expandedProp,
      onExpandedChange,
      showTimestamp = true,
      autoScroll = true,
    },
    ref,
  ) {
    const [internalExpanded, setInternalExpanded] = React.useState<string[]>(() => defaultExpanded ?? []);
    const isControlled = expandedProp !== undefined;
    const expanded = isControlled ? (expandedProp as string[]) : internalExpanded;

    // spec-013 P1-Q3: 用 ref 跟踪 expanded 最新值,避免 setExpanded 闭包捕获过时值
    const expandedRef = React.useRef(expanded);
    React.useEffect(() => {
      expandedRef.current = expanded;
    }, [expanded]);

    const latestNodeRef = React.useRef<HTMLDivElement | null>(null);

    const setExpanded = React.useCallback(
      (next: string[] | ((prev: string[]) => string[])) => {
        if (!isControlled) {
          setInternalExpanded((prev) => {
            const resolved = typeof next === 'function' ? next(prev) : next;
            onExpandedChange?.(resolved);
            return resolved;
          });
        } else {
          // 受控模式:从 ref 取最新值,而非闭包中的 expanded
          const prev = expandedRef.current;
          const resolved = typeof next === 'function' ? next(prev) : next;
          onExpandedChange?.(resolved);
        }
      },
      [isControlled, onExpandedChange],
    );

    const toggleNode = React.useCallback(
      (nodeId: string) => {
        setExpanded((prev) =>
          prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId],
        );
      },
      [setExpanded],
    );

    // 自动滚动到最新节点
    React.useEffect(() => {
      if (autoScroll && latestNodeRef.current) {
        latestNodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, [nodes, autoScroll]);

    // spec-013 P2-Q4: 递归查找最新节点(最右下叶子)
    const latestNodeId = React.useMemo(() => findLatestNodeId(nodes), [nodes]);

    return (
      <div
        ref={ref}
        className="flex flex-col gap-0"
        role="list"
        data-testid="task-progress"
      >
        {nodes.map((node, index) => (
          <ProgressNodeItem
            key={node.id}
            node={node}
            isLast={index === nodes.length - 1}
            isLatest={node.id === latestNodeId}
            expanded={expanded}
            onToggle={toggleNode}
            showTimestamp={showTimestamp}
            latestNodeRef={latestNodeRef}
          />
        ))}
      </div>
    );
  },
);

/**
 * spec-013 P2-Q4: 递归查找最新节点 ID。
 * 深度优先遍历,返回最右下叶子节点的 ID(即最近完成的动作)。
 * 若树为空返回 null。
 */
function findLatestNodeId(nodes: ProgressNode[]): string | null {
  if (nodes.length === 0) return null;
  const lastNode = nodes[nodes.length - 1];
  if (lastNode.children && lastNode.children.length > 0) {
    return findLatestNodeId(lastNode.children);
  }
  return lastNode.id;
}

/** 单个进度节点(含嵌套子节点) */
interface ProgressNodeItemProps {
  node: ProgressNode;
  isLast: boolean;
  isLatest: boolean;
  expanded: string[];
  onToggle: (nodeId: string) => void;
  showTimestamp: boolean;
  latestNodeRef: React.RefObject<HTMLDivElement | null>;
}

function ProgressNodeItem({
  node,
  isLast,
  isLatest,
  expanded,
  onToggle,
  showTimestamp,
  latestNodeRef,
}: ProgressNodeItemProps) {
  const isExpanded = expanded.includes(node.id);
  const hasContent = node.content !== undefined && node.content !== null;
  const hasChildren = node.children && node.children.length > 0;
  const isInteractive = hasContent || hasChildren;
  const color = PROGRESS_NODE_COLOR[node.status];
  const isRunning = node.status === 'running';
  const isFailed = node.status === 'failed';

  // spec-013 P1-A2: 节点 aria-label 提供语义描述
  const ariaLabel = `${node.title} - ${node.status}`;

  return (
    <div
      ref={isLatest ? (latestNodeRef as React.RefObject<HTMLDivElement>) : undefined}
      className="relative flex gap-3"
      role="listitem"
      aria-label={ariaLabel}
      data-node-id={node.id}
      data-node-type={node.type}
      data-node-status={node.status}
    >
      {/* 左侧:圆点 + 竖线 */}
      <div className="flex flex-col items-center">
        {/* 圆点 */}
        <span
          className={cn(
            'mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2',
            isFailed && 'border-transparent',
          )}
          style={{
            borderColor: color,
            backgroundColor: node.status === 'completed' ? color : 'transparent',
          }}
          aria-hidden
        >
          {isRunning && (
            <Loader2
              className="size-2 animate-spin"
              style={{ color }}
            />
          )}
          {isFailed && (
            <AlertCircle className="size-2" style={{ color }} />
          )}
        </span>

        {/* 竖线(连接到下一节点) */}
        {!isLast && (
          <div
            className="mt-1 w-px flex-1"
            style={{ backgroundColor: 'var(--trae-line)' }}
            aria-hidden
          />
        )}
      </div>

      {/* 右侧:标题 + 内容 */}
      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-3')}>
        <Collapsible open={isExpanded} onOpenChange={() => isInteractive && onToggle(node.id)}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {isInteractive && (
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded text-trae-grey transition-colors hover:text-trae-green"
                    aria-label={isExpanded ? '折叠' : '展开'}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3 transition-transform duration-trae-fast',
                        isExpanded && 'rotate-90',
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
              )}
              <span
                className={cn(
                  'truncate font-semibold text-trae-sm',
                  isFailed ? 'text-[#ef4444]' : 'text-trae-ink',
                )}
                title={node.title}
              >
                {node.title}
              </span>
            </div>

            {showTimestamp && node.startedAt && (
              <time
                className="shrink-0 font-mono text-trae-xs text-trae-grey-2"
                dateTime={node.startedAt}
              >
                {formatTimestamp(node.startedAt, node.endedAt)}
              </time>
            )}
          </div>

          {/* 内容区(展开时显示) */}
          {isInteractive && (
            <CollapsibleContent className="mt-1 overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
              <div
                className="pl-5 text-trae-sm text-trae-grey"
                style={{ lineHeight: 'var(--trae-leading-relaxed)' }}
              >
                {hasContent && node.content}
              </div>

              {/* 嵌套子节点 */}
              {hasChildren && (
                <div className="mt-2">
                  {node.children!.map((child, idx) => (
                    <ProgressNodeItem
                      key={child.id}
                      node={child}
                      isLast={idx === node.children!.length - 1}
                      isLatest={false}
                      expanded={expanded}
                      onToggle={onToggle}
                      showTimestamp={showTimestamp}
                      latestNodeRef={latestNodeRef}
                    />
                  ))}
                </div>
              )}
            </CollapsibleContent>
          )}
        </Collapsible>
      </div>
    </div>
  );
}

/**
 * 格式化时间戳:仅开始 → "HH:mm";开始+结束 → "HH:mm → HH:mm"
 * spec-013 P2-Q8: 移除冗余 try/catch(Date 构造器不抛异常,isNaN 已覆盖无效输入)
 */
function formatTimestamp(startedAt?: string, endedAt?: string): string {
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const start = fmt(startedAt);
  const end = fmt(endedAt);
  if (start && end) return `${start} → ${end}`;
  return start;
}
