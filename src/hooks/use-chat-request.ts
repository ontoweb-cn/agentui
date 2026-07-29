import { FileUploadProps } from '@/components/file-upload';
import message from '@/components/ui/message';
import { ChatSearchParams } from '@/constants/chat';
import { MessageType } from '@/constants/chat';
import {
  IClientConversation,
  IConversation,
  IDialog,
  IExternalChatInfo,
  IMessage,
} from '@/interfaces/database/chat';
import {
  IAskRequestBody,
  IFeedbackRequestBody,
} from '@/interfaces/request/chat';
import { useGetSharedChatSearchParams } from '@/pages/next-chats/hooks/use-send-shared-message';
import chatService from '@/services/next-chat-service';
import gatewayChatService, {
  GATEWAY_CHAT_AGENT_ID,
} from '@/services/gateway-chat-service';
import api from '@/utils/api';
import { buildMessageListWithUuid } from '@/utils/chat';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'ahooks';
import { has } from 'lodash';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import {
  useGetPaginationWithRouter,
  useHandleSearchChange,
} from './logic-hooks';
import { useHandleSearchStrChange } from './logic-hooks/use-change-search';

export const enum ChatApiAction {
  FetchChatList = 'fetchChatList',
  DeleteChat = 'deleteChat',
  CreateChat = 'createChat',
  UpdateChat = 'updateChat',
  PatchChat = 'patchChat',
  FetchChat = 'fetchChat',
  FetchSessionList = 'fetchSessionList',
  FetchSession = 'fetchSession',
  FetchSessionManually = 'fetchSessionManually',
  CreateSession = 'createSession',
  UpdateSession = 'updateSession',
  RemoveSession = 'removeSession',
  DeleteMessage = 'deleteMessage',
  FetchMindMap = 'fetchMindMap',
  FetchRelatedQuestions = 'fetchRelatedQuestions',
  UploadAndParse = 'upload_and_parse',
  FetchExternalChatInfo = 'fetchExternalChatInfo',
  Feedback = 'feedback',
  CreateSharedConversation = 'createSharedConversation',
}

export const useGetChatSearchParams = () => {
  const [currentQueryParameters] = useSearchParams();

  return {
    dialogId: currentQueryParameters.get(ChatSearchParams.DialogId) || '',
    conversationId:
      currentQueryParameters.get(ChatSearchParams.ConversationId) || '',
    isNew: currentQueryParameters.get(ChatSearchParams.isNew) || '',
  };
};

/**
 * 将 Gateway Session 响应映射为 IDialog 形状。
 * Gateway session 模型只有 6 个字段(id/agentId/title/createdAt/updatedAt),
 * 其余字段用默认值填充以满足 IDialog 类型约束。
 */
function mapGatewaySessionToDialog(s: any): IDialog {
  return {
    id: String(s.id ?? ''),
    name: s.title || s.name || 'New Chat',
    description: '',
    icon: '',
    dataset_ids: [],
    kb_names: [],
    language: 'English',
    llm_id: '',
    llm_setting: {},
    prompt_config: {
      empty_response: '',
      parameters: [],
      prologue: '',
      system: '',
      quote: false,
      keyword: false,
      refine_multiturn: false,
      use_kg: false,
    },
    prompt_type: 'simple',
    status: 'VALID',
    tenant_id: '',
    create_date: s.createdAt || s.created_at || '',
    update_date: s.updatedAt || s.updated_at || '',
    create_time: 0,
    update_time: 0,
    vector_similarity_weight: 0,
    similarity_threshold: 0,
    top_k: 0,
    top_n: 0,
    meta_data_filter: { manual: [], method: '' },
    source: 'gateway' as const,
  };
}

