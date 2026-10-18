import { DocumentDownloadButton } from '@/components/document-download-button';
import { UploadedMessageFiles } from '@/components/next-message-item/uploaded-message-files';
import { ReferenceDocumentList } from '@/components/next-message-item/reference-document-list';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Docagg,
  IDocumentDownloadInfo,
  IMessage,
  UploadResponseDataType,
} from '@/interfaces/database/chat';
import { cn } from '@/lib/utils';
import { LucidePanelRightClose } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

type UploadFile = File | UploadResponseDataType;
type WorkspaceTab = 'files' | 'references';

export interface WorkspacePanelProps {
  visible: boolean;
  onClose: () => void;
  /** 当前会话消息(优先使用聊天页实时 derivedMessages) */
  messages: IMessage[];
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * WorkspacePanel — 聊天页右侧工作区。
 *
 * 与 ChatSettings 共用右侧槽位(同时只能打开一个),提供:
 * - Files:当前会话上传文件 + 可下载产物
 * - References:检索引用文档(复用 ReferenceDocumentList 的预览能力)
 *
 * Route B P2-17:解决 ChatSettings 独占右槽的问题,按 tabs 呈现工作区内容。
 */
export function WorkspacePanel({
  visible,
  onClose,
  messages,
}: WorkspacePanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('files');
  const tabRefs = useRef<
    Partial<Record<WorkspaceTab, HTMLButtonElement | null>>
  >({});

  const uploads = useMemo<UploadFile[]>(
    () =>
      uniqueBy(
        messages.flatMap((message) => message.files ?? []),
        (file) => {
          // 服务端文件有稳定 id 时优先按 id 去重;本地 File 退化为 name+size
          const id = 'id' in file ? file.id : undefined;
          return id ? `id:${id}` : `name:${file.name}:${file.size}`;
        },
      ),
    [messages],
  );

  const downloads = useMemo<IDocumentDownloadInfo[]>(
    () =>
      uniqueBy(
        messages.flatMap((message) => message.downloads ?? []),
        (file) => file.doc_id || file.filename,
      ),
    [messages],
  );

  const references = useMemo<Docagg[]>(
    () =>
      uniqueBy(
        messages.flatMap((message) => message.reference?.doc_aggs ?? []),
        (doc) => doc.doc_id,
      ),
    [messages],
  );

  const fileCount = uploads.length + downloads.length;
  const tabs: Array<{ key: WorkspaceTab; label: string; count: number }> = [
    { key: 'files', label: t('workspace.files'), count: fileCount },
    {
      key: 'references',
      label: t('workspace.references'),
      count: references.length,
    },
  ];

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: WorkspaceTab,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.key === tab);
    if (index === -1) return;
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setActiveTab(next.key);
    tabRefs.current[next.key]?.focus();
  };

  return (
    <section
      data-testid="chat-workspace"
      className={cn(
        'transition-[width] ease-out duration-300 flex-shrink-0 flex flex-col overflow-hidden',
        visible ? 'w-[440px]' : 'w-0',
      )}
    >
      {visible && (
        <>
          <div className="p-5 pb-2 flex justify-between items-center text-base">
            <span>{t('workspace.title')}</span>
            <Button
              variant="transparent"
              size="icon-sm"
              className="border-0"
              onClick={onClose}
              aria-label={t('workspace.close')}
              data-testid="chat-workspace-close"
            >
              <LucidePanelRightClose className="size-4" />
            </Button>
          </div>

          <div
            role="tablist"
            aria-label={t('workspace.title')}
            className="px-5 flex gap-1 border-b border-border-button"
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  ref={(node) => {
                    tabRefs.current[tab.key] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`workspace-tab-${tab.key}`}
                  aria-selected={active}
                  aria-controls={
                    active ? `workspace-panel-${tab.key}` : undefined
                  }
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveTab(tab.key)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
                  className={cn(
                    'relative px-3 py-2 text-sm -mb-px border-b-2 transition-colors',
                    active
                      ? 'border-accent-primary-text text-text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary',
                  )}
                >
                  {tab.label}
                  <span className="ms-1.5 text-xs text-text-disabled">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <ScrollArea className="flex-1" viewportClassName="[&>div]:!block">
            <div
              role="tabpanel"
              id={`workspace-panel-${activeTab}`}
              aria-labelledby={`workspace-tab-${activeTab}`}
              className="p-5 space-y-6"
            >
              {activeTab === 'files' ? (
                fileCount === 0 ? (
                  <p className="py-10 text-center text-sm text-text-secondary">
                    {t('workspace.emptyFiles')}
                  </p>
                ) : (
                  <>
                    {uploads.length > 0 && (
                      <section>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                          {t('workspace.uploads')}
                        </h3>
                        <div className="overflow-x-auto">
                          <UploadedMessageFiles files={uploads} />
                        </div>
                      </section>
                    )}
                    {downloads.length > 0 && (
                      <section>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                          {t('workspace.downloads')}
                        </h3>
                        <div className="space-y-2">
                          {downloads.map((download) => (
                            <DocumentDownloadButton
                              key={download.doc_id || download.filename}
                              downloadInfo={download}
                            />
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )
              ) : references.length === 0 ? (
                <p className="py-10 text-center text-sm text-text-secondary">
                  {t('workspace.emptyReferences')}
                </p>
              ) : (
                <ReferenceDocumentList list={references} />
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </section>
  );
}
