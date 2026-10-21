import { IntellectPagination } from '@/components/ui/intellect-pagination';
import { SearchInput } from '@/components/ui/input';
import { TaskCard } from '@/components/trae-work';
import { useFetchChatList } from '@/hooks/use-chat-request';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatSessionTaskDuration,
  groupSessionTasks,
  mapSessionToTask,
  type SessionTaskGroupKey,
} from './task-list-utils';

const GROUP_LABEL_KEY: Record<SessionTaskGroupKey, string> = {
  today: 'tasks.groupToday',
  yesterday: 'tasks.groupYesterday',
  earlier: 'tasks.groupEarlier',
};

/**
 * TaskList — 任务 Hub 索引页。
 *
 * 注意:后端暂无独立 task 实体,本轮用 Gateway Session 做只读任务投影;
 * 分组(今天/昨天/更早)与时长来自 Session create/update time。
 */
export default function TaskList() {
  const { t } = useTranslation();
  const { navigateToChat } = useNavigatePage();
  const {
    data,
    loading,
    searchString,
    handleInputChange,
    pagination,
  } = useFetchChatList();

  const tasks = useMemo(
    () => data.chats.map((chat) => mapSessionToTask(chat)),
    [data.chats],
  );
  const groups = useMemo(() => groupSessionTasks(tasks), [tasks]);

  return (
    <section className="flex flex-col min-h-0 h-full" data-testid="tasks-list">
      <header className="flex items-center justify-between gap-4 pb-4">
        <h2 className="text-2xl font-semibold">{t('header.tasks')}</h2>
        <div className="w-[280px] max-w-full">
          <SearchInput
            value={searchString}
            onChange={handleInputChange}
            placeholder={t('tasks.searchPlaceholder')}
            data-testid="tasks-search"
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <p className="py-16 text-center text-sm text-text-secondary">
            {t('tasks.loading')}
          </p>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-secondary">
            {t('tasks.empty')}
          </p>
        ) : (
          <div className="space-y-6 pb-4">
            {groups.map((group) => (
              <section key={group.key}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {t(GROUP_LABEL_KEY[group.key])}
                  <span className="ms-1.5 text-text-disabled">
                    {group.tasks.length}
                  </span>
                </h3>
                <div className="grid gap-3 xl:grid-cols-2">
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      {...task}
                      title={task.title || t('chat.newConversation')}
                      description={t('tasks.duration', {
                        duration: formatSessionTaskDuration(task),
                      })}
                      onClick={navigateToChat(task.sessionId)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {pagination.total > 0 && (
        <div className="pt-3">
          <IntellectPagination
            current={pagination.current}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onChange={pagination.onChange}
          />
        </div>
      )}
    </section>
  );
}