export const useFetchChatList = () => {
  const { searchString, handleInputChange } = useHandleSearchChange();
  const { pagination, setPagination } = useGetPaginationWithRouter();
  const debouncedSearchString = useDebounce(searchString, { wait: 500 });

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<{ chats: IDialog[]; total: number }>({
    queryKey: [
      ChatApiAction.FetchChatList,
      {
        debouncedSearchString,
        ...pagination,
      },
    ],
    initialData: { chats: [], total: 0 },
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // intellect-rag chat 功能已全部迁移到 Gateway,
      // 仅调 gatewayChatService.listGatewayChats()。
      // BFF 返回 Session[] 数组(无 code/data 信封)。
      const { data: sessions } = await gatewayChatService.listGatewayChats();
      const sessionList = Array.isArray(sessions) ? sessions : [];
      let chats: IDialog[] = sessionList.map((s) => {
        const dialog = mapGatewaySessionToDialog(s);
        // 前端侧临时方案:优先使用 localStorage 中保存的用户自定义 name,
        // 避免列表显示被 Gateway 自动生成的 title 覆盖。
        const storedName = dialog.id
          ? localStorage.getItem(`chat_app_name_${dialog.id}`)
          : null;
        if (storedName) {
          dialog.name = storedName;
        }
        return dialog;
      });

      // 客户端关键词过滤(Gateway 不支持服务端搜索)
      if (debouncedSearchString) {
        chats = chats.filter((c) =>
          c.name.toLowerCase().includes(debouncedSearchString.toLowerCase()),
        );
      }

      // 客户端分页(Gateway 返回全量,前端切片)
      const start = (pagination.current - 1) * pagination.pageSize;
      const paged = chats.slice(start, start + pagination.pageSize);

      return {
        chats: paged,
        total: chats.length,
      };
    },
  });

  const onInputChange: React.ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      handleInputChange(e);
    },
    [handleInputChange],
  );

  return {
    data,
    loading,
    refetch,
    searchString,
    handleInputChange: onInputChange,
    pagination: { ...pagination, total: data?.total },
    setPagination,
  };
};

export const useDeleteChat = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.DeleteChat],
    mutationFn: async (chatId: string) => {
      // Gateway session 删除:BFF 返回 { code:0, message:'ok' }
      const { data } = await gatewayChatService.deleteGatewayChat(
        {
          url: api.deleteAgentSession(GATEWAY_CHAT_AGENT_ID, chatId),
        },
        true,
      );
      if (data?.code === 0) {
        // 清理 localStorage 中保存的用户自定义 name(前端临时方案的兜底数据)
        localStorage.removeItem(`chat_app_name_${chatId}`);
        queryClient.invalidateQueries({
          queryKey: [ChatApiAction.FetchChatList],
        });
        message.success(t('message.deleted'));
      }
      return data?.code;
    },
  });

  return { data, loading, deleteChat: mutateAsync };
};

export const useCreateChat = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.CreateChat],
    mutationFn: async (params: Record<string, any>) => {
      // 统一调 Gateway session 创建。
      // BFF 返回 Session 域对象 { id, agentId, title, ... },无 { code, data } 信封。
      const { data: session } = await gatewayChatService.createGatewayChat({
        name: params.name,
      });
      if (session?.id) {
        // 前端侧临时方案:将用户设置的 name 存入 localStorage。
        // 根因:Gateway 的 run_conversation 在首轮对话时会自动生成 title 并覆盖用户设置的值,
        // 而 Gateway session 模型当前没有"用户自定义 name"字段与"title"分离。
        // 此处保存原始 name,供 useFetchChat 读取,避免被 Gateway 自动生成的 title 覆盖。
        // 待 Gateway 端完善相关字段后,移除此 localStorage 兜底,改为同步到 Gateway。
        localStorage.setItem(
          `chat_app_name_${session.id}`,
          params.name,
        );
        queryClient.invalidateQueries({
          exact: false,
          queryKey: [ChatApiAction.FetchChatList],
        });
        message.success(t('message.created'));
        return 0;
      }
      return -1;
    },
  });

  return { data, loading, createChat: mutateAsync };
};

export const useUpdateChat = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.UpdateChat],
    mutationFn: async ({
      chatId,
      params,
    }: {
      chatId: string;
      params: Record<string, any>;
    }) => {
      // Gateway session 仅支持 title 字段更新,其余字段(LLM/dataset/prompt 配置)忽略。
      // ChatSettings 页面已对 Gateway chat 隐藏,此 hook 仅作向后兼容保留。
      const { data } = await gatewayChatService.patchGatewayChat(
        {
          url: api.patchAgentSession(GATEWAY_CHAT_AGENT_ID, chatId),
          data: { name: params.name, title: params.name },
        },
        true,
      );
      if (data) {
        // 同步更新 localStorage 中的用户自定义 name(前端临时方案)
        if (typeof params.name === 'string') {
          localStorage.setItem(`chat_app_name_${chatId}`, params.name);
        }
        queryClient.invalidateQueries({
          exact: false,
          queryKey: [ChatApiAction.FetchChatList],
        });
        queryClient.invalidateQueries({ queryKey: [ChatApiAction.FetchChat] });
        message.success(t('message.modified'));
      }
      return 0;
    },
  });

  return { data, loading, updateChat: mutateAsync };
};

export const usePatchChat = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.PatchChat],
    mutationFn: async ({
      chatId,
      params,
    }: {
      chatId: string;
      params: Record<string, any>;
    }) => {
      // Gateway PATCH /api/sessions/{id} 仅支持 title 字段。
      const { data } = await gatewayChatService.patchGatewayChat(
        {
          url: api.patchAgentSession(GATEWAY_CHAT_AGENT_ID, chatId),
          data: { name: params.name, title: params.name },
        },
        true,
      );
      if (data) {
        // 同步更新 localStorage 中的用户自定义 name(前端临时方案)
        if (typeof params.name === 'string') {
          localStorage.setItem(`chat_app_name_${chatId}`, params.name);
        }
        queryClient.invalidateQueries({
          exact: false,
          queryKey: [ChatApiAction.FetchChatList],
        });
        queryClient.invalidateQueries({ queryKey: [ChatApiAction.FetchChat] });
        message.success(t('message.modified'));
      }
      return 0;
    },
  });

  return { data, loading, patchChat: mutateAsync };
};

export const useFetchChat = () => {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IDialog>({
    queryKey: [ChatApiAction.FetchChat, id],
    gcTime: 0,
    initialData: {} as IDialog,
    enabled: !!id,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Gateway chat 详情:优先复用列表缓存(避免单独请求)。
      // 若列表未加载(如深度链接直接进入),调 getGatewayChat 获取。
      const chatListData = queryClient.getQueryData<{
        chats: IDialog[];
        total: number;
      }>([ChatApiAction.FetchChatList]);
      const fromList = chatListData?.chats.find((c) => c.id === id);
      let dialog: IDialog;
      if (fromList) {
        dialog = fromList;
      } else {
        // 列表未命中,单独请求 Gateway session 详情。
        const { data: session } = await gatewayChatService.getGatewayChat(
          {
            url: api.fetchAgentSessionById(GATEWAY_CHAT_AGENT_ID, id!),
          },
          true,
        );
        dialog = mapGatewaySessionToDialog(session);
      }

      // 前端侧临时方案:优先使用 localStorage 中保存的用户自定义 name。
      // 根因:Gateway run_conversation 首轮会自动生成 title 覆盖用户设置的值,
      // 而 Gateway session 模型当前没有"用户自定义 name"字段与"title"分离。
      // 待 Gateway 端完善相关字段后,移除此兜底。
      const storedName = id
        ? localStorage.getItem(`chat_app_name_${id}`)
        : null;
      if (storedName) {
        dialog = { ...dialog, name: storedName };
      }
      return dialog;
    },
  });

  return { data, loading, refetch };
};

//#region Session

/**
 * Gateway session = chat(一对一),不存在 intellect-rag 的 chat → sessions 嵌套概念。
 * 本 hook 返回单个 conversation(基于当前 chat 构造),供前端 conversation 切换逻辑使用。
 *
 * 标题来源:复用 useFetchChat 缓存的 Gateway session title(由 mapGatewaySessionToDialog
 * 从 s.title 映射),避免硬编码 'Default'。Gateway 在 POST /v1/runs 时会自动根据首条
 * 消息更新 session title,本 hook 通过 queryClient 缓存订阅自动同步。
 */
