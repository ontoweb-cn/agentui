import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { fetchMarkets } from '@/ee/features/aihub/api';
import { useFeatureFlags } from '@/hooks/use-feature-flags';

import AihubHubPage from '../index';

jest.mock('@/hooks/use-feature-flags', () => ({
  useFeatureFlags: jest.fn(),
}));

jest.mock('@/ee/features/aihub/api', () => ({
  fetchMarkets: jest.fn(),
}));

const mockUseFeatureFlags = useFeatureFlags as jest.MockedFunction<
  typeof useFeatureFlags
>;
const mockFetchMarkets = fetchMarkets as jest.MockedFunction<
  typeof fetchMarkets
>;

function renderHub() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/hub/models']}>
        <Routes>
          <Route path="/hub" element={<AihubHubPage />}>
            <Route path=":type" element={<div data-testid="list-page" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AIHub hub 容器', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFeatureFlags.mockReturnValue({
      features: { aihub: true } as never,
      isLoading: false,
      refetch: jest.fn(),
    });
    mockFetchMarkets.mockResolvedValue({
      data: {
        items: [
          {
            slug: 'models',
            type: 'models',
            label: { zh: '模型', en: 'Models' },
            enabled: true,
            count: 488,
          },
          {
            slug: 'datasets',
            type: 'datasets',
            label: { zh: '数据', en: 'Datasets' },
            enabled: false,
            count: 0,
          },
          {
            slug: 'agents',
            type: 'agents',
            label: { zh: '智能体', en: 'Agents' },
            enabled: true,
            count: 0,
          },
          {
            slug: 'benchmarks',
            type: 'benchmarks',
            label: { zh: '基准', en: 'Benchmarks' },
            enabled: true,
            count: 3,
          },
        ],
      },
    } as never);
  });

  it('按 markets 渲染左菜单，隐藏 enabled=false 的类型并展示计数', async () => {
    renderHub();

    // 菜单先以 i18n 兜底文案渲染，markets 返回后替换为后端名称与计数
    await waitFor(() =>
      expect(screen.getByTestId('aihub-submenu-models')).toHaveTextContent(
        'Models',
      ),
    );
    expect(screen.getByTestId('aihub-submenu-models')).toHaveTextContent('488');
    expect(screen.getByTestId('aihub-submenu-agents')).toBeInTheDocument();
    // 后端新增类型即使不在静态清单内也应出现在菜单
    expect(
      await screen.findByTestId('aihub-submenu-benchmarks'),
    ).toHaveTextContent('Benchmarks');
    await waitFor(() =>
      expect(
        screen.queryByTestId('aihub-submenu-datasets'),
      ).not.toBeInTheDocument(),
    );
  });

  it('能力关闭时显示禁用态且不请求 markets', async () => {
    mockUseFeatureFlags.mockReturnValue({
      features: { aihub: false } as never,
      isLoading: false,
      refetch: jest.fn(),
    });

    renderHub();

    expect(await screen.findByTestId('aihub-feature-disabled')).toBeInTheDocument();
    await waitFor(() => expect(mockFetchMarkets).not.toHaveBeenCalled());
  });
});
