import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import { RenameDialog } from '@/components/rename-dialog';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
import { IntellectPagination } from '@/components/ui/intellect-pagination';
import { useFetchChatList } from '@/hooks/use-chat-request';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { groupChatsByDate } from './chat-list-group';
import { ChatTaskCard } from './chat-task-card';
import { useCreateChatDialog } from './hooks/use-create-chat';
import { useRenameChat } from './hooks/use-rename-chat';

const GROUP_LABEL_KEY = {
  today: 'chat.groupToday',
  yesterday: 'chat.groupYesterday',
  earlier: 'chat.groupEarlier',
} as const;

export default function ChatList() {
  const { data, setPagination, pagination, handleInputChange, searchString, loading } =
    useFetchChatList();
  const { t } = useTranslation();
  const {
    initialChatName,
    chatRenameVisible,
    showChatRenameModal,
    hideChatRenameModal,
    onChatRenameOk,
    chatRenameLoading,
  } = useRenameChat();
  const {
    createChatVisible,
    showCreateChatModal,
    hideCreateChatModal,
    onCreateChatOk,
    createChatLoading,
  } = useCreateChatDialog();

  const handlePageChange = useCallback(
    (page: number, pageSize?: number) => {
      setPagination({ page, pageSize });
    },
    [setPagination],
  );

  const handleShowCreateModal = useCallback(() => {
    showCreateChatModal();
  }, [showCreateChatModal]);

  const [searchParams, setSearchParams] = useSearchParams();
  const isCreate = searchParams.get('isCreate') === 'true';
  useEffect(() => {
    if (isCreate) {
      handleShowCreateModal();
      searchParams.delete('isCreate');
      setSearchParams(searchParams);
    }
  }, [isCreate, handleShowCreateModal, searchParams, setSearchParams]);

  const groups = useMemo(
    () => groupChatsByDate(data.chats ?? []),
    [data.chats],
  );

  const renameDialogProps = useMemo(() => {
    if (chatRenameVisible) {
      return {
        hideModal: hideChatRenameModal,
        onOk: onChatRenameOk,
        initialName: initialChatName,
        loading: chatRenameLoading,
        title: initialChatName,
      };
    }
    if (createChatVisible) {
      return {
        hideModal: hideCreateChatModal,
        onOk: onCreateChatOk,
        initialName: '',
        loading: createChatLoading,
        title: t('chat.createChat'),
      };
    }
    return null;
  }, [
    chatRenameVisible,
    createChatVisible,
    hideChatRenameModal,
    onChatRenameOk,
    initialChatName,
    chatRenameLoading,
    hideCreateChatModal,
    onCreateChatOk,
    createChatLoading,
    t,
  ]);

  return (
    <>
      <section
        className="flex h-full min-h-0 flex-col"
        data-testid="chats-list"
      >
        <header className="flex items-center justify-between gap-4 pb-4">
          <h2 className="text-2xl font-semibold">{t('chat.chatApps')}</h2>
          <div className="flex items-center gap-3">
            <div className="w-[280px] max-w-full">
              <SearchInput
                value={searchString}
                onChange={handleInputChange}
                placeholder={t('common.search')}
              />
            </div>
            <Button data-testid="create-chat" onClick={handleShowCreateModal}>
              <Plus className="size-[1em]" />
              {t('chat.createChat')}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="py-16 text-center text-sm text-text-secondary">
              {t('chat.loading')}
            </p>
          ) : groups.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyAppCard
                showIcon
                size="large"
                className="w-[480px] p-14"
                isSearch={Boolean(searchString)}
                type={EmptyCardType.Chat}
                onClick={!searchString ? handleShowCreateModal : undefined}
                testId="chats-empty-create"
              />
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {groups.map((group) => (
                <section key={group.key}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    {t(GROUP_LABEL_KEY[group.key])}
                    <span className="ms-1.5 text-text-disabled">
                      {group.chats.length}
                    </span>
                  </h3>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {group.chats.map((chat) => (
                      <ChatTaskCard
                        key={chat.id}
                        data={chat}
                        showChatRenameModal={showChatRenameModal}
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
              onChange={handlePageChange}
            />
          </div>
        )}
      </section>

      {renameDialogProps && (
        <RenameDialog {...renameDialogProps}></RenameDialog>
      )}
    </>
  );
}
