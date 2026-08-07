import { MessageType } from '@/constants/chat';
import {
  IMessage,
  IReference,
  IReferenceChunk,
  UploadResponseDataType,
} from '@/interfaces/database/chat';
import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { IRegenerateMessage, IRemoveMessageById } from '@/hooks/logic-hooks';
import { cn } from '@/lib/utils';
import { isEmpty } from 'lodash';
import { DocumentDownloadButton } from '../document-download-button';
import MarkdownContent from '../markdown-content';
import { ApprovalCard } from '../next-message-item/approval-card';
import { ClarifyCard } from '../next-message-item/clarify-card';
import { ReasoningPanel } from '../next-message-item/reasoning-panel';
import { ReferenceDocumentList } from '../next-message-item/reference-document-list';
import { ReferenceImageList } from '../next-message-item/reference-image-list';
import { ToolCallCard } from '../next-message-item/tool-call-card';
import { UploadedMessageFiles } from '../next-message-item/uploaded-message-files';
import { IntellectAvatar } from '../intellect-avatar';
import SvgIcon from '../svg-icon';
import { useTheme } from '../theme-provider';
import { AssistantGroupButton, UserGroupButton } from './group-button';
import styles from './index.module.less';

interface IProps extends Partial<IRemoveMessageById>, IRegenerateMessage {
  item: IMessage;
  reference: IReference;
  loading?: boolean;
  sendLoading?: boolean;
  visibleAvatar?: boolean;
  nickname?: string;
  avatar?: string;
  avatarDialog?: string | null;
  clickDocumentButton?: (documentId: string, chunk: IReferenceChunk) => void;
  index: number;
  showLikeButton?: boolean;
  showLoudspeaker?: boolean;
  /** P1：当前消息是否处于流式输出中（仅最后一条 assistant 消息为 true） */
  isStreaming?: boolean;
  /** P1：流式中的实时 reasoning（工具调用后重置），仅 isStreaming=true 时有意义 */
  liveReasoning?: string;
  /**
   * v1.3.0:提交工具审批回调(来自 use-send-chat-message.ts submitApproval)。
   * 仅 gateway 路径(IntellectEnterpriseAdapter /v1/runs)生效,RAG 路径为 noop。
   * ApprovalCard 按钮组 onClick 调用此方法,提交后 BFF 转发到 intellect-team。
   */
  onSubmitApproval?: (
    choice: 'once' | 'session' | 'always' | 'deny',
  ) => Promise<boolean>;
  /**
   * 提交 clarify 澄清回答回调(来自 use-send-chat-message.ts submitClarify)。
   * ClarifyCard 输入框/choice 按钮 onClick 调用此方法,提交后 BFF 转发到 intellect-team。
   */
  onSubmitClarify?: (answer: string) => Promise<boolean>;
  /** 是否为连续同类消息的非首条(用于隐藏头像和缩小间距) */
  isContinuation?: boolean;
}

