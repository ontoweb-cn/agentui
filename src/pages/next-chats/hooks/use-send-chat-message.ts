import { NextMessageInputOnPressEnterParameter } from '@/components/message-input/next';
import { MessageType } from '@/constants/chat';
import {
  useHandleMessageInputChange,
  useRegenerateMessage,
  useSelectDerivedMessages,
  useSendMessageWithSse,
} from '@/hooks/logic-hooks';
import { useSendAgentMessageWithSse } from '@/hooks/use-send-agent-message-with-sse';
import {
  clearInflight,
  loadInflight,
  mergeInflightTailMessages,
  saveInflight,
} from '@/hooks/use-inflight-state';
import { ChatApiAction, useDeleteMessage, useGetChatSearchParams, usePatchChat } from '@/hooks/use-chat-request';
import { useFetchAllAddedModels } from '@/hooks/use-llm-request';
import { ICommandContext, isSlashCommandVisible } from '@/interfaces/command';
import { IMessage } from '@/interfaces/database/chat';
import { GATEWAY_CHAT_AGENT_ID } from '@/services/gateway-chat-service';
import api from '@/utils/api';
import { useQueryClient } from '@tanstack/react-query';
import { trim } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { v4 as uuid } from 'uuid';
import { useCreateConversationBeforeSendMessage } from './use-chat-url';
import { useFindPrologueFromDialogList } from './use-select-conversation-list';
import { useUploadFile } from './use-upload-file';

export const useSelectNextMessages = () => {
  const {
    scrollRef,
    messageContainerRef,
    setDerivedMessages,
    derivedMessages,
    addNewestAnswer,
    addNewestQuestion,
    removeLatestMessage,
    removeMessageById,
    removeMessagesAfterCurrentMessage,
  } = useSelectDerivedMessages();
  const { isNew, conversationId } = useGetChatSearchParams();
  const { id: dialogId } = useParams();
  const prologue = useFindPrologueFromDialogList();

  const addPrologue = useCallback(() => {
    // Gateway chat: conversationId === dialogId, prologue 恒为空,跳过。
    // isNew=true 是 intellect-rag 延迟创建语义,对 Gateway chat 无效,
    // 且会覆盖正在加载的服务端消息,导致 chat 内容不显示。
    const isGatewayChat = conversationId === dialogId;
    if (dialogId !== '' && isNew === 'true' && !isGatewayChat) {
      const nextMessage = {
        role: MessageType.Assistant,
        content: prologue,
        id: uuid(),
        conversationId: conversationId,
      } as IMessage;

      setDerivedMessages([nextMessage]);
    }
  }, [conversationId, dialogId, isNew, prologue, setDerivedMessages]);

  useEffect(() => {
    addPrologue();
  }, [addPrologue]);

  return {
    scrollRef,
    messageContainerRef,
    derivedMessages,
    addNewestAnswer,
    addNewestQuestion,
    removeLatestMessage,
    removeMessageById,
    removeMessagesAfterCurrentMessage,
    setDerivedMessages,
  };
};

