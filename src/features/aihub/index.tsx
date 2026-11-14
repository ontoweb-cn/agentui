/**
 * 「资源」市场页（M1）。
 *
 * 能力关闭时不发起业务请求；模型市场读取 repo-seed（502 条），
 * 其他资源类型已注册但 M1 暂无数据。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Routes } from '@/constants/routes';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { cn } from '@/lib/utils';
import {
  fetchAsset,
  fetchMarketPage,
  fetchMarkets,
  fetchTaxonomies,
  type MarketAsset,
  type TaxonomyItem,
} from './api';

const RESOURCE_TYPES = [
  { key: 'models', label: '模型', description: '预训练模型与算法应用' },
  { key: 'datasets', label: '数据', description: '数据集与语料' },
  { key: 'agents', label: '智能体', description: '可对话的 Agent' },
  { key: 'skills', label: '技能', description: '可复用的技能包' },
  { key: 'tools', label: '工具', description: '工具与函数目录' },
  { key: 'mcps', label: 'MCP', description: 'MCP Server 注册表' },
  { key: 'solutions', label: '解决方案', description: '多资产组合模板' },
  { key: 'apps', label: 'APP', description: '可发布的 Web 应用' },
] as const;

const PAGE_SIZE = 20;

function FeatureDisabledState() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-base font-medium text-text-primary">
        AIHub 能力未启用
      </p>
      <p className="max-w-md text-sm text-text-secondary">
        当前部署未开启 <code className="rounded bg-bg-secondary px-1">aihub</code>{' '}
        能力，或代理/断言配置不完整。请联系部署管理员设置
        <code className="mx-1 rounded bg-bg-secondary px-1">AIHUB_ENABLED</code>
        并完成密钥配置。
      </p>
    </div>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

function AssetImage({ asset }: { asset: MarketAsset }) {
  const [failed, setFailed] = useState(false);
  const absolute = /^https?:\/\//i.test(asset.pic);
  const src = absolute
    ? asset.pic
    : asset.pic
      ? `/api/bff/aihub/static/deep-learning/${encodeURIComponent(asset.name)}/${asset.pic
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      : '';

  if (!src || failed) {
    return (
      <div className="flex h-32 w-full items-center justify-center bg-bg-secondary text-xs text-text-secondary">
        暂无示例图
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={asset.label}
      className="h-32 w-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function AssetCard({
  asset,
  fieldLabel,
  onOpen,
}: {
  asset: MarketAsset;
  fieldLabel: (key: string) => string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col overflow-hidden rounded-lg border border-border text-left transition-colors hover:bg-bg-secondary"
    >
      <AssetImage asset={asset} />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {asset.label}
          </span>
          {asset.price > 0 && (
            <span className="rounded border border-border px-1 text-[10px] text-text-secondary">
              企业版
            </span>
          )}
        </div>
        <div className="truncate text-xs text-text-secondary">{asset.name}</div>
        <p className="line-clamp-2 text-xs text-text-secondary">
          {asset.description || '暂无描述'}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-text-secondary">
          <span>{fieldLabel(asset.field)}</span>
          <span>
            {asset.images_status === 'placeholder' ? '镜像未就绪' : '镜像就绪'}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function AihubResourcesPage() {
  const { type } = useParams();
  const navigate = useNavigate();
  const activeType = RESOURCE_TYPES.some((item) => item.key === type)
    ? type
    : undefined;
  const { features, isLoading } = useFeatureFlags();
  const enabled = features?.aihub === true;

  const [field, setField] = useState('all');
  const [domain, setDomain] = useState('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    setField('all');
    setDomain('all');
    setSearch('');
    setQ('');
    setPage(1);
    setSelectedId(undefined);
  }, [activeType]);

  const markets = useQuery({
    queryKey: ['aihub-markets'],
    enabled,
    queryFn: async () => (await fetchMarkets()).data.items,
  });

  const taxonomies = useQuery({
    queryKey: ['aihub-taxonomies', activeType, field],
    enabled: enabled && Boolean(activeType),
    queryFn: async () =>
      (
        await fetchTaxonomies(
          activeType as string,
          field === 'all' ? undefined : field,
        )
      ).data,
  });

  const list = useQuery({
    queryKey: ['aihub-market', activeType, field, domain, q, page],
    enabled: enabled && Boolean(activeType),
    queryFn: async () =>
      (
        await fetchMarketPage({
          assetType: activeType as string,
          field,
          domain,
          q,
          page,
          pageSize: PAGE_SIZE,
        })
      ).data,
  });

  const detail = useQuery({
    queryKey: ['aihub-asset', selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await fetchAsset(selectedId as string)).data,
  });

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center p-8 text-sm text-text-secondary">
        加载中…
      </div>
    );
  }
  if (!enabled) {
    return <FeatureDisabledState />;
  }
  if (type && !activeType) {
    return <Navigate to={Routes.Resources} replace />;
  }

  const countOf = (slug: string) =>
    markets.data?.find((item) => item.slug === slug)?.count ?? 0;
  const labelOf = (items: TaxonomyItem[] | undefined, key: string) =>
    items?.find((item) => item.key === key)?.label.zh ?? key;

  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex size-full flex-col gap-5 overflow-auto p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text-primary">资源</h1>
        <p className="text-sm text-text-secondary">
          组织级 AI 资产统一入口。M1 已接入模型市场（repo-seed 502 条），其他类型为占位。
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {RESOURCE_TYPES.map((item) => (
          <Chip
            key={item.key}
            active={activeType === item.key}
            onClick={() => {
              navigate(`${Routes.Resources}/${item.key}`);
            }}
          >
            {item.label}
            <span className="ml-1 text-[11px] text-text-secondary">
              {countOf(item.key)}
            </span>
          </Chip>
        ))}
      </nav>

      {activeType && (
        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-secondary">领域</span>
            {(taxonomies.data?.fields ?? []).map((item) => (
              <Chip
                key={item.key}
                active={field === item.key}
                onClick={() => {
                  setField(item.key);
                  setPage(1);
                }}
              >
                {item.label.zh}
                <span className="ml-1 text-[11px] text-text-secondary">
                  {item.count}
                </span>
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-secondary">行业</span>
            {(taxonomies.data?.domains ?? []).map((item) => (
              <Chip
                key={item.key}
                active={domain === item.key}
                onClick={() => {
                  setDomain(item.key);
                  setPage(1);
                }}
              >
                {item.label.zh}
                <span className="ml-1 text-[11px] text-text-secondary">
                  {item.count}
                </span>
              </Chip>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setQ(search.trim());
              setPage(1);
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称、描述"
              className="h-8 w-full max-w-sm rounded border border-border bg-bg-input px-2 text-sm text-text-primary outline-none focus:border-border-button"
            />
            <Button type="submit" variant="outline" size="sm">
              搜索
            </Button>
          </form>
        </section>
      )}

      {list.error ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-4">
          <p className="text-sm text-text-secondary">
            市场加载失败：{(list.error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => list.refetch()}>
            重试
          </Button>
        </div>
      ) : list.isLoading ? (
        <p className="text-sm text-text-secondary">正在加载资产…</p>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-text-secondary">
          该资源类型在 M1 暂无数据。
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {list.data?.items.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                fieldLabel={(key) => labelOf(taxonomies.data?.fields, key)}
                onOpen={() => setSelectedId(asset.id)}
              />
            ))}
          </section>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              上一页
            </Button>
            <span className="text-xs text-text-secondary">
              {page} / {totalPages}（共 {total} 条）
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}

      {selectedId && (
        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-medium text-text-primary">
              {detail.data?.label ?? '资产详情'}
            </h2>
            <Button variant="outline" size="sm" onClick={() => setSelectedId(undefined)}>
              关闭
            </Button>
          </div>
          {detail.isLoading ? (
            <p className="text-sm text-text-secondary">加载中…</p>
          ) : detail.error ? (
            <p className="text-sm text-text-secondary">
              详情加载失败：{(detail.error as Error).message}
            </p>
          ) : detail.data ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-text-secondary">{detail.data.description}</p>
              <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-text-secondary">标识</dt>
                  <dd className="text-text-primary">{detail.data.name}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-text-secondary">领域</dt>
                  <dd className="text-text-primary">
                    {labelOf(taxonomies.data?.fields, detail.data.field)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-text-secondary">行业</dt>
                  <dd className="text-text-primary">
                    {detail.data.domains.join(', ')}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-text-secondary">状态</dt>
                  <dd className="text-text-primary">
                    {detail.data.status} / {detail.data.images_status}
                  </dd>
                </div>
              </dl>
              {detail.data.doc && (
                <a
                  href={detail.data.doc}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-text-primary underline hover:text-text-secondary"
                >
                  查看文档
                </a>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