export const useFetchSessionList = () => {
  const { id } = useParams();
  const { searchString, handleInputChange } = useHandleSearchStrChange();
  const queryClient = useQueryClient();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IConversation[]>({
    queryKey: [ChatApiAction.FetchSessionList, id],
    initialData: [],
    gcTime: 0,
    refetchOnWindowFocus: false,
    enabled: !!id,
    select(data) {
      return searchString
        ? data.filter((x) => x.name.includes(searchString))
        : data;
    },
    queryFn: async () => {
      // 从 useFetchChat 缓存读取真实 session title(Gateway 自动生成/用户手动改名)。
      // useFetchChat 的 queryKey 为 [FetchChat, id],缓存命中时返回 IDialog.name。
      const chatCache = queryClient.getQueryData<IDialog>([
        ChatApiAction.FetchChat,
        id,
      ]);
      const sessionName = chatCache?.name || '';
      return [
        {
          id: id!,
          chat_id: id!,
          name: sessionName,
          messages: [],
          reference: [],
          avatar: '',
          is_new: true,
          create_date: '',
          update_date: '',
          create_time: 0,
          update_time: 0,
        } as IConversation,
      ];
    },
  });

  return { data, loading, refetch, searchString, handleInputChange };
};

/**
 * 获取会话历史消息(Gateway GET /api/sessions/{id}/messages)。
 * 将 Gateway 消息格式映射为前端 IClientConversation。
 */
