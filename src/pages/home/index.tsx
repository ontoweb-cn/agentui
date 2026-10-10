import { HubLayout } from '@/layouts/components/hub-layout';
import { useIsCapabilityEnabled } from '@/hooks/use-harness-capabilities';
import { LucideDatabase, LucideMessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Applications } from './applications';
import { Datasets } from './datasets';

export type HomeMenuKey = 'dataset' | 'chat';

const Home = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState<HomeMenuKey>('dataset');
  // 无 intellect-rag 后端时隐藏知识库菜单(BFF 能力 knowledgeBase=false)
  const knowledgeBase = useIsCapabilityEnabled('knowledgeBase');
  const menu: HomeMenuKey =
    active === 'dataset' && !knowledgeBase ? 'chat' : active;

  const items = [
    ...(knowledgeBase
      ? [
          {
            key: 'dataset',
            label: t('header.dataset'),
            icon: <LucideDatabase className="size-[1em]" />,
          },
        ]
      : []),
    {
      key: 'chat',
      label: t('header.chat'),
      icon: <LucideMessagesSquare className="size-[1em]" />,
    },
  ];

  return (
    <HubLayout
      testIdPrefix="home"
      items={items}
      activeKey={menu}
      onSelect={(key) => setActive(key as HomeMenuKey)}
    >
      {menu === 'dataset' ? <Datasets /> : <Applications />}
    </HubLayout>
  );
};

export default Home;
