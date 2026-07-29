/**
 * ReasoningPanel — Reasoning 实时增量流面板（P1）
 *
 * 参考 webui reasoningText + liveReasoningText 双字符串模式 (messages.js L726-727)。
 *
 * 双字符串语义：
 * - reasoning：累积字符串，整 turn 内不重置（用于持久化）
 * - liveReasoning：工具调用后重置的字符串（用于实时显示，避免跨工具污染）
 *
 * 渲染策略：
 * - 流式中：显示 liveReasoning（实时增量），自动展开
 * - 流完成/历史回看：显示 reasoning（完整累积），默认折叠
 * - partial `<think>` 标签剥离（BFF 可能发送未闭合的 `<think>` 标签）
 *
 * 交互：
 * - 折叠/展开（点击 header）
 * - 流式中自动展开，流完成后自动折叠（除非用户主动展开）
 */
import { Brain, ChevronRight, Loader2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import MarkdownContent from '../next-markdown-content';

interface ReasoningPanelProps {
  /** 累积 reasoning（整 turn 不重置，用于持久化与历史回看） */
  reasoning: string;
  /** 流式中实时显示的 reasoning（工具调用后重置），可选 */
  liveReasoning?: string;
  /** 是否正在流式输出 */
  isStreaming: boolean;
}

/**
 * 剥离 partial `<think>` / `</think>` 标签。
 * BFF 在 reasoning 事件中可能发送未闭合的 `<think>` 标签（webui 兼容行为）。
 */
function stripThinkTags(text: string): string {
  return text.replace(/<\/?think>/g, '');
}

function ReasoningPanelImpl({
  reasoning,
  liveReasoning,
  isStreaming,
}: ReasoningPanelProps) {
  const { t } = useTranslation();
  // 用户手动控制状态：null 表示未手动操作，true/false 表示手动展开/折叠
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  // 流式开始时重置手动状态
  useEffect(() => {
    if (isStreaming) setManualOpen(null);
  }, [isStreaming]);

  // 流式中自动展开，流完成自动折叠（除非用户手动操作）
  const open =
    manualOpen !== null ? manualOpen : isStreaming && !!(liveReasoning || reasoning);

  const displayText = useMemo(() => {
    // 流式中优先显示 liveReasoning（避免跨工具污染），否则显示 reasoning 累积
    const raw = isStreaming
      ? liveReasoning || reasoning
      : reasoning;
    return stripThinkTags(raw);
  }, [isStreaming, liveReasoning, reasoning]);

  if (!displayText) return null;

  return (
    <div className="my-1 rounded-md border border-border/50 bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        {isStreaming ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : (
          <Brain className="h-3 w-3 text-muted-foreground" />
        )}
        <ChevronRight
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="text-muted-foreground">
          {isStreaming ? t('reasoning.thinking') : t('reasoning.show')}
        </span>
      </button>
      {open && (
        <div className="border-t p-2 text-muted-foreground">
          <MarkdownContent content={displayText} loading={false} />
        </div>
      )}
    </div>
  );
}

export const ReasoningPanel = memo(ReasoningPanelImpl);
