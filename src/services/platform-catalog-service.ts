import request from '@/utils/next-request';

const bffPlatform = '/api/bff/platform';

export interface PlatformV2Envelope<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface CatalogKindCounts {
  online?: number;
  stale?: number;
  never_seen?: number;
}

export interface CatalogOverview {
  by_kind?: Record<string, CatalogKindCounts>;
}

export interface CatalogInstance {
  id: string;
  kind: string;
  name: string;
  status: string;
  scope?: string;
  endpoint?: string;
}

export const fetchCatalogOverview = () =>
  request.get<PlatformV2Envelope<CatalogOverview>>(
    `${bffPlatform}/catalog/overview`,
  );

export const fetchCatalogInstances = () =>
  request.get<PlatformV2Envelope<{ instances: CatalogInstance[] }>>(
    `${bffPlatform}/catalog/instances`,
  );