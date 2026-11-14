import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

export interface HubMenuItem {
  /** 路由路径或页内标识,同时用于选中态匹配(最长前缀) */
  key: string;
  label: string;
  icon: ReactNode;
  /** 额外参与选中态匹配的路径前缀(如详情页);缺省仅用 key */
  activeKeys?: string[];
  /** 右侧附加信息(如资源计数);收起态不显示 */
  suffix?: ReactNode;
  testId?: string;
}

/**
 * hub 页共享两栏壳(首页/任务/知识):可折叠侧栏 + 内容区,间距对齐 chat 页。
 *
 * - 选中态:传入 activeKey 则完全受控(如首页的页内 state 切换);
 *   否则按 pathname 与菜单 key 做最长前缀匹配,无匹配则全部不选中
 *   (如能力隐藏的子菜单对应页面)。
 * - 菜单点击:默认 navigate(item.key);传入 onSelect 时导航由调用方处理。
 * - 头部:icon/title 均省略时仅保留折叠按钮(右对齐),如首页。
 */
export function HubLayout({
  title,
  icon,
  items,
  activeKey: controlledActiveKey,
  onSelect,
  testIdPrefix,
  contentClassName,
  children,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  items: HubMenuItem[];
  activeKey?: string;
  onSelect?: (key: string) => void;
  testIdPrefix?: string;
  /** 内容区附加类名；默认保持 overflow-auto，需要列内独立滚动时传 overflow-hidden */
  contentClassName?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const hasBrand = Boolean(title || icon);
  const activeKey =
    controlledActiveKey ??
    items
      .map((item) => ({
        item,
        matched: (item.activeKeys ?? [item.key])
          .filter((key) => pathname.startsWith(key))
          .sort((a, b) => b.length - a.length)[0],
      }))
      .filter((entry) => entry.matched)
      .sort((a, b) => (b.matched?.length ?? 0) - (a.matched?.length ?? 0))[0]
      ?.item.key;

  return (
    <section
      className={cn(
        'pt-0.5 size-full grid grid-cols-[4rem_minmax(0,1fr)] grid-rows-1 min-w-0',
        !collapsed && 'md:grid-cols-[303px_minmax(0,1fr)]',
      )}
    >
      <aside
        className={cn(
          'shrink-0 w-16 bg-bg-base flex flex-col overflow-hidden',
          !collapsed && 'md:w-[303px]',
        )}
      >
        <header>
          <h1
            className={cn(
              'px-2 py-2 flex gap-2.5 items-center justify-center',
              collapsed
                ? 'flex-col'
                : hasBrand
                  ? 'md:justify-start md:px-6'
                  : 'md:justify-end md:px-6',
            )}
          >
            {collapsed && (
              <Button
                variant="transparent"
                size="icon-sm"
                className="border-0 hidden md:inline-flex"
                aria-label={t('header.expandSidebar')}
                onClick={() => setCollapsed(false)}
                data-testid={testIdPrefix && `${testIdPrefix}-sidebar-open`}
              >
                <LucidePanelLeftOpen />
              </Button>
            )}

            {icon}

            {!collapsed && (
              <>
                {title && (
                  <span className="hidden md:inline text-base font-medium flex-1 truncate">
                    {title}
                  </span>
                )}
                <Button
                  variant="transparent"
                  size="icon-sm"
                  className="border-0 hidden md:inline-flex"
                  aria-label={t('header.collapseSidebar')}
                  onClick={() => setCollapsed(true)}
                  data-testid={testIdPrefix && `${testIdPrefix}-sidebar-close`}
                >
                  <LucidePanelLeftClose />
                </Button>
              </>
            )}
          </h1>
        </header>

        <nav className="flex-1 overflow-auto mt-4 py-1">
          <ul
            className={cn(
              'px-2 flex flex-col gap-2 items-center',
              !collapsed && 'md:px-6 md:gap-3 md:items-stretch',
            )}
          >
            {items.map((item) => {
              const active = activeKey === item.key;

              return (
                <li key={item.key} className="w-full md:w-auto">
                  <Button
                    block
                    variant="ghost"
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    data-testid={item.testId}
                    className={cn(
                      'relative h-10 text-base max-md:size-10 max-md:p-0 max-md:justify-center justify-start gap-2.5 px-2 md:px-3',
                      collapsed && 'md:size-10 md:p-0 md:justify-center',
                      active && 'bg-bg-card text-text-primary',
                    )}
                    onClick={() =>
                      onSelect ? onSelect(item.key) : navigate(item.key)
                    }
                  >
                    <span
                      className={cn(
                        'flex items-center gap-2.5 max-md:gap-0',
                        collapsed && 'md:gap-0',
                      )}
                    >
                      {item.icon}
                      <span className={cn('hidden', !collapsed && 'md:inline')}>
                        {item.label}
                      </span>
                    </span>
                    {item.suffix && (
                      <span
                        className={cn(
                          'ml-auto hidden text-[11px] text-text-secondary',
                          !collapsed && 'md:inline',
                        )}
                      >
                        {item.suffix}
                      </span>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* 内容区间距对齐 chat 页:上 2px/左右 10px/下 10px */}
      <div
        className={cn(
          'px-2.5 pt-0.5 pb-2.5 flex flex-col min-w-0 rounded-lg overflow-auto',
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
