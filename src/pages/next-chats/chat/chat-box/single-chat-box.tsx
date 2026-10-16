import { NextMessageInput } from '@/components/message-input/next';
import MessageItem from '@/components/message-item';
import PdfSheet from '@/components/pdf-drawer';
import { useClickDrawer } from '@/components/pdf-drawer/hooks';
import { SelectedTextReply } from '@/components/selected-text-reply';
import { Authorization } from '@/constants/authorization';
import { MessageType } from '@/constants/chat';
import { useFetchChat, useGetChatSearchParams } from '@/hooks/use-chat-request';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { IClientConversation } from '@/interfaces/database/chat';
import { useQuery } from '@tanstack/react-query';
import api from '@/utils/api';
import { buildMessageUuidWithRole } from '@/utils/chat';
import { getAuthorization } from '@/utils/authorization-util';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useGetSendButtonDisabled,
  useSendButtonDisabled,
} from '../../hooks/use-button-disabled';
import { useCreateConversationBeforeUploadDocument } from '../../hooks/use-create-conversation';
import { useSendMessage } from '../../hooks/use-send-chat-message';
import { buildMessageItemReference } from '../../utils';
import { useShowInternet } from '../use-show-internet';

interface IProps {
  controller: AbortController;
  stopOutputMessage(): void;
  conversation: IClientConversation;
}

