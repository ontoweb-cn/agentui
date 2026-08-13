import { cn } from '@/lib/utils';
import {
  BarChart3,
  ClipboardCheck,
  FileBarChart,
  FileCode2,
  GitGraph,
  LayoutDashboard,
  PackageSearch,
  PlaySquare,
  ScrollText,
  Settings,
  Settings2,
  SlidersHorizontal,
  Tags,
  Users,
  Wrench,
} from 'lucide-react';
import type { ComponentType, PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { WargameRoutes } from '../routes';

type SectionMenuChild = {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
};

type SectionMenuItem = SectionMenuChild & {
  children?: SectionMenuChild[];
};

export default function WargameSectionLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = getActiveSection(pathname);
  const items: SectionMenuItem[] = [
    {
      id: 'overview',
      label: t('cognitiveWargame.sectionMenu.overviewDashboard', '总览'),
      path: WargameRoutes.Dashboard,
      icon: LayoutDashboard,
    },
    {
      id: 'agents',
      label: t('cognitiveWargame.sectionMenu.agents', 'Agent 管理'),
      path: WargameRoutes.Agents,
      icon: Users,
      children: [
        {
          id: 'agent-list',
          label: t('cognitiveWargame.sectionMenu.agentList', 'Agent 列表'),
          path: WargameRoutes.Agents,
          icon: Users,
        },
        {
          id: 'agent-types',
          label: t('cognitiveWargame.sectionMenu.agentTypes', '类型字典'),
          path: WargameRoutes.AgentTypes,
          icon: Tags,
        },
      ],
    },
    {
      id: 'resources',
      label: t('cognitiveWargame.sectionMenu.resources', '资源'),
      path: WargameRoutes.ResourceSkills,
      icon: PackageSearch,
      children: [
        {
          id: 'resource-skills',
          label: t('cognitiveWargame.resource.skills', 'Skills'),
          path: WargameRoutes.ResourceSkills,
          icon: FileCode2,
        },
        {
          id: 'resource-tools',
          label: t('cognitiveWargame.resource.tools', 'Tools'),
          path: WargameRoutes.ResourceTools,
          icon: Wrench,
        },
        {
          id: 'resource-models',
          label: t('cognitiveWargame.resource.modelConfig', '模型配置'),
          path: WargameRoutes.ResourceModels,
          icon: Settings2,
        },
      ],
    },
    {
      id: 'scenarios',
      label: t('cognitiveWargame.sectionMenu.scenarios'),
      path: WargameRoutes.Scenarios,
      icon: ScrollText,
      children: [
        {
          id: 'scenario-list',
          label: t('cognitiveWargame.sectionMenu.scenarioManagement', '想定管理'),
          path: WargameRoutes.Scenarios,
          icon: ScrollText,
        },
        {
          id: 'scenario-approvals',
          label: t('cognitiveWargame.sectionMenu.approvals', '想定审批'),
          path: WargameRoutes.Approvals,
          icon: ClipboardCheck,
        },
      ],
    },
    {
      id: 'director',
      label: t('cognitiveWargame.sectionMenu.director', '推演监控/导演台'),
      path: WargameRoutes.Rounds,
      icon: SlidersHorizontal,
      children: [
        {
          id: 'director-playback',
          label: t('cognitiveWargame.sectionMenu.playback', '历史回放'),
          path: WargameRoutes.Playback,
          icon: PlaySquare,
        },
        {
          id: 'director-metrics',
          label: t('cognitiveWargame.sectionMenu.metrics', '态势分析'),
          path: WargameRoutes.Metrics,
          icon: BarChart3,
        },
        {
          id: 'director-kg',
          label: t('cognitiveWargame.sectionMenu.kg', '知识图谱'),
          path: WargameRoutes.KG,
          icon: GitGraph,
        },
        {
          id: 'director-reports',
          label: t('cognitiveWargame.sectionMenu.reports', '评估报告'),
          path: WargameRoutes.Reports,
          icon: FileBarChart,
        },
      ],
    },
    {
      id: 'settings',
      label: t('cognitiveWargame.sectionMenu.settings'),
      path: WargameRoutes.Settings,
      icon: Settings,
    },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border-button px-3 py-6">
        <nav className="space-y-2" aria-label={t('cognitiveWargame.sectionMenu.label')}>
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <div key={item.id}>
                <Link
                  to={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex min-h-10 items-center gap-2 rounded px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-input hover:text-text-primary',
                    isActive && 'bg-bg-input font-medium text-text-primary',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
                {item.children && (
                  <div className="ml-5 mt-1 space-y-1 border-l border-border-button pl-3">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      const childActive = isActivePath(pathname, child.path);
                      return (
                        <Link
                          key={child.id}
                          to={child.path}
                          aria-current={childActive ? 'page' : undefined}
                          className={cn(
                            'flex min-h-8 items-center gap-2 rounded px-2 py-1.5 text-xs text-text-disabled transition-colors hover:bg-bg-input/70 hover:text-text-primary',
                            childActive && 'bg-bg-input/80 font-medium text-text-primary',
                          )}
                        >
                          <ChildIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function getActiveSection(pathname: string) {
  if (pathname.startsWith(WargameRoutes.Settings)) return 'settings';
  if (pathname.startsWith(WargameRoutes.Agents) || pathname.startsWith(WargameRoutes.AgentTypes)) return 'agents';
  if (pathname.startsWith(WargameRoutes.Resources)) return 'resources';
  if (pathname.startsWith(WargameRoutes.Scenarios) || pathname.startsWith(WargameRoutes.Approvals)) {
    return 'scenarios';
  }
  if (
    pathname.startsWith(WargameRoutes.Rounds) ||
    pathname.startsWith(WargameRoutes.Playback) ||
    pathname.startsWith(WargameRoutes.Metrics) ||
    pathname.startsWith(WargameRoutes.KG) ||
    pathname.startsWith(WargameRoutes.Reports)
  ) {
    return 'director';
  }
  return 'overview';
}

function isActivePath(pathname: string, path: string) {
  if (path === WargameRoutes.Dashboard) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}
