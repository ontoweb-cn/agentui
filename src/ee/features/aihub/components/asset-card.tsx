import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { MarketAsset } from '../api';
import { AssetImage } from './asset-image';
import {
  acceleratorLabelKey,
  archLabelKey,
  hasHardwareLabel,
} from './hardware-labels';

export function AssetCard({
  asset,
  fieldLabel,
  active,
  onOpen,
  onPrefetch,
}: {
  asset: MarketAsset;
  fieldLabel: (key: string) => string;
  active: boolean;
  onOpen: () => void;
  /** 悬停/聚焦时预取详情 */
  onPrefetch?: () => void;
}) {
  const { t } = useTranslation();
  const gpuCount = asset.resources?.gpu ?? 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-expanded={active}
      data-testid={`aihub-asset-card-${asset.id}`}
      data-asset-id={asset.id}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border text-left transition-colors hover:bg-bg-secondary',
        active ? 'border-border-button bg-bg-secondary' : 'border-border',
      )}
    >
      <AssetImage asset={asset} className="h-32 w-full" />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {asset.label}
          </span>
          {asset.price > 0 && (
            <span className="rounded border border-border px-1 text-[10px] text-text-secondary">
              {t('aihub.detail.enterprise')}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-text-secondary">{asset.name}</div>
        <p className="line-clamp-2 text-xs text-text-secondary">
          {asset.description || t('aihub.detail.noDescription')}
        </p>
        {(hasHardwareLabel(asset.hardware) || gpuCount > 0) && (
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-text-secondary">
            {asset.hardware?.arch && asset.hardware.arch !== 'unknown' && (
              <span className="rounded border border-border px-1">
                {t(archLabelKey(asset.hardware.arch))}
              </span>
            )}
            {asset.hardware?.accelerator &&
              asset.hardware.accelerator !== 'unknown' && (
                <span className="rounded border border-border px-1">
                  {t(acceleratorLabelKey(asset.hardware.accelerator))}
                  {asset.hardware.accelerator_model
                    ? ` ${asset.hardware.accelerator_model}`
                    : ''}
                </span>
              )}
            {gpuCount > 0 && (
              <span className="rounded border border-border px-1">
                {t('aihub.hardware.gpuCountValue', { count: gpuCount })}
              </span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-text-secondary">
          <span>{fieldLabel(asset.field)}</span>
          <span>
            {asset.images_status === 'placeholder'
              ? t('aihub.detail.imagePending')
              : t('aihub.detail.imageReady')}
          </span>
        </div>
      </div>
    </button>
  );
}
