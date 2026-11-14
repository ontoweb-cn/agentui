/**
 * 「资源」页（M0 骨架）。
 *
 * 资源类型先用静态清单占位；M1 起由 `/taxonomies` + `taxonomy.yaml` 驱动。
 * 能力关闭时只显示禁用态，不发起 `/api/bff/aihub/*` 请求。
 */

import { useQuery } from '@tanstack/react-query';
import { Navigate, NavLink, useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Routes } from '@/constants/routes';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { cn } from '@/lib/utils';
import { fetchAihubMeta } from './api';

const RESOURCE_TYPES = [
  { key: 'models', label: '模型', description: '预训练模型与算法应用' },
  { key: 'datasets', label: '数据', description: '数据集与语料' },
  { key: 'agents', label: '智能体', description: '可对话的 Agent' },
  { key: 'skills', label: '技能', description: '可复用的技能包' },
  { key: 'tools', label: '工具', description: '工具与函数目录' },
  { key: 'mcps', label: 'MCP', description: 'MCP Server 注册表' },
  { key: 'solutions', label: '解决方案', description: '多资产组合模板' },
  { key: 'apps', label: 'APP', description: '可发布的 Web 应用' },
] as const;

function FeatureDisabledState() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-base font-medium text-text-primary">
        AIHub 能力未启用
      </p>
      <p className="max-w-md text-sm text-text-secondary">
        当前部署未开启 <code className="rounded bg-bg-secondary px-1">aihub</code>{' '}
        能力，或代理/断言配置不完整。请联系部署管理员设置
        <code className="mx-1 rounded bg-bg-secondary px-1">AIHUB_ENABLED</code>
        并完成密钥配置。
      </p>
    </div>
  );
}

export default function AihubResourcesPage() {
  const { type } = useParams();
  const activeType = RESOURCE_TYPES.some((item) => item.key === type)
    ? type
    : undefined;
  const { features, isLoading } = useFeatureFlags();
  const enabled = features?.aihub === true;

  const meta = useQuery({
    queryKey: ['aihub-meta'],
    enabled,
    retry: 1,
    queryFn: async () => {
      const res = await fetchAihubMeta();
      if (res?.data?.code !== 0) {
        throw new Error(res?.data?.message ?? 'Failed to fetch aihub meta');
      }
      return res.data.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center p-8 text-sm text-text-secondary">
        加载中…
      </div>
    );
  }
  if (!enabled) {
    return <FeatureDisabledState />;
  }
  if (type && !activeType) {
    return <Navigate to={Routes.Resources} replace />;
  }

  return (
    <div className="flex size-full flex-col gap-6 overflow-auto p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text-primary">资源</h1>
        <p className="text-sm text-text-secondary">
          组织级 AI 资产统一入口。M0 仅验证能力开关与代理链路，市场列表在 M1 开放。
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        <NavLink
          to={Routes.Resources}
          end
          className={({ isActive }) =>
            cn(
              'rounded-md border border-border px-3 py-1.5 text-sm',
              isActive
                ? 'bg-bg-secondary font-medium text-text-primary'
                : 'text-text-secondary hover:bg-bg-secondary',
            )
          }
        >
          全部
        </NavLink>
        {RESOURCE_TYPES.map((item) => (
          <NavLink
            key={item.key}
            to={`${Routes.Resources}/${item.key}`}
            className={({ isActive }) =>
              cn(
                'rounded-md border border-border px-3 py-1.5 text-sm',
                isActive
                  ? 'bg-bg-secondary font-medium text-text-primary'
                  : 'text-text-secondary hover:bg-bg-secondary',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {RESOURCE_TYPES.map((item) => (
          <NavLink
            key={item.key}
            to={`${Routes.Resources}/${item.key}`}
            className={cn(
              'rounded-lg border border-border p-4 transition-colors hover:bg-bg-secondary',
              activeType === item.key && 'bg-bg-secondary',
            )}
          >
            <div className="text-sm font-medium text-text-primary">
              {item.label}
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              {item.description}
            </div>
            <div className="mt-3 text-xs text-text-secondary">
              {activeType === item.key ? 'M1 开放列表' : '查看'}
            </div>
          </NavLink>
        ))}
      </section>

      <section className="rounded-lg border border-border p-4">
        <div className="mb-2 text-sm font-medium text-text-primary">链路状态</div>
        {meta.isLoading ? (
          <p className="text-sm text-text-secondary">正在连接 aihub…</p>
        ) : meta.error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-text-secondary">
              aihub 不可达：{(meta.error as Error).message}
            </p>
            <Button variant="outline" size="sm" onClick={() => meta.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-text-secondary">服务</dt>
              <dd className="text-text-primary">
                {meta.data?.service} {meta.data?.version}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-secondary">主体</dt>
              <dd className="truncate text-text-primary">{meta.data?.subject}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-secondary">存储</dt>
              <dd className="text-text-primary">{meta.data?.storage}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-secondary">kid</dt>
              <dd className="text-text-primary">{meta.data?.kid}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
