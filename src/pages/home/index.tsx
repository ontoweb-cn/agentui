import { PageContainer } from '@/layouts/components/page-container';
import { useIsCapabilityEnabled } from '@/hooks/use-harness-capabilities';
import { Applications } from './applications';
import { NextBanner } from './banner';
import { Datasets } from './datasets';

const Home = () => {
  // 无 intellect-rag 后端时隐藏知识库区块(BFF 能力 knowledgeBase=false)
  const knowledgeBase = useIsCapabilityEnabled('knowledgeBase');
  return (
    <PageContainer>
      <article>
        <header className="mb-8">
          <NextBanner />
        </header>

        {knowledgeBase && <Datasets />}
        <Applications />
      </article>
    </PageContainer>
  );
};

export default Home;
