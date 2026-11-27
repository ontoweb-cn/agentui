import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuery } from '@tanstack/react-query';

import { LucideLayers } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  fetchCatalogInstances,
  fetchCatalogOverview,
} from '@/services/platform-catalog-service';

function PlatformCatalogAdmin() {
  const { t } = useTranslation();

  const {
    data: overviewRes,
    isLoading: overviewLoading,
    error: overviewError,
  } = useQuery({
    queryKey: ['platform/catalog/overview'],
    queryFn: async () => (await fetchCatalogOverview()).data,
    retry: false,
  });

  const {
    data: instancesRes,
    isLoading: instancesLoading,
    error: instancesError,
  } = useQuery({
    queryKey: ['platform/catalog/instances'],
    queryFn: async () => (await fetchCatalogInstances()).data,
    retry: false,
  });

  const overviewRows = useMemo(() => {
    const byKind = overviewRes?.data?.by_kind ?? {};
    return Object.entries(byKind).map(([kind, counts]) => ({
      kind,
      online: counts.online ?? 0,
      stale: counts.stale ?? 0,
      never_seen: counts.never_seen ?? 0,
    }));
  }, [overviewRes]);

  const instances = instancesRes?.data?.instances ?? [];

  const overviewErr =
    overviewError instanceof Error ? overviewError.message : null;
  const instancesErr =
    instancesError instanceof Error ? instancesError.message : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center gap-2">
        <LucideLayers className="size-5 text-text-secondary" />
        <h1 className="text-xl font-semibold">
          {t('admin.platformCatalog.title', {
            defaultValue: 'Platform catalog (1a)',
          })}
        </h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('admin.platformCatalog.overviewTitle', {
              defaultValue: 'Status by kind',
            })}
          </CardTitle>
          <CardDescription>
            {t('admin.platformCatalog.overviewHint', {
              defaultValue:
                'via BFF → kb-platform GET /api/v1/platform/catalog/overview',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overviewLoading && (
            <p className="text-sm text-text-secondary">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </p>
          )}
          {overviewErr && (
            <p className="text-sm text-state-error">{overviewErr}</p>
          )}
          {!overviewLoading && !overviewErr && overviewRows.length === 0 && (
            <p className="text-sm text-text-secondary">
              {t('admin.platformCatalog.emptyOverview', {
                defaultValue: 'No catalog data (MySQL / migration required?).',
              })}
            </p>
          )}
          {overviewRows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>kind</TableHead>
                  <TableHead>online</TableHead>
                  <TableHead>stale</TableHead>
                  <TableHead>never_seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overviewRows.map((row) => (
                  <TableRow key={row.kind}>
                    <TableCell>{row.kind}</TableCell>
                    <TableCell>{row.online}</TableCell>
                    <TableCell>{row.stale}</TableCell>
                    <TableCell>{row.never_seen}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('admin.platformCatalog.instancesTitle', {
              defaultValue: 'Instances',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {instancesLoading && (
            <p className="text-sm text-text-secondary">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </p>
          )}
          {instancesErr && (
            <p className="text-sm text-state-error">{instancesErr}</p>
          )}
          {!instancesLoading && !instancesErr && instances.length === 0 && (
            <p className="text-sm text-text-secondary">
              {t('admin.platformCatalog.emptyInstances', {
                defaultValue: 'No instances registered.',
              })}
            </p>
          )}
          {instances.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>kind</TableHead>
                  <TableHead>name</TableHead>
                  <TableHead>status</TableHead>
                  <TableHead>scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((inst) => (
                  <TableRow key={inst.id}>
                    <TableCell>{inst.kind}</TableCell>
                    <TableCell>{inst.name}</TableCell>
                    <TableCell>{inst.status}</TableCell>
                    <TableCell>{inst.scope ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PlatformCatalogAdmin;