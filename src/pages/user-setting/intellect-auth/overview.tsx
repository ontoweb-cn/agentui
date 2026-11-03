import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/services/hiedu/api';
import {
  formatCount,
  formatDateTime,
  statusLabel,
} from '@/services/hiedu/format';
import { PageHeader, Panel } from './components/page';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from './components/state';
import { useMe } from './hooks';

const CARDS: Array<{
  key: 'units' | 'persons' | 'projects' | 'classes' | 'pending_jobs' | 'manual_jobs';
  label: string;
  note: string;
}> = [
  { key: 'units', label: '组织单元', note: '范围内的部门与团队' },
  { key: 'persons', label: '人员档案', note: '范围内的人员总数' },
  { key: 'projects', label: '项目', note: '教学与科研项目' },
  { key: 'classes', label: '班级', note: '扁平班级登记' },
  { key: 'pending_jobs', label: '待投影任务', note: '等待同步到 IdP' },
  { key: 'manual_jobs', label: '人工队列', note: '需人工处理的任务' },
];

export default function OverviewPage() {
  const me = useMe();
  const query = useQuery({
    queryKey: ['hiedu', 'dashboard-summary'],
    queryFn: async () => (await api.dashboardSummary()).data,
    retry: false,
  });

  const summary = query.data;
  const reconcile = summary?.reconcile ?? null;
  const scopes = summary?.scopes ?? me.scopes;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="工作台"
        description="按当前数据范围汇总的组织与人员概况。"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            刷新
          </Button>
        }
      />

      {query.isLoading ? <LoadingState label="正在加载工作台数据…" /> : null}
      {!query.isLoading && query.error ? (
        <ErrorState
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {!query.isLoading && !query.error && summary ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {CARDS.map((card) => (
              <article
                key={card.key}
                className="rounded-lg border border-border-button bg-bg-card p-4"
              >
                <span className="text-xs text-text-secondary">{card.label}</span>
                <strong className="mt-1 block text-2xl font-semibold text-text-primary">
                  {formatCount(summary[card.key])}
                </strong>
                <span className="mt-1 block text-xs text-text-tertiary">
                  {card.note}
                </span>
              </article>
            ))}
          </section>

          <Panel
            title="对账状态"
            extra={
              reconcile?.status ? (
                <StatusBadge status={reconcile.status} />
              ) : null
            }
          >
            {reconcile ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <span className="block text-xs text-text-secondary">状态</span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {statusLabel(reconcile.status)}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-text-secondary">差异数</span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {formatCount(reconcile.diffs)}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-text-secondary">最近运行</span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {formatDateTime(reconcile.last_run_at ?? reconcile.last_run)}
                  </strong>
                </div>
              </div>
            ) : (
              <EmptyState
                title="暂无对账数据"
                description="后端尚未返回对账状态。"
              />
            )}
          </Panel>

          <Panel title="当前数据范围">
            {scopes.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {scopes.map((scope, index) => (
                  <li
                    key={`${scope.unit_id ?? 'all'}-${scope.path ?? index}`}
                    className="flex flex-wrap items-center gap-2 rounded-md bg-bg-secondary px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-text-primary">
                      {scope.all ? '全校' : scope.name}
                    </span>
                    {scope.path ? (
                      <code className="text-xs text-text-secondary">
                        {scope.path}
                      </code>
                    ) : null}
                    {scope.all ? null : (
                      <span className="text-xs text-text-tertiary">
                        {scope.include_descendants ? '含下级部门' : '仅本部门'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="无数据范围"
                description="当前账号未分配任何部门范围。"
              />
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
