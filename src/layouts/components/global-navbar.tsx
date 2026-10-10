import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { LucideHouse } from 'lucide-react';

import { collectNav } from '@/features/_registry';
import {
  CapabilityName,
  useIsCapabilityEnabled,
} from '@/hooks/use-harness-capabilities';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { supportsCssAnchor } from '@/utils/css-support';

// Match on path-segment boundaries, not a loose substring, so e.g.
// "/user-setting/chat-channel" does not match the "/chat" tab.
const matchesPath = (pathname: string, candidate: string) =>
  pathname === candidate || pathname.startsWith(`${candidate}/`);

const staticMenuItems = [
  { path: Routes.Root, name: 'header.home', icon: LucideHouse },
];

// 菜单项 → 能力映射:能力为 false 时隐藏对应入口。
// 知识库/文件管理已并入"知识"hub,入口隐藏在 hub 页内按能力处理,无需在此映射。
const navCapabilityMap: Record<string, CapabilityName> = {
  [Routes.Memories]: 'memory',
};

/**
 * 组装导航菜单(静态首页项 + 各 feature 模块 nav),并按能力过滤。
 * 必须在组件内调用(依赖能力的 useIsCapabilityEnabled),
 * 不能像旧实现那样在模块加载时求值一次——那会固化空能力下的菜单。
 */
function useNavMenu() {
  const knowledgeBase = useIsCapabilityEnabled('knowledgeBase');
  const memory = useIsCapabilityEnabled('memory');
  const capabilityValues: Partial<Record<CapabilityName, boolean>> = {
    knowledgeBase,
    memory,
  };

  const menuItems = useMemo(() => {
    const featureNavItems = collectNav().map((item) => ({
      path: item.path,
      name: item.labelKey,
      ...(item.icon ? { icon: item.icon } : {}),
      ...(item.testId ? { 'data-testid': item.testId } : {}),
    }));
    return [...staticMenuItems, ...featureNavItems].filter((item) => {
      const cap = navCapabilityMap[item.path];
      return !cap || capabilityValues[cap] === true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeBase, memory]);

  const pathMap = useMemo(() => {
    const featureItems = collectNav();
    return menuItems.reduce<Record<string, string[]>>((acc, item) => {
      const featureItem = featureItems.find((f) => f.path === item.path);
      acc[item.path] = featureItem?.pathMap ?? [item.path];
      return acc;
    }, {});
  }, [menuItems]);

  return { menuItems, pathMap };
}

const GlobalNavbar = supportsCssAnchor
  ? () => {
      const { t } = useTranslation();
      const { pathname } = useLocation();
      const navbarAnchorNamePrefix = useId().replace(/:/g, '');
      const { menuItems, pathMap } = useNavMenu();

      const activePath = useMemo(() => {
        return (
          Object.keys(pathMap).find((x: string) =>
            pathMap[x].some((y: string) => matchesPath(pathname, y)),
          ) || pathname
        );
      }, [pathname, pathMap]);

      const activePathAnchorName = `--${navbarAnchorNamePrefix}${activePath === Routes.Root ? '-root' : activePath.replace('/', '-')}`;

      const hasAnyActive = useMemo(
        () => menuItems.some(({ path }) => path === activePath),
        [activePath, menuItems],
      );

      return (
        <nav>
          <ul className="relative flex items-center p-1 rounded-full">
            {menuItems.map(({ path, name, icon: Icon, ...props }) => {
              const isActive = path === activePath;
              const anchorName = `--${navbarAnchorNamePrefix}${path === Routes.Root ? '-root' : path.replace('/', '-')}`;

              return (
                <li key={path} className="relative" style={{ anchorName }}>
                  <Link
                    {...props}
                    to={path}
                    className={cn(
                      'h-10 px-4 text-base inline-flex items-center justify-center gap-2',
                      'hover:text-current focus-visible:text-current rounded-full transition-all',
                      isActive && '!text-bg-base',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {Icon && <Icon className="size-4 shrink-0 stroke-[1.5]" />}
                    <span>{t(name)}</span>
                  </Link>
                </li>
              );
            })}

            <li
              className={cn(
                'absolute -z-[1] bg-text-primary border-b-2 border-b-accent-primary rounded-full opacity-0',
                'transition-all',
                hasAnyActive && 'opacity-100',
              )}
              role="presentation"
              style={{
                top: 'anchor(top)',
                left: 'anchor(left)',
                width: 'anchor-size(width)',
                height: 'anchor-size(height)',
                positionAnchor: activePathAnchorName,
              }}
            />
          </ul>
        </nav>
      );
    }
  : () => {
      const { t } = useTranslation();
      const { pathname } = useLocation();
      const { menuItems, pathMap } = useNavMenu();

      const activePath = useMemo(() => {
        return (
          Object.keys(pathMap).find((x: string) =>
            pathMap[x].some((y: string) => matchesPath(pathname, y)),
          ) || pathname
        );
      }, [pathname, pathMap]);

      return (
        <nav>
          <ul className="flex items-center p-1 rounded-full">
            {menuItems.map(({ path, name, icon: Icon, ...props }) => {
              const isActive = path === activePath;

              return (
                <li key={path}>
                  <Link
                    {...props}
                    to={path}
                    className={cn(
                      'h-10 px-4 text-base inline-flex items-center justify-center gap-2',
                      'hover:text-current focus-visible:text-current rounded-full transition-all',
                      isActive &&
                        '!text-bg-base bg-text-primary border-b-2 border-b-accent-primary',
                    )}
                    aria-label={t(name)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {Icon && <Icon className="size-4 shrink-0 stroke-[1.5]" />}
                    <span>{t(name)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      );
    };

export default GlobalNavbar;
