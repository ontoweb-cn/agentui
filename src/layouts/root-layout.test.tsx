// RootLayout 冒烟测试:three-column 移除后 legacy 是唯一布局,
// 锁住"顶栏 Header + Outlet 内容"的最小装配,防止布局回归。
// 评审 P3:布局装配层此前无任何测试防线。

// Header → logic-hooks 引入 eventsource-parser/stream,jsdom 无 TransformStream,
// 与 logic-hooks-use-scroll-to-bottom.test 同款 mock(本测试不消费 SSE)。
jest.mock('eventsource-parser/stream', () => ({}));

// GlobalNavbar → css-support 在模块顶层调用 CSS.supports,jsdom 未实现。
jest.mock('@/utils/css-support', () => ({ supportsCssAnchor: false }));

// @/routes 在模块顶层 createBrowserRouter 并初始化导航,jsdom 下崩溃
// (这正是 @/constants/routes 存在的原因,见其文件头注释)。测试只需
// Routes 常量,用无副作用的常量模块顶替。
jest.mock('@/routes', () => ({
  ...jest.requireActual('@/constants/routes'),
  routers: undefined,
}));

// react-router v7 的 data router 在 jsdom 下启动导航即崩溃(request.signal 未定义),
// 而本测试只验证 RootLayout 的装配,不验证导航——用路由原语桩替换:
// Outlet 渲染桩内容,Link 退化为 <a>,导航 hooks 返回静态值。
jest.mock('react-router', () => ({
  ...jest.requireActual('react-router'),
  Outlet: () => <div data-testid="outlet-content">home</div>,
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    // 无 href 的 <a> 不产生 link role,补 href 供 getByRole 断言
    <a {...props} href={to ?? '#'}>
      {children}
    </a>
  ),
  Navigate: () => null,
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => jest.fn(),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  useMatch: () => undefined,
  useMatches: () => [],
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import RootLayout from './root-layout';

function renderRootLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* Header 链路:ThemeButton 依赖 useTheme(无 Provider 会 throw) */}
      <ThemeProvider>
        <RootLayout />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RootLayout(唯一布局)', () => {
  it('渲染顶栏 Header(banner)与 Outlet 内容', () => {
    renderRootLayout();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
  });

  it('顶栏包含全局搜索与主导航入口', () => {
    renderRootLayout();
    expect(screen.getByTestId('global-search')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
  });
});
