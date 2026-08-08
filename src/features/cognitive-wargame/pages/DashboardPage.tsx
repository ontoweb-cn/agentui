/**
 * DashboardPage — 推演总览（P3.4-1 重写）。
 *
 * 布局：指标卡片行（想定总数/进行中/已完成/告警数）
 *      + Recharts 得分趋势图 + G6 关系图拓扑
 *      + 最近想定列表。
 *
 * 趋势图与关系图取最近一个想定的数据；无想定时展示空状态。
 */
import { EmptyCard } from '@/components/empty/empty';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, type KGRelation, type Metrics } from '../api';
import GraphView from '../components/GraphView';
import MetricsChart from '../components/MetricsChart';
import WargameSectionLayout from '../components/section-menu';
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

const StatCard: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base font-normal text-text-secondary">
        {label}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <span className="text-3xl font-semibold">{value}</span>
    </CardContent>
  </Card>
);

const ResourceSummaryCard: React.FC<{
  title: string;
  value: string | number;
  description: string;
  to?: string;
}> = ({ title, value, description, to }) => {
  const content = (
    <Card className="h-full transition-colors hover:border-accent-primary">
      <CardHeader>
        <CardTitle className="text-base font-normal text-text-secondary">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
};

const DashboardPage: React.FC = () => {
  const { scenarios, loading, anomalies, fetchScenarios } = useWargameStore();
  const [trend, setTrend] = useState<Metrics[]>([]);
  const [relations, setRelations] = useState<KGRelation[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [skillCount, setSkillCount] = useState<number | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);

  useEffect(() => {
    fetchScenarios(10, 0);
  }, [fetchScenarios]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getSkillCategories().catch(() => null),
      api.getTools().catch(() => null),
    ]).then(([skills, tools]) => {
      if (cancelled) return;
      setSkillCount(skills?.total ?? null);
      setToolCount(tools?.total ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 取最近一个想定的态势趋势 + 关系图
  const firstId = scenarios[0]?.id;
  useEffect(() => {
    if (!firstId) {
      setTrend([]);
      setRelations([]);
      return;
    }
    let cancelled = false;
    setTrendLoading(true);
    Promise.all([
      api.getMetricsHistory(firstId).catch(() => [] as Metrics[]),
      api.getKGRelations(firstId).catch(() => [] as KGRelation[]),
    ]).then(([h, r]) => {
      if (cancelled) return;
      setTrend(h);
      setRelations(r);
      setTrendLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [firstId]);

  const total = scenarios.length;
  const running = scenarios.filter((s) => s.status === 'running').length;
  const completed = scenarios.filter((s) => s.status === 'completed').length;

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.dashboard.title')}
        </h1>
        <Button variant="outline" onClick={() => fetchScenarios(10, 0)}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t('cognitiveWargame.dashboard.totalScenarios')}
          value={total}
        />
        <StatCard
          label={t('cognitiveWargame.dashboard.runningScenarios')}
          value={running}
        />
        <StatCard
          label={t('cognitiveWargame.dashboard.completedScenarios')}
          value={completed}
        />
        <StatCard
          label={t('cognitiveWargame.dashboard.anomalyAlerts')}
          value={anomalies.length}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 得分趋势 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.dashboard.scoreTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Spin spinning={trendLoading}>
              {trend.length === 0 ? (
                <EmptyCard
                  title={t('cognitiveWargame.common.empty')}
                  className="w-full"
                />
              ) : (
                <MetricsChart history={trend} height={280} />
              )}
            </Spin>
          </CardContent>
        </Card>

        {/* 关系图拓扑 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.dashboard.networkTopology')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {relations.length === 0 ? (
              <EmptyCard
                title={t('cognitiveWargame.common.empty')}
                className="w-full"
              />
            ) : (
              <div className="h-72 w-full">
                <GraphView relations={relations} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.dashboard.recentScenarios')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {scenarios.length === 0 ? (
              <EmptyCard
                title={t('cognitiveWargame.common.empty')}
                className="w-full"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('cognitiveWargame.scenario.name')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.status')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.scenario.redForce')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.scenario.blueForce')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenarios.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.status ?? '-'}</TableCell>
                      <TableCell>{s.red_force ?? '-'}</TableCell>
                      <TableCell>{s.blue_force ?? '-'}</TableCell>
                      <TableCell>
                        <Link
                          className="text-text-primary underline"
                          to={WargamePath.scenarioDetail(s.id)}
                        >
                          {t('cognitiveWargame.common.viewDetail')}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Spin>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t('cognitiveWargame.resource.title')}
          </h2>
          <Link
            to="/cognitive-wargame/resources"
            className="text-sm text-text-secondary underline"
          >
            {t('cognitiveWargame.common.viewDetail')}
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ResourceSummaryCard
            title={t('cognitiveWargame.resource.skills')}
            value={skillCount ?? '-'}
            description={t('cognitiveWargame.resource.skillsSummary')}
            to="/cognitive-wargame/resources"
          />
          <ResourceSummaryCard
            title={t('cognitiveWargame.resource.tools')}
            value={toolCount ?? '-'}
            description={t('cognitiveWargame.resource.toolsSummary')}
            to="/cognitive-wargame/resources"
          />
          <ResourceSummaryCard
            title={t('cognitiveWargame.resource.modelConfig')}
            value={t('cognitiveWargame.resource.pending')}
            description={t('cognitiveWargame.resource.modelConfigSummary')}
          />
        </div>
      </section>
      </div>
    </WargameSectionLayout>
  );
};

export default DashboardPage;
