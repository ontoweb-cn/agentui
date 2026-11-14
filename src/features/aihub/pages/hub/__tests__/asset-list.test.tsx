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
  type MarketAsset,
  type MarketPage,
  type Taxonomies,
} from '@/features/aihub/api';

import AssetListRoute from '../asset-list';

jest.mock('@/features/aihub/api', () => ({
  fetchAsset: jest.fn(),
  fetchMarketPage: jest.fn(),
  fetchTaxonomies: jest.fn(),
}));

const mockFetchAsset = fetchAsset as jest.MockedFunction<typeof fetchAsset>;
const mockFetchMarketPage = fetchMarketPage as jest.MockedFunction<
  typeof fetchMarketPage
>;
const mockFetchTaxonomies = fetchTaxonomies as jest.MockedFunction<
  typeof fetchTaxonomies
>;

const asset: MarketAsset = {
  id: 'm1',
  asset_type: 'models',
  name: 'resnet50',
  label: 'ResNet-50',
  field: 'cv',
  domains: ['industry'],
  status: 'online',
  hot: 12,
  price: 0,
  description: 'A classic vision model',
  pic: '',
  doc: 'https://example.com/doc',
  images: '',
  images_status: 'ready',
  spec: {},
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
      key: 'cv',
      label: { zh: '计算机视觉', en: 'CV' },
      count: 10,
      synthetic: false,
      order: 1,
    },
  ],
  domains: [
    {
      key: 'industry',
      label: { zh: '工业', en: 'Industry' },
      count: 5,
      synthetic: false,
      order: 1,
    },
  ],
};

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
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

  it('非法资源类型重定向到默认类型', async () => {
    renderAt('/hub/a%20b');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/hub/models'),
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
