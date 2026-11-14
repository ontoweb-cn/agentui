import { useQuery } from '@tanstack/react-query';
import { LucideBox, LucideLibrary } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { Routes } from '@/constants/routes';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { HubLayout, type HubMenuItem } from '@/layouts/components/hub-layout';

import { fetchMarkets, type MarketType } from '../../api';
import { FeatureDisabledState } from '../../components/feature-disabled';
import { RESOURCE_TYPES } from '../../resource-types';

function menuLabel(
  market: MarketType | undefined,
  isZh: boolean,
  fallback: string,
): string {
  if (!market) return fallback;
  const label = isZh ? market.label?.zh : market.label?.en;
  return label || market.label?.zh || fallback;
}

/**
 * 资源 hub：`/hub` 的布局容器。
 *
 * 左侧资源类型菜单由后端 markets 驱动（含计数，enabled=false 隐藏），
 * 内容区由 `/hub/:type[/:assetId]` 复用同一个列表页。
 */
export default function AihubHubPage() {
  const { t, i18n } = useTranslation();
  const { features, isLoading } = useFeatureFlags();
  const enabled = features?.aihub === true;

  const markets = useQuery({
    queryKey: ['aihub-markets'],
    enabled,
    queryFn: async () => (await fetchMarkets()).data.items,
  });

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center p-8 text-sm text-text-secondary">
        {t('aihub.loading')}
      </div>
    );
  }
  if (!enabled) {
    return <FeatureDisabledState />;
  }

  const isZh = i18n.language?.toLowerCase().startsWith('zh');
  const marketBySlug = new Map(
    (markets.data ?? []).map((market) => [market.slug, market]),
  );

  const items: HubMenuItem[] = [
    ...RESOURCE_TYPES.map((meta) => ({
      key: meta.key,
      icon: meta.icon,
      fallbackLabel: t(meta.labelKey),
    })),
    // 后端配置新增的类型不在静态清单内，也并入菜单（默认图标，名称取 /markets.label）
    ...(markets.data ?? [])
      .filter(
        (market) =>
          !RESOURCE_TYPES.some((meta) => meta.key === market.slug),
      )
      .map((market) => ({
        key: market.slug,
        icon: LucideBox,
        fallbackLabel: market.slug,
      })),
  ]
    .filter((meta) => marketBySlug.get(meta.key)?.enabled !== false)
    .map((meta) => {
      const market = marketBySlug.get(meta.key);
      const Icon = meta.icon;

      return {
        key: `${Routes.Hub}/${meta.key}`,
        label: menuLabel(market, isZh, meta.fallbackLabel),
        icon: <Icon className="size-[1em]" />,
        suffix: market ? String(market.count) : undefined,
        testId: `aihub-submenu-${meta.key}`,
      };
    });

  return (
    <HubLayout
      testIdPrefix="aihub-hub"
      title={t('header.resources')}
      icon={<LucideLibrary className="size-5 shrink-0 stroke-[1.5]" />}
      items={items}
      contentClassName="overflow-hidden"
    >
      <Outlet />
    </HubLayout>
  );
}
