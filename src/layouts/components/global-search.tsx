// spec-013 P1-7: GlobalSearch 顶栏全局搜索
// 占据 TopBar 中列(原 ModeSwitcher 位置)
// 视觉:居中搜索框 + 快捷键提示徽标,点击/⌘K 聚焦

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GlobalSearchProps {
  /** 搜索关键词(受控,可选) */
  value?: string;
  /** 搜索回调(可选) */
  onChange?: (query: string) => void;
  /** 占位文案(可选) */
  placeholder?: string;
  /** 是否显示快捷键提示(可选,默认 ⌘K) */
  showShortcut?: boolean;
}

/**
 * GlobalSearch — 顶栏全局搜索框。
 *
 * 居中渲染于 TopBar 中列,点击或按 ⌘K 聚焦。
 * 当前为 UI 壳,onChange 仅透传,后续接入全局搜索逻辑。
 */
export function GlobalSearch({
  value,
  onChange,
  placeholder,
  showShortcut = true,
}: GlobalSearchProps) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K 聚焦搜索框
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // 已聚焦时不重复 preventDefault,避免干扰可能的浏览器扩展行为
        if (document.activeElement === inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className={cn(
        'relative flex items-center w-full max-w-[420px] mx-auto',
      )}
      data-testid="global-search"
    >
      <Search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-disabled" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder ?? t('globalSearch.placeholder', '搜索任务、应用、数据集...')}
        className={cn(
          'flex h-8 w-full rounded-md border-0.5 border-border-button bg-bg-input px-7 py-2 outline-none text-sm text-text-primary',
          'placeholder:text-text-disabled focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary transition-colors',
        )}
        aria-label={t('globalSearch.ariaLabel', '全局搜索')}
      />
      {showShortcut && (
        <kbd
          className={cn(
            'pointer-events-none absolute end-2 top-1/2 -translate-y-1/2',
            'inline-flex h-5 select-none items-center gap-0.5 rounded border border-[var(--trae-line)]',
            'bg-[var(--trae-surface)] px-1.5 font-mono text-[10px] text-trae-grey',
          )}
          aria-hidden
        >
          ⌘K
        </kbd>
      )}
    </div>
  );
}
