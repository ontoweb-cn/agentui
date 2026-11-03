import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  extra,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border-button bg-bg-card',
        className,
      )}
    >
      {title || extra ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-button px-4 py-3">
          <div className="text-sm font-medium text-text-primary">{title}</div>
          {extra ? <div className="flex items-center gap-2">{extra}</div> : null}
        </header>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint ? <span className="text-xs text-text-tertiary">{hint}</span> : null}
    </label>
  );
}

export function MutedText({ children }: { children: ReactNode }) {
  return <span className="text-xs text-text-secondary">{children}</span>;
}