export function useFetchSessionManually() {
  const { id: chatId } = useParams();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation<IClientConversation, unknown, string>({
    mutationKey: [ChatApiAction.FetchSessionManually],
    mutationFn: async (sessionId) => {
      // Gateway session = chat,sessionId 等于 chatId。
      // 调 BFF GET /agents/:agentId/sessions/:sessionId/messages 获取历史。
      const { data: resp } = await gatewayChatService.getGatewaySessionMessages(
        {
          url: api.fetchAgentSessionMessages(
            GATEWAY_CHAT_AGENT_ID,
            chatId || sessionId,
          ),
        },
        true,
      );

      // BFF 返回 { messages: [...] },每条消息 { id, role, content, tool_call_id, tool_calls, tool_name, timestamp, finish_reason }
      // Gateway 消息有三种 role:
      // - user: 用户消息
      // - assistant: Agent 回复,可能含 content(文本) 和 tool_calls(工具调用数组)
      // - tool: 工具执行结果,含 content(结果)、tool_call_id、tool_name
      //
      // 前端展示需求:
      // - user/assistant 消息作为气泡渲染
      // - assistant 的 tool_calls 映射为 ToolCallRecord[] 渲染 ToolCallCard

      // 兜底:Gateway 部分版本不保存 user 消息,导致历史会话只有 assistant/tool。
      // 当首条消息不是 user 时,用 session title 作为占位 user 消息插入开头,
      // 让用户至少能看到自己提问的内容。
      let sessionTitle: string | undefined;
      if (
        Array.isArray(resp?.messages) &&
        resp.messages.length > 0 &&
        resp.messages[0].role !== 'user'
      ) {
        try {
          const sessionResp = await gatewayChatService.getGatewayChat(
            {
              url: api.fetchAgentSessionById(
                GATEWAY_CHAT_AGENT_ID,
                chatId || sessionId,
              ),
            },
            true,
          );
          // BFF GET /agents/:agentId/sessions/:sessionId 返回 Session 域对象
          // {id, agentId, title, createdAt, updatedAt}(无 {data, session} 信封),
          // 因此直接从 data.title 读取。
          sessionTitle = sessionResp?.data?.title;
        } catch {
          // 取不到 title 时静默,不影响主流程
        }
      }
      // - tool 消息不单独渲染,其结果合并到对应 assistant 消息的 toolCalls[].result
      // - finish_reason="tool_calls" 且 content 为空的 assistant 消息仍保留(展示工具调用卡片)
      const rawMsgs: any[] = resp?.messages ?? [];

      // 1. 收集 tool 消息结果,按 tool_call_id 索引,供后续合并到 assistant 消息
      const toolResultByCallId = new Map<string, { content: unknown; toolName: string }>();
      for (const m of rawMsgs) {
        if (m.role === 'tool' && m.tool_call_id) {
          let parsed: unknown = m.content;
          // 尝试 JSON 解析 tool content(可能是字符串化的 JSON)
          if (typeof m.content === 'string') {
            try {
              parsed = JSON.parse(m.content);
            } catch {
              // 非 JSON,保留原始字符串
            }
          }
          toolResultByCallId.set(String(m.tool_call_id), {
            content: parsed,
            toolName: String(m.tool_name ?? ''),
          });
        }
      }

      // 2. 过滤并映射 user/assistant 消息,合并 tool 结果到 assistant 的 toolCalls
      const messages = rawMsgs
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => {
          const base: any = {
            id: m.id != null ? String(m.id) : undefined,
            content: String(m.content ?? ''),
            role: m.role === 'user' ? MessageType.User : MessageType.Assistant,
          };

          // 映射 assistant 的 tool_calls 为 ToolCallRecord[]
          if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
            const timestamp = Number(m.timestamp ?? 0);
            base.toolCalls = m.tool_calls.map((tc: any) => {
              const callId = String(tc.call_id ?? tc.id ?? '');
              const fn = tc.function ?? {};
              // 解析 arguments(可能是字符串化的 JSON)
              let args: unknown = fn.arguments;
              if (typeof args === 'string') {
                try {
                  args = JSON.parse(args);
                } catch {
                  // 保留原始字符串
                }
              }
              // 合并对应的 tool 消息结果
              const toolResult = toolResultByCallId.get(callId);
              return {
                toolCallId: callId,
                toolName: String(fn.name ?? toolResult?.toolName ?? ''),
                args,
                result: toolResult?.content,
                status: 'completed' as const,
                startedAt: timestamp,
              };
            });
          }

          return base;
        });

      const messageList = buildMessageListWithUuid(messages);

      // 兜底:若历史中首条不是 user 消息(Gateway 部分版本不保存 user 消息),
      // 用 session title 作为占位 user 消息插入开头,保证用户提问可见。
      let finalMessageList = messageList;
      if (
        sessionTitle &&
        messageList.length > 0 &&
        messageList[0].role !== MessageType.User
      ) {
        const placeholderUser: IMessage = {
          id: `placeholder-user-${chatId || sessionId}`,
          content: sessionTitle,
          role: MessageType.User,
        } as unknown as IMessage;
        finalMessageList = [placeholderUser, ...messageList];
      }

      // 兜底:Gateway 不持久化 user 消息,历史会话刷新后 messages 数组可能含连续 assistant 消息。
      // single-chat-box.tsx 的 isContinuation 规则为 `i > 0 && prev.role === cur.role`,
      // 连续 assistant 消息会从第 2 条起被误判为 continuation 隐藏头像。
      // 扫描 finalMessageList,在每对相邻 assistant 消息之间插入占位 user 消息触发 role 转换。
      if (finalMessageList.length > 1) {
        const patched: IMessage[] = [];
        for (let i = 0; i < finalMessageList.length; i++) {
          patched.push(finalMessageList[i]);
          if (
            i < finalMessageList.length - 1 &&
            finalMessageList[i].role === MessageType.Assistant &&
            finalMessageList[i + 1].role === MessageType.Assistant
          ) {
            patched.push({
              id: `placeholder-user-${chatId || sessionId}-${i}`,
              content: '',
              role: MessageType.User,
            } as unknown as IMessage);
          }
        }
        finalMessageList = patched;
      }

      return {
        id: chatId || sessionId,
        chat_id: chatId || sessionId,
        name: 'Default',
        messages: finalMessageList,
        reference: [],
        avatar: '',
        is_new: true,
        create_date: '',
        update_date: '',
        create_time: 0,
        update_time: 0,
      } as unknown as IClientConversation;
    },
  });

  return { data, loading, fetchSessionManually: mutateAsync };
}

/**
 * Gateway session = chat,创建 session 等同于创建 chat。
 * 此 hook 仅作向后兼容保留,实际不应被调用(use-chat-url.ts 已对 Gateway chat 跳过 createSession)。
 */
export const useCreateSession = () => {
  const queryClient = useQueryClient();
  const { id: chatId } = useParams();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.CreateSession],
    mutationFn: async ({ chatId: id }: { chatId: string; name: string }) => {
      // Gateway chat 已在 useCreateChat 中创建 session,此处直接返回成功。
      // 保留 data 字段以兼容调用方(use-chat-url.ts)期望的 { code, data: { id, messages } } 结构。
      queryClient.invalidateQueries({
        queryKey: [ChatApiAction.FetchSessionList],
      });
      return {
        code: 0,
        data: { id: id || chatId || '', messages: [] as never[] },
      };
    },
  });

  return { data, loading, createSession: mutateAsync };
};

