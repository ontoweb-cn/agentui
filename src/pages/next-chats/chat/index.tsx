import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useFetchChat,
  useFetchSessionManually,
  useGetChatSearchParams,
} from '@/hooks/use-chat-request';
import { IClientConversation } from '@/interfaces/database/chat';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { RootLayoutContainer } from '@/layouts/root-layout';
import { cn } from '@/lib/utils';
import { useMount } from 'ahooks';
import { isEmpty } from 'lodash';
import { LucideArrowBigLeft, LucideArrowUpRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useHandleClickConversationCard } from '../hooks/use-click-card';
import { ChatSettings } from './app-settings/chat-settings';
import { MultipleChatBox } from './chat-box/next-multiple-chat-box';
import { SingleChatBox } from './chat-box/single-chat-box';
import { Sessions } from './sessions';
import { useAddChatBox } from './use-add-box';
import { useSwitchDebugMode } from './use-switch-debug-mode';

export default function Chat() {
  const { t } = useTranslation();
  const { mode } = useLayoutMode();
  const [currentConversation, setCurrentConversation] =
    useState<IClientConversation>({} as IClientConversation);

  const { fetchSessionManually } = useFetchSessionManually();

  const { handleConversationCardClick, controller, stopOutputMessage } =
    useHandleClickConversationCard();

  const { isDebugMode, switchDebugMode } = useSwitchDebugMode();
  const { removeChatBox, addChatBox, chatBoxIds, hasSingleChatBox } =
    useAddChatBox(isDebugMode);

  const { conversationId, isNew } = useGetChatSearchParams();
  const { id: chatId } = useParams();

  // 顶部标题直接使用 useFetchChat 的 name（与 sessions.tsx 共享缓存）。
  // 不从 useFetchSessionList 间接读取，因为 useFetchSessionList 的 queryFn
  // 从 useFetchChat 缓存读取 title，但页面首次加载时缓存可能还没准备好，
  // 导致返回空 name。useFetchChat 自身完成请求后 React Query 会自动触发重渲染。
  const { data: chatData } = useFetchChat();

  const currentConversationName = useMemo(() => {
    return chatData?.name || t('chat.newConversation');
  }, [chatData, t]);

  const fetchConversation: typeof handleConversationCardClick = useCallback(
    async (conversationId, isNew) => {
      // Gateway chat: conversationId === chatId (route :id), session 始终存在于服务端,
      // 即使 URL 残留 isNew=true 也必须加载消息（isNew 是 intellect-rag 延迟创建语义,对 Gateway 无效）。
      // 此外,刷新页面时 URL 中可能没有 conversationId 查询参数（只有路由 :id）,
      // 此时若 chatId 存在应直接用 chatId 加载(Gateway session = chat)。
      const effectiveConversationId = conversationId || chatId;
      const isGatewayChat =
        !!effectiveConversationId && effectiveConversationId === chatId;
      if (effectiveConversationId && (!isNew || isGatewayChat)) {
        try {
          const conversation =
            await fetchSessionManually(effectiveConversationId);
          if (!isEmpty(conversation)) {
            setCurrentConversation(conversation);
          }
        } catch (err) {
          // 新建 Gateway session 首次进入可能 404,静默处理。
          console.debug('[chat] fetchSessionManually failed:', err);
        }
      }
    },
    [fetchSessionManually, chatId],
  );

  const handleSessionClick: typeof handleConversationCardClick = useCallback(
    (conversationId, isNew) => {
      handleConversationCardClick(conversationId, isNew);
      fetchConversation(conversationId, isNew);
    },
    [fetchConversation, handleConversationCardClick],
  );

  useMount(() => {
    fetchConversation(conversationId, isNew === 'true');
  });

  if (isDebugMode) {
    return (
      <section
        className="pt-5 pb-14 h-[100vh] flex flex-col"
        data-testid="chat-detail-multimodel-root"
      >
        <header className="px-10 pb-5">
          <div className="mb-5">
            <Button
              variant="outline"
              onClick={switchDebugMode}
              data-testid="chat-detail-multimodel-back"
            >
              <LucideArrowBigLeft />
              <span>{t('common.back')}</span>
            </Button>
          </div>

          <span className="text-2xl">
            {t('chat.multipleModels')} ({chatBoxIds.length}/3)
          </span>
        </header>

        <MultipleChatBox
          chatBoxIds={chatBoxIds}
          controller={controller}
          removeChatBox={removeChatBox}
          addChatBox={addChatBox}
          stopOutputMessage={stopOutputMessage}
          conversation={currentConversation}
        ></MultipleChatBox>
      </section>
    );
  }

  const chatContent = (
    <section className="h-full flex flex-col" data-testid="chat-detail">
      <article className="flex flex-1 min-h-0 pb-9">
        <Sessions handleConversationCardClick={handleSessionClick}></Sessions>

        <Card className="flex-1 min-w-0 bg-transparent border-none shadow-none h-full">
          <CardContent className="flex p-0 h-full">
            <Card className="flex flex-col flex-1 bg-transparent min-w-0">
              <CardHeader
                className={cn('p-5', {
                  'border-b-0.5 border-border-button': hasSingleChatBox,
                })}
              >
                <CardTitle className="flex justify-between items-center text-base gap-2">
                  <div className="truncate">{currentConversationName}</div>

                  <Button
                    variant="ghost"
                    onClick={switchDebugMode}
                    data-testid="chat-detail-multimodel-toggle"
                  >
                    <LucideArrowUpRight />
                    {t('chat.multipleModels')}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 min-h-0">
                <SingleChatBox
                  controller={controller}
                  stopOutputMessage={stopOutputMessage}
                  conversation={currentConversation}
                />
              </CardContent>
            </Card>

            <ChatSettings hasSingleChatBox={hasSingleChatBox}></ChatSettings>
          </CardContent>
        </Card>
      </article>
    </section>
  );

  // three-column 模式下布局由父级 RootLayout 的 ThreeColumnLayout 承载
  if (mode === 'three-column') {
    return chatContent;
  }

  return <RootLayoutContainer>{chatContent}</RootLayoutContainer>;
}
