/**
 * MetricsViewPage 态势分析（独立路由入口）。
 *
 * 复用共享组件 ScenarioMetricsView，仅包裹布局与从 URL 读取想定 ID。
 */
import WargameSectionLayout from '../components/section-menu';
import ScenarioMetricsView from '../components/scenario-metrics-view';
import { useParams } from 'react-router';

const MetricsViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <ScenarioMetricsView scenarioId={id ?? ''} />
      </div>
    </WargameSectionLayout>
  );
};

export default MetricsViewPage;