export const useSendMessage = (controller: AbortController) => {
  const { conversationId, isNew } = useGetChatSearchParams();
  const { handleInputChange, value, setValue } = useHandleMessageInputChange();

  const { handleUploadFile, isUploading, removeFile, files, clearFiles } =
    useUploadFile();

  const { id: chatId } = useParams();
  const queryClient = useQueryClient();
  // P0 评审 §3.1/§4-step4：同时调用两个 hook，根据 isGatewayChat 选择使用哪个的 send/answer/done。
  // useSendMessageWithSse 保持原样服务 RAG 增强路径（envelope-wrapped 格式），零回归。
  // useSendAgentMessageWithSse 服务 gateway 路径（BFF {event, data} 格式），按 event 路由避免 answer 被污染。
  const ragSse = useSendMessageWithSse();
  const gatewaySse = useSendAgentMessageWithSse();
  const {
    scrollRef,
    messageContainerRef,
    derivedMessages,
    addNewestAnswer,
    addNewestQuestion,
    removeLatestMessage,
    removeMessageById,
    removeMessagesAfterCurrentMessage,
    setDerivedMessages,
  } = useSelectNextMessages();

  // Gateway chat: conversationId === chatId（URL 结构特征）。
  // Gateway session ID 同时作为 route :id 和 query conversationId；
  // RAG chat 的 conversationId 是 chat 内部对话 ID，与 chatId 不同。
  // 注：曾用 chatListData?.chats.find(...)?.source === 'gateway' 判断，
  // 但 useFetchChatList 的 queryKey 含 pagination/search 参数且 gcTime=0，
  // 导致此处 getQueryData([FetchChatList]) 恒为 undefined，isGatewayChat 恒为 false。
  const isGatewayChat = conversationId === chatId;

  // 根据当前 chat 来源选择对应 hook 的状态（answer/done/send）
  const activeSse = isGatewayChat ? gatewaySse : ragSse;
  const { answer, done } = activeSse;

  const sendMessage = useCallback(
    async ({
      message,
      currentConversationId,
      messages,
      enableInternet,
      enableThinking,
    }: {
      message: IMessage;
      currentConversationId?: string;
      messages?: IMessage[];
    } & NextMessageInputOnPressEnterParameter) => {
      const sessionId = currentConversationId ?? conversationId;

      const send = isGatewayChat ? gatewaySse.send : ragSse.send;

      const res = isGatewayChat
        ? await send(
            api.agentChatCompletion,
            {
              session_id: sessionId,
              content: message.content,
              agent_id: GATEWAY_CHAT_AGENT_ID,
            },
            controller,
          )
        : await send(
            api.completionUrl,
            {
              chat_id: chatId,
              session_id: sessionId,
              messages: [
                ...(Array.isArray(messages) && messages?.length > 0
                  ? messages
                  : (derivedMessages ?? [])),
                message,
              ],
              pass_all_history_messages: true,
              reasoning: enableThinking,
              internet: enableInternet,
            },
            controller,
          );

      // P0 评审 §3.2：gateway 路径 BFF 流式成功时 res.data 是流响应的克隆 JSON（可能解析失败/空对象），
      // code 字段 undefined 不应触发 removeLatestMessage；仅当 code 显式为非 0 时才算错误。
      if (
        res &&
        (res?.response.status !== 200 ||
          (res?.data?.code !== undefined && res?.data?.code !== 0))
      ) {
        // cancel loading
        setValue(message.content);
        removeLatestMessage();
      }

      // P2：发送后立即保存 INFLIGHT 状态（包含 user 乐观消息），用于会话切换/页面刷新恢复
      // 注：updatedAt 由 saveInflight 内部覆盖，此处不传避免冗余（Q13）
      if (sessionId) {
        saveInflight({
          sessionId,
          messages: [...(derivedMessages ?? []), message],
          toolCalls: [],
          reasoning: '',
          uploadedFiles: [],
          updatedAt: Date.now(),
        });
      }
    },
    [
      derivedMessages,
      conversationId,
      chatId,
      queryClient,
      removeLatestMessage,
      setValue,
      ragSse.send,
      gatewaySse.send,
      isGatewayChat,
      controller,
    ],
  );

  const { regenerateMessage } = useRegenerateMessage({
    removeMessagesAfterCurrentMessage,
    sendMessage,
    messages: derivedMessages,
  });

  const { createConversationBeforeSendMessage } =
    useCreateConversationBeforeSendMessage();

  const handlePressEnter = useCallback(
    async ({
      enableThinking,
      enableInternet,
    }: NextMessageInputOnPressEnterParameter) => {
      if (trim(value) === '') return;

      const data = await createConversationBeforeSendMessage(value);

      if (data === undefined) {
        return;
      }

      const { targetConversationId, currentMessages } = data;

      const id = uuid();

      addNewestQuestion({
        content: value,
        files: files as any,
        id,
        role: MessageType.User,
        conversationId: targetConversationId,
      });

      if (done) {
        setValue('');
        sendMessage({
          currentConversationId: targetConversationId,
          messages: currentMessages,
          message: {
            id,
            content: value.trim(),
            role: MessageType.User,
            files: files as any,
            conversationId: targetConversationId,
          },
          enableInternet,
          enableThinking,
        });
      }

      clearFiles();

      // Auto scroll to bottom when sending new message
      if (messageContainerRef.current) {
        const el = messageContainerRef.current;

        requestAnimationFrame(() => {
          el.scrollTo({
            top: el.scrollHeight,
          });
        });
      }
    },
    [
      value,
      createConversationBeforeSendMessage,
      addNewestQuestion,
      files,
      done,
      clearFiles,
      setValue,
      sendMessage,
      messageContainerRef,
    ],
  );

  useEffect(() => {
    //  #1289
    // Gateway chat: conversationId === chatId，isNew=true 是 URL 参数遗留，
    // 不应阻止 answer 显示（Gateway session 已存在，非 intellect-rag 延迟创建语义）。
    const skipNew = isNew === 'true' && !isGatewayChat;
    if (answer.answer && conversationId && !skipNew) {
      addNewestAnswer(answer);
    }
  }, [answer, addNewestAnswer, conversationId, isNew, isGatewayChat]);

  // P1：gateway 路径实时接线 toolCalls/reasoning/liveReasoning/usage 到最新 assistant 消息
  // 仅在 gateway 路径且流式进行中（derivedMessages 最后一条为 assistant）时生效
  // P2-Q7 修复:pendingApproval 用语义比较(status+runId+submittedChoice)而非引用比较,
  // 避免每次 forceRender 创建新对象触发链式 effect。
  useEffect(() => {
    if (!isGatewayChat) return;
    if (!derivedMessages || derivedMessages.length === 0) return;
    const lastMsg = derivedMessages[derivedMessages.length - 1];
    if (lastMsg.role !== MessageType.Assistant) return;

    const patch = {
      toolCalls: gatewaySse.toolCalls,
      reasoning: gatewaySse.reasoning,
      usage: gatewaySse.usage ?? undefined,
      // P3: 透传 errorDetails 到最新 assistant 消息，供 ProviderErrorDetails 渲染
      errorDetails: gatewaySse.errorDetails,
      // v1.3.0: 透传 pendingApproval 到最新 assistant 消息,供 ApprovalCard 渲染
      // 注意:pendingApproval 为 null 时也写入(清除上一 turn 的残留状态)
      pendingApproval: gatewaySse.pendingApproval ?? undefined,
      // clarify: 透传 pendingClarify 到最新 assistant 消息,供 ClarifyCard 渲染
      // 注意:pendingClarify 为 null 时也写入(清除上一 turn 的残留状态)
      pendingClarify: gatewaySse.pendingClarify ?? undefined,
    };
    // 浅比较避免无变化时无谓 setState（forceRender 触发的 render 仍会执行此 effect）
    // P2-Q7: pendingApproval 用语义比较(因 ref.current 每次读取返回新对象引用)
    const pendingApprovalEqual = (() => {
      const a = lastMsg.pendingApproval;
      const b = patch.pendingApproval;
      if (a === b) return true;
      if (!a || !b) return a === b; // 一方为 undefined/null
      return (
        a.status === b.status &&
        a.runId === b.runId &&
        a.submittedChoice === b.submittedChoice &&
        a.toolName === b.toolName
      );
    })();
    // clarify: 同样用语义比较(因 ref.current 每次读取返回新对象引用)
    const pendingClarifyEqual = (() => {
      const a = lastMsg.pendingClarify;
      const b = patch.pendingClarify;
      if (a === b) return true;
      if (!a || !b) return a === b; // 一方为 undefined/null
      return (
        a.status === b.status &&
        a.clarifyId === b.clarifyId &&
        a.submittedAnswer === b.submittedAnswer &&
        a.question === b.question
      );
    })();
    if (
      lastMsg.toolCalls === patch.toolCalls &&
      lastMsg.reasoning === patch.reasoning &&
      lastMsg.usage === patch.usage &&
      lastMsg.errorDetails === patch.errorDetails &&
      pendingApprovalEqual &&
      pendingClarifyEqual
    ) {
      return;
    }
    setDerivedMessages((pre) => {
      if (!pre || pre.length === 0) return pre;
      const last = pre[pre.length - 1];
      if (last.role !== MessageType.Assistant) return pre;
      return [
        ...pre.slice(0, -1),
        { ...last, ...patch },
      ];
    });
  }, [
    isGatewayChat,
    gatewaySse.toolCalls,
    gatewaySse.reasoning,
    gatewaySse.usage,
    gatewaySse.errorDetails,
    gatewaySse.pendingApproval,
    gatewaySse.pendingClarify,
    derivedMessages,
    setDerivedMessages,
  ]);

  // P2：流式进行中节流保存 INFLIGHT 状态（2s 节流，token 增量场景）
  useEffect(() => {
    if (!isGatewayChat || !conversationId) return;
    if (!gatewaySse.isStreaming) return;
    if (!derivedMessages || derivedMessages.length === 0) return;
    saveInflight(
      {
        sessionId: conversationId,
        messages: derivedMessages,
        toolCalls: gatewaySse.toolCalls,
        reasoning: gatewaySse.reasoning,
        uploadedFiles: [],
        updatedAt: Date.now(),
      },
      true, // throttle=true
    );
  }, [
    isGatewayChat,
    conversationId,
    gatewaySse.isStreaming,
    gatewaySse.toolCalls,
    gatewaySse.reasoning,
    derivedMessages,
  ]);

  // P2：流完成时立即清除 INFLIGHT 状态（server 已持久化，避免重复显示）
  // 同时兼容 RAG 路径（done 转为 true 时清除）
  // 并触发 chat list / chat 详情缓存刷新,让 Gateway 自动生成的 session title
  // 同步到左侧 Sessions 列表和顶部标题(useFetchSessionList 依赖 useFetchChat 缓存)。
  const prevDoneRef = useRef(done);
  useEffect(() => {
    const prevDone = prevDoneRef.current;
    prevDoneRef.current = done;
    // done 从 false → true 表示流完成
    if (prevDone === false && done === true && conversationId) {
      clearInflight(conversationId);
      // Gateway chat:刷新 chat 列表和当前 chat 详情,同步 session title。
      // useFetchChatList 重新拉取会更新 IDialog.name(来自 Gateway session.title),
      // useFetchChat 缓存失效后 useFetchSessionList 也会重新读取最新 title。
      if (isGatewayChat && chatId) {
        queryClient.invalidateQueries({
          queryKey: [ChatApiAction.FetchChatList],
        });
        queryClient.invalidateQueries({
          queryKey: [ChatApiAction.FetchChat, chatId],
        });
      }
    }
  }, [done, conversationId, isGatewayChat, chatId, queryClient]);

  // P2：会话切换时加载 INFLIGHT 状态并合并到 derivedMessages
  // 合并时序参考方案 §4.1.3：server-side messages 加载完成后，append inflight tail（用 id 去重）
  //
  // Q1 修复：原实现依赖 [conversationId, isNew]，当 server-side messages 异步加载完成
  // （derivedMessages 从 [] 变为 [m1, m2]）时 effect 不会重新触发，导致 inflight tail 永不合并。
  // 修复：加入 derivedMessages 作为依赖，配合 mergedRef 避免重复合并。
  // - mergedRef 记录已合并的 sessionId，conversationId 变化时由下面 effect 清空
  // - 合并成功或确认无 inflight 后标记，避免 derivedMessages 后续变化重复触发
  const inflightMergedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // 切换会话时清空 mergedRef 中本会话的标记，允许新会话的 inflight 合并
    inflightMergedRef.current.delete(conversationId);
  }, [conversationId]);
  useEffect(() => {
    if (!conversationId) return;
    if (isNew === 'true') return; // 新会话无 inflight
    if (inflightMergedRef.current.has(conversationId)) return;
    const inflight = loadInflight(conversationId);
    if (!inflight || inflight.messages.length === 0) {
      // 无 inflight，标记已处理避免后续 derivedMessages 变化重复触发
      inflightMergedRef.current.add(conversationId);
      return;
    }
    // 仅在 derivedMessages 已加载（非空且包含 server 数据）时合并
    // 避免在 prologue 阶段误触发
    if (!derivedMessages || derivedMessages.length === 0) return;
    inflightMergedRef.current.add(conversationId);
    setDerivedMessages((prev) => {
      if (!prev || prev.length === 0) return prev;
      return mergeInflightTailMessages(prev, inflight.messages);
    });
  }, [conversationId, isNew, derivedMessages, setDerivedMessages]);

  // P3: 提前计算 isStreaming / contextPromptTokens 等，供 Slash 命令上下文使用
  const isStreaming = isGatewayChat ? gatewaySse.isStreaming : !done;
  const contextPromptTokens = isGatewayChat
    ? gatewaySse.usage?.promptTokens ?? 0
    : 0;
  const contextCompletionTokens = isGatewayChat
    ? gatewaySse.usage?.completionTokens
    : undefined;
  const contextLength = isGatewayChat
    ? gatewaySse.usage?.contextLength
    : undefined;

  // P3: Slash 命令面板可见性（Q2: 复用公共函数 isSlashCommandVisible）
  const slashCommandVisible = useMemo(() => isSlashCommandVisible(value), [value]);

  // P3: 命令执行后清空 textarea value
  const handleSlashCommandExecuted = useCallback(() => {
    setValue('');
  }, [setValue]);

  // S3 修复：Esc 关闭面板时不清空 value，仅设置独立的面板关闭状态
  // 用户可能输入了 "/retry 请重新生成" 后想取消面板但保留文本，不应丢失输入
  const [slashPaletteForceHidden, setSlashPaletteForceHidden] = useState(false);
  // 当 value 变化时重置 forceHidden，允许面板重新显示
  useEffect(() => {
    setSlashPaletteForceHidden(false);
  }, [value]);
  const handleSlashCommandClose = useCallback(() => {
    setSlashPaletteForceHidden(true);
  }, []);
  // 实际可见性 = slashCommandVisible && !forceHidden
  const slashPaletteVisible = slashCommandVisible && !slashPaletteForceHidden;

  // Q6 + Batch 1-B: /undo 实现 - 删除最后一条 user 消息及其后所有消息
  // 设计决策（PU1 评审）：
  // - 乐观删除：先 setDerivedMessages 本地删除，再异步调用 useDeleteMessage 同步 server
  // - 部分失败处理：循环调用单条删除，失败时 toast 提示但不回滚（与 message-item 删除按钮行为一致）
  // - 不新增批量删除 API（YAGNI，避免 BFF 改动）
  //
  // L5 修复:改用函数式 setDerivedMessages(prev => ...)，
  // 避免 handleSlashUndo 创建后、执行前有新消息到达（如流式 token）时丢失新消息。
  const { deleteMessage } = useDeleteMessage();
  const handleSlashUndo = useCallback(async () => {
    // 在 setDerivedMessages updater 内计算 toDelete，确保基于最新 state
    let toDelete: IMessage[] = [];
    setDerivedMessages((prev) => {
      if (!prev || prev.length === 0) return prev;
      // 找到最后一条 user 消息
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === MessageType.User) {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return prev; // 无 user 消息，不变
      toDelete = prev.slice(lastUserIdx);
      return prev.slice(0, lastUserIdx);
    });

    // setDerivedMessages updater 同步执行，此处已拿到 toDelete
    if (toDelete.length === 0) {
      // 无可删除消息（列表为空或无 user 消息）
      // 重新读取 derivedMessages 用于 toast 提示
      if (!derivedMessages || derivedMessages.length === 0) {
        toast('No message to undo');
      } else {
        toast('No user message to undo');
      }
      return;
    }

    // 异步同步 server（循环调用单条删除）
    let failedCount = 0;
    for (const msg of toDelete) {
      if (!msg.id) continue;
      try {
        await deleteMessage(msg.id);
      } catch {
        failedCount++;
      }
    }
    if (failedCount > 0) {
      toast(`Undid locally, ${failedCount} message(s) failed to sync to server`);
    } else {
      toast('Undid last user message');
    }
  }, [derivedMessages, setDerivedMessages, deleteMessage]);

  // P3: /status 实现 - toast 显示会话状态
  const handleSlashStatus = useCallback(() => {
    toast(`Session: ${conversationId ?? 'N/A'}\nStreaming: ${String(isStreaming)}`);
  }, [conversationId, isStreaming]);

  // P3: /usage 实现 - toast 显示上一 turn token 用量
  const handleSlashUsage = useCallback(() => {
    const prompt = contextPromptTokens;
    const completion = contextCompletionTokens ?? 0;
    toast(`Prompt: ${prompt}\nCompletion: ${completion}\nTotal: ${prompt + completion}`);
  }, [contextPromptTokens, contextCompletionTokens]);

  // Batch 1-C: /model 实现 - 实际切换模型
  // 设计决策（PM1 评审）：
  // - 通过 patchChat 持久化 llm_id 到 server，下次发送时生效
  // - 从 useFetchAllAddedModels 查找匹配 model name 的完整 llm_id 格式
  // - llm_id 格式：${modelName}@${instance_name}@${provider_name}
  const { patchChat } = usePatchChat();
  const { data: allAddedModels } = useFetchAllAddedModels();
  const handleSlashSwitchModel = useCallback(
    async (modelName: string) => {
      if (!chatId) {
        toast('Chat ID not available');
        return;
      }
      // 从 allAddedModels 中查找匹配的模型
      const target = allAddedModels.find((m) => m.name === modelName);
      if (!target) {
        toast(`Model not found: ${modelName}`);
        return;
      }
      // 构造完整 llm_id 格式
      const llmId = `${target.name}@${target.instance_name}@${target.provider_name}`;
      try {
        await patchChat({
          chatId,
          params: { llm_id: llmId },
        });
        toast(`Switched to model: ${modelName}`);
      } catch {
        toast(`Failed to switch model: ${modelName}`);
      }
    },
    [chatId, allAddedModels, patchChat],
  );

  // P3: ICommandContext 实例化
  const slashCommandContext: ICommandContext = useMemo(
    () => ({
      retry: () => {
        // 复用 regenerateMessage：取最后一条 assistant 消息
        const lastAssistant = [...(derivedMessages ?? [])]
          .reverse()
          .find((m) => m.role === MessageType.Assistant);
        if (lastAssistant) {
          regenerateMessage(lastAssistant);
        } else {
          toast('No assistant message to retry');
        }
      },
      undo: handleSlashUndo,
      status: handleSlashStatus,
      usage: handleSlashUsage,
      switchModel: handleSlashSwitchModel,
    }),
    [
      derivedMessages,
      regenerateMessage,
      handleSlashUndo,
      handleSlashStatus,
      handleSlashUsage,
      handleSlashSwitchModel,
    ],
  );

  return {
    handlePressEnter,
    handleInputChange,
    value,
    setValue,
    regenerateMessage,
    sendLoading: !done,
    scrollRef,
    messageContainerRef,
    derivedMessages,
    removeMessageById,
    handleUploadFile,
    isUploading,
    removeFile,
    setDerivedMessages,
    // P1：暴露 gateway 路径的实时流式状态（供 message-item 渲染 ToolCallCard / ReasoningPanel）
    isStreaming,
    liveReasoning: isGatewayChat ? gatewaySse.liveReasoning : '',
    // P2：Context ring 数据（上一 turn 的 token 用量，仅 gateway 路径暴露）
    // Q4: contextLength 从 usage.contextLength 读取（BFF 后续扩展透传，当前 undefined 走默认 128000）
    contextPromptTokens,
    contextCompletionTokens,
    contextLength,
    // P3: Slash 命令面板
    // 注：暴露 slashPaletteVisible（含 forceHidden 逻辑），外层直接使用
    slashCommandVisible: slashPaletteVisible,
    slashCommandContext,
    onSlashCommandExecuted: handleSlashCommandExecuted,
    onSlashCommandClose: handleSlashCommandClose,
    // v1.3.0: 工具审批提交方法(仅 gateway 路径有效,RAG 路径为 noop)
    // ApprovalCard 按钮组 onClick 调用此方法,提交后 BFF 转发到 intellect-team
    submitApproval: isGatewayChat
      ? gatewaySse.submitApproval
      : // RAG 路径不支持审批,返回 noop(永不 resolve,因 RAG 不产出 approval_request)
        async () => false,
    // clarify: 澄清回答提交方法(仅 gateway 路径有效,RAG 路径为 noop)
    // ClarifyCard 输入框/choice 按钮 onClick 调用此方法
    submitClarify: isGatewayChat
      ? gatewaySse.submitClarify
      : async () => false,
  };
};
