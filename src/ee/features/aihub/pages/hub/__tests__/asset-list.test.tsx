import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import {
  fetchAsset,
  fetchMarketPage,
  fetchTaxonomies,
  toggleFavorite,
  type MarketAsset,
  type MarketPage,
  type Taxonomies,
} from '@/ee/features/aihub/api';

import AssetListRoute from '../asset-list';

jest.mock('@/ee/features/aihub/api', () => ({
  fetchAsset: jest.fn(),
  fetchMarketPage: jest.fn(),
  fetchTaxonomies: jest.fn(),
  toggleFavorite: jest.fn(),
}));

const mockFetchAsset = fetchAsset as jest.MockedFunction<typeof fetchAsset>;
const mockFetchMarketPage = fetchMarketPage as jest.MockedFunction<
  typeof fetchMarketPage
>;
const mockFetchTaxonomies = fetchTaxonomies as jest.MockedFunction<
  typeof fetchTaxonomies
>;
const mockToggleFavorite = toggleFavorite as jest.MockedFunction<
  typeof toggleFavorite
>;

const asset: MarketAsset = {
  id: 'm1',
  asset_type: 'models',
  name: 'resnet50',
  label: 'ResNet-50',
  field: 'cv',
  domains: ['industrial'],
  status: 'online',
  hot: 12,
  price: 0,
  description: 'A classic vision model',
  pic: '',
  doc: 'https://example.com/doc',
  images: '',
  images_status: 'ready',
  spec: {},
  hardware: { arch: 'x86_64', accelerator: 'gpu', source: 'inferred' },
  resources: { gpu: 1, cpu: 8 },
};

const page: MarketPage = {
  asset_type: 'models',
  field: 'all',
  domain: 'all',
  total: 40,
  page: 1,
  page_size: 20,
  items: [asset],
};

const taxonomies: Taxonomies = {
  version: 1,
  config_hash: 'hash',
  asset_type: 'models',
  fields: [
    {
      key: 'all',
      label: { zh: '全部', en: 'All' },
      count: 40,
      synthetic: true,
      order: 0,
    },
    {
      key: 'cv',
      label: { zh: '计算机视觉', en: 'CV' },
      count: 10,
      synthetic: false,
      order: 1,
    },
  ],
  domains: [
    {
      key: 'all',
      label: { zh: '全部', en: 'All' },
      count: 40,
      synthetic: true,
      order: 0,
    },
    {
      key: 'biology',
      label: { zh: '生物', en: 'Biology' },
      count: 0,
      synthetic: false,
      order: 10,
    },
    {
      key: 'medical',
      label: { zh: '医药', en: 'Pharma & Healthcare' },
      count: 0,
      synthetic: false,
      order: 20,
    },
    {
      key: 'industrial',
      label: { zh: '工业', en: 'Industrial' },
      count: 5,
      synthetic: false,
      order: 30,
    },
    {
      key: 'finance',
      label: { zh: '金融', en: 'Finance' },
      count: 0,
      synthetic: false,
      order: 40,
    },
    {
      key: 'transport',
      label: { zh: '交通', en: 'Transportation' },
      count: 0,
      synthetic: false,
      order: 50,
    },
    {
      key: 'government',
      label: { zh: '政务', en: 'Government' },
      count: 0,
      synthetic: false,
      order: 60,
    },
    {
      key: 'general',
      label: { zh: '通用', en: 'General' },
      count: 0,
      synthetic: false,
      order: 70,
    },
  ],
  hardware: {
    arch: [
      {
        key: 'x86_64',
        label: { zh: 'x86_64', en: 'x86_64' },
        count: 1,
      },
    ],
    accelerators: [
      {
        key: 'gpu',
        label: { zh: 'GPU（厂商未标注）', en: 'GPU (vendor unknown)' },
        count: 1,
      },
    ],
  },
};

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {decodeURIComponent(`${location.pathname}${location.search}`)}
    </div>
  );
}

