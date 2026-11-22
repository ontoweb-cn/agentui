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
  /** 当前主体是否已收藏；仅 aihub 配置了数据库时返回。 */
  favorited?: boolean;
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

export interface FavoriteToggleResult {
  asset_id: string;
  favorited: boolean;
}

/** 收藏/取消（幂等 toggle）。 */
export const toggleFavorite = (id: string) =>
  request.post<FavoriteToggleResult>(
    `/api/bff/aihub/assets/${encodeURIComponent(id)}/favorite`,
  );

export interface Installation {
  id: string;
  asset_id: string;
  asset_type: string;
  status: string;
  binding: Record<string, unknown>;
  created_at?: string;
  name?: string | null;
  label?: string | null;
}

export const fetchInstallations = () =>
  request.get<{ items: Installation[]; total: number }>(
    '/api/bff/aihub/installations',
  );

export const installAsset = (id: string) =>
  request.post<Installation>(
    `/api/bff/aihub/assets/${encodeURIComponent(id)}/install`,
  );

export const openInstallation = (id: string) =>
  request.post<Installation>(
    `/api/bff/aihub/installations/${encodeURIComponent(id)}/open`,
  );

export const removeInstallation = (id: string) =>
  request.delete<{ id: string; status: string }>(
    `/api/bff/aihub/installations/${encodeURIComponent(id)}`,
  );

export interface DownloadResult {
  asset_id: string;
  storage_uri: string;
  name: string;
}

export const downloadAsset = (id: string) =>
  request.post<DownloadResult>(
    `/api/bff/aihub/assets/${encodeURIComponent(id)}/actions/download`,
  );

export interface PublishDatasetInput {
  name: string;
  label?: string;
  field: string;
  domains: string[];
  description?: string;
  format?: string;
  sizeBytes?: number;
  license?: string;
  checksum?: string;
  storageUri: string;
}

/** 发布本地 dataset（M2）；体积单位字节。 */
export const publishDataset = (input: PublishDatasetInput) =>
  request.post<MarketAsset>('/api/bff/aihub/assets', {
    asset_type: 'dataset',
    name: input.name,
    label: input.label ?? input.name,
    field: input.field,
    domains: input.domains,
    description: input.description ?? '',
    spec: {
      format: input.format || undefined,
      size_bytes: input.sizeBytes,
      license: input.license || undefined,
      checksum: input.checksum || undefined,
      storage_uri: input.storageUri,
    },
  });

export interface ChatModel {
  id: string;
}

export const fetchChatModels = () =>
  request.get<{ items: ChatModel[] }>('/api/bff/aihub/chat/models');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 流式对话（SSE）：逐 token 回调 `onDelta`；调用方用 AbortSignal 取消。
 * 直接使用 fetch 读取 ReadableStream，避免 axios 缓冲整个响应。
 */
export async function streamChat(params: {
  assetId?: string;
  model?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  const response = await fetch('/api/bff/aihub/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(params.assetId ? { 'X-Aihub-Asset-Id': params.assetId } : {}),
    },
    body: JSON.stringify({
      model: params.model || undefined,
      messages: params.messages,
      stream: true,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // 上游返回非 JSON 时保留状态码
    }
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error('EMPTY_STREAM');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame
        .split('\n')
        .find((item) => item.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) params.onDelta(delta);
      } catch {
        // keep-alive 或非 JSON 帧直接忽略
      }
    }
  }
}
