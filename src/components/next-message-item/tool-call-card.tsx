/**
 * ToolCallCard — Tool call 内联卡片（P1）
 *
 * 参考 webui buildToolCard (ui.js L6873-6921)，React + Tailwind + shadcn/ui Collapsible 实现。
 *
 * 卡片状态：
 * - 'running'：显示 spinner + preview 累积
 * - 'completed'：显示完成图标 + result（可折叠）
 * - 'failed'：显示错误图标 + 错误信息
 *
 * 交互：
 * - 默认折叠，点击 header 切换展开/折叠
 * - 展开时显示 args / result JSON
 * - result 超过 800 字符截断
 *
 * 数据源：useSendAgentMessageWithSse 的 toolCallsRef（StreamToolStart/Progress/Complete/Error 事件累积）
 */
import { ToolCallRecord } from '@/interfaces/database/chat';
import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const RESULT_TRUNCATE_LIMIT = 800;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n... (truncated, ${text.length - limit} chars)`;
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface ToolCallCardProps {
  record: ToolCallRecord;
  defaultOpen?: boolean;
}

function ToolCallCardImpl({ record, defaultOpen = false }: ToolCallCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const argsText = useMemo(
    () => (record.args ? safeStringify(record.args) : ''),
    [record.args],
  );
  const resultText = useMemo(
    () => (record.result !== undefined ? safeStringify(record.result) : ''),
    [record.result],
  );
  const truncatedResult = useMemo(
    () => (resultText ? truncate(resultText, RESULT_TRUNCATE_LIMIT) : ''),
    [resultText],
  );

  const status = record.status;
  const durationLabel = useMemo(() => {
    if (record.durationMs === undefined) return '';
    if (record.durationMs < 1000) return `${record.durationMs}ms`;
    return `${(record.durationMs / 1000).toFixed(1)}s`;
  }, [record.durationMs]);

  const statusIcon =
    status === 'running' ? (
      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
    ) : status === 'completed' ? (
      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
    ) : (
      <XCircle className="h-3 w-3 text-destructive" />
    );

  const statusLabel =
    status === 'running'
      ? t('toolCall.running')
      : status === 'completed'
        ? t('toolCall.completed')
        : t('toolCall.failed');

  return (
    <div className="my-1 rounded-md border bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
        aria-expanded={open}
      >
        {statusIcon}
        <ChevronRight
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="font-mono">{record.toolName}</span>
        {record.preview && (
          <span className="ml-1 flex-1 truncate text-muted-foreground">
            {record.preview}
          </span>
        )}
        <span className="text-muted-foreground">{statusLabel}</span>
        {durationLabel && (
          <span className="text-muted-foreground">{durationLabel}</span>
        )}
      </button>
      {open && (argsText || truncatedResult) && (
        <div className="space-y-1 border-t p-2">
          {argsText && (
            <div>
              <div className="mb-1 text-muted-foreground">args:</div>
              <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                {argsText}
              </pre>
            </div>
          )}
          {truncatedResult && (
            <div>
              <div className="mb-1 text-muted-foreground">
                {status === 'failed' ? 'error:' : 'result:'}
              </div>
              <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                {truncatedResult}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ToolCallCard = memo(ToolCallCardImpl);
