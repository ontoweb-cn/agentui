/**
 * RoundViewPage — 回合视图。
 *
 * 顶部回合选择器，下方为该回合的事件流。
 */
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import { api, type RoundEvent } from '../api';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

const RoundViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { currentRound, setCurrentRound } = useWargameStore();
  const [events, setEvents] = useState<RoundEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRound = useCallback(
    async (round: number) => {
      if (!id || round < 1) return;
      setLoading(true);
      try {
        const playback = await api.getPlayback(id, round);
        setEvents(playback.events ?? []);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const initial = currentRound > 0 ? currentRound : 1;
    setCurrentRound(initial);
    loadRound(initial);
  }, [currentRound, setCurrentRound, loadRound]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.round.title')}
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
            onClick={() => loadRound(currentRound)}
            disabled={!id}
          >
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.round.eventStream')} -{' '}
            {t('cognitiveWargame.common.round')} {currentRound}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {events.length === 0 ? (
              <div className="text-text-secondary">
                {t('cognitiveWargame.common.empty')}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {events.map((ev, idx) => (
                  <li
                    key={`${ev.round}-${idx}`}
                    className="rounded border border-border-button p-3"
                  >
                    <div className="flex flex-wrap gap-3 text-sm text-text-secondary">
                      <span>
                        {t('cognitiveWargame.round.phase')}: {ev.phase}
                      </span>
                      {ev.actor && (
                        <span>
                          {t('cognitiveWargame.round.actor')}: {ev.actor}
                        </span>
                      )}
                      {ev.timestamp && (
                        <span>
                          {t('cognitiveWargame.round.timestamp')}:{' '}
                          {ev.timestamp}
                        </span>
                      )}
                    </div>
                    {ev.action && (
                      <div className="mt-1 font-medium">{ev.action}</div>
                    )}
                    {ev.content && (
                      <div className="mt-1 text-text-secondary">
                        {ev.content}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Spin>
        </CardContent>
      </Card>
    </div>
  );
};

export default RoundViewPage;
