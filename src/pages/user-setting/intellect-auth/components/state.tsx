import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusLabel, statusTone } from '@/services/hiedu/format';

export function LoadingState({ label = '加载中…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border-button bg-bg-card p-8 text-sm text-text-secondary"
    >
      <Loader2 className="size-5 animate-spin text-text-secondary" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-lg border border-state-error/30 bg-state-error/5 p-8 text-sm text-state-error"
    >
      <span>{message}</span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title = '暂无数据',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-button bg-bg-card p-8 text-sm">
      <span className="text-text-primary">{title}</span>
      {description ? (
        <span className="text-text-secondary">{description}</span>
      ) : null}
    </div>
  );
}

export function ForbiddenState({
  message = '无权限访问此页面',
  detail,
}: {
  message?: string;
  detail?: string;
}) {
  return (
    <div className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-state-error/30 bg-state-error/5 p-8 text-sm">
      <span className="font-medium text-state-error">{message}</span>
      {detail ? <span className="text-text-secondary">{detail}</span> : null}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  ok: 'bg-state-success/5 text-state-success',
  warn: 'bg-state-warning/5 text-state-warning',
  danger: 'bg-state-error/5 text-state-error',
  muted: 'bg-bg-secondary text-text-secondary',
};

/** 业务状态徽标，沿用 hiedu 的 statusLabel/statusTone 口径。 */
export function StatusBadge({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <Badge
      variant="secondary"
      className={cn('rounded-md border-transparent', TONE_CLASS[tone], className)}
    >
      {statusLabel(status)}
    </Badge>
  );
}
