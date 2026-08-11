/**
 * ScenarioMetricsView 态势分析（共享视图组件）。
 *
 * 供导航台（导演台）Tab 与独立 MetricsViewPage 复用；
 * scenarioId 由父级传入，不再从 useParams 读取。
 */
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import { api, type Metrics } from '../api';
import MetricsChart from './MetricsChart';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';

const MetricCard: React.FC<{ label: string; value: number | undefined }> = ({
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
      <span className="text-2xl font-semibold">{value ?? '-'}</span>
    </CardContent>
  </Card>
);

export const ScenarioMetricsView: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { currentRound, setCurrentRound } = useWargameStore();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMetrics = useCallback(
    async (round: number) => {
      if (!scenarioId || round < 1) return;
      setLoading(true);
      try {
        const [m, h] = await Promise.all([
          api.getMetrics(scenarioId, round),
          api.getMetricsHistory(scenarioId).catch(() => [] as Metrics[]),
        ]);
        setMetrics(m);
        setHistory(h);
      } finally {
        setLoading(false);
      }
    },
    [scenarioId],
  );

  useEffect(() => {
    const initial = currentRound > 0 ? currentRound : 1;
    setCurrentRound(initial);
    loadMetrics(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId, currentRound, setCurrentRound, loadMetrics]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.metrics.title')}
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary">
            {t('cognitiveWargame.common.selectRound')}:
          </span>
          <input
            type="number"
            min={1}
            value={currentRound}
            onChange={(e) => setCurrentRound(Number(e.target.value) || 1)}
            className="w-20 rounded border border-border-button bg-bg-input px-2 py-1"
          />
          <Button
            variant="outline"
            onClick={() => loadMetrics(currentRound)}
            disabled={!scenarioId}
          >
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={t('cognitiveWargame.metrics.redScore')}
            value={metrics?.red_score}
          />
          <MetricCard
            label={t('cognitiveWargame.metrics.blueScore')}
            value={metrics?.blue_score}
          />
          <MetricCard
            label={t('cognitiveWargame.metrics.redCognitive')}
            value={metrics?.red_cognitive}
          />
          <MetricCard
            label={t('cognitiveWargame.metrics.blueCognitive')}
            value={metrics?.blue_cognitive}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.metrics.trendTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="flex h-64 items-center justify-center rounded border border-dashed border-border-button text-text-secondary">
                {t('cognitiveWargame.common.empty')}
              </div>
            ) : (
              <MetricsChart history={history} height={300} />
            )}
          </CardContent>
        </Card>
      </Spin>
    </div>
  );
};

export default ScenarioMetricsView;
