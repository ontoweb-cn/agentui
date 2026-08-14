/**
 * KGViewPage 知识图谱（独立路由入口）。
 *
 * 复用共享组件 ScenarioKGView，仅包裹布局与从 URL 读取想定 ID。
 */
import WargameSectionLayout from '../components/section-menu';
import ScenarioKGView from '../components/scenario-kg-view';
import { useParams } from 'react-router';

const KGViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <ScenarioKGView scenarioId={id ?? ''} />
      </div>
    </WargameSectionLayout>
  );
};

export default KGViewPage;
