/**
 * ScenarioDetailPage — 想定详情。
 *
 * 展示想定描述信息与回合列表，提供执行推演入口。
 */
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
import { api } from '../api';
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

const ScenarioDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { currentScenario, loading, loadScenario } = useWargameStore();
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (id) loadScenario(id);
  }, [id, loadScenario]);

  const handleExecute = async () => {
    if (!id) return;
    setExecuting(true);
    try {
      await api.executeScenario(id, currentScenario?.rounds_limit);
      await loadScenario(id);
    } finally {
      setExecuting(false);
    }
  };

  const roundsCompleted = currentScenario?.rounds_completed ?? 0;
  const roundsLimit = currentScenario?.rounds_limit ?? 0;
  const rounds = Array.from(
    { length: roundsCompleted },
    (_, i) => i + 1,
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.scenario.detailTitle')}
        </h1>
        <div className="flex gap-2">
          <Link to="/cognitive-wargame/scenarios">
            <Button variant="outline">
              {t('cognitiveWargame.common.back')}
            </Button>
          </Link>
          <Button onClick={handleExecute} disabled={executing || !id}>
            {t('cognitiveWargame.common.execute')}
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {currentScenario?.name ?? '-'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              {t('cognitiveWargame.scenario.description')}:
              {currentScenario?.description ?? '-'}
            </div>
            <div>
              {t('cognitiveWargame.common.status')}:
              {currentScenario?.status ?? '-'}
            </div>
            <div>
              {t('cognitiveWargame.scenario.redForce')}:
              {currentScenario?.red_force ?? '-'}
            </div>
            <div>
              {t('cognitiveWargame.scenario.blueForce')}:
              {currentScenario?.blue_force ?? '-'}
            </div>
            <div>
              {t('cognitiveWargame.scenario.roundsLimit')}:{roundsLimit}
            </div>
            <div>
              {t('cognitiveWargame.scenario.roundsCompleted')}:
              {roundsCompleted}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.scenario.roundList')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rounds.length === 0 ? (
              <div className="text-text-secondary">
                {t('cognitiveWargame.common.empty')}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('cognitiveWargame.common.round')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rounds.map((r) => (
                    <TableRow key={r}>
                      <TableCell>{r}</TableCell>
                      <TableCell>
                        <Link
                          className="text-text-primary underline"
                          to={WargamePath.roundView(id ?? '')}
                        >
                          {t('cognitiveWargame.common.viewDetail')}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Spin>
    </div>
  );
};

export default ScenarioDetailPage;
