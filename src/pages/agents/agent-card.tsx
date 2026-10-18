import { IntellectAvatar } from '@/components/intellect-avatar';
import { MoreButton } from '@/components/more-button';
import { SharedBadge } from '@/components/shared-badge';
import { Badge } from '@/components/ui/badge';
import { AgentCategory } from '@/constants/agent';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IFlow } from '@/interfaces/database/agent';
import { formatDate } from '@/utils/date';
import { Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AgentDropdown } from './agent-dropdown';
import { useRenameAgent } from './use-rename-agent';

export type DatasetCardProps = {
  data: IFlow;
} & Pick<ReturnType<typeof useRenameAgent>, 'showAgentRenameModal'>;

function AgentTags({ tags }: { tags?: string }) {
  const list = (tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {list.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-xs font-normal">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

/** 过滤后端返回的 32 位 tenant/member id,避免把 ID 当昵称展示。 */
function isMeaningfulNickname(nickname?: string): boolean {
  const value = nickname?.trim();
  if (!value) return false;
  return !/^[0-9a-f]{16,}$/i.test(value);
}

/**
 * Agent 卡片,视觉与 Task Hub / Chat 列表对齐。
 * 保留 Agent 的 avatar、tags、发布状态、共享标记与下拉操作。
 */
export function AgentCard({ data, showAgentRenameModal }: DatasetCardProps) {
  const { t } = useTranslation();
  const { navigateToAgent } = useNavigatePage();
  const isDataflow = data.canvas_category === AgentCategory.DataflowCanvas;
  const updatedAt = data.update_date || data.update_time;

  const handleClick = () => {
    navigateToAgent(data.id, data.canvas_category as AgentCategory)();
  };

  return (
    <div className="group relative h-full transition-transform duration-trae-base hover:-translate-y-0.5">
      <article
        role="button"
        tabIndex={0}
        aria-label={data.title}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleClick();
          }
        }}
        className="relative flex h-full min-h-[116px] cursor-pointer flex-col rounded-trae-xl border border-trae-line bg-trae-card p-[18px] ps-[22px] transition-all duration-trae-base group-hover:border-trae-line-strong group-hover:bg-trae-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary-text"
        data-testid="agent-card"
        data-agent-id={data.id}
      >
        <div className="flex items-start gap-3">
          <IntellectAvatar
            className="size-8 shrink-0"
            avatar={data.avatar}
            name={data.title}
          />
          <div className="flex min-h-[76px] min-w-0 flex-1 flex-col pe-7">
            <div className="flex items-start justify-between gap-2">
              <h4 className="truncate font-semibold text-trae-ink">
                {data.title}
              </h4>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge
                  variant="secondary"
                  className="text-[10px] font-normal text-trae-grey"
                >
                  {data.release ? t('flow.published') : t('flow.draft')}
                </Badge>
                {isDataflow && (
                  <span
                    className="mt-0.5 text-trae-grey-2"
                    title={t('flow.canvasCategory')}
                  >
                    <Route className="size-4" />
                  </span>
                )}
              </div>
            </div>

            {data.description && (
              <p className="mt-1 line-clamp-2 text-trae-sm text-trae-grey">
                {data.description}
              </p>
            )}
            <AgentTags tags={data.tags} />

            <div className="mt-auto flex items-end justify-between gap-2 pt-2">
              <div className="flex min-w-0 flex-col gap-0.5 font-mono text-trae-xs text-trae-grey-2">
                {updatedAt && (
                  <time
                    dateTime={
                      typeof updatedAt === 'string'
                        ? updatedAt
                        : new Date(updatedAt).toISOString()
                    }
                  >
                    {t('flow.lastSavedAt')}:{' '}
                    {formatDate(updatedAt, 'MM-DD HH:mm')}
                  </time>
                )}
                {data.release_time && (
                  <span>
                    {t('flow.publishedAt')}:{' '}
                    {formatDate(data.release_time, 'MM-DD HH:mm')}
                  </span>
                )}
              </div>
              {isMeaningfulNickname(data.nickname) && (
                <SharedBadge>{data.nickname}</SharedBadge>
              )}
            </div>
          </div>
        </div>
      </article>

      {/* 操作区:卡片主体 sibling,避免 role=button 内嵌 button */}
      <div className="absolute end-[14px] top-[14px] z-10 opacity-0 transition-opacity duration-trae-fast group-hover:opacity-100 group-focus-within:opacity-100">
        <AgentDropdown showAgentRenameModal={showAgentRenameModal} agent={data}>
          <MoreButton />
        </AgentDropdown>
      </div>
    </div>
  );
}
