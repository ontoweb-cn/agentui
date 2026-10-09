import { PageContainer } from '@/layouts/components/page-container';
import { useIsCapabilityEnabled } from '@/hooks/use-harness-capabilities';
import { Applications } from './applications';
import { Datasets } from './datasets';

const Home = () => {
  // 无 intellect-rag 后端时隐藏知识库区块(BFF 能力 knowledgeBase=false)
  const knowledgeBase = useIsCapabilityEnabled('knowledgeBase');
  return (
    <PageContainer>
      <article>
        {knowledgeBase && <Datasets />}
        <Applications />
      </article>
    </PageContainer>
  );
};

export default Home;
