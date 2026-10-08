import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LayoutGrid } from 'lucide-react';

import { collectApps } from '@/features/_registry';
import { cn } from '@/lib/utils';

// registry 在模块加载后不再变化,与 global-navbar 的 featureNavItems 同样做模块级提升
const apps = collectApps();

export default function ApplicationList() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">{t('applications.title')}</h1>
        <p className="text-sm text-text-secondary">
          {t('applications.subtitle')}
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border-button bg-bg-card py-16 text-center">
          <LayoutGrid className="size-10 text-text-secondary" aria-hidden />
          <p className="text-base font-medium">{t('applications.empty')}</p>
          <p className="text-sm text-text-secondary">
            {t('applications.emptyDescription')}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => {
            const Icon: ComponentType<{ className?: string }> =
              app.icon ?? LayoutGrid;
            return (
              <li key={app.id}>
                <Link
                  to={app.path}
                  data-testid={`app-card-${app.id}`}
                  className={cn(
                    'group flex h-full flex-col gap-3 rounded-lg border border-border-button bg-bg-card p-5',
                    'transition-all hover:-translate-y-0.5 hover:shadow-md',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-md bg-text-primary/10">
                      <Icon className="size-5 stroke-[1.5]" aria-hidden />
                    </span>
                    <span className="text-base font-medium">
                      {t(app.labelKey)}
                    </span>
                  </div>
                  {app.descriptionKey && (
                    <p className="text-sm text-text-secondary">
                      {t(app.descriptionKey)}
                    </p>
                  )}
                  <span className="mt-auto text-sm text-accent-primary opacity-0 transition-opacity group-hover:opacity-100">
                    {t('applications.enter')} →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
