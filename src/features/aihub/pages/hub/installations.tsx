import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import {
  fetchInstallations,
  openInstallation,
  removeInstallation,
  type Installation,
} from '../../api';

/** `/hub/library`：当前主体的安装记录（M2）。 */
export default function InstallationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; binding: unknown } | null>(
    null,
  );
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['aihub-installations'],
    queryFn: async () => (await fetchInstallations()).data,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['aihub-installations'] });
  };

  const open = async (item: Installation) => {
    setBusy(item.id);
    setError('');
    try {
      const result = (await openInstallation(item.id)).data;
      setOpened({ id: item.id, binding: result.binding });
    } catch (err) {
      setError(
        t('aihub.library.openError', { message: (err as Error).message }),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: Installation) => {
    setBusy(item.id);
    setError('');
    try {
      await removeInstallation(item.id);
      if (opened?.id === item.id) setOpened(null);
      refresh();
    } catch (err) {
      setError(
        t('aihub.library.removeError', { message: (err as Error).message }),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-0.5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text-primary">
          {t('aihub.library.title')}
        </h1>
        <p className="text-sm text-text-secondary">{t('aihub.subtitle')}</p>
      </header>

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">
          {t('aihub.library.loading')}
        </p>
      ) : query.error ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-4">
          <p className="text-sm text-text-secondary">
            {t('aihub.library.error', {
              message: (query.error as Error).message,
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {t('aihub.library.open')}
          </Button>
        </div>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-text-secondary" data-testid="aihub-library-empty">
          {t('aihub.library.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="aihub-library-list">
          {query.data?.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-text-primary">
                    {item.label || item.name || item.asset_id}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {item.asset_type} · {item.status} · {item.created_at ?? '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === item.id}
                    onClick={() => void open(item)}
                  >
                    {busy === item.id
                      ? t('aihub.library.opening')
                      : t('aihub.library.open')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === item.id}
                    onClick={() => void remove(item)}
                  >
                    {busy === item.id
                      ? t('aihub.library.removing')
                      : t('aihub.library.remove')}
                  </Button>
                </div>
              </div>
              {opened?.id === item.id && (
                <pre className="overflow-x-auto rounded bg-bg-secondary p-2 text-xs text-text-secondary">
                  {JSON.stringify(opened.binding, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs text-text-secondary" data-testid="aihub-library-error">
          {error}
        </p>
      )}
    </div>
  );
}
