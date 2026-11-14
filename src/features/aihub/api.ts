/**
 * aihub BFF 客户端（M1：市场、分类、详情）。
 *
 * 浏览器只访问 `/api/bff/aihub/*`，不直连 aihub。
 */

import request from '@/utils/next-request';

export interface AihubMeta {
  service: string;
  version: string;
  model_source: string;
  storage: string;
  subject: string;
  kid: string;
  assertion_exp: number;
  now: number;
}

export interface TaxonomyLabel {
  zh: string;
  en?: string;
}

export interface TaxonomyItem {
  key: string;
  label: TaxonomyLabel;
  count: number;
  synthetic: boolean;
  order: number;
  icon?: string | null;
}

export interface HardwareFacet {
  key: string;
  label: TaxonomyLabel;
  count: number;
}

export interface Taxonomies {
  version: number;
  config_hash: string;
  asset_type: string;
  fields: TaxonomyItem[];
  domains: TaxonomyItem[];
  hardware?: {
    arch: HardwareFacet[];
    accelerators: HardwareFacet[];
  };
}

export interface AssetHardware {
  /** x86_64 | arm64 | unknown */
  arch: string;
  /** nvidia | ascend | amd | gpu | cpu | unknown */
  accelerator: string;
  accelerator_model?: string;
  vram_gb?: number | null;
  framework?: string;
  runtime?: string;
  /** declared | curated | inferred | unknown */
  source?: string;
  note?: string;
}

export interface AssetResources {
  gpu?: number | null;
  cpu?: number | null;
  memory_gb?: number | null;
}

export interface MarketType {
  slug: string;
  type: string;
  label: TaxonomyLabel;
  enabled: boolean;
  count: number;
}

export interface MarketAsset {
  id: string;
  asset_type: string;
  name: string;
  label: string;
  field: string;
  domains: string[];
  status: string;
  hot: number;
  price: number;
  description: string;
  pic: string;
  doc: string;
  images: string;
  images_status: string;
  spec: Record<string, unknown>;
  hardware?: AssetHardware;
  resources?: AssetResources;
}

export interface MarketPage {
  asset_type: string;
  field: string;
  domain: string;
  total: number;
  page: number;
  page_size: number;
  items: MarketAsset[];
}

export interface MarketQueryParams {
  assetType: string;
  field: string;
  /** 路径中的单 domain；使用多选时传 all */
  domain: string;
  /** 多选行业（query `domains=`）；非空时路径 domain 强制 all */
  domains?: string[];
  /** 多选匹配模式，默认 any */
  domainMatch?: 'any' | 'all';
  q?: string;
  page?: number;
  pageSize?: number;
  arch?: string;
  accelerator?: string;
  minVram?: number;
}

/** `GET /api/bff/aihub/meta`（原始 JSON，无 code/data 信封）。 */
export const fetchAihubMeta = () =>
  request.get<AihubMeta>('/api/bff/aihub/meta');

export const fetchMarkets = () =>
  request.get<{ items: MarketType[] }>('/api/bff/aihub/markets');

export const fetchTaxonomies = (assetType: string, field?: string) =>
  request.get<Taxonomies>('/api/bff/aihub/taxonomies', {
    params: { asset_type: assetType, field },
  });

export const fetchMarketPage = ({
  assetType,
  field,
  domain,
  domains,
  domainMatch,
  q,
  page = 1,
  pageSize = 20,
  arch,
  accelerator,
  minVram,
}: MarketQueryParams) => {
  const selectedDomains = (domains ?? []).filter(Boolean);
  const domainPath = selectedDomains.length > 0 ? 'all' : domain;

  return request.get<MarketPage>(
    `/api/bff/aihub/markets/${encodeURIComponent(assetType)}/${encodeURIComponent(
      field,
    )}/${encodeURIComponent(domainPath)}`,
    {
      params: {
        q: q || undefined,
        page,
        page_size: pageSize,
        domains:
          selectedDomains.length > 0 ? selectedDomains.join(',') : undefined,
        domain_match:
          selectedDomains.length > 1 ? (domainMatch ?? 'any') : undefined,
        arch: arch && arch !== 'all' ? arch : undefined,
        accelerator:
          accelerator && accelerator !== 'all' ? accelerator : undefined,
        min_vram: minVram,
      },
    },
  );
};

export const fetchAsset = (id: string) =>
  request.get<MarketAsset>(`/api/bff/aihub/assets/${encodeURIComponent(id)}`);
