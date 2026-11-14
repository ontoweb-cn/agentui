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

export interface Taxonomies {
  version: number;
  config_hash: string;
  asset_type: string;
  fields: TaxonomyItem[];
  domains: TaxonomyItem[];
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
  domain: string;
  q?: string;
  page?: number;
  pageSize?: number;
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
  q,
  page = 1,
  pageSize = 20,
}: MarketQueryParams) =>
  request.get<MarketPage>(
    `/api/bff/aihub/markets/${encodeURIComponent(assetType)}/${encodeURIComponent(
      field,
    )}/${encodeURIComponent(domain)}`,
    { params: { q: q || undefined, page, page_size: pageSize } },
  );

export const fetchAsset = (id: string) =>
  request.get<MarketAsset>(`/api/bff/aihub/assets/${encodeURIComponent(id)}`);
