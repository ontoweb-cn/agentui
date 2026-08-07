// spec-013 P1-6: ActivityBar 模式导航窄列
// 对齐 TRAE Work / TraeCode Activity Bar 范式:
// - 桌面端:左侧 52px 窄列,垂直排列 Work/Code/Canvas 模式切换 + 底部设置入口
// - 移动端(<768px):由 ThreeColumnLayout 转为底部 tab bar 渲染
// 复用 ModeSwitcher(vertical) 实现模式切换,保持受控协议一致

import * as React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { ModeSwitcher } from '@/components/trae-work';
import type { WorkMode } from '@/components/trae-work';
import { Routes } from '@/constants/routes';
import { cn } from '@/lib/utils';

export interface ActivityBarProps {
  /** 当前激活模式(受控) */
  value: WorkMode;
  /** 模式切换回调 */
  onChange: (mode: WorkMode) => void;
  /** 底部设置入口(可选,默认链接到 UserSetting) */
  footer?: React.ReactNode;
  /** 是否为移动端底部 tab bar 模式(由 ThreeColumnLayout 注入) */
  mobile?: boolean;
}

/**
 * ActivityBar — 模式导航窄列,承载 Work/Code/Canvas 切换。
 *
 * 桌面端:垂直窄列(52px),顶部模式切换 + 底部设置入口。
 * 移动端:水平底部 tab bar(由父级通过 mobile prop 触发)。
 */
export function ActivityBar({ value, onChange, footer, mobile = false }: ActivityBarProps) {
  const { t } = useTranslation();

  if (mobile) {
    // 移动端:水平底部 tab bar
    return (
      <nav
        role="navigation"
        aria-label={t('activityBar.label', '模式导航')}
        className={cn(
          'flex items-stretch justify-around border-t border-[var(--trae-line)]',
          'bg-[var(--trae-surface)] backdrop-blur-[var(--trae-blur-nav,12px)]',
        )}
        data-testid="activity-bar-mobile"
      >
        <ModeSwitcher
          value={value}
          onChange={onChange}
          orientation="horizontal"
          size="sm"
          showLabels
        />
        {footer ?? <DefaultFooter mobile />}
      </nav>
    );
  }

  // 桌面端:垂直窄列
  return (
    <nav
      role="navigation"
      aria-label={t('activityBar.label', '模式导航')}
      className={cn(
        'flex h-full flex-col items-center justify-between py-2',
        'border-r border-[var(--trae-line)] bg-[var(--trae-surface)]',
      )}
      data-testid="activity-bar"
      data-mode={value}
    >
      <div className="flex flex-col items-center gap-1">
        <ModeSwitcher
          value={value}
          onChange={onChange}
          orientation="vertical"
          size="md"
          showLabels
        />
      </div>

      <div className="flex flex-col items-center gap-1">
        {footer ?? <DefaultFooter />}
      </div>
    </nav>
  );
}

/** 默认底部入口:设置(链接到 UserSetting) */
function DefaultFooter({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to={Routes.UserSetting}
      className={cn(
        'inline-flex items-center justify-center rounded-trae-sm text-trae-grey hover:text-trae-green',
        'transition-colors duration-trae-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trae-green',
        mobile ? 'size-9' : 'size-8',
      )}
      aria-label={t('activityBar.settings', '设置')}
      title={t('activityBar.settings', '设置')}
      data-testid="activity-bar-settings"
    >
      <Settings className={mobile ? 'size-4' : 'size-3.5'} aria-hidden />
    </Link>
  );
}
