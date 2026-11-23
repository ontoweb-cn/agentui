import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';

import { Button } from '@/components/ui/button';
import { Routes } from '@/constants/routes';
import { cn } from '@/lib/utils';

import {
  fetchAsset,
  fetchMarketPage,
  fetchTaxonomies,
  type TaxonomyItem,
} from '../../api';
import { AssetCard } from '../../components/asset-card';
import { AssetWorkspace } from '../../components/asset-workspace';
import { DatasetPublish } from '../../components/dataset-publish';
import {
  DEFAULT_RESOURCE_TYPE,
  isSafeResourceType,
} from '../../resource-types';

const PAGE_SIZE = 20;

const SAFE_FILTER_KEY = /^[A-Za-z0-9._-]{1,64}$/;

/** 筛选 key 只接受安全 slug，异常值回落 all（避免拼入 BFF 路径时改变路径）。 */
function readFilterKey(value: string | null): string {
  return value && SAFE_FILTER_KEY.test(value) ? value : 'all';
}

/** 兼容单值 ?domain= 与多值 ?domains=a,b；输出去重后的合法 key。 */
function readDomains(value: string | null, legacy: string): string[] {
  const domains = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(
      (item) => item && item !== 'all' && SAFE_FILTER_KEY.test(item),
    );
  const unique = Array.from(new Set(domains));
  if (unique.length === 0 && legacy !== 'all') return [legacy];
  return unique;
}

function Chip({
  active,
  children,
  onClick,
  testId,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'rounded-md border border-border px-3 py-1.5 text-sm',
        active
          ? 'bg-bg-secondary font-medium text-text-primary'
          : 'text-text-secondary hover:bg-bg-secondary',
      )}
    >
      {children}
    </button>
  );
}

/** 校验 `:type` 后再挂载内层，避免非法参数导致 hooks 数量变化。 */
export default function AssetListRoute() {
  const { type, assetId } = useParams();

  if (!isSafeResourceType(type)) {
    return <Navigate to={`${Routes.Hub}/${DEFAULT_RESOURCE_TYPE}`} replace />;
  }

  return <AssetList type={type} assetId={assetId} />;
}

