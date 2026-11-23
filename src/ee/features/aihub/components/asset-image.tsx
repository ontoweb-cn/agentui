import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { MarketAsset } from '../api';

/** 相对路径图片经 BFF 静态代理；绝对 URL 直接使用。 */
export function buildAssetImageSrc(asset: MarketAsset): string {
  if (!asset.pic) return '';
  if (/^https?:\/\//i.test(asset.pic)) return asset.pic;
  const path = asset.pic.split('/').map(encodeURIComponent).join('/');
  return `/api/bff/aihub/static/deep-learning/${encodeURIComponent(
    asset.name,
  )}/${path}`;
}

export function AssetImage({
  asset,
  className,
}: {
  asset: MarketAsset;
  className?: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const src = buildAssetImageSrc(asset);

  if (!src || failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-bg-secondary text-xs text-text-secondary',
          className,
        )}
        data-testid="aihub-asset-image-fallback"
      >
        {t('aihub.detail.noImage')}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={asset.label}
      className={cn('object-cover', className)}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
