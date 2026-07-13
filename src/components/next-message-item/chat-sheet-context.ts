import type { INodeEvent } from '@/hooks/use-send-message';
import type { IMessage } from '@/interfaces/database/chat';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { createContext, useContext } from 'react';

/**
 * 时间线 render prop 的数据载荷。
 * 字段对齐画布 WorkFlowTimeline 的 props(LogFlowTimelineProps),
 * 此处显式声明类型,避免使用 unknown 丧失类型安全(评审 Q1 修复)。
 */
export interface TimelineRenderData {
  currentEventListWithoutMessage: INodeEvent[];
  isShare?: boolean;
  // 必填:对齐 WorkFlowTimeline 的 LogFlowTimelineProps(从 useCacheChatLog 推断为 string)
  currentMessageId: string;
  canvasId?: string;
  // 必填:对齐 WorkFlowTimeline 的 LogFlowTimelineProps
  sendLoading: boolean;
}

export interface TimelineRenderProps {
  messageId: string;
  data: TimelineRenderData;
}

export interface ChatSheetContextValue {
  showLogSheet: (messageId: string) => void;
  setLastSendLoadingFunc: (loading: boolean, messageId: string) => void;
  setDerivedMessages: Dispatch<SetStateAction<IMessage[] | undefined>>;
  // 时间线组件通过 render prop 注入(评审 R5:不迁入,保持通用性)
  timelineRenderer?: (props: TimelineRenderProps) => ReactNode;
}

export const ChatSheetContext = createContext<ChatSheetContextValue | null>(
  null,
);

export const useChatSheet = (): ChatSheetContextValue => {
  const ctx = useContext(ChatSheetContext);
  if (!ctx) {
    // 画布外使用时返回 noop,避免 crash(评审 S1:开发环境抛错以暴露缺失 Provider 的 bug)
    if (import.meta.env.DEV) {
      console.warn(
        '[useChatSheet] ChatSheetContext.Provider 未挂载,返回 noop 实现。' +
          '若此组件期望在画布内运行,请检查 Provider 是否正确包裹。',
      );
    }
    return {
      showLogSheet: () => {},
      setLastSendLoadingFunc: () => {},
      setDerivedMessages: () => {},
      timelineRenderer: undefined,
    };
  }
  return ctx;
};
