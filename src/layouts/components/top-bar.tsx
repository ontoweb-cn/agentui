// spec-013 P1-5: TopBar 简化顶栏

import { IntellectAvatar } from '@/components/intellect-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChangeLanguage } from '@/hooks/logic-hooks';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import {
  useFetchUserInfo,
  useListTenant,
} from '@/hooks/use-user-setting-request';
import type { IUserInfo } from '@/interfaces/database/user-setting';
import { cn } from '@/lib/utils';
import { supportedLanguages } from '@/locales/config';
import { TenantRole } from '@/pages/user-setting/constants';
import { Routes } from '@/routes';
import { LucideChevronDown, LucideCircleHelp, LayoutPanelLeft, PanelTop } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { BellButton } from './bell-button';
import ThemeButton from './theme-button';

export interface TopBarProps {
  /** 左侧内容(可选,默认 Logo) */
  left?: React.ReactNode;
  /** 中间内容(可选,默认留空;通常传入 GlobalSearch) */
  center?: React.ReactNode;
  /** 右侧内容(可选,默认用户菜单) */
  right?: React.ReactNode;
  /** 高度(可选,默认 56px) */
  height?: number | string;
  /** 是否粘性(可选,默认 true) */
  sticky?: boolean;
}

/**
 * useHeaderActions — 复用 legacy header.tsx 的用户操作区逻辑。
 * 提取为内部 hook,供 TopBar 默认右列渲染使用。
 */
function useHeaderActions() {
  const changeLanguage = useChangeLanguage();
  // 防御性解构:useFetchUserInfo 虽然 initialData:{} 保证 data 非空,
  // 但在极端时序(如 query 被 gcTime:0 回收后重置)下可能为 undefined,
  // 此处给 data 默认值避免解构报错 "Cannot read properties of undefined"
  const { data: userInfo = {} as IUserInfo } = useFetchUserInfo();
  const { language = 'en', avatar, nickname } = userInfo;
  const { data: tenantData } = useListTenant();
  const hasNotification = React.useMemo(
    () => tenantData?.some((x) => x.role === TenantRole.Invite),
    [tenantData],
  );
  const currentLanguage = supportedLanguages.find((x) => x.code === language);
  return {
    changeLanguage,
    currentLanguage,
    supportedLanguages,
    avatar,
    nickname,
    hasNotification,
  };
}

/**
 * TopBar — 简化顶栏,替代 legacy Header。
 *
 * 三列网格布局(左/中/右),支持毛玻璃背景与粘性定位。
 * - 左列:默认 Logo(链接到 Routes.Root)
 * - 中列:默认留空;通常由父组件传入 GlobalSearch
 * - 右列:默认用户操作区(语言切换/帮助/主题/通知/头像)
 *
 * 各列均支持通过 prop 自定义内容,传入则覆盖默认渲染。
 */
export function TopBar({
  left,
  center,
  right,
  height = 56,
  sticky = true,
}: TopBarProps) {
  const { mode: layoutMode, toggleMode } = useLayoutMode();
  const {
    changeLanguage,
    currentLanguage,
    supportedLanguages: languages,
    avatar,
    nickname,
    hasNotification,
  } = useHeaderActions();

  return (
    <header
      data-testid="top-bar"
      className={cn(
        'w-full grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-[var(--trae-line)]',
        'backdrop-blur-[var(--trae-blur-nav,12px)] bg-[var(--trae-nav-bg,rgba(255,255,255,0.8))]',
        sticky && 'sticky top-0 z-50',
      )}
      style={{ height }}
    >
      <div className="justify-self-start">
        {left ?? (
          <Link to={Routes.Root}>
            <img src="/logo-96.png" alt="Logo" className="size-8" />
          </Link>
        )}
      </div>

      <div className="justify-self-center w-full max-w-[420px]">
        {center}
      </div>

      <div className="justify-self-end flex items-center gap-4">
        {right ?? (
          <div
            className="flex items-center justify-end gap-4"
            data-testid="auth-status"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="flex items-center gap-1" variant="ghost">
                  {currentLanguage?.displayName}
                  <LucideChevronDown className="size-[1em]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {languages.map((x) => (
                  <DropdownMenuItem
                    key={x.code}
                    onClick={() => changeLanguage(x.code)}
                  >
                    {x.displayName}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              asLink
              variant="ghost"
              size="icon"
              to="https://intellect.ontoweb.cn/docs/dev/category/user-guides"
              target="_blank"
              rel="noreferrer noopener"
            >
              <LucideCircleHelp className="size-[1em]" />
            </Button>

            {import.meta.env.DEV && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMode}
                aria-label="切换布局模式"
                data-testid="layout-mode-toggle"
              >
                {layoutMode === 'three-column' ? (
                  <LayoutPanelLeft className="size-[1em]" />
                ) : (
                  <PanelTop className="size-[1em]" />
                )}
              </Button>
            )}

            <ThemeButton />

            {hasNotification && <BellButton />}

            <Link
              to={Routes.UserSetting}
              className="relative ms-3"
              data-testid="settings-entrypoint"
            >
              <IntellectAvatar
                name={nickname}
                avatar={avatar}
                isPerson
                className="size-8"
              />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
