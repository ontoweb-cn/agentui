/**
 * 统一认证（intellect-auth）内置页布局。
 *
 * 能力门控：features['intellect-auth'] !== true 时不发起任何 hiedu 业务请求。
 * 权限门控：/api/me 成功后按 permissions 过滤二级导航；后端仍是最终裁决。
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';

import { Button } from '@/components/ui/button';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { cn } from '@/lib/utils';
import { Routes } from '@/constants/routes';
import {
  api,
  isApiError,
  errorMessage,
  UNAUTHORIZED_EVENT,
  type Me,
} from '@/services/hiedu/api';
import { hasPermission } from '@/services/hiedu/format';
import {
  ErrorState,
  ForbiddenState,
  LoadingState,
} from './components/state';

interface NavItem {
  to: string;
  label: string;
  permission?: string;
  anyOf?: string[];
  /** 需要校级数据范围（与 hiedu 独立门户的 requireOrgScope 一致）。 */
  orgScope?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: Routes.IntellectAuthOverview, label: '工作台' },
  { to: Routes.IntellectAuthUnits, label: '组织架构', permission: 'unit:read' },
  {
    to: Routes.IntellectAuthRoles,
    label: '角色与授权',
    permission: 'role:admin',
    orgScope: true,
  },
  {
    to: Routes.IntellectAuthApps,
    label: '应用管理',
    permission: 'role:admin',
    orgScope: true,
  },
  { to: Routes.IntellectAuthPersons, label: '人员管理', permission: 'person:read' },
  {
    to: Routes.IntellectAuthProjects,
    label: '项目与邀请',
    anyOf: ['project:read', 'project:read:own'],
  },
  { to: Routes.IntellectAuthClasses, label: '班级管理', permission: 'class:read' },
  { to: Routes.IntellectAuthDicts, label: '数据字典', permission: 'dict:read' },
  { to: Routes.IntellectAuthJobs, label: '同步任务', permission: 'sync:write' },
  {
    to: Routes.IntellectAuthReconcile,
    label: '对账看板',
    permission: 'reconcile:read',
  },
  { to: Routes.IntellectAuthAuditLogs, label: '审计日志', permission: 'audit:read' },
  { to: Routes.IntellectAuthImports, label: '导入导出', permission: 'system:import' },
];

export function FeatureDisabledState() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-base font-medium text-text-primary">
        统一认证能力未启用
      </p>
      <p className="max-w-md text-sm text-text-secondary">
        当前部署未开启 <code className="rounded bg-bg-secondary px-1">intellect-auth</code>
        能力，或断言代理配置不完整。请联系部署管理员开启
        <code className="mx-1 rounded bg-bg-secondary px-1">
          INTELLECT_AUTH_ENABLED
        </code>
        并完成密钥配置。
      </p>
    </div>
  );
}

function visibleNav(me: Me): NavItem[] {
  const orgScope = me.scopes.some((scope) => scope.all);
  return NAV_ITEMS.filter((item) => {
    if (item.orgScope && !orgScope) return false;
    if (item.anyOf) {
      return item.anyOf.some((permission) =>
        hasPermission(me.permissions, permission),
      );
    }
    return item.permission
      ? hasPermission(me.permissions, item.permission)
      : true;
  });
}

export default function IntellectAuthLayout() {
  const { features, isLoading: featuresLoading } = useFeatureFlags();
  const enabled = features?.['intellect-auth'] === true;

  const meQuery = useQuery({
    queryKey: ['hiedu', 'me'],
    queryFn: async () => (await api.me()).data,
    enabled,
    retry: false,
  });

  // 任一业务请求返回 401：重新校验会话，布局会切到“未登录/会话失效”状态。
  const refetchMe = meQuery.refetch;
  useEffect(() => {
    if (!enabled) return;
    const onUnauthorized = () => void refetchMe();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [enabled, refetchMe]);

  if (featuresLoading) {
    return <LoadingState label="正在查询统一认证能力…" />;
  }

  if (!enabled) {
    return <FeatureDisabledState />;
  }

  if (meQuery.isLoading) {
    return <LoadingState label="正在校验统一认证会话…" />;
  }

  if (meQuery.error) {
    const err = meQuery.error;
    if (isApiError(err) && err.status === 401) {
      return (
        <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base font-medium text-text-primary">
            未登录或会话已失效
          </p>
          <p className="text-sm text-text-secondary">
            请重新登录 AgentUI 后再访问统一认证。
          </p>
          <Button asLink to={Routes.Login}>
            前往登录
          </Button>
        </div>
      );
    }
    if (isApiError(err) && err.status === 403) {
      return (
        <ForbiddenState
          message="无权限访问统一认证"
          detail="当前账号已登录，但没有访问管理门户的权限。"
        />
      );
    }
    return (
      <ErrorState
        message={errorMessage(err)}
        onRetry={() => void meQuery.refetch()}
      />
    );
  }

  const me = meQuery.data;
  if (!me) {
    return <ErrorState message="无法获取当前会话" />;
  }

  const nav = visibleNav(me);

  return (
    <div className="flex size-full min-w-0 flex-col gap-3 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-button bg-bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">统一认证</p>
          <p className="text-xs text-text-secondary">
            {me.org_code} · {me.person.name}
            {me.pii.read ? ' · PII 可查看' : ''}
            {me.bound ? '' : ' · 未绑定'}
          </p>
        </div>
      </header>

      <nav
        className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border-button bg-bg-card p-1"
        aria-label="统一认证二级导航"
      >
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary',
                isActive && 'bg-bg-primary font-medium text-text-primary',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        <Outlet context={me} />
      </div>
    </div>
  );
}