export const useRemoveSessions = () => {
  const queryClient = useQueryClient();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.RemoveSession],
    mutationFn: async (_sessionIds: string[]) => {
      // Gateway session = chat,删除 session 等同于删除 chat。
      // 此 hook 仅作向后兼容保留,实际由 useDeleteChat 处理。
      queryClient.invalidateQueries({
        queryKey: [ChatApiAction.FetchSessionList],
      });
      return 0;
    },
  });

  return { data, loading, removeSessions: mutateAsync };
};

/**
 * Gateway 不支持删除单条消息。
 * 此 hook 仅作向后兼容保留,UI 层已对 Gateway chat 隐藏删除消息按钮。
 */
export const useDeleteMessage = () => {
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.DeleteMessage],
    mutationFn: async (_messageId: string) => {
      // Gateway 不支持删除单条消息,返回失败。
      message.warning(t('message.not_supported', { defaultValue: 'Operation not supported' }));
      return -1;
    },
  });

  return { data, loading, deleteMessage: mutateAsync };
};

/**
 * Gateway 不支持消息反馈(like/dislike)。
 * 此 hook 仅作向后兼容保留,UI 层已对 Gateway chat 隐藏反馈按钮。
 */
export const useFeedback = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.Feedback],
    mutationFn: async (_params: IFeedbackRequestBody) => {
      // Gateway 不支持消息反馈,返回失败。
      return -1;
    },
  });

  return { data, loading, feedback: mutateAsync };
};

type UploadParameters = Parameters<NonNullable<FileUploadProps['onUpload']>>;

type X = {
  file: UploadParameters[0][0];
  options: UploadParameters[1];
  conversationId?: string;
};

export function useUploadAndParseFile() {
  const { conversationId: id } = useGetChatSearchParams();
  const { t } = useTranslation();
  const controller = useRef(new AbortController());

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.UploadAndParse],
    mutationFn: async ({
      file,
      options: { onProgress, onSuccess, onError },
      conversationId,
    }: X) => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('conversation_id', conversationId || id);

        const { data } = await chatService.documentInfoUpload(
          {
            url: api.documentInfoUpload,
            signal: controller.current.signal,
            data: formData,
            onUploadProgress: ({ progress }) => {
              onProgress(file, (progress || 0) * 100 - 1);
            },
          },
          true,
        );

        onProgress(file, 100);

        if (data?.code === 0) {
          onSuccess(file);
          message.success(t(`message.uploaded`));
        } else {
          onError(file, new Error(data.message));
        }

        return data;
      } catch (error) {
        onError(file, error as Error);
      }
    },
  });

  const cancel = useCallback(() => {
    controller.current.abort();
    controller.current = new AbortController();
  }, [controller]);

  return { data, loading, uploadAndParseFile: mutateAsync, cancel };
}

export const useFetchExternalChatInfo = () => {
  const { sharedId: id } = useGetSharedChatSearchParams();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IExternalChatInfo>({
    queryKey: [ChatApiAction.FetchExternalChatInfo, id],
    gcTime: 0,
    initialData: {} as IExternalChatInfo,
    enabled: !!id,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await chatService.fetchExternalChatInfo(id!);

      return data?.data;
    },
  });

  return { data, loading, refetch };
};

//#endregion Session

//#region search page

export const useFetchMindMap = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.FetchMindMap],
    gcTime: 0,
    mutationFn: async (params: IAskRequestBody) => {
      try {
        const ret = await chatService.chatsMindmap(params);
        return ret?.data?.data ?? {};
      } catch (error: any) {
        if (has(error, 'message')) {
          message.error(error.message);
        }

        return [];
      }
    },
  });

  return { data, loading, fetchMindMap: mutateAsync };
};

export const useFetchRelatedQuestions = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.FetchRelatedQuestions],
    gcTime: 0,
    mutationFn: async (question: string): Promise<string[]> => {
      const { data } = await chatService.chatsRelatedQuestions({ question });

      return data?.data ?? [];
    },
  });

  return { data, loading, fetchRelatedQuestions: mutateAsync };
};
//#endregion
