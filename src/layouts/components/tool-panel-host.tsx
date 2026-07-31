// spec-013 P1-3: ToolPanelHost 工具面板容器
// 管理多个 ToolPanel 的展开/折叠状态(支持受控/非受控/手风琴模式)
// 对接 ThreeColumnLayout 右侧工具面板区

import * as React from 'react';
import { PanelRightClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolPanel } from '@/components/trae-work';
import type { ToolPanelProps } from '@/components/trae-work';

export interface ToolPanelHostProps {
  /** 工具面板列表 */
  panels: ToolPanelProps[];
  /** 默认展开的面板 ID 列表(可选) */
  defaultExpandedPanels?: string[];
  /** 受控展开(可选) */
  expandedPanels?: string[];
  /** 展开变更回调(可选) */
  onExpandedChange?: (panelIds: string[]) => void;
  /** 手风琴模式(可选,默认 false,同时只能展开一个) */
  accordion?: boolean;
  /** 顶部标题(可选,默认 "工具") */
  title?: string;
  /** 折叠状态(可选,折叠时隐藏整个面板) */
  collapsed?: boolean;
  /** 折叠回调(可选) */
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function ToolPanelHost({
  panels,
  defaultExpandedPanels,
  expandedPanels,
  onExpandedChange,
  accordion = false,
  title = '工具',
  collapsed = false,
  onCollapsedChange,
}: ToolPanelHostProps) {
  const [internalExpanded, setInternalExpanded] = React.useState<Set<string>>(
    () => new Set(defaultExpandedPanels ?? []),
  );

  // 受控 / 非受控选择:expandedPanels 传入时优先使用
  const expandedSet = React.useMemo(
    () => new Set(expandedPanels ?? internalExpanded),
    [expandedPanels, internalExpanded],
  );

  const handlePanelToggle = React.useCallback(
    (panelId: string, expanded: boolean) => {
      let nextSet: Set<string>;
      if (accordion) {
        nextSet = expanded ? new Set([panelId]) : new Set();
      } else {
        nextSet = new Set(expandedSet);
        if (expanded) nextSet.add(panelId);
        else nextSet.delete(panelId);
      }

      if (expandedPanels === undefined) {
        setInternalExpanded(nextSet);
      }
      onExpandedChange?.(Array.from(nextSet));
    },
    [accordion, expandedSet, expandedPanels, onExpandedChange],
  );

  const handleToggleCollapse = React.useCallback(() => {
    onCollapsedChange?.(!collapsed);
  }, [collapsed, onCollapsedChange]);

  return (
    <div
      className={cn(
        'flex h-full flex-col border-l border-[var(--trae-line)] bg-[var(--trae-surface)]',
        collapsed && 'hidden',
      )}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* 顶部标题栏 */}
      <div className="flex h-10 items-center justify-between border-b border-[var(--trae-line)] px-4">
        <span className="text-sm font-semibold text-[var(--trae-ink)]">
          {title}
        </span>
        <button
          type="button"
          onClick={handleToggleCollapse}
          aria-label="折叠工具面板"
          className="inline-flex size-4 items-center justify-center text-[var(--trae-grey)] transition-colors hover:text-[var(--trae-ink)]"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {/* 面板列表区域 */}
      {panels.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {panels.map((panel) => (
            <ToolPanel
              key={panel.id}
              {...panel}
              expanded={expandedSet.has(panel.id)}
              onExpandedChange={(exp) => handlePanelToggle(panel.id, exp)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
