import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { LucideHouse } from 'lucide-react';

import { collectNav } from '@/features/_registry';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { supportsCssAnchor } from '@/utils/css-support';

// Match on path-segment boundaries, not a loose substring, so e.g.
// "/user-setting/chat-channel" does not match the "/chat" tab.
const matchesPath = (pathname: string, candidate: string) =>
  pathname === candidate || pathname.startsWith(`${candidate}/`);

const staticMenuItems = [
  { path: Routes.Root, name: 'header.Root', icon: LucideHouse },
];

const featureNavItems = collectNav().map((item) => ({
  path: item.path,
  name: item.labelKey,
  ...(item.icon ? { icon: item.icon } : {}),
  ...(item.testId ? { 'data-testid': item.testId } : {}),
}));

const menuItems = [...staticMenuItems, ...featureNavItems];

const PathMap = menuItems.reduce<Record<string, string[]>>((acc, item) => {
  const featureItem = collectNav().find((f) => f.path === item.path);
  acc[item.path] = featureItem?.pathMap ?? [item.path];
  return acc;
}, {});

const GlobalNavbar = supportsCssAnchor
  ? () => {
      const { t } = useTranslation();
      const { pathname } = useLocation();
      const navbarAnchorNamePrefix = useId().replace(/:/g, '');

      const activePath = useMemo(() => {
        return (
          Object.keys(PathMap).find((x: string) =>
            PathMap[x as keyof typeof PathMap].some((y: string) =>
              matchesPath(pathname, y),
            ),
          ) || pathname
        );
      }, [pathname]);

      const activePathAnchorName = `--${navbarAnchorNamePrefix}${activePath === Routes.Root ? '-root' : activePath.replace('/', '-')}`;

      const hasAnyActive = useMemo(
        () => menuItems.some(({ path }) => path === activePath),
        [activePath],
      );

      return (
        <nav>
          <ul className="relative flex items-center p-1 bg-bg-card rounded-full border border-border-button">
            {menuItems.map(({ path, name, icon: Icon, ...props }) => {
              const isActive = path === activePath;
              const anchorName = `--${navbarAnchorNamePrefix}${path === Routes.Root ? '-root' : path.replace('/', '-')}`;

              return (
                <li key={path} className="relative" style={{ anchorName }}>
                  <Link
                    {...props}
                    to={path}
                    className={cn(
                      'h-10 px-6 text-base inline-flex items-center justify-center',
                      'hover:text-current focus-visible:text-current rounded-full transition-all',
                      isActive && '!text-bg-base',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {Icon && <Icon className="size-6 stroke-[1.5]" />}
                    <span className={cn(Icon && 'sr-only')}>{t(name)}</span>
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

      const activePath = useMemo(() => {
        return (
          Object.keys(PathMap).find((x: string) =>
            PathMap[x as keyof typeof PathMap].some((y: string) =>
              matchesPath(pathname, y),
            ),
          ) || pathname
        );
      }, [pathname]);

      return (
        <nav>
          <ul className="flex items-center p-1 bg-bg-card rounded-full border border-border-button">
            {menuItems.map(({ path, name, icon: Icon, ...props }) => {
              const isActive = path === activePath;

              return (
                <li key={path}>
                  <Link
                    {...props}
                    to={path}
                    className={cn(
                      'h-10 px-6 text-base inline-flex items-center justify-center',
                      'hover:text-current focus-visible:text-current rounded-full transition-all',
                      isActive &&
                        '!text-bg-base bg-text-primary border-b-2 border-b-accent-primary',
                    )}
                    aria-label={t(name)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {Icon ? (
                      <Icon className="size-6 stroke-[1.5]" />
                    ) : (
                      <span>{t(name)}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      );
    };

export default GlobalNavbar;
