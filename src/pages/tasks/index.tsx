import { HubLayout } from '@/layouts/components/hub-layout';
import { Routes } from '@/constants/routes';
import { LucideBot, LucideListTodo, LucideMessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

/**
 * 任务 hub:一级导航"任务"落地页,布局同首页(可折叠侧栏 + 内容区)。
 * 聊天/智能体作为子菜单由侧栏切换,内容区复用既有列表页(next-chats / agents)。
 */
const Tasks = () => {
  const { t } = useTranslation();

  return (
    <HubLayout
      testIdPrefix="tasks"
      title={t('header.tasks')}
      icon={<LucideListTodo className="size-5 shrink-0 stroke-[1.5]" />}
      items={[
        {
          key: Routes.TasksChat,
          label: t('header.chat'),
          icon: <LucideMessageCircle className="size-[1em]" />,
          testId: 'tasks-submenu-chat',
        },
        {
          key: Routes.TasksAgent,
          label: t('header.flow'),
          icon: <LucideBot className="size-[1em]" />,
          testId: 'tasks-submenu-agent',
        },
      ]}
    >
      <Outlet />
    </HubLayout>
  );
};

export default Tasks;
