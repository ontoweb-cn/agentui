// spec-013 P0-5: ToolPanel 工具面板组件
// 对齐 components-api.md §2.3
// 视觉规范:头部 40px,图标 + 标题 + 徽标数,展开/折叠 chevron 旋转

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Loader2,
  Search,
  FileText,
  ListTree,
  Settings,
  Bell,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { ToolPanelProps } from './types';

// spec-013 P2-Q9: 显式图标映射(替代 import *,优化 tree-shaking)
// 仅暴露常用图标,未列出的图标名回退为 null
const ICON_MAP: Record<string, LucideIcon> = {
  Search,
  FileText,
  ListTree,
  Settings,
  Bell,
};

/**
 * ToolPanel — 可折叠的工具面板项。
 * 头部(图标 + 标题 + actions + chevron)+ 内容区。
 * 支持受控/非受控展开、徽标数、加载/空状态/禁用。
 *
 * spec-013 P1-Q2 修复:头部改为 flex 布局,trigger 与 actions 分离,
 * 避免按钮嵌套违反 HTML 规范。
 * spec-013 评审 Q-4 修复:chevron 改用普通 button(非 CollapsibleTrigger),
 * 加 aria-hidden + tabIndex=-1,主 trigger 独占 ARIA 语义,避免屏幕阅读器困惑。
 */
export const ToolPanel = React.forwardRef<HTMLDivElement, ToolPanelProps>(
  function ToolPanel(
    {
      id,
      title,
      icon,
      children,
      defaultExpanded = false,
      expanded: expandedProp,
      onExpandedChange,
      actions,
      loading = false,
      empty,
      disabled = false,
      badge,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [internalExpanded, setInternalExpanded] = React.useState(defaultExpanded);
    const isControlled = expandedProp !== undefined;
    const expanded = isControlled ? (expandedProp as boolean) : internalExpanded;

    const handleOpenChange = React.useCallback(
      (open: boolean) => {
        if (disabled) return;
        if (!isControlled) {
          setInternalExpanded(open);
        }
        onExpandedChange?.(open);
      },
      [disabled, isControlled, onExpandedChange],
    );

    // 显式图标映射查找(未列出返回 null)
    const IconComponent = icon ? ICON_MAP[icon] ?? null : null;

    return (
      <Collapsible open={expanded} onOpenChange={handleOpenChange}>
        <div
          ref={ref}
          className="border-b border-trae-line"
          data-testid={`tool-panel-${id}`}
          data-expanded={expanded}
          data-disabled={disabled}
        >
          {/* 头部:trigger 与 actions 分离,避免 button 嵌套 */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 text-left',
                  'transition-colors duration-trae-fast',
                  disabled
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer hover:bg-[image:var(--trae-card-bg-hover)]',
                )}
                aria-expanded={expanded}
                aria-controls={`tool-panel-content-${id}`}
              >
                {IconComponent && (
                  <IconComponent className="size-4 shrink-0 text-trae-grey" aria-hidden />
                )}
                <span
                  className="truncate font-semibold tracking-trae-wide text-trae-sm-2 text-trae-ink"
                  title={title}
                >
                  {title}
                </span>

                {/* 徽标数 */}
                {typeof badge === 'number' && badge > 0 && (
                  <span
                    className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-trae-xs font-semibold"
                    style={{
                      backgroundColor: 'var(--trae-green-bright)',
                      color: '#000',
                    }}
                    aria-label={t('toolPanel.unreadBadge', { count: badge })}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            </CollapsibleTrigger>

            {/* 右侧:actions + chevron(actions 与 trigger 同级,不再嵌套) */}
            {/* spec-013 评审 Q-4: chevron 改用普通 button(非 CollapsibleTrigger),
                避免 Radix 自动注入 aria-expanded/aria-controls 造成重复;
                主 trigger 独占 ARIA 语义,chevron 仅视觉辅助(tabIndex=-1) */}
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleOpenChange(!expanded)}
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded text-trae-grey',
                  'transition-colors duration-trae-fast',
                  disabled
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer hover:text-trae-green',
                )}
                tabIndex={-1}
                aria-hidden
              >
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform duration-trae-base',
                    expanded && 'rotate-180',
                  )}
                />
              </button>
            </div>
          </div>

          {/* 内容区 */}
          <CollapsibleContent
            id={`tool-panel-content-${id}`}
            className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
          >
            <div className="px-4 py-2">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-trae-sm text-trae-grey-2">
                  <Loader2 className="size-3 animate-spin" />
                  <span>{t('toolPanel.loading')}</span>
                </div>
              ) : empty ? (
                <div className="py-4 text-center text-trae-sm text-trae-grey-2">{empty}</div>
              ) : (
                children
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  },
);
