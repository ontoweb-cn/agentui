import { ChatSearchParams } from '@/constants/chat';
import { useGetChatSearchParams } from '@/hooks/use-chat-request';
import { IMessage } from '@/interfaces/database/chat';
import { useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useSetConversation } from './use-set-conversation';

/**
 * Consolidated hook for managing chat URL parameters (conversationId and isNew)
 * Replaces: useClickConversationCard from use-chat-request.ts and useSetChatRouteParams from use-set-chat-route.ts
 */
export const useChatUrlParams = () => {
  const [currentQueryParameters, setSearchParams] = useSearchParams();
  const newQueryParameters: URLSearchParams = useMemo(
    () => new URLSearchParams(currentQueryParameters.toString()),
    [currentQueryParameters],
  );

  const setConversationId = useCallback(
    (conversationId: string) => {
      newQueryParameters.set(ChatSearchParams.ConversationId, conversationId);
      setSearchParams(newQueryParameters);
    },
    [setSearchParams, newQueryParameters],
  );

  const setIsNew = useCallback(
    (isNew: string) => {
      newQueryParameters.set(ChatSearchParams.isNew, isNew);
      setSearchParams(newQueryParameters);
    },
    [setSearchParams, newQueryParameters],
  );

  const getIsNew = useCallback(() => {
    return newQueryParameters.get(ChatSearchParams.isNew);
  }, [newQueryParameters]);

  const setConversationBoth = useCallback(
    (conversationId: string, isNew: string) => {
      newQueryParameters.set(ChatSearchParams.ConversationId, conversationId);
      newQueryParameters.set(ChatSearchParams.isNew, isNew);
      setSearchParams(newQueryParameters);
    },
    [setSearchParams, newQueryParameters],
  );

  return {
    setConversationId,
    setIsNew,
    getIsNew,
    setConversationBoth,
  };
};

export function useCreateConversationBeforeSendMessage() {
  const { conversationId, isNew } = useGetChatSearchParams();
  const { setConversation } = useSetConversation();
  const { setConversationBoth } = useChatUrlParams();
  const { id: chatId } = useParams();

  // Create conversation if it doesn't exist
  const createConversationBeforeSendMessage = useCallback(
    async (value: string) => {
      let currentMessages: Array<IMessage> = [];

      // 评审文档 §3.2：Gateway chat 的 session 本身就是 conversation，
      // 无需调用 intellect-rag-app 的 createSession 接口。
      // 直接用 chatId（URL 路由参数，即 Gateway session ID）作为 conversationId。
      if (conversationId === '' || isNew === 'true') {
        // Gateway chat 判定：(conversationId || chatId) === chatId（URL 结构特征）。
        // conversationId 为空时（页面直接加载/刷新），回退到 chatId 判断：
        // Gateway chat 的 session 就是 chat 本身，chatId 即 session ID。
        // 与 use-send-chat-message.ts 和 chat/index.tsx 的判断保持一致。
        const isGatewayChat = (conversationId || chatId) === chatId;

        if (isGatewayChat) {
          // Gateway chat：session 已存在，直接复用 chatId 作为 conversationId。
          setConversationBoth(chatId!, '');
          return {
            targetConversationId: chatId!,
            currentMessages,
          };
        }

        // intellect-rag chat：调用 createSession 创建 conversation。
        const data = await setConversation(value);
        if (!data || data.code !== 0) {
          return;
        }
        const backendConvId = data.data.id;
        setConversationBoth(backendConvId, '');
        currentMessages = data.data.messages;
        return {
          targetConversationId: backendConvId,
          currentMessages,
        };
      }

      return {
        targetConversationId: conversationId,
        currentMessages,
      };
    },
    [
      conversationId,
      isNew,
      setConversation,
      setConversationBoth,
      chatId,
    ],
  );

  return {
    createConversationBeforeSendMessage,
  };
}

export type CreateConversationBeforeSendMessageType = ReturnType<
  typeof useCreateConversationBeforeSendMessage
>['createConversationBeforeSendMessage'];

export type CreateConversationBeforeSendMessageReturnType = Awaited<
  ReturnType<CreateConversationBeforeSendMessageType>
>;
