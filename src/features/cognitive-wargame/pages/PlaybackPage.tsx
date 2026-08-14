/**
 * PlaybackPage 历史回放（独立路由入口）。
 *
 * 保留顶部想定选择器，复用共享组件 ScenarioPlaybackView 展示时间轴。
 */
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import WargameSectionLayout from '../components/section-menu';
import ScenarioPlaybackView from '../components/scenario-playback-view';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

const PlaybackPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { scenarios, fetchScenarios } = useWargameStore();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    id ?? '',
  );

  useEffect(() => {
    fetchScenarios(50, 0);
  }, [fetchScenarios]);

  // URL 带 id 时同步到选中想定
  useEffect(() => {
    if (id && id !== selectedScenarioId) {
      setSelectedScenarioId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <Card>
          <CardContent className="py-4">
            <Label>{t('cognitiveWargame.playback.selectScenario')}</Label>
            <Select
              value={selectedScenarioId}
              onValueChange={setSelectedScenarioId}
            >
              <SelectTrigger className="mt-2 w-72">
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
          </CardContent>
        </Card>
        <ScenarioPlaybackView scenarioId={selectedScenarioId} />
      </div>
    </WargameSectionLayout>
  );
};

export default PlaybackPage;
