/**
 * ApprovalCard — 工具审批请求卡片（v1.3.0）
 *
 * Constitution Principle IV v1.3.0:
 * - 当 intellect-team /v1/runs 主通道需要工具人工审批时,BFF 透传 approval_request 事件
 * - 前端 ApprovalCard 渲染按钮组(once/session/always/deny)
 * - 用户提交后调用 submitApproval → BFF POST /agents/:agentId/runs/:runId/approval
 *
 * 设计要点:
 * - 状态:'pending'(等待用户提交) → 'submitted'(已提交,等待 run 继续执行)
 * - pending 状态:显示 4 个按钮(once/session/always/deny),点击即提交
 * - submitted 状态:显示用户选择的 choice + 等待提示,按钮组禁用
 * - arguments JSON 字符串按需 parse 展示(折叠/展开)
 * - toolName 用等宽字体显示,与 ToolCallCard 样式一致
 *
 * 与 ToolCallCard 的关系:
 * - BFF streamChunksAsSSE 在 approval_request 后过滤 tool_* 事件,前端不会同时收到
 *   tool_start 与 approval_request。ApprovalCard 独立渲染,不与 ToolCallCard 重复。
 * - 同一条 assistant 消息可同时包含 ToolCallCard(已完成的工具)和 ApprovalCard(待审批的工具)。
 *
 * 数据源:
 * - useSendAgentMessageWithSse.pendingApproval(由 approval_request 事件触发)
 * - use-send-chat-message.ts useEffect 将 pendingApproval 透传到 IMessage.pendingApproval
 * - 本组件读取 item.pendingApproval 字段
 */
import { PendingApproval } from '@/interfaces/database/chat';
import { CheckCircle2, ChevronRight, Shield, Loader2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const ARGS_TRUNCATE_LIMIT = 800;
// P2-S4 修复:arguments 输入长度预校验上限(10KB)。
// 超长输入直接截断显示,避免 JSON.parse 处理超深嵌套/超长字符串时栈溢出或卡顿。
// BFF 侧已在 serializeChunk 中限制 64KB,此处为前端二次防御。
const ARGS_INPUT_MAX_LENGTH = 10 * 1024;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n... (truncated, ${text.length - limit} chars)`;
}

/**
 * 安全解析 arguments JSON 字符串。
 * - P2-S4 修复:输入长度预校验,超长直接截断(避免 JSON.parse 栈溢出)
 * - 解析失败时返回原始字符串(便于用户查看上游透传内容)
 * - 解析成功时返回 prettified JSON(2-space 缩进)
 */
function safeFormatArguments(args: string): string {
  if (!args) return '';
  // P2-S4: 长度预校验,超长输入截断后再尝试 parse
  const safeArgs =
    args.length > ARGS_INPUT_MAX_LENGTH
      ? args.slice(0, ARGS_INPUT_MAX_LENGTH) +
        `\n... (input truncated, total ${args.length} chars)`
      : args;
  try {
    const parsed = JSON.parse(safeArgs);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // 非 JSON 字符串或解析失败,返回原始内容(已截断)
    return safeArgs;
  }
}

interface ApprovalCardProps {
  /** 审批请求数据(来自 IMessage.pendingApproval) */
  approval: PendingApproval;
  /**
   * 提交审批回调(来自 use-send-chat-message.ts submitApproval)。
   * 返回 true 提交成功,false 提交失败(网络错误/上游错误)。
   */
  onSubmit: (choice: 'once' | 'session' | 'always' | 'deny') => Promise<boolean>;
}

function ApprovalCardImpl({ approval, onSubmit }: ApprovalCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 提交中状态(防止用户连点)
  const [submitting, setSubmitting] = useState(false);
  // 提交失败的 choice(用于按钮错误状态)
  const [failedChoice, setFailedChoice] = useState<
    'once' | 'session' | 'always' | 'deny' | null
  >(null);

  const argsText = useMemo(
    () => (approval.arguments ? safeFormatArguments(approval.arguments) : ''),
    [approval.arguments],
  );
  const truncatedArgs = useMemo(
    () => (argsText ? truncate(argsText, ARGS_TRUNCATE_LIMIT) : ''),
    [argsText],
  );

  const isPending = approval.status === 'pending';
  const isSubmitted = approval.status === 'submitted';

  const handleSubmit = async (
    choice: 'once' | 'session' | 'always' | 'deny',
  ) => {
    if (!isPending || submitting) return;
    setSubmitting(true);
    setFailedChoice(null);
    try {
      const ok = await onSubmit(choice);
      if (!ok) {
        setFailedChoice(choice);
      }
      // 成功时由父组件 useEffect 透传 pendingApproval.status='submitted',本组件 re-render
    } catch (err) {
      console.warn('[ApprovalCard] submit failed:', err);
      setFailedChoice(choice);
    } finally {
      setSubmitting(false);
    }
  };

  // 选项标签国际化(key 与 intellect-team choice 值对齐)
  const choiceLabel = (choice: 'once' | 'session' | 'always' | 'deny') => {
    switch (choice) {
      case 'once':
        return t('approval.choiceOnce');
      case 'session':
        return t('approval.choiceSession');
      case 'always':
        return t('approval.choiceAlways');
      case 'deny':
        return t('approval.choiceDeny');
    }
  };

  // submitted 状态下显示的图标和文案
  const submittedChoice = approval.submittedChoice;
  const isDenied = submittedChoice === 'deny';

  return (
    <div
      className={cn(
        'my-1 rounded-md border text-xs',
        isSubmitted
          ? isDenied
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      {/* Header:点击展开/折叠 arguments */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/30"
        aria-expanded={open}
      >
        {isSubmitted ? (
          isDenied ? (
            <CheckCircle2 className="h-3 w-3 text-destructive" />
          ) : (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          )
        ) : (
          <Shield className="h-3 w-3 text-amber-500" />
        )}
        <ChevronRight
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="font-mono">{approval.toolName}</span>
        <span className="ml-1 text-muted-foreground">
                {isSubmitted
                  ? t('approval.submitted', {
                      choice: choiceLabel(submittedChoice!),
                      // P2-Q9 修复:choice 已是翻译后文本,关闭 escapeValue 避免被 i18next 二次解析
                      escapeValue: false,
                    })
                  : t('approval.pending')}
              </span>
      </button>

      {/* 展开时显示 arguments JSON */}
      {open && truncatedArgs && (
        <div className="space-y-1 border-t p-2">
          <div className="mb-1 text-muted-foreground">arguments:</div>
          <pre className="overflow-auto rounded bg-muted p-2 text-xs">
            {truncatedArgs}
          </pre>
        </div>
      )}

      {/* pending 状态:显示按钮组 */}
      {isPending && (
        <div className="flex flex-wrap gap-2 border-t p-2">
          {approval.choices.map((choice) => {
            const isFailed = failedChoice === choice;
            const isDanger = choice === 'deny';
            return (
              <button
                key={choice}
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit(choice)}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  isDanger
                    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    : 'bg-primary/10 text-primary hover:bg-primary/20',
                  isFailed && 'ring-2 ring-destructive',
                )}
                aria-label={choiceLabel(choice)}
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {choiceLabel(choice)}
              </button>
            );
          })}
          {failedChoice && (
            <div className="w-full text-destructive text-xs">
              {t('approval.submitFailed')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ApprovalCard = memo(ApprovalCardImpl);
