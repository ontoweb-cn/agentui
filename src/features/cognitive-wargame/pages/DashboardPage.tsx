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
import { Badge } from '@/components/ui/badge';
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
import { ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type AuthMode, type KGRelation, type Metrics } from '../api';
import GraphView from '../components/GraphView';
import MetricsChart from '../components/MetricsChart';
import WargameSectionLayout from '../components/section-menu';
import { WargamePath, WargameRoutes } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

type AgentTypeCode =
  | 'individual'
  | 'admin_organ'
  | 'political_party'
  | 'news_media'
  | 'mass';

const AGENT_TYPE_CHART_ITEMS: Array<{
  type: AgentTypeCode;
  labelKey: string;
  color: string;
}> = [
  {
    type: 'individual',
    labelKey: 'cognitiveWargame.agents.type.individual',
    color: '#2563eb',
  },
  {
    type: 'admin_organ',
    labelKey: 'cognitiveWargame.agents.type.admin_organ',
    color: '#16a34a',
  },
  {
    type: 'political_party',
    labelKey: 'cognitiveWargame.agents.type.political_party',
    color: '#dc2626',
  },
  {
    type: 'news_media',
    labelKey: 'cognitiveWargame.agents.type.news_media',
    color: '#f59e0b',
  },
  {
    type: 'mass',
    labelKey: 'cognitiveWargame.agents.type.mass',
    color: '#7c3aed',
  },
];


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
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [activeAgentCount, setActiveAgentCount] = useState<number | null>(null);
  const [archivedAgentCount, setArchivedAgentCount] = useState<number | null>(
    null,
  );
  const [agentTypeCounts, setAgentTypeCounts] = useState<
    Record<AgentTypeCode, number>
  >({
    individual: 0,
    admin_organ: 0,
    political_party: 0,
    news_media: 0,
    mass: 0,
  });

  useEffect(() => {
    fetchScenarios(10, 0);
  }, [fetchScenarios]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getSkillCategories().catch(() => null),
      api.getTools().catch(() => null),
      api.getAgents({ limit: 1 }).catch(() => null),
      api.getAgents({ status: 'active', limit: 1 }).catch(() => null),
      api.getAgents({ status: 'archived', limit: 1 }).catch(() => null),
      Promise.all(
        AGENT_TYPE_CHART_ITEMS.map(({ type }) =>
          api.getAgents({ agent_type: type, limit: 1 }).catch(() => null),
        ),
      ),
    ]).then(([
      skills,
      tools,
      agents,
      activeAgents,
      archivedAgents,
      agentTypeResults,
    ]) => {
      if (cancelled) return;
      setSkillCount(skills?.total ?? null);
      setToolCount(tools?.total ?? null);
      setAgentCount(agents?.total ?? null);
      setActiveAgentCount(activeAgents?.total ?? null);
      setArchivedAgentCount(archivedAgents?.total ?? null);
      setAgentTypeCounts(
        AGENT_TYPE_CHART_ITEMS.reduce(
          (acc, item, index) => ({
            ...acc,
            [item.type]: agentTypeResults[index]?.total ?? 0,
          }),
          {} as Record<AgentTypeCode, number>,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 探测后端认证模式（CW_AUTH_BYPASS_LAN 内网免 token 场景展示标识）
  useEffect(() => {
    let cancelled = false;
    api.getSystemHealthz().then((h) => {
      if (!cancelled) setAuthMode(h.auth_mode);
    }).catch(() => {
      // healthz 失败时不展示标识，不影响主流程
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
  const agentTypeChartData = AGENT_TYPE_CHART_ITEMS.map((item) => ({
    ...item,
    name: t(item.labelKey),
    value: agentTypeCounts[item.type],
  }));
  const hasAgentTypeData = agentTypeChartData.some((item) => item.value > 0);

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-medium">
            {t('cognitiveWargame.dashboard.title')}
          </h1>
          {authMode === 'lan_bypass' && (
            <Badge
              variant="success"
              className="gap-1"
              title={t('cognitiveWargame.auth.lanBypassTooltip')}
            >
              <ShieldCheck className="size-3" />
              {t('cognitiveWargame.auth.lanBypassBadge')}
            </Badge>
          )}
        </div>
        <Button variant="outline" onClick={() => fetchScenarios(10, 0)}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">
            {t('cognitiveWargame.dashboard.overviewTab')}
          </TabsTrigger>
          <TabsTrigger value="resources">
            {t('cognitiveWargame.dashboard.resourceTab')}
          </TabsTrigger>
          <TabsTrigger value="agents">
            {t('cognitiveWargame.dashboard.agentTab')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-4">
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

        </TabsContent>
        <TabsContent value="resources">
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

        </TabsContent>
        <TabsContent value="agents">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t('cognitiveWargame.dashboard.agentOverview')}
          </h2>
          <Link
            to={WargameRoutes.Agents}
            className="text-sm text-text-secondary underline"
          >
            {t('cognitiveWargame.common.viewDetail')}
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ResourceSummaryCard
            title={t('cognitiveWargame.dashboard.totalAgents')}
            value={agentCount ?? '-'}
            description={t('cognitiveWargame.dashboard.agentSummary')}
            to={WargameRoutes.Agents}
          />
          <ResourceSummaryCard
            title={t('cognitiveWargame.dashboard.activeAgents')}
            value={activeAgentCount ?? '-'}
            description={t('cognitiveWargame.agents.status.active')}
            to={WargameRoutes.Agents}
          />
          <ResourceSummaryCard
            title={t('cognitiveWargame.dashboard.archivedAgents')}
            value={archivedAgentCount ?? '-'}
            description={t('cognitiveWargame.agents.status.archived')}
            to={WargameRoutes.Agents}
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.dashboard.agentOverview')} /{' '}
              {t('cognitiveWargame.common.type')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasAgentTypeData ? (
              <div className="flex flex-col gap-6 xl:flex-row xl:items-center">
                <div className="h-72 min-w-0 xl:flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={agentTypeChartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={112}
                        paddingAngle={2}
                      >
                        {agentTypeChartData.map((item) => (
                          <Cell key={item.type} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col justify-center gap-3 xl:w-80 xl:shrink-0">
                  {agentTypeChartData.map((item) => (
                    <div
                      key={item.type}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate text-sm">{item.name}</span>
                      </div>
                      <span className="text-sm font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyCard
                title={t('cognitiveWargame.common.empty')}
                className="w-full"
              />
            )}
          </CardContent>
        </Card>
      </section>
        </TabsContent>
      </Tabs>
      </div>
    </WargameSectionLayout>
  );
};

export default DashboardPage;
