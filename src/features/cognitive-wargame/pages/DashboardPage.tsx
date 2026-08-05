/**
 * DashboardPage — 总览仪表盘。
 *
 * 顶部统计卡片（想定总数 / 进行中 / 已完成），下方为最近想定列表。
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
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useEffect } from 'react';
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

const DashboardPage: React.FC = () => {
  const { scenarios, loading, fetchScenarios } = useWargameStore();

  useEffect(() => {
    fetchScenarios(10, 0);
  }, [fetchScenarios]);

  const total = scenarios.length;
  const running = scenarios.filter((s) => s.status === 'running').length;
  const completed = scenarios.filter((s) => s.status === 'completed').length;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.dashboard.title')}
        </h1>
        <Button variant="outline" onClick={() => fetchScenarios(10, 0)}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
    </div>
  );
};

export default DashboardPage;
