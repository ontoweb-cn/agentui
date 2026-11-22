import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LucidePanelRightClose, LucideStar } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  downloadAsset,
  fetchAsset,
  fetchMarketPage,
  installAsset,
  toggleFavorite,
  type MarketAsset,
} from '../api';
import { AgentChat } from './agent-chat';
import { AssetImage } from './asset-image';
import {
  acceleratorLabelKey,
  archLabelKey,
  sourceLabelKey,
} from './hardware-labels';

type WorkspaceTab = 'overview' | 'docs' | 'related' | 'chat';

export interface AssetWorkspaceProps {
  visible: boolean;
  assetId?: string;
  /** 列表项作为详情加载前的占位，避免右栏空白闪烁 */
  fallbackAsset?: MarketAsset;
  fieldLabel: (key: string) => string;
  domainLabel: (key: string) => string;
  onClose: () => void;
  /** 相关资产点击后切换到目标详情。 */
  onOpenAsset?: (id: string) => void;
}

const RESOURCE_SLUGS: Record<string, string> = {
  model: 'models',
  dataset: 'datasets',
  agent: 'agents',
  skill: 'skills',
  tool: 'tools',
  mcp: 'mcps',
  solution: 'solutions',
  app: 'apps',
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">{children}</dd>
    </div>
  );
}

function formatSpecValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** 仅放行 http(s) 文档链接，避免后端数据注入 javascript:/data: 等协议。 */
function safeDocUrl(doc?: string): string | undefined {
  if (!doc) return undefined;
  try {
    const { protocol } = new URL(doc, 'http://localhost');
    return protocol === 'http:' || protocol === 'https:' ? doc : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 资源详情右栏。
 *
 * 交互与尺寸对齐 chat 页 WorkspacePanel：桌面内联 440px、收起为 0 宽；
 * 窄屏为右侧抽屉（带遮罩，Esc/遮罩关闭）。
 */
export function AssetWorkspace({
  visible,
  assetId,
  fallbackAsset,
  fieldLabel,
  domainLabel,
  onClose,
  onOpenAsset,
}: AssetWorkspaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<WorkspaceTab, HTMLButtonElement | null>>>(
    {},
  );

  const detail = useQuery<MarketAsset, Error>({
    queryKey: ['aihub-asset', assetId],
    enabled: visible && Boolean(assetId),
    queryFn: async () => (await fetchAsset(assetId as string)).data,
    placeholderData: fallbackAsset,
    staleTime: 60_000,
  });

  const favorite = useMutation({
    mutationFn: async () => (await toggleFavorite(assetId as string)).data,
    onSuccess: (result) => {
      queryClient.setQueryData<MarketAsset>(
        ['aihub-asset', assetId],
        (previous) =>
          previous ? { ...previous, favorited: result.favorited } : previous,
      );
    },
  });
  const resetFavorite = favorite.reset;

  const install = useMutation({
    mutationFn: async () => (await installAsset(assetId as string)).data,
  });
  const resetInstall = install.reset;
  const download = useMutation({
    mutationFn: async () => (await downloadAsset(assetId as string)).data,
  });
  const resetDownload = download.reset;

  useEffect(() => {
    setActiveTab('overview');
    setCopied(false);
    resetFavorite();
    resetInstall();
    resetDownload();
  }, [assetId, resetFavorite, resetInstall, resetDownload]);

  useEffect(() => {
    if (visible) closeRef.current?.focus();
  }, [visible, assetId]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  const asset = detail.data ?? fallbackAsset;
  const docUrl = safeDocUrl(asset?.doc);
  const isAgent = asset?.asset_type === 'agent';
  const isDataset = asset?.asset_type === 'dataset';
  const typeSlug = asset
    ? RESOURCE_SLUGS[asset.asset_type] ?? `${asset.asset_type}s`
    : undefined;
  const related = useQuery({
    queryKey: ['aihub-related', typeSlug, asset?.field, asset?.id],
    enabled: visible && Boolean(typeSlug && asset?.field),
    queryFn: async () => {
      const page = (
        await fetchMarketPage({
          assetType: typeSlug as string,
          field: asset?.field ?? 'all',
          domain: 'all',
          page: 1,
          pageSize: 8,
        })
      ).data;
      return page.items.filter((item) => item.id !== asset?.id).slice(0, 6);
    },
  });
  const tabs: WorkspaceTab[] = isAgent
    ? ['overview', 'docs', 'related', 'chat']
    : ['overview', 'docs', 'related'];
  const spec = (asset?.spec ?? {}) as Record<string, unknown>;
  const storageUri =
    typeof spec.storage_uri === 'string' ? spec.storage_uri : undefined;
  const tips = Array.isArray(spec.tips)
    ? spec.tips.filter((item): item is string => typeof item === 'string')
    : undefined;
  const specEntries = Object.entries(asset?.spec ?? {});
  const errorMessage = detail.error?.message ?? '';
  const notFound = /404|not[_ ]?found/i.test(errorMessage);

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: WorkspaceTab,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  const copyIdentifier = async () => {
    if (!asset?.name) return;
    try {
      await navigator.clipboard?.writeText(asset.name);
      setCopied(true);
    } catch {
      // 剪贴板不可用时静默降级，标识文本仍可手动选择复制
    }
  };

  return (
    <section
      data-testid="aihub-asset-workspace"
      role="complementary"
      aria-label={t('aihub.detail.title')}
      aria-hidden={!visible}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden bg-bg-base',
        'transition-[width] ease-out duration-300',
        visible
          ? 'xl:w-[440px] xl:border-l xl:border-border-button'
          : 'xl:w-0',
        'max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:w-[min(440px,calc(100vw-4rem))] max-xl:border-l max-xl:border-border-button max-xl:shadow-xl',
        !visible && 'max-xl:hidden',
      )}
    >
      {visible && (
        <>
          <div className="flex items-center justify-between gap-2 p-5 pb-2">
            <span className="truncate text-base text-text-primary">
              {asset?.label ?? t('aihub.detail.title')}
            </span>
            <div className="flex items-center gap-1">
              {asset?.favorited !== undefined && (
                <Button
                  variant="transparent"
                  size="icon-sm"
                  className="border-0"
                  aria-pressed={asset.favorited}
                  aria-label={
                    asset.favorited
                      ? t('aihub.detail.unfavorite')
                      : t('aihub.detail.favorite')
                  }
                  title={
                    asset.favorited
                      ? t('aihub.detail.unfavorite')
                      : t('aihub.detail.favorite')
                  }
                  disabled={favorite.isPending}
                  onClick={() => favorite.mutate()}
                  data-testid="aihub-asset-favorite"
                >
                  <LucideStar
                    className={cn('size-4', asset.favorited && 'fill-current')}
                  />
                </Button>
              )}
              <Button
                ref={closeRef}
                variant="transparent"
                size="icon-sm"
                className="border-0"
                onClick={onClose}
                aria-label={t('aihub.detail.close')}
                data-testid="aihub-asset-workspace-close"
              >
                <LucidePanelRightClose className="size-4" />
              </Button>
            </div>
          </div>

          {favorite.isError && (
            <p className="px-5 pb-1 text-xs text-text-secondary">
              {t('aihub.detail.favoriteError')}
            </p>
          )}

          {asset && (
            <div
              role="tablist"
              aria-label={t('aihub.detail.title')}
              className="flex gap-1 border-b border-border-button px-5"
            >
              {tabs.map((tab) => (
                <button
                  key={tab}
                  ref={(node) => {
                    tabRefs.current[tab] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`aihub-asset-panel-${tab}`}
                  tabIndex={activeTab === tab ? 0 : -1}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab)}
                  className={cn(
                    'border-b-2 px-2 py-2 text-sm transition-colors',
                    activeTab === tab
                      ? 'border-text-primary text-text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary',
                  )}
                >
                  {t(`aihub.detail.${tab}`)}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!asset && detail.isLoading ? (
              <div className="flex flex-col gap-3 p-5" aria-busy="true">
                <div className="h-40 w-full rounded-md bg-bg-secondary" />
                <div className="h-4 w-3/4 rounded bg-bg-secondary" />
                <div className="h-4 w-1/2 rounded bg-bg-secondary" />
              </div>
            ) : detail.isError ? (
              <div className="flex flex-col items-start gap-2 p-5 text-sm">
                <p className="text-text-secondary">
                  {notFound
                    ? t('aihub.detail.notFound')
                    : t('aihub.detail.error', { message: errorMessage })}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => detail.refetch()}
                >
                  {t('aihub.detail.retry')}
                </Button>
              </div>
            ) : asset && activeTab === 'overview' ? (
              <div
                id="aihub-asset-panel-overview"
                role="tabpanel"
                className="flex flex-col gap-4 p-5 text-sm"
              >
                <AssetImage asset={asset} className="h-40 w-full rounded-md" />
                <p className="whitespace-pre-wrap text-text-secondary">
                  {asset.description || t('aihub.detail.noDescription')}
                </p>

                <dl className="flex flex-col gap-2">
                  <DetailRow label={t('aihub.detail.identifier')}>
                    <span className="inline-flex items-center gap-2">
                      <span className="break-all">{asset.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={copyIdentifier}
                        data-testid="aihub-asset-copy"
                      >
                        {copied
                          ? t('aihub.detail.copied')
                          : t('aihub.detail.copy')}
                      </Button>
                    </span>
                  </DetailRow>
                  <DetailRow label={t('aihub.detail.field')}>
                    {fieldLabel(asset.field)}
                  </DetailRow>
                  <DetailRow label={t('aihub.detail.domains')}>
                    {asset.domains.length > 0
                      ? asset.domains.map(domainLabel).join(', ')
                      : '—'}
                  </DetailRow>
                  <DetailRow label={t('aihub.detail.status')}>
                    {asset.status}
                  </DetailRow>
                  <DetailRow label={t('aihub.detail.imagesStatus')}>
                    {asset.images_status === 'placeholder'
                      ? t('aihub.detail.imagePending')
                      : t('aihub.detail.imageReady')}
                  </DetailRow>
                  <DetailRow label={t('aihub.hardware.archLabel')}>
                    {t(archLabelKey(asset.hardware?.arch))}
                  </DetailRow>
                  <DetailRow label={t('aihub.hardware.accelLabel')}>
                    {t(acceleratorLabelKey(asset.hardware?.accelerator))}
                    {asset.hardware?.accelerator_model
                      ? ` · ${asset.hardware.accelerator_model}`
                      : ''}
                  </DetailRow>
                  {asset.hardware?.vram_gb != null && (
                    <DetailRow label={t('aihub.hardware.vramLabel')}>
                      {t('aihub.hardware.memoryValue', {
                        size: asset.hardware.vram_gb,
                      })}
                    </DetailRow>
                  )}
                  {asset.resources?.gpu != null && (
                    <DetailRow label={t('aihub.hardware.gpuCountLabel')}>
                      {t('aihub.hardware.gpuCountValue', {
                        count: asset.resources.gpu,
                      })}
                    </DetailRow>
                  )}
                  {asset.resources?.cpu != null && (
                    <DetailRow label={t('aihub.hardware.cpuCountLabel')}>
                      {t('aihub.hardware.cpuCountValue', {
                        count: asset.resources.cpu,
                      })}
                    </DetailRow>
                  )}
                  {asset.resources?.memory_gb != null && (
                    <DetailRow label={t('aihub.hardware.memoryLabel')}>
                      {t('aihub.hardware.memoryValue', {
                        size: asset.resources.memory_gb,
                      })}
                    </DetailRow>
                  )}
                  {(asset.hardware?.framework ||
                    asset.hardware?.runtime) && (
                    <DetailRow label={t('aihub.hardware.frameworkLabel')}>
                      {[asset.hardware?.framework, asset.hardware?.runtime]
                        .filter(Boolean)
                        .join(' · ')}
                    </DetailRow>
                  )}
                  {asset.hardware?.source &&
                    asset.hardware.source !== 'unknown' && (
                      <DetailRow label={t('aihub.hardware.sourceLabel')}>
                        {t(sourceLabelKey(asset.hardware.source))}
                      </DetailRow>
                    )}
                  <DetailRow label={t('aihub.detail.hot')}>
                    {asset.hot}
                  </DetailRow>
                  {asset.price > 0 && (
                    <DetailRow label={t('aihub.detail.enterprise')}>
                      {asset.price}
                    </DetailRow>
                  )}
                  {asset.images && (
                    <DetailRow label={t('aihub.detail.images')}>
                      <span className="whitespace-pre-wrap break-all text-xs">
                        {asset.images}
                      </span>
                    </DetailRow>
                  )}
                  {isDataset && (
                    <>
                      {typeof spec.format === 'string' && (
                        <DetailRow label={t('aihub.dataset.formatLabel')}>
                          {spec.format}
                        </DetailRow>
                      )}
                      {typeof spec.size_bytes === 'number' && (
                        <DetailRow label={t('aihub.dataset.sizeLabel')}>
                          {formatBytes(spec.size_bytes)}
                        </DetailRow>
                      )}
                      {typeof spec.license === 'string' && (
                        <DetailRow label={t('aihub.dataset.licenseLabel')}>
                          {spec.license}
                        </DetailRow>
                      )}
                      {typeof spec.checksum === 'string' && (
                        <DetailRow label={t('aihub.dataset.checksumLabel')}>
                          <span className="break-all text-xs">{spec.checksum}</span>
                        </DetailRow>
                      )}
                      <DetailRow label={t('aihub.dataset.storageLabel')}>
                        {storageUri ? (
                          <span className="break-all text-xs">{storageUri}</span>
                        ) : (
                          <span className="text-text-secondary">
                            {t('aihub.dataset.storageRestricted')}
                          </span>
                        )}
                      </DetailRow>
                    </>
                  )}
                </dl>

                {specEntries.length > 0 && (
                  <details className="rounded-md border border-border p-3">
                    <summary className="cursor-pointer text-text-secondary">
                      {t('aihub.detail.spec')}
                    </summary>
                    <dl className="mt-2 flex flex-col gap-1 text-xs">
                      {specEntries.map(([key, value]) => (
                        <DetailRow key={key} label={key}>
                          {formatSpecValue(value)}
                        </DetailRow>
                      ))}
                    </dl>
                  </details>
                )}

                {isDataset ? (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={download.isPending}
                        onClick={() => download.mutate()}
                        data-testid="aihub-asset-download"
                      >
                        {download.isPending
                          ? t('aihub.dataset.downloading')
                          : t('aihub.dataset.download')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={install.isPending || install.isSuccess}
                        onClick={() => install.mutate()}
                        data-testid="aihub-asset-install"
                      >
                        {install.isSuccess
                          ? t('aihub.install.installed')
                          : install.isPending
                            ? t('aihub.install.installing')
                            : t('aihub.install.action')}
                      </Button>
                    </div>
                    {download.data && (
                      <p className="break-all rounded bg-bg-secondary p-2 text-xs text-text-secondary">
                        {download.data.storage_uri}
                      </p>
                    )}
                    {download.isError && (
                      <p className="text-xs text-text-secondary">
                        {t('aihub.dataset.downloadError', {
                          message: (download.error as Error).message,
                        })}
                      </p>
                    )}
                    {install.isError && (
                      <p className="text-xs text-text-secondary">
                        {t('aihub.install.error', {
                          message: (install.error as Error).message,
                        })}
                      </p>
                    )}
                  </div>
                ) : isAgent ? (
                  <div className="flex flex-col gap-1 border-t border-border pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={install.isPending || install.isSuccess}
                        onClick={() => install.mutate()}
                        data-testid="aihub-asset-install"
                      >
                        {install.isSuccess
                          ? t('aihub.install.installed')
                          : install.isPending
                            ? t('aihub.install.installing')
                            : t('aihub.install.action')}
                      </Button>
                    </div>
                    {install.isError && (
                      <p className="text-xs text-text-secondary">
                        {t('aihub.install.error', {
                          message: (install.error as Error).message,
                        })}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 border-t border-border pt-3">
                    <div className="flex flex-wrap gap-2">
                      {(['develop', 'finetune', 'deploy'] as const).map(
                        (action) => (
                          <Button
                            key={action}
                            variant="outline"
                            size="sm"
                            disabled
                            title={t('aihub.detail.actions.hint')}
                          >
                            {t(`aihub.detail.actions.${action}`)}
                          </Button>
                        ),
                      )}
                    </div>
                    <p className="text-xs text-text-secondary">
                      {t('aihub.detail.actions.hint')}
                    </p>
                  </div>
                )}
              </div>
            ) : asset && activeTab === 'related' ? (
              <div
                id="aihub-asset-panel-related"
                role="tabpanel"
                className="flex flex-col gap-2 p-5 text-sm"
                data-testid="aihub-related-list"
              >
                {related.isLoading ? (
                  <p className="text-text-secondary">{t('aihub.loading')}</p>
                ) : related.isError ? (
                  <p className="text-text-secondary">
                    {t('aihub.detail.relatedError')}
                  </p>
                ) : (related.data?.length ?? 0) === 0 ? (
                  <p className="text-text-secondary">
                    {t('aihub.detail.relatedEmpty')}
                  </p>
                ) : (
                  related.data?.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenAsset?.(item.id)}
                      className="flex flex-col items-start gap-1 rounded-md border border-border p-2 text-left hover:bg-bg-secondary"
                      data-testid="aihub-related-item"
                    >
                      <span className="text-text-primary">{item.label}</span>
                      <span className="line-clamp-2 text-xs text-text-secondary">
                        {item.description || item.name}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : asset && activeTab === 'chat' ? (
              <div id="aihub-asset-panel-chat" role="tabpanel">
                <AgentChat assetId={asset.id} tips={tips} />
              </div>
            ) : asset ? (
              <div
                id="aihub-asset-panel-docs"
                role="tabpanel"
                className="flex flex-col gap-3 p-5 text-sm"
              >
                {docUrl ? (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-text-primary underline hover:text-text-secondary"
                    data-testid="aihub-asset-doc-link"
                  >
                    {t('aihub.detail.docsOpen')}
                  </a>
                ) : (
                  <p className="text-text-secondary">
                    {t('aihub.detail.docsEmpty')}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
