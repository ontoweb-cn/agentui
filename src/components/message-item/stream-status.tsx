/**
 * StreamStatus — 聊天流式状态行。
 *
 * 对齐 TRAE/Intellect webui 的 `Working for 00:34` / `Done in 59s`:
 * - 流式进行中:秒级计时,显示工具数量(可选)
 * - 流完成后:保留 3 秒 `Done in Xs`,随后自动隐藏
 *
 * 计时起点优先使用 `startedAt`;未传时以首次进入 streaming 的时间为准。
 */
import { formatDuration } from '@/utils/format-duration';
import { CheckCircle2, CircleStop, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const DONE_VISIBLE_MS = 3000;

/** 外部 startedAt 必须是合法、非未来、非 0 的时间戳;否则回退到当前时间。 */
function normalizeStartedAt(value?: number): number | null {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > Date.now()
  ) {
    return null;
  }
  return value;
}

export type StreamTerminalState = 'done' | 'failed' | 'stopped';

export interface StreamStatusProps {
  isStreaming: boolean;
  /** 流式结束后的终态;默认 done */
  terminalState?: StreamTerminalState;
  /** 当前 turn 的工具数量(可选) */
  toolCount?: number;
  /** 外部传入的流式开始时间(毫秒时间戳);不传则自动记录 */
  startedAt?: number;
  className?: string;
}

export function StreamStatus({
  isStreaming,
  terminalState = 'done',
  toolCount = 0,
  startedAt: startedAtProp,
  className,
}: StreamStatusProps) {
  const { t } = useTranslation();
  const startRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);
  const wasStreamingRef = useRef(isStreaming);
  const [startedAt, setStartedAt] = useState<number | null>(
    isStreaming ? normalizeStartedAt(startedAtProp) : null,
  );
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (isStreaming) {
      setFinishedAt(null);
      if (startRef.current === null) {
        // 第一轮优先采用外部 startedAt;后续轮次(上一轮完成后再次流式)
        // 必须用当前时间,避免复用旧的 startedAt 导致计时从旧起点继续。
        const providedStart = normalizeStartedAt(startedAtProp);
        startRef.current =
          !hasStartedRef.current && providedStart !== null
            ? providedStart
            : Date.now();
        hasStartedRef.current = true;
        setStartedAt(startRef.current);
      }
      setNow(Date.now());
    } else if (wasStreamingRef.current && startRef.current !== null) {
      setFinishedAt(Date.now());
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, startedAtProp]);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming || finishedAt === null) return;
    const timer = window.setTimeout(() => {
      setFinishedAt(null);
      setStartedAt(null);
      startRef.current = null;
    }, DONE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [isStreaming, finishedAt]);

  if (!isStreaming && finishedAt === null) return null;

  const start = startedAt ?? finishedAt ?? now;
  const elapsed = Math.max(0, (finishedAt ?? now) - start);
  const duration = formatDuration(elapsed);
  const state = isStreaming ? 'streaming' : terminalState;

  const statusIcon =
    state === 'streaming' ? (
      <Loader2
        className="size-3 shrink-0 animate-spin text-accent-primary-text"
        aria-hidden
      />
    ) : state === 'failed' ? (
      <XCircle className="size-3 shrink-0 text-trae-error" aria-hidden />
    ) : state === 'stopped' ? (
      <CircleStop className="size-3 shrink-0 text-text-secondary" aria-hidden />
    ) : (
      <CheckCircle2 className="size-3 shrink-0 text-accent-primary-text" aria-hidden />
    );

  const statusText =
    state === 'streaming'
      ? t('streamStatus.workingFor', { duration })
      : state === 'failed'
        ? t('streamStatus.failedIn', { duration })
        : state === 'stopped'
          ? t('streamStatus.stoppedIn', { duration })
          : t('streamStatus.doneIn', { duration });

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-1 py-2 text-xs text-text-secondary',
        state === 'failed' && 'text-trae-error-text',
        className,
      )}
      data-testid="stream-status"
      data-state={state}
    >
      {statusIcon}
      <span>{statusText}</span>
      {toolCount > 0 && (
        <span className="text-text-disabled">
          · {t('streamStatus.tools', { count: toolCount })}
        </span>
      )}
    </div>
  );
}