const MessageItem = ({
  item,
  reference,
  loading = false,
  avatar,
  avatarDialog,
  sendLoading = false,
  clickDocumentButton,
  index,
  removeMessageById,
  regenerateMessage,
  showLikeButton = true,
  showLoudspeaker = true,
  visibleAvatar = true,
  nickname,
  isStreaming = false,
  liveReasoning,
  onSubmitApproval,
  onSubmitClarify,
  isContinuation = false,
}: IProps) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isAssistant = item.role === MessageType.Assistant;
  const isUser = item.role === MessageType.User;

  const uploadedFiles = useMemo(() => {
    return item?.files ?? [];
  }, [item?.files]);

  const referenceDocumentList = useMemo(() => {
    return reference?.doc_aggs ?? [];
  }, [reference?.doc_aggs]);

  const documentDownloadInfos = useMemo(
    () => item.downloads ?? [],
    [item.downloads],
  );
  const messageContent = item.content;

  const handleRegenerateMessage = useCallback(() => {
    regenerateMessage?.(item);
  }, [regenerateMessage, item]);

  return (
    <div
      className={classNames(styles.messageItem, {
        [styles.messageItemLeft]: item.role === MessageType.Assistant,
        [styles.messageItemRight]: item.role === MessageType.User,
        [styles.messageItemContinuation]: isContinuation,
      })}
    >
      <section
        className={classNames(styles.messageItemSection, {
          [styles.messageItemSectionLeft]: item.role === MessageType.Assistant,
          [styles.messageItemSectionRight]: item.role === MessageType.User,
        })}
      >
        <div
          className={classNames(styles.messageItemContent, 'group', {
            [styles.messageItemContentReverse]: item.role === MessageType.User,
          })}
        >
          {visibleAvatar &&
            !isContinuation &&
            (item.role === MessageType.User ? (
              <IntellectAvatar
                className="size-10"
                avatar={avatar ?? `${import.meta.env.BASE_URL}logo-96.png`}
                isPerson
                name={nickname}
              />
            ) : avatarDialog ? (
              <IntellectAvatar
                className="size-10"
                avatar={avatarDialog}
                isPerson
              />
            ) : (
              <SvgIcon
                name={'assistant'}
                width={'100%'}
                className={cn('size-10 fill-current')}
              ></SvgIcon>
            ))}
          {visibleAvatar && isContinuation && (
            <div className="size-10 shrink-0" aria-hidden />
          )}

          <section className="flex min-w-0 gap-2 flex-1 flex-col">
            {isAssistant ? (
              index !== 0 && (
                <AssistantGroupButton
                  messageId={item.id}
                  content={messageContent}
                  prompt={item.prompt}
                  showLikeButton={showLikeButton}
                  audioBinary={item.audio_binary}
                  showLoudspeaker={showLoudspeaker}
                ></AssistantGroupButton>
              )
            ) : (
              <UserGroupButton
                content={messageContent}
                messageId={item.id}
                removeMessageById={removeMessageById}
                regenerateMessage={regenerateMessage && handleRegenerateMessage}
                sendLoading={sendLoading}
              ></UserGroupButton>
            )}
            {/* P1：Reasoning 面板（流式中显示 liveReasoning，流完成/历史回看显示 reasoning） */}
            {isAssistant && (item.reasoning || (isStreaming && liveReasoning)) && (
              <ReasoningPanel
                reasoning={item.reasoning ?? ''}
                liveReasoning={isStreaming ? liveReasoning : undefined}
                isStreaming={isStreaming}
              />
            )}
            {/* Show message content if there's any text besides the download */}
            {(messageContent || sendLoading) && (
              <div
                className={cn(
                  isAssistant
                    ? theme === 'dark'
                      ? styles.messageTextDark
                      : styles.messageText
                    : styles.messageUserText,
                  { '!bg-bg-card': !isAssistant },
                )}
              >
                {sendLoading && isEmpty(messageContent) ? (
                  t('common.running')
                ) : (
                  <MarkdownContent
                    loading={loading}
                    content={messageContent}
                    reference={reference}
                    clickDocumentButton={clickDocumentButton}
                  ></MarkdownContent>
                )}
              </div>
            )}
            {/* P1：Tool call 卡片列表（备选后置方案：放在 content 之后，保留 content 完整性）
                P2-Q10 修复:当 pendingApproval 存在时,过滤掉同名 toolName 的 running 状态 ToolCallCard,
                避免"工具运行中 + 审批待处理"两个卡片同时显示造成语义混乱。
                approval_request 之前到达的 tool_start(running)被隐藏,审批卡片独占显示。 */}
            {isAssistant && item.toolCalls && item.toolCalls.length > 0 && (
              <div className="space-y-1">
                {item.toolCalls
                  .filter(
                    (tc) =>
                      !item.pendingApproval ||
                      tc.toolName !== item.pendingApproval!.toolName ||
                      tc.status !== 'running',
                  )
                  .map((tc) => (
                    <ToolCallCard key={tc.toolCallId} record={tc} />
                  ))}
              </div>
            )}
            {/* v1.3.0: 工具审批卡片(仅当 pendingApproval 存在且 onSubmitApproval 提供时渲染)
                BFF streamChunksAsSSE 已在 approval_request 后过滤 tool_* 事件,
                ApprovalCard 与 ToolCallCard 不会同时显示同一工具调用 */}
            {isAssistant && item.pendingApproval && onSubmitApproval && (
              <ApprovalCard
                approval={item.pendingApproval}
                onSubmit={onSubmitApproval}
              />
            )}
            {/* clarify: 澄清请求卡片(仅当 pendingClarify 存在且 onSubmitClarify 提供时渲染) */}
            {isAssistant && item.pendingClarify && onSubmitClarify && (
              <ClarifyCard
                clarify={item.pendingClarify}
                onSubmit={onSubmitClarify}
              />
            )}
            {isAssistant && (
              <ReferenceImageList
                referenceChunks={reference.chunks}
                messageContent={messageContent}
              ></ReferenceImageList>
            )}
            {isAssistant && referenceDocumentList.length > 0 && (
              <ReferenceDocumentList
                list={referenceDocumentList}
              ></ReferenceDocumentList>
            )}
            {isUser &&
              Array.isArray(uploadedFiles) &&
              uploadedFiles.length > 0 && (
                <UploadedMessageFiles
                  files={uploadedFiles as UploadResponseDataType[]}
                ></UploadedMessageFiles>
              )}
            {documentDownloadInfos.length > 0 && (
              <div className="mt-3 space-y-3">
                {documentDownloadInfos.map((downloadInfo, index) => (
                  <div key={`${downloadInfo.filename}-${index}`}>
                    {index > 0 && <div className="my-6 h-px bg-border" />}
                    <DocumentDownloadButton downloadInfo={downloadInfo} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
};

export default memo(MessageItem);
