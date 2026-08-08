/**
 * MetricsViewPage — 态势分析。
 *
 * 指标卡片（红蓝得分 / 认知态势）+ 图表占位区域。
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
import MetricsChart from '../components/MetricsChart';
import WargameSectionLayout from '../components/section-menu';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

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
      <span className="text-2xl font-semibold">
        {value ?? '-'}
      </span>
    </CardContent>
  </Card>
);

const MetricsViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { currentRound, setCurrentRound } = useWargameStore();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMetrics = useCallback(
    async (round: number) => {
      if (!id || round < 1) return;
      setLoading(true);
      try {
        const [m, h] = await Promise.all([
          api.getMetrics(id, round),
          api.getMetricsHistory(id).catch(() => [] as Metrics[]),
        ]);
        setMetrics(m);
        setHistory(h);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const initial = currentRound > 0 ? currentRound : 1;
    setCurrentRound(initial);
    loadMetrics(initial);
  }, [currentRound, setCurrentRound, loadMetrics]);

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
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
            disabled={!id}
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
    </WargameSectionLayout>
  );
};

export default MetricsViewPage;
