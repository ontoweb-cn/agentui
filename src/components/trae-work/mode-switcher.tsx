// spec-013 P0-6: ModeSwitcher 模式切换组件
// 对齐 components-api.md §2.4
// 视觉规范:容器 inline-flex,激活 var(--trae-green-bright),非激活 var(--trae-grey)
// 阶段 0 仅 UI 壳,onChange 回调不接业务逻辑

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Code2, LayoutGrid, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ModeSwitcherProps, WorkMode } from './types';
import { WORK_MODE_LABEL, DEFAULT_AVAILABLE_MODES, MODE_SWITCHER_SIZE_PADDING, MODE_SWITCHER_SIZE_ICON } from './constants';

/** WorkMode → 图标组件映射 */
const MODE_ICON_COMPONENT: Record<WorkMode, LucideIcon> = {
  work: FileText,
  code: Code2,
  canvas: LayoutGrid,
};

/**
 * ModeSwitcher — 三段式模式切换(Work/Code/Canvas)。
 * 受控组件(value + onChange),支持 availableModes 控制可选模式、size 控制尺寸。
 */
export const ModeSwitcher = React.forwardRef<HTMLDivElement, ModeSwitcherProps>(
  function ModeSwitcher(
    {
      value,
      onChange,
      availableModes = DEFAULT_AVAILABLE_MODES,
      size = 'md',
      disabled = false,
      showLabels = true,
      orientation = 'horizontal',
    },
    ref,
  ) {
    const { t } = useTranslation();
    const sizePadding = MODE_SWITCHER_SIZE_PADDING[size];
    const sizeIcon = MODE_SWITCHER_SIZE_ICON[size];
    const isVertical = orientation === 'vertical';

    const handleSelect = React.useCallback(
      (mode: WorkMode) => {
        if (disabled) return;
        if (mode === value) return;
        onChange(mode);
      },
      [disabled, value, onChange],
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent, mode: WorkMode) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect(mode);
        }
      },
      [disabled, handleSelect],
    );

    return (
      <div
        ref={ref}
        className={cn(
          isVertical
            ? 'inline-flex flex-col items-stretch gap-0.5 rounded-trae-md'
            : 'inline-flex items-center gap-0.5 rounded-trae-md',
          'bg-[image:var(--trae-card-bg-hover)]',
          disabled && 'opacity-50',
        )}
        role="radiogroup"
        aria-orientation={isVertical ? 'vertical' : 'horizontal'}
        aria-label={t('modeSwitcher.label')}
        aria-disabled={disabled}
        data-testid="mode-switcher"
        data-value={value}
        data-orientation={orientation}
      >
        {availableModes.map((mode) => {
          const Icon = MODE_ICON_COMPONENT[mode];
          const isActive = mode === value;
          const label = WORK_MODE_LABEL[mode];

          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={label}
              disabled={disabled}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleSelect(mode)}
              onKeyDown={(e) => handleKeyDown(e, mode)}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-trae-sm relative',
                'font-semibold tracking-trae-wide transition-all duration-trae-base',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trae-green',
                sizePadding,
                isVertical && 'flex-col py-2',
                isActive
                  ? isVertical
                    ? 'text-trae-green bg-[var(--trae-green-soft,rgba(16,185,129,0.12))]'
                    : 'text-black shadow-trae-glow-sm'
                  : 'text-trae-grey hover:text-trae-green',
              )}
              style={
                isActive && !isVertical
                  ? { backgroundColor: 'var(--trae-green-bright)' }
                  : undefined
              }
              data-mode={mode}
              data-active={isActive}
            >
              {isActive && isVertical && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-trae-green"
                  aria-hidden
                />
              )}
              <Icon className={cn(sizeIcon)} aria-hidden />
              {showLabels && <span className={cn(isVertical && 'text-[10px]')}>{label}</span>}
            </button>
          );
        })}
      </div>
    );
  },
);