export function SingleChatBox({
  controller,
  stopOutputMessage,
  conversation,
}: IProps) {
  const { t } = useTranslation();
  // P3: 选中文本回复按钮的根节点 ref
  const chatRootRef = useRef<HTMLElement>(null);
  const {
    value,
    setValue,
    scrollRef,
    messageContainerRef,
    sendLoading,
    derivedMessages,
    isUploading,
    handleInputChange,
    handlePressEnter,
    regenerateMessage,
    removeMessageById,
    handleUploadFile,
    removeFile,
    setDerivedMessages,
    isStreaming,
    liveReasoning,
    contextPromptTokens,
    contextCompletionTokens,
    contextLength,
    // P3: Slash 命令面板
    slashCommandVisible,
    slashCommandContext,
    onSlashCommandExecuted,
    onSlashCommandClose,
    // v1.3.0: 工具审批提交方法(仅 gateway 路径有效,RAG 路径为 noop)
    submitApproval,
    // clarify: 澄清回答提交方法(仅 gateway 路径有效,RAG 路径为 noop)
    submitClarify,
    // P0-3: gateway 会话级模型选择
    selectedModel,
    onSelectedModelChange,
    isGatewayChat,
  } = useSendMessage(controller);
  const { data: userInfo } = useFetchUserInfo();
  const { data: currentDialog } = useFetchChat();
  const { createConversationBeforeUploadDocument } =
    useCreateConversationBeforeUploadDocument();
  const { conversationId } = useGetChatSearchParams();
  const disabled = useGetSendButtonDisabled();
  const sendDisabled = useSendButtonDisabled(value);
  const { visible, hideModal, documentId, selectedChunk, clickDocumentButton } =
    useClickDrawer();

  const showInternet = useShowInternet();

  // P0-3: gateway 路径拉取可选模型列表(BFF GET /api/bff/agents → 网关 /v1/models)。
  // 社区版网关可能仅返回占位名(如 intellect-agent),芯片仍提供"网关默认"兜底,
  // 精确 provider 模型名可用 /model <name> 自由文本设置。
  const { data: gatewayModels } = useQuery({
    queryKey: ['gatewayModels'],
    queryFn: async () => {
      const resp = await fetch(api.gatewayModels, {
        headers: { [Authorization]: getAuthorization() },
      });
      if (!resp.ok) return [] as string[];
      const list = (await resp.json()) as Array<{ id?: string; name?: string }>;
      return Array.isArray(list)
        ? list.map((m) => m.name || m.id || '').filter(Boolean)
        : [];
    },
    enabled: isGatewayChat,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // 停止生成:先请求 BFF 网关侧取消 run(fire-and-forget,失败不影响本地断流),
  // 再沿用原有 AbortController 断开 SSE。BFF 无活跃 run 记录时幂等返回 204。
  const handleStopOutput = useCallback(() => {
    if (conversationId) {
      void fetch(api.agentSessionStop('chat', conversationId), {
        method: 'POST',
        headers: { [Authorization]: getAuthorization() },
      }).catch(() => {});
    }
    stopOutputMessage();
  }, [conversationId, stopOutputMessage]);

  useEffect(() => {
    const messages = conversation?.messages;
    if (Array.isArray(messages)) {
      setDerivedMessages((prevMessages) => {
        // Preserve uploaded file objects from local state that the server doesn't
        // persist (e.g. File instances). Build a map of message id → files from
        // the current local state so they survive when server data is applied.
        const filesMap = new Map(
          prevMessages
            .filter((m) => m.files?.length)
            .map((m) => [m.id, m.files]),
        );
        if (filesMap.size === 0) {
          return messages;
        }
        return messages.map((m) => ({
          ...m,
          files: filesMap.get(m.id) ?? m.files,
        }));
      });
    }
  }, [conversation?.messages, setDerivedMessages]);

  useEffect(() => {
    // Clear the message list after deleting the conversation.
    if (conversationId === '') {
      setDerivedMessages([]);
    }
  }, [conversationId, setDerivedMessages]);

  return (
    <section ref={chatRootRef} className="flex flex-col h-full gap-4">
      {/* P3: 选中文本回复浮动按钮（仅单 chat box 模式渲染） */}
      <SelectedTextReply
        chatRootRef={chatRootRef}
        onQuote={(quote) => {
          // 追加引用文本到 textarea value
          setValue((prev) => (prev ? `${prev}\n${quote}` : quote));
        }}
      />
      <div
        ref={messageContainerRef}
        className="p-5 flex-1 overflow-auto min-h-0 scrollbar-auto"
      >
        <div className="w-full pr-5">
          {derivedMessages?.length === 0 && !isStreaming && (
            <div
              className="flex items-center justify-center py-16 text-sm text-muted-foreground"
              data-testid="chat-empty-state"
            >
              {t('chat.noMessages')}
            </div>
          )}
          {derivedMessages?.map((message, i) => (
            <MessageItem
              loading={
                message.role === MessageType.Assistant &&
                sendLoading &&
                derivedMessages.length - 1 === i
              }
              key={buildMessageUuidWithRole(message)}
              item={message}
              nickname={userInfo.nickname}
              avatar={userInfo.avatar}
              avatarDialog={currentDialog.icon}
              reference={buildMessageItemReference(
                {
                  messages: derivedMessages,
                  reference: conversation.reference,
                },
                message,
              )}
              clickDocumentButton={clickDocumentButton}
              index={i}
              removeMessageById={removeMessageById}
              regenerateMessage={regenerateMessage}
              sendLoading={sendLoading}
              // 连续同类消息的非首条:隐藏头像 + 缩小间距
              isContinuation={
                i > 0 && derivedMessages[i - 1].role === message.role
              }
              // P1：仅最后一条 assistant 消息传递流式状态
              isStreaming={
                message.role === MessageType.Assistant &&
                isStreaming &&
                derivedMessages.length - 1 === i
              }
              liveReasoning={
                message.role === MessageType.Assistant &&
                isStreaming &&
                derivedMessages.length - 1 === i
                  ? liveReasoning
                  : undefined
              }
              // v1.3.0: 透传审批提交方法(ApprovalCard 按钮组 onClick 调用)
              // 仅 gateway 路径有效;RAG 路径为 noop(item.pendingApproval 永远 undefined,不会渲染)
              onSubmitApproval={submitApproval}
              // clarify: 透传澄清回答提交方法(ClarifyCard 输入框/choice 按钮 onClick 调用)
              // 仅 gateway 路径有效;RAG 路径为 noop(item.pendingClarify 永远 undefined,不会渲染)
              onSubmitClarify={submitClarify}
            />
          ))}
        </div>
        <div ref={scrollRef} />
      </div>

      <div className="p-5 pt-0">
        <NextMessageInput
          disabled={disabled}
          sendDisabled={sendDisabled}
          sendLoading={sendLoading}
          value={value}
          resize="vertical"
          onInputChange={handleInputChange}
          onPressEnter={handlePressEnter}
          conversationId={conversationId}
          createConversationBeforeUploadDocument={
            createConversationBeforeUploadDocument
          }
          stopOutputMessage={handleStopOutput}
          onUpload={handleUploadFile}
          isUploading={isUploading}
          removeFile={removeFile}
          showReasoning
          showInternet={showInternet}
          contextPromptTokens={contextPromptTokens}
          contextCompletionTokens={contextCompletionTokens}
          contextLength={contextLength}
          slashCommandVisible={slashCommandVisible}
          slashCommandContext={slashCommandContext}
          onSlashCommandExecuted={onSlashCommandExecuted}
          onSlashCommandClose={onSlashCommandClose}
          {...(isGatewayChat && onSelectedModelChange
            ? {
                modelValue: selectedModel,
                modelOptions: gatewayModels,
                onModelChange: onSelectedModelChange,
              }
            : {})}
        />
        {visible && (
          <PdfSheet
            visible={visible}
            hideModal={hideModal}
            documentId={documentId}
            chunk={selectedChunk}
          ></PdfSheet>
        )}
      </div>
    </section>
  );
}
