/**
 * ScenarioListPage — 想定列表。
 *
 * 使用 shadcn Table 展示分页想定列表，支持刷新。
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

const ScenarioListPage: React.FC = () => {
  const { scenarios, loading, total, fetchScenarios } = useWargameStore();

  useEffect(() => {
    fetchScenarios(20, 0);
  }, [fetchScenarios]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.scenario.listTitle')}
        </h1>
        <Button variant="outline" onClick={() => fetchScenarios(20, 0)}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.scenario.listTitle')} ({total})
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
                      {t('cognitiveWargame.scenario.description')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.status')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.scenario.roundsLimit')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.createdAt')}
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
                      <TableCell className="max-w-xs truncate">
                        {s.description ?? '-'}
                      </TableCell>
                      <TableCell>{s.status ?? '-'}</TableCell>
                      <TableCell>{s.rounds_limit ?? '-'}</TableCell>
                      <TableCell>{s.created_at ?? '-'}</TableCell>
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

export default ScenarioListPage;
