/**
 * PlaybackPage — 历史回放（P3.4-3）。
 *
 * 布局：顶部想定选择 + 回合选择（含 prev/next）+ 主体事件时间轴。
 * 调用 api.getPlayback(scenarioId, round) 获取指定回合的 bi-temporal 快照事件。
 */
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spin } from '@/components/ui/spin';
import { api, type Playback, type RoundEvent } from '../api';
import WargameSectionLayout from '../components/section-menu';
import { WargameRoutes } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

const PlaybackPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { scenarios, fetchScenarios } = useWargameStore();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(id ?? '');
  const [round, setRound] = useState<number>(1);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarios(50, 0);
  }, [fetchScenarios]);

  // URL 有 id 时同步到选中想定
  useEffect(() => {
    if (id && id !== selectedScenarioId) {
      setSelectedScenarioId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadPlayback = useCallback(
    async (scenarioId: string, roundNum: number) => {
      if (!scenarioId || roundNum < 1) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.getPlayback(scenarioId, roundNum);
        setPlayback(data);
      } catch (err) {
        setPlayback(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedScenarioId) {
      loadPlayback(selectedScenarioId, round);
    }
  }, [selectedScenarioId, round, loadPlayback]);

  const handleScenarioChange = (value: string) => {
    setSelectedScenarioId(value);
    setRound(1);
    setPlayback(null);
  };

  const handlePrevRound = () => {
    if (round > 1) setRound(round - 1);
  };

  const handleNextRound = () => {
    setRound(round + 1);
  };

  const events: RoundEvent[] = playback?.events ?? [];

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.playback.title')}
        </h1>
        <Button
          variant="outline"
          onClick={() =>
            selectedScenarioId && loadPlayback(selectedScenarioId, round)
          }
          disabled={!selectedScenarioId || loading}
        >
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      {/* 顶部控制栏：想定选择 + 回合选择 */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label>{t('cognitiveWargame.playback.selectScenario')}</Label>
            <Select
              value={selectedScenarioId}
              onValueChange={handleScenarioChange}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t('cognitiveWargame.common.selectScenario')}
                />
              </SelectTrigger>
              <SelectContent>
                {scenarios.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.playback.selectRound')}</Label>
              <Input
                type="number"
                min={1}
                value={round}
                onChange={(e) =>
                  setRound(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-24"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrevRound}
              disabled={round <= 1 || loading}
              title={t('cognitiveWargame.playback.prevRound')}
            >
              ←
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNextRound}
              disabled={loading}
              title={t('cognitiveWargame.playback.nextRound')}
            >
              →
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-text-error">{error}</p>
      )}

      {/* 事件时间轴 */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.playback.eventTimeline')} ·{' '}
            {t('cognitiveWargame.common.round')} {round}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {events.length === 0 ? (
              <EmptyCard
                title={
                  selectedScenarioId
                    ? t('cognitiveWargame.playback.noEvents')
                    : t('cognitiveWargame.common.selectScenario')
                }
                className="w-full"
              />
            ) : (
              <ScrollArea className="h-[480px]">
                <ol className="flex flex-col gap-3">
                  {events.map((ev, idx) => (
                    <li
                      key={`${ev.timestamp ?? idx}-${idx}`}
                      className="rounded border border-border-button p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{ev.action ?? ev.phase}</Badge>
                        {ev.actor && (
                          <span className="text-text-secondary">
                            {t('cognitiveWargame.round.actor')}: {ev.actor}
                          </span>
                        )}
                        {ev.timestamp && (
                          <span className="text-xs text-text-secondary">
                            {ev.timestamp}
                          </span>
                        )}
                      </div>
                      {ev.content && (
                        <p className="mt-1 text-sm text-text-secondary">
                          {ev.content}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            )}
          </Spin>
        </CardContent>
      </Card>

      {!selectedScenarioId && (
        <div className="text-center">
          <Link
            to={WargameRoutes.Scenarios}
            className="text-text-primary underline"
          >
            {t('cognitiveWargame.scenario.listTitle')} →
          </Link>
        </div>
      )}
      </div>
    </WargameSectionLayout>
  );
};

export default PlaybackPage;
