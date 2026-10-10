import { IconFontFill } from '@/components/icon-font';
import { IntellectAvatar } from '@/components/intellect-avatar';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/hooks/use-login-request';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { TFunction } from 'i18next';
import {
  LucideBox,
  LucideCircleHelp,
  LucideMessagesSquare,
  LucideLogOut,
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
  LucideServer,
  LucideUnplug,
  LucideUser,
  LucideUsers,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHandleMenuClick } from './hooks';

// 用户文档入口(原顶栏"?"按钮迁入侧边栏)
const DOC_URL = 'https://intellect.ontoweb.cn/docs/dev/category/user-guides';

const menuItems = (t: TFunction) => [
  {
    icon: <LucideServer className="size-[1em]" />,
    label: t('setting.dataSources'),
    key: Routes.DataSource,
  },
  {
    icon: <LucideMessagesSquare className="size-[1em]" />,
    label: t('setting.chatChannels'),
    key: Routes.ChatChannel,
  },
  {
    icon: <LucideBox className="size-[1em]" />,
    label: t('setting.model'),
    key: Routes.Model,
    'data-testid': 'settings-nav-model-providers',
  },
  {
    icon: <IconFontFill name="mcp" className="size-[1em]" />,
    label: 'MCP',
    key: Routes.Mcp,
  },
  {
    icon: <LucideUsers className="size-[1em]" />,
    label: t('setting.team'),
    key: Routes.Team,
  },
  {
    icon: <LucideUser className="size-[1em]" />,
    label: t('setting.profile'),
    key: Routes.Profile,
  },
  {
    icon: <LucideUnplug className="size-[1em]" />,
    label: t('setting.api'),
    key: Routes.Api,
  },
];

export function SideBar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { data: userInfo } = useFetchUserInfo();
  const { handleMenuClick, active: activeItemKey } = useHandleMenuClick();
  const { t } = useTranslation();
  const { logout } = useLogout();

  return (
    <aside
      className={cn(
        'shrink-0 w-16 bg-bg-base flex flex-col overflow-hidden',
        !collapsed && 'md:w-[303px]',
      )}
    >
      <header>
        <h1
          className={cn(
            'px-2 flex gap-2.5 items-center justify-center font-normal',
            !collapsed && 'md:justify-start md:px-6',
            collapsed && 'flex-col py-2',
          )}
        >
          {collapsed && (
            <Button
              variant="transparent"
              size="icon-sm"
              className="border-0 hidden md:inline-flex"
              onClick={onToggle}
              data-testid="user-setting-sidebar-open"
            >
              <LucidePanelLeftOpen />
            </Button>
          )}

          <IntellectAvatar
            avatar={userInfo?.avatar}
            name={userInfo?.nickname}
            isPerson
          />

          {!collapsed && (
            <>
              <p className="hidden md:block flex-1 text-sm text-text-primary truncate">
                {userInfo?.email}
              </p>
              <Button
                variant="transparent"
                size="icon-sm"
                className="border-0 hidden md:inline-flex"
                onClick={onToggle}
                data-testid="user-setting-sidebar-close"
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
          {menuItems(t).map((item) => {
            const { key, icon, label, ...rest } = item;

            return (
              <li key={key} className="w-full md:w-auto">
                <Button
                  {...rest}
                  block
                  variant="ghost"
                  aria-label={label}
                  className={cn(
                    'relative h-10 text-base max-md:size-10 max-md:p-0 max-md:justify-center justify-start gap-2.5 px-2 md:px-3',
                    collapsed && 'md:size-10 md:p-0 md:justify-center',
                    activeItemKey === key && 'bg-bg-card text-text-primary',
                  )}
                  onClick={handleMenuClick(key)}
                >
                  <span
                    className={cn(
                      'flex items-center gap-2.5 max-md:gap-0',
                      collapsed && 'md:gap-0',
                    )}
                  >
                    {icon}
                    <span className={cn('hidden', !collapsed && 'md:inline')}>
                      {label}
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
          {/* 帮助:外链新窗口打开,不走路由菜单高亮 */}
          <li className="w-full md:w-auto">
            <Button
              block
              asLink
              variant="ghost"
              aria-label={t('setting.help')}
              to={DOC_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                'relative h-10 text-base max-md:size-10 max-md:p-0 max-md:justify-center justify-start gap-2.5 px-2 md:px-3',
                collapsed && 'md:size-10 md:p-0 md:justify-center',
              )}
            >
              <span
                className={cn(
                  'flex items-center gap-2.5 max-md:gap-0',
                  collapsed && 'md:gap-0',
                )}
              >
                <LucideCircleHelp className="size-[1em]" />
                <span className={cn('hidden', !collapsed && 'md:inline')}>
                  {t('setting.help')}
                </span>
              </span>
            </Button>
          </li>
        </ul>
      </nav>

      <footer className="px-2 md:px-6 pb-4 mt-auto">
        <Button
          block
          size="lg"
          variant="transparent"
          aria-label={t('setting.logout')}
          className={cn(
            'max-md:size-10 max-md:p-0 max-md:mx-auto max-md:justify-center',
            collapsed && 'md:size-10 md:p-0 md:mx-auto md:justify-center',
          )}
          onClick={() => logout()}
        >
          <LucideLogOut className={cn('size-[1em]', !collapsed && 'md:hidden')} />
          <span className={cn('hidden', !collapsed && 'md:inline')}>
            {t('setting.logout')}
          </span>
        </Button>
      </footer>
    </aside>
  );
}
