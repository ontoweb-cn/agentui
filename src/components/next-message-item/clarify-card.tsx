/**
 * ClarifyCard — 澄清请求卡片
 *
 * - BFF 转发 intellect-team clarify SSE 事件,前端 ClarifyCard 渲染问题与输入框
 * - 用户提交回答后调用 submitClarify → BFF POST /agents/:agentId/sessions/:sessionId/clarify
 *
 * 设计要点:
 * - 状态:'pending'(等待用户提交) → 'submitted'(已提交,等待 run 继续执行)
 * - pending 状态:显示 choices 按钮(若有)+ 自由输入框 + 提交按钮
 * - submitted 状态:显示用户回答 + 等待提示
 * - Header 点击可展开/折叠(显示完整 question 和输入区)
 * - 颜色:blue(pending) / emerald(submitted)
 *
 * 数据源:
 * - useSendAgentMessageWithSse.pendingClarify(由 clarify_request 事件触发)
 * - use-send-chat-message.ts useEffect 将 pendingClarify 透传到 IMessage.pendingClarify
 * - 本组件读取 item.pendingClarify 字段
 */
import { PendingClarify } from '@/interfaces/database/chat';
import { CheckCircle2, ChevronRight, HelpCircle, Loader2, Send } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface ClarifyCardProps {
  /** 澄清请求数据(来自 IMessage.pendingClarify) */
  clarify: PendingClarify;
  /**
   * 提交回答回调(来自 use-send-chat-message.ts submitClarify)。
   * 返回 true 提交成功,false 提交失败(网络错误/上游错误)。
   */
  onSubmit: (answer: string) => Promise<boolean>;
}

function ClarifyCardImpl({ clarify, onSubmit }: ClarifyCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  // 自由输入框值
  const [inputValue, setInputValue] = useState('');
  // 提交中状态(防止用户连点)
  const [submitting, setSubmitting] = useState(false);
  // 提交失败的 choice(用于按钮错误状态)
  const [failedChoice, setFailedChoice] = useState<string | null>(null);
  // 自由输入提交失败标记
  const [inputFailed, setInputFailed] = useState(false);

  const isPending = clarify.status === 'pending';
  const isSubmitted = clarify.status === 'submitted';

  const handleChoiceSubmit = async (choice: string) => {
    if (!isPending || submitting) return;
    setSubmitting(true);
    setFailedChoice(null);
    try {
      const ok = await onSubmit(choice);
      if (!ok) {
        setFailedChoice(choice);
      }
      // 成功时由父组件 useEffect 透传 pendingClarify.status='submitted',本组件 re-render
    } catch (err) {
      console.warn('[ClarifyCard] choice submit failed:', err);
      setFailedChoice(choice);
    } finally {
      setSubmitting(false);
    }
  };

  const handleInputSubmit = async () => {
    if (!isPending || submitting) return;
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setInputFailed(false);
    try {
      const ok = await onSubmit(trimmed);
      if (!ok) {
        setInputFailed(true);
      }
      // 成功时由父组件透传状态切换
    } catch (err) {
      console.warn('[ClarifyCard] input submit failed:', err);
      setInputFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        'my-1 rounded-md border text-xs',
        isSubmitted
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-blue-500/30 bg-blue-500/5',
      )}
    >
      {/* Header:点击展开/折叠 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/30"
        aria-expanded={open}
      >
        {isSubmitted ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        ) : (
          <HelpCircle className="h-3 w-3 text-blue-500" />
        )}
        <ChevronRight
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="flex-1 truncate text-foreground">
          {clarify.question || t('clarify.defaultQuestion')}
        </span>
        <span className="ml-1 shrink-0 text-muted-foreground">
          {isSubmitted ? t('clarify.submitted') : t('clarify.pending')}
        </span>
      </button>

      {/* 展开时显示完整 question 与交互区 */}
      {open && (
        <div className="space-y-2 border-t p-2">
          {/* 完整 question(避免 Header truncate 截断) */}
          {clarify.question && (
            <div className="text-foreground whitespace-pre-wrap break-words">
              {clarify.question}
            </div>
          )}

          {/* submitted 状态:显示用户回答 + 等待提示 */}
          {isSubmitted && (
            <div className="space-y-1">
              <div className="text-muted-foreground">{t('clarify.yourAnswer')}</div>
              <div className="rounded bg-muted p-2 text-xs break-words">
                {clarify.submittedAnswer ?? ''}
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t('clarify.waiting')}</span>
              </div>
            </div>
          )}

          {/* pending 状态:choices 按钮 + 自由输入框 */}
          {isPending && (
            <>
              {clarify.choices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {clarify.choices.map((choice) => {
                    const isFailed = failedChoice === choice;
                    return (
                      <button
                        key={choice}
                        type="button"
                        disabled={submitting}
                        onClick={() => handleChoiceSubmit(choice)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                          'bg-primary/10 text-primary hover:bg-primary/20',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          isFailed && 'ring-2 ring-destructive',
                        )}
                        aria-label={choice}
                      >
                        {submitting && failedChoice === choice && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {choice}
                      </button>
                    );
                  })}
                </div>
              )}
              {failedChoice && (
                <div className="text-destructive text-xs">
                  {t('clarify.submitFailed')}
                </div>
              )}

              {/* 自由输入框 + 提交按钮 */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleInputSubmit();
                    }
                  }}
                  disabled={submitting}
                  placeholder={t('clarify.inputPlaceholder')}
                  className={cn(
                    'flex-1 rounded border bg-background px-2 py-1 text-xs',
                    'focus:outline-none focus:ring-1 focus:ring-primary',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    inputFailed && 'ring-2 ring-destructive',
                  )}
                />
                <button
                  type="button"
                  disabled={submitting || !inputValue.trim()}
                  onClick={handleInputSubmit}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    'bg-primary/10 text-primary hover:bg-primary/20',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                  aria-label={t('clarify.submit')}
                >
                  {submitting && !failedChoice ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  {t('clarify.submit')}
                </button>
              </div>
              {inputFailed && (
                <div className="text-destructive text-xs">
                  {t('clarify.submitFailed')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const ClarifyCard = memo(ClarifyCardImpl);