function AssetList({ type, assetId }: { type: string; assetId?: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const field = readFilterKey(params.get('field'));
  const legacyDomain = readFilterKey(params.get('domain'));
  const domains = readDomains(params.get('domains'), legacyDomain);
  const domainKey = domains.join(',');
  const domainMatch = params.get('domain_match') === 'all' ? 'all' : 'any';
  const arch = readFilterKey(params.get('arch'));
  const accelerator = readFilterKey(params.get('accelerator'));
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  const listPath = `${Routes.Hub}/${type}`;
  const queryString = params.toString();
  const listUrl = queryString ? `${listPath}?${queryString}` : listPath;

  const taxonomies = useQuery({
    queryKey: ['aihub-taxonomies', type, field],
    queryFn: async () =>
      (
        await fetchTaxonomies(type, field === 'all' ? undefined : field)
      ).data,
  });

  const list = useQuery({
    queryKey: [
      'aihub-market',
      type,
      field,
      domainKey,
      domainMatch,
      arch,
      accelerator,
      q,
      page,
    ],
    queryFn: async () =>
      (
        await fetchMarketPage({
          assetType: type,
          field,
          domain: 'all',
          domains,
          domainMatch,
          q,
          page,
          pageSize: PAGE_SIZE,
          arch,
          accelerator,
        })
      ).data,
  });

  const isZh = i18n.language?.toLowerCase().startsWith('zh');
  const labelOf = (items: TaxonomyItem[] | undefined, key: string) => {
    const item = items?.find((entry) => entry.key === key);
    if (!item) return key;
    return (isZh ? item.label.zh : item.label.en || item.label.zh) || key;
  };
  const fieldLabel = (key: string) => labelOf(taxonomies.data?.fields, key);
  const domainLabel = (key: string) => labelOf(taxonomies.data?.domains, key);
  const facetLabel = (item: { key: string; label: { zh: string; en?: string } }) =>
    (isZh ? item.label.zh : item.label.en || item.label.zh) || item.key;
  const archFacets = (taxonomies.data?.hardware?.arch ?? []).filter(
    (item) => item.count > 0,
  );
  const accelFacets = (
    taxonomies.data?.hardware?.accelerators ?? []
  ).filter((item) => item.count > 0);

  const assets = list.data?.items ?? [];
  const fallbackAsset = assets.find((asset) => asset.id === assetId);
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered =
    field !== 'all' ||
    domains.length > 0 ||
    arch !== 'all' ||
    accelerator !== 'all' ||
    Boolean(q);

  // page 越界（筛选后总数变小 / 手改 URL）时收敛到最后一页并回写 URL
  useEffect(() => {
    if (!list.data) return;
    const max = Math.max(1, Math.ceil(list.data.total / PAGE_SIZE));
    if (page <= max) return;

    const next = new URLSearchParams(params);
    if (max === 1) next.delete('page');
    else next.set('page', String(max));
    const query = next.toString();
    navigate(query ? `${listPath}?${query}` : listPath, { replace: true });
  }, [list.data, page, params, listPath, navigate]);

  const navigateWith = (
    patch: Record<string, string | number | undefined>,
    options: { keepPage?: boolean } = {},
  ) => {
    const next = new URLSearchParams(params);
    if (!options.keepPage) next.delete('page');
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    }
    const query = next.toString();
    navigate(query ? `${listPath}?${query}` : listPath);
  };

  /** 多选行业：写 ?domains=a,b；选中 >1 时保留/补 domain_match */
  const updateDomains = (next: string[]) => {
    const unique = Array.from(new Set(next));
    const nextParams = new URLSearchParams(params);
    nextParams.delete('page');
    nextParams.delete('domain');
    if (unique.length === 0) {
      nextParams.delete('domains');
      nextParams.delete('domain_match');
    } else {
      nextParams.set('domains', unique.join(','));
      if (unique.length > 1) {
        if (!nextParams.get('domain_match')) {
          nextParams.set('domain_match', 'any');
        }
      } else {
        nextParams.delete('domain_match');
      }
    }
    const query = nextParams.toString();
    navigate(query ? `${listPath}?${query}` : listPath);
  };

  const toggleDomain = (key: string) => {
    updateDomains(
      domains.includes(key)
        ? domains.filter((item) => item !== key)
        : [...domains, key],
    );
  };

  const openAsset = (id: string) => {
    navigate(
      `${listPath}/${encodeURIComponent(id)}${queryString ? `?${queryString}` : ''}`,
    );
  };

  const prefetchAsset = (id: string) => {
    void queryClient.prefetchQuery({
      queryKey: ['aihub-asset', id],
      queryFn: async () => (await fetchAsset(id)).data,
      staleTime: 60_000,
    });
  };

  const closeAsset = () => {
    const previousId = assetId;
    navigate(listUrl);
    if (!previousId) return;
    // 关闭后把焦点还给触发卡片（移动端抽屉/桌面右栏共用）。
    // 用属性遍历而非拼选择器，避免 assetId 含引号/方括号时 querySelector 抛错。
    window.setTimeout(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-asset-id]'),
      ).find((node) => node.dataset.assetId === previousId);
      target?.focus();
    }, 0);
  };

  const typeTitle = t(`aihub.type.${type}`, { defaultValue: type });

  return (
    <div className="flex min-h-0 flex-1 gap-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-0.5">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text-primary">
            {typeTitle}
          </h1>
          <p className="text-sm text-text-secondary">{t('aihub.subtitle')}</p>
        </header>

        {type === 'datasets' && (
          <DatasetPublish
            fields={taxonomies.data?.fields ?? []}
            domains={taxonomies.data?.domains ?? []}
            onPublished={() => {
              void list.refetch();
              void taxonomies.refetch();
              void queryClient.invalidateQueries({
                queryKey: ['aihub-markets'],
              });
            }}
          />
        )}

        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">
                  {t('aihub.filter.field')}
                </span>
                <Chip
                  active={field === 'all'}
                  onClick={() => navigateWith({ field: 'all' })}
                  testId="aihub-filter-field-all"
                >
                  {t('aihub.filter.all')}
                </Chip>
                {(taxonomies.data?.fields ?? [])
                  .filter((item) => !item.synthetic)
                  .map((item) => (
                  <Chip
                    key={item.key}
                    active={field === item.key}
                    onClick={() => navigateWith({ field: item.key })}
                    testId={`aihub-filter-field-${item.key}`}
                  >
                    {labelOf(taxonomies.data?.fields, item.key)}
                    <span className="ml-1 text-[11px] text-text-secondary">
                      {item.count}
                    </span>
                  </Chip>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">
                  {t('aihub.filter.domain')}
                </span>
                <Chip
                  active={domains.length === 0}
                  onClick={() => updateDomains([])}
                  testId="aihub-filter-domain-all"
                >
                  {t('aihub.filter.all')}
                </Chip>
                {(taxonomies.data?.domains ?? [])
                  .filter((item) => !item.synthetic)
                  .map((item) => (
                    <Chip
                      key={item.key}
                      active={domains.includes(item.key)}
                      onClick={() => toggleDomain(item.key)}
                      testId={`aihub-filter-domain-${item.key}`}
                    >
                      {labelOf(taxonomies.data?.domains, item.key)}
                      <span className="ml-1 text-[11px] text-text-secondary">
                        {item.count}
                      </span>
                    </Chip>
                  ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              {archFacets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-secondary">
                    {t('aihub.hardware.archLabel')}
                  </span>
                  <Chip
                    active={arch === 'all'}
                    onClick={() => navigateWith({ arch: 'all' })}
                    testId="aihub-filter-arch-all"
                  >
                    {t('aihub.filter.all')}
                  </Chip>
                  {archFacets.map((item) => (
                    <Chip
                      key={item.key}
                      active={arch === item.key}
                      onClick={() => navigateWith({ arch: item.key })}
                      testId={`aihub-filter-arch-${item.key}`}
                    >
                      {facetLabel(item)}
                      <span className="ml-1 text-[11px] text-text-secondary">
                        {item.count}
                      </span>
                    </Chip>
                  ))}
                </div>
              )}

              {accelFacets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-secondary">
                    {t('aihub.hardware.accelLabel')}
                  </span>
                  <Chip
                    active={accelerator === 'all'}
                    onClick={() => navigateWith({ accelerator: 'all' })}
                    testId="aihub-filter-accel-all"
                  >
                    {t('aihub.filter.all')}
                  </Chip>
                  {accelFacets.map((item) => (
                    <Chip
                      key={item.key}
                      active={accelerator === item.key}
                      onClick={() => navigateWith({ accelerator: item.key })}
                      testId={`aihub-filter-accel-${item.key}`}
                    >
                      {facetLabel(item)}
                      <span className="ml-1 text-[11px] text-text-secondary">
                        {item.count}
                      </span>
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              navigateWith({ q: search.trim() });
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('aihub.search.placeholder')}
              aria-label={t('aihub.search.placeholder')}
              className="h-8 w-full max-w-sm rounded border border-border bg-bg-input px-2 text-sm text-text-primary outline-none focus:border-border-button"
            />
            <Button type="submit" variant="outline" size="sm">
              {t('aihub.search.action')}
            </Button>
          </form>
        </section>

        {list.error ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-4">
            <p className="text-sm text-text-secondary">
              {t('aihub.list.error', {
                message: (list.error as Error).message,
              })}
            </p>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              {t('aihub.list.retry')}
            </Button>
          </div>
        ) : list.isLoading ? (
          <p className="text-sm text-text-secondary">
            {t('aihub.list.loading')}
          </p>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-text-secondary">
              {filtered ? t('aihub.list.emptyFiltered') : t('aihub.list.empty')}
            </p>
            {filtered && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(listPath)}
              >
                {t('aihub.list.clearFilters')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <section
              className={cn(
                'grid grid-cols-1 gap-3',
                assetId
                  ? 'sm:grid-cols-2 2xl:grid-cols-3'
                  : 'sm:grid-cols-2 xl:grid-cols-4',
              )}
            >
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  fieldLabel={fieldLabel}
                  active={asset.id === assetId}
                  onOpen={() => openAsset(asset.id)}
                  onPrefetch={() => prefetchAsset(asset.id)}
                />
              ))}
            </section>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() =>
                  navigateWith(
                    { page: page <= 1 ? undefined : page - 1 },
                    { keepPage: true },
                  )
                }
              >
                {t('aihub.pagination.prev')}
              </Button>
              <span className="text-xs text-text-secondary">
                {t('aihub.pagination.summary', { page, totalPages, total })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() =>
                  navigateWith(
                    { page: page >= totalPages ? undefined : page + 1 },
                    { keepPage: true },
                  )
                }
              >
                {t('aihub.pagination.next')}
              </Button>
            </div>
          </>
        )}
      </div>

      <AssetWorkspace
        visible={Boolean(assetId)}
        assetId={assetId}
        fallbackAsset={fallbackAsset}
        fieldLabel={fieldLabel}
        domainLabel={domainLabel}
        onClose={closeAsset}
        onOpenAsset={openAsset}
      />

      {assetId && (
        <div
          className="fixed inset-y-0 left-16 right-0 z-30 bg-black/30 xl:hidden"
          onClick={closeAsset}
          aria-hidden
          data-testid="aihub-asset-backdrop"
        />
      )}
    </div>
  );
}
