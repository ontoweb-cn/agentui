/**
 * ScenarioPlaybackView 历史回放（共享视图组件）。
 *
 * 供导航台（导演台）Tab 与独立 PlaybackPage 复用；
 * scenarioId 由父级传入，不再从 useParams 读取，也不自带想定选择器。
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
import { Spin } from '@/components/ui/spin';
import { api, type Playback, type RoundEvent } from '../api';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';

export const ScenarioPlaybackView: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const [round, setRound] = useState<number>(1);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlayback = useCallback(
    async (scenarioIdToLoad: string, roundNum: number) => {
      if (!scenarioIdToLoad || roundNum < 1) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.getPlayback(scenarioIdToLoad, roundNum);
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

  // 切换想定时重置回合并清空旧数据
  useEffect(() => {
    setRound(1);
    setPlayback(null);
  }, [scenarioId]);

  useEffect(() => {
    if (scenarioId) {
      loadPlayback(scenarioId, round);
    }
  }, [scenarioId, round, loadPlayback]);

  const handlePrevRound = () => {
    if (round > 1) setRound(round - 1);
  };

  const handleNextRound = () => {
    setRound(round + 1);
  };

  const events: RoundEvent[] = playback?.events ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.playback.title')}
        </h1>
        <Button
          variant="outline"
          onClick={() => scenarioId && loadPlayback(scenarioId, round)}
          disabled={!scenarioId || loading}
        >
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      {/* 回合选择器（想定由父级传入） */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-end">
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

      {error && <p className="text-sm text-text-error">{error}</p>}

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
                  scenarioId
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
                        <Badge variant="secondary">
                          {ev.action ?? ev.phase}
                        </Badge>
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
    </div>
  );
};

export default ScenarioPlaybackView;
