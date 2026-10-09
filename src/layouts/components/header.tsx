/**
 * 应用顶栏(three-column 布局已移除,此为唯一布局铬)。
 */

// Temporarily hidden: Discord & GitHub logos
// import { IconFontFill } from '@/components/icon-font';
import { IntellectAvatar } from '@/components/intellect-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChangeLanguage } from '@/hooks/logic-hooks';
import { useTranslation } from 'react-i18next';
import {
  useFetchUserInfo,
  useListTenant,
} from '@/hooks/use-user-setting-request';
import type { IUserInfo } from '@/interfaces/database/user-setting';
import { cn } from '@/lib/utils';
import { TenantRole } from '@/pages/user-setting/constants';
import { Routes } from '@/routes';
import { LucideChevronDown } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { BellButton } from './bell-button';
import { GlobalSearch } from './global-search';
import GlobalNavbar from './global-navbar';
import ThemeButton from './theme-button';

import { supportedLanguages } from '@/locales/config';

export function Header({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const { pathname } = useLocation();

  const changeLanguage = useChangeLanguage();

  // 语言按钮以 i18n 当前语言为准,而非后端用户资料(userInfo.language)——
  // 后者仅在 profile 同步时更新,切换语言后不会立即变化,曾导致按钮显示错语言。
  const { i18n } = useTranslation();
  const currentLanguage =
    supportedLanguages.find((x) => x.code === i18n.language) ??
    supportedLanguages.find(
      (x) => x.code.split('-')[0] === i18n.language.split('-')[0],
    );

  // 防御性解构:useFetchUserInfo 虽然 initialData:{} 保证 data 非空,
  // 但在极端时序(如 query 被 gcTime:0 回收后重置)下可能为 undefined,
  // 此处给 data 默认值避免解构报错 "Cannot read properties of undefined"
  const { data: userInfo = {} as IUserInfo } = useFetchUserInfo();
  const { avatar, nickname } = userInfo;

  const { data: tenantData } = useListTenant();
  const hasNotification = useMemo(
    () => tenantData?.some((x) => x.role === TenantRole.Invite),
    [tenantData],
  );

  // const langItems = LanguageList.map((x) => ({
  //   key: x,
  //   label: <span>{LanguageMap[x as keyof typeof LanguageMap]}</span>,
  // }));

  return (
    <header
      key="app-navbar"
      className={cn(
        'w-full grid grid-cols-[1fr_auto_1fr] grid-rows-1 items-center gap-8',
        className,
      )}
      {...props}
    >
      <div className="inline-flex items-center">
        <Link
          to={Routes.Root}
          aria-current={pathname === Routes.Root ? 'page' : undefined}
        >
          <img src={`${import.meta.env.BASE_URL}logo-96.png`} alt="Intellect logo" className="size-10" />
        </Link>
      </div>

      <GlobalNavbar />

      <div
        className="flex items-center justify-end gap-2 text-text-badge"
        data-testid="auth-status"
      >
        {/* 评审 P2:全局搜索入口从已删的 TopBar 迁移到 Header,置于菜单右侧 */}
        <div className="hidden w-[220px] max-w-full md:block">
          <GlobalSearch />
        </div>
        {/* Temporarily hidden: Discord & GitHub logos */}
        {/* <a
          className="p-2 text-text-secondary hover:text-text-primary focus-visible:text-text-primary"
          target="_blank"
          href="https://discord.com/invite/NjYzJD3GM3"
          rel="noreferrer noopener"
        >
          <IconFontFill name="a-DiscordIconSVGVectorIcon" />
        </a>

        <a
          className="p-2 text-text-secondary hover:text-text-primary focus-visible:text-text-primary"
          target="_blank"
          href="https://gitee.com/wustbd/intellect-rag"
          rel="noreferrer noopener"
        >
          <IconFontFill name="GitHub" />
        </a> */}

        {/* 语言切换:按钮与菜单均用简称压缩占位;title 保留全名供悬停提示 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="flex items-center gap-1 min-w-[3.25rem]"
              variant="ghost"
              aria-label={`Language: ${currentLanguage?.displayName ?? ''}`}
            >
              {currentLanguage?.shortName ?? currentLanguage?.displayName}
              <LucideChevronDown className="size-[1em]" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent>
            {supportedLanguages.map((x) => (
              <DropdownMenuItem
                key={x.code}
                onClick={() => changeLanguage(x.code)}
              >
                {/* 简称徽标 + 全称:徽标样式与横幅 System 标签同源(backgroundCoreWeak) */}
                <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-sm bg-backgroundCoreWeak px-1 text-xs font-semibold">
                  {x.shortName}
                </span>
                <span>{x.displayName}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 帮助"?"入口已迁至用户设置页左侧菜单栏 */}

        <ThemeButton />

        {hasNotification && <BellButton />}

        <Link
          to={Routes.UserSetting}
          className="relative"
          data-testid="settings-entrypoint"
        >
          <IntellectAvatar
            name={nickname}
            avatar={avatar}
            isPerson
            className="size-8"
          />
          {/* Temporarily hidden */}
          {/* <Badge className="h-5 w-8 absolute font-normal p-0 justify-center -right-8 -top-2 text-bg-base bg-gradient-to-l from-[#42D7E7] to-[#478AF5]">
            Pro
          </Badge> */}
        </Link>
      </div>
    </header>
  );
}