function renderAt(entry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/hub/:type" element={<AssetListRoute />} />
          <Route path="/hub/:type/:assetId" element={<AssetListRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AIHub asset list + workspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchMarketPage.mockResolvedValue({ data: page } as never);
    mockFetchTaxonomies.mockResolvedValue({ data: taxonomies } as never);
    mockFetchAsset.mockResolvedValue({ data: asset } as never);
  });

  it('点击卡片把 assetId 写入 URL 并在右栏展示详情，关闭后回到列表', async () => {
    renderAt('/hub/models');

    fireEvent.click(await screen.findByTestId('aihub-asset-card-m1'));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models/m1',
      ),
    );
    expect(await screen.findByTestId('aihub-asset-workspace')).toHaveAttribute(
      'aria-hidden',
      'false',
    );
    expect(screen.getByTestId('aihub-asset-workspace-close')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('aihub-asset-workspace')).getByText(
        'A classic vision model',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('aihub-asset-workspace-close'));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/hub/models'),
    );
    expect(
      screen.queryByTestId('aihub-asset-workspace-close'),
    ).not.toBeInTheDocument();
  });

  it('深链直接打开详情，并按 URL 还原筛选与分页', async () => {
    renderAt('/hub/models/m1?field=cv&page=2');

    expect(await screen.findByTestId('aihub-asset-workspace-close')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/hub/models/m1?field=cv&page=2',
    );
    expect(mockFetchMarketPage).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: 'models', field: 'cv', page: 2 }),
    );
  });

  it('筛选写入 URL 并重置页码', async () => {
    renderAt('/hub/models?page=2');

    fireEvent.click(await screen.findByTestId('aihub-filter-field-cv'));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models?field=cv',
      ),
    );
  });

  it('详情可收藏，成功后就地更新按钮状态', async () => {
    mockFetchAsset.mockResolvedValue({
      data: { ...asset, favorited: false },
    } as never);
    mockToggleFavorite.mockResolvedValue({
      data: { asset_id: 'm1', favorited: true },
    } as never);

    renderAt('/hub/models/m1');

    const button = await screen.findByTestId('aihub-asset-favorite');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);

    await waitFor(() => expect(mockToggleFavorite).toHaveBeenCalledWith('m1'));
    await waitFor(() =>
      expect(button).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('未配置收藏（favorited 缺失）时不渲染收藏按钮', async () => {
    renderAt('/hub/models/m1');

    expect(
      await screen.findByTestId('aihub-asset-workspace-close'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('aihub-asset-favorite'),
    ).not.toBeInTheDocument();
  });

  it('非法资源类型重定向到默认类型', async () => {
    renderAt('/hub/a%20b');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/hub/models'),
    );
  });

  it('渲染全部 7 个行业分类，且不重复合成「全部」项', async () => {
    renderAt('/hub/models');
    await screen.findByTestId('aihub-asset-card-m1');

    for (const key of [
      'biology',
      'medical',
      'industrial',
      'finance',
      'transport',
      'government',
      'general',
    ]) {
      expect(screen.getByTestId(`aihub-filter-domain-${key}`)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('aihub-filter-domain-all')).toHaveLength(1);
    expect(screen.getAllByTestId('aihub-filter-field-all')).toHaveLength(1);
  });

  it('任意行业分类都可触发筛选并透传给列表查询', async () => {
    renderAt('/hub/models');

    fireEvent.click(
      await screen.findByTestId('aihub-filter-domain-government'),
    );

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models?domains=government',
      ),
    );
    await waitFor(() =>
      expect(mockFetchMarketPage).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'all',
          domains: ['government'],
        }),
      ),
    );
  });

  it('行业支持多选，写入 domains 与 domain_match，再次点击可取消', async () => {
    renderAt('/hub/models');

    fireEvent.click(
      await screen.findByTestId('aihub-filter-domain-government'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models?domains=government',
      ),
    );

    fireEvent.click(screen.getByTestId('aihub-filter-domain-medical'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models?domains=government,medical&domain_match=any',
      ),
    );
    await waitFor(() =>
      expect(mockFetchMarketPage).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'all',
          domains: ['government', 'medical'],
          domainMatch: 'any',
        }),
      ),
    );

    fireEvent.click(screen.getByTestId('aihub-filter-domain-government'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models?domains=medical',
      ),
    );

    fireEvent.click(screen.getByTestId('aihub-filter-domain-all'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/hub/models'),
    );
  });

  it('硬件筛选写入 URL 并透传给列表查询', async () => {
    renderAt('/hub/models');

    fireEvent.click(await screen.findByTestId('aihub-filter-accel-gpu'));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/hub/models?accelerator=gpu',
      ),
    );
    await waitFor(() =>
      expect(mockFetchMarketPage).toHaveBeenCalledWith(
        expect.objectContaining({ accelerator: 'gpu' }),
      ),
    );
  });

  it('拒绝非 http(s) 文档链接', async () => {
    mockFetchAsset.mockResolvedValue({
      data: { ...asset, doc: 'javascript:alert(1)' },
    } as never);

    renderAt('/hub/models/m1');

    fireEvent.click(
      await screen.findByRole('tab', { name: 'aihub.detail.docs' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('aihub-asset-doc-link'),
      ).not.toBeInTheDocument(),
    );
  });
});
