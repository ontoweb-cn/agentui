import { HubLayout, type HubMenuItem } from '@/layouts/components/hub-layout';
import { Routes } from '@/constants/routes';
import { useIsCapabilityEnabled } from '@/hooks/use-harness-capabilities';
import {
  LucideBookOpen,
  LucideDatabase,
  LucideFolderOpen,
  LucideSearch,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

/**
 * 知识 hub:一级导航"知识"落地页,布局同任务页(可折叠侧栏 + 内容区)。
 * 知识库/文件管理/搜索作为子菜单由侧栏切换,内容区复用既有列表页。
 *
 * 无 intellect-rag 后端时知识库子菜单隐藏(BFF 能力 knowledgeBase=false,响应式);
 * /knowledge/dataset 路由仍可达(与被替代的旧 /datasets 路由行为一致),此时
 * 无菜单项高亮。manifest 中的 index 重定向固定落在知识库,不做静态门控——
 * window.__CAPABILITIES__ 无写入方,路由表加载期拿不到真实能力。
 */
const Knowledge = () => {
  const { t } = useTranslation();
  const knowledgeBase = useIsCapabilityEnabled('knowledgeBase');

  const items: HubMenuItem[] = [
    ...(knowledgeBase
      ? [
          {
            key: Routes.KnowledgeDataset,
            label: t('header.dataset'),
            icon: <LucideDatabase className="size-[1em]" />,
            testId: 'knowledge-submenu-dataset',
          },
        ]
      : []),
    {
      key: Routes.KnowledgeFiles,
      label: t('header.fileManager'),
      icon: <LucideFolderOpen className="size-[1em]" />,
      testId: 'knowledge-submenu-files',
    },
    {
      key: Routes.KnowledgeSearch,
      label: t('header.search'),
      icon: <LucideSearch className="size-[1em]" />,
      testId: 'knowledge-submenu-search',
    },
  ];

  return (
    <HubLayout
      testIdPrefix="knowledge"
      title={t('header.knowledge')}
      icon={<LucideBookOpen className="size-5 shrink-0 stroke-[1.5]" />}
      items={items}
    >
      <Outlet />
    </HubLayout>
  );
};

export default Knowledge;
