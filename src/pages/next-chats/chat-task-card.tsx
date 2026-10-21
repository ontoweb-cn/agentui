import { IntellectAvatar } from '@/components/intellect-avatar';
import { MoreButton } from '@/components/more-button';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IDialog } from '@/interfaces/database/chat';
import { formatDate } from '@/utils/date';
import { ChatDropdown } from './chat-dropdown';
import { useRenameChat } from './hooks/use-rename-chat';

export type ChatTaskCardProps = {
  data: IDialog;
} & Pick<ReturnType<typeof useRenameChat>, 'showChatRenameModal'>;

/**
 * 与 Task Hub 的 TaskCard 视觉对齐的会话卡片。
 * 仅用于 /tasks/chat;首页 ChatList 仍使用 HomeCard。
 */
export function ChatTaskCard({ data, showChatRenameModal }: ChatTaskCardProps) {
  const { navigateToChat } = useNavigatePage();
  const updatedAt = data.update_date || data.update_time;

  return (
    <div className="group relative h-full transition-transform duration-trae-base hover:-translate-y-0.5">
      <article
        role="button"
        tabIndex={0}
        aria-label={data.name}
        onClick={() => navigateToChat(data.id)()}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigateToChat(data.id)();
          }
        }}
        className="relative flex h-full min-h-[116px] cursor-pointer flex-col rounded-trae-xl border border-trae-line bg-trae-card p-[18px] ps-[22px] transition-all duration-trae-base group-hover:border-trae-line-strong group-hover:bg-trae-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary-text"
        data-testid="chat-task-card"
        data-chat-id={data.id}
      >
        <div className="flex items-start gap-3">
          <IntellectAvatar
            className="size-8 shrink-0"
            avatar={data.icon}
            name={data.name}
          />
          <div className="flex min-h-[76px] min-w-0 flex-1 flex-col pe-7">
            <h4 className="truncate font-semibold text-trae-ink">
              {data.name}
            </h4>
            {data.description && (
              <p className="mt-1 line-clamp-2 text-trae-sm text-trae-grey">
                {data.description}
              </p>
            )}
            {updatedAt && (
              <time
                className="mt-auto block pt-2 font-mono text-trae-xs text-trae-grey-2"
                dateTime={
                  typeof updatedAt === 'string'
                    ? updatedAt
                    : new Date(updatedAt).toISOString()
                }
              >
                {formatDate(updatedAt, 'MM-DD HH:mm')}
              </time>
            )}
          </div>
        </div>
      </article>

      {/* 操作区:卡片主体 sibling,避免 role=button 内嵌 button */}
      <div className="absolute end-[14px] top-[14px] z-10 opacity-0 transition-opacity duration-trae-fast group-hover:opacity-100 group-focus-within:opacity-100">
        <ChatDropdown chat={data} showChatRenameModal={showChatRenameModal}>
          <MoreButton />
        </ChatDropdown>
      </div>
    </div>
  );
}
