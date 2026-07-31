// spec-013 P1-5: TopBar Jest 单元测试
// 覆盖:默认渲染/自定义 left/center/right/sticky=false/ModeSwitcher 切换

import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import { TopBar } from './top-bar';

// 仅 mock 数据 hooks,UI 组件(ModeSwitcher/ThemeButton 等)真实渲染
// 用模块级变量支持 per-test 覆盖 mock 返回值
let mockTenantData: unknown[] = [];
let mockUserInfo = { language: 'en', avatar: 'url', nickname: 'Test' };

jest.mock('@/hooks/logic-hooks', () => ({
  useChangeLanguage: () => jest.fn(),
}));
jest.mock('@/hooks/use-user-setting-request', () => ({
  useFetchUserInfo: () => ({ data: mockUserInfo }),
  useListTenant: () => ({ data: mockTenantData }),
}));

// 避免 @/routes 模块加载时触发 createBrowserRouter 副作用
// (jsdom 下会因 startNavigation/handleLoaders 抛错)。直接提供 Routes 常量。
jest.mock('@/routes', () => ({
  Routes: {
    Root: '/',
    UserSetting: '/user-setting',
    Team: '/team',
  },
}));

// react-router 7 的 MemoryRouter 在 jsdom 下会触发 startNavigation/handleLoaders
// 导致 "Cannot read properties of undefined (reading 'aborted')" 错误。
// 这里 mock Link 为简单 <a> 标签,避免依赖 Router 上下文(测试中不点击导航)。
jest.mock('react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));

/**
 * TopBar 默认右列使用 ThemeButton(useTheme) 需 ThemeProvider 包裹。
 * Link 已 mock 为 <a>,不再需要 Router 上下文。
 */
function renderWithProviders(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('TopBar', () => {
  it('渲染默认 TopBar (Logo + ModeSwitcher + 用户操作区)', () => {
    renderWithProviders(<TopBar />);

    // 默认左列:Logo
    const logo = screen.getByAltText('Logo');
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/logo-96.png');

    // 默认中列:ModeSwitcher
    expect(screen.getByTestId('mode-switcher')).toBeInTheDocument();

    // 默认右列:用户操作区(语言切换/帮助/主题/头像)
    expect(screen.getByTestId('auth-status')).toBeInTheDocument();
    expect(screen.getByTestId('settings-entrypoint')).toBeInTheDocument();
  });

  it('默认右列渲染语言切换/帮助按钮/主题按钮/头像', () => {
    renderWithProviders(<TopBar />);
    // 语言触发器显示当前语言名称(由 useFetchUserInfo mock 的 language='en' 推导)
    // supportedLanguages 真实渲染,'en' → 'English'
    expect(screen.getByText('English')).toBeInTheDocument();
    // 帮助按钮(外链 icon-only,通过 href 精确定位)
    const helpLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[href="https://intellect.ontoweb.cn/docs/dev/category/user-guides"]',
    );
    expect(helpLinks).toHaveLength(1);
    // 头像链接(指向 user-setting)
    const settingLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[href="/user-setting"]',
    );
    expect(settingLinks).toHaveLength(1);
  });

  it('hasNotification=false 时不渲染通知铃铛', () => {
    // useListTenant mock 返回 [],hasNotification=false
    renderWithProviders(<TopBar />);
    // BellButton 通过 asLink 渲染,指向 user-setting/team;不存在时应查无
    const bellLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[href="/user-setting/team"]',
    );
    expect(bellLinks).toHaveLength(0);
  });

  it('自定义 left 内容覆盖默认 Logo', () => {
    renderWithProviders(
      <TopBar left={<div data-testid="custom-left">Custom Logo</div>} />,
    );
    expect(screen.getByTestId('custom-left')).toBeInTheDocument();
    expect(screen.queryByAltText('Logo')).not.toBeInTheDocument();
  });

  it('自定义 center 内容覆盖默认 ModeSwitcher', () => {
    renderWithProviders(
      <TopBar center={<div data-testid="custom-center">Custom Center</div>} />,
    );
    expect(screen.getByTestId('custom-center')).toBeInTheDocument();
    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument();
  });

  it('自定义 right 内容覆盖默认用户操作区', () => {
    renderWithProviders(
      <TopBar right={<div data-testid="custom-right">Custom Right</div>} />,
    );
    expect(screen.getByTestId('custom-right')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-entrypoint')).not.toBeInTheDocument();
  });

  it('sticky=false 时不渲染 sticky 类', () => {
    renderWithProviders(<TopBar sticky={false} />);
    const topBar = screen.getByTestId('top-bar');
    expect(topBar.className).not.toContain('sticky');
    expect(topBar.className).not.toContain('top-0');
  });

  it('sticky=true (默认) 渲染 sticky 类', () => {
    renderWithProviders(<TopBar />);
    const topBar = screen.getByTestId('top-bar');
    expect(topBar.className).toContain('sticky');
    expect(topBar.className).toContain('top-0');
    expect(topBar.className).toContain('z-50');
  });

  it('默认 height=56 通过 style 应用', () => {
    renderWithProviders(<TopBar />);
    expect(screen.getByTestId('top-bar')).toHaveStyle({ height: '56px' });
  });

  it('自定义 height 数字通过 style 应用 px', () => {
    renderWithProviders(<TopBar height={80} />);
    expect(screen.getByTestId('top-bar')).toHaveStyle({ height: '80px' });
  });

  it('自定义 height 字符串原样应用', () => {
    renderWithProviders(<TopBar height="4rem" />);
    expect(screen.getByTestId('top-bar')).toHaveStyle({ height: '4rem' });
  });

  it('ModeSwitcher 显示默认 work 模式且可切换到 code/canvas', () => {
    renderWithProviders(<TopBar />);
    const modeSwitcher = screen.getByTestId('mode-switcher');
    expect(modeSwitcher).toHaveAttribute('data-value', 'work');

    // work 段激活
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // 切换到 code
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(modeSwitcher).toHaveAttribute('data-value', 'code');
    expect(screen.getByRole('radio', { name: 'Code' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // 切换到 canvas
    fireEvent.click(screen.getByRole('radio', { name: 'Canvas' }));
    expect(modeSwitcher).toHaveAttribute('data-value', 'canvas');
    expect(screen.getByRole('radio', { name: 'Canvas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('点击语言触发器不抛异常', () => {
    // Radix DropdownMenu 使用 Portal + pointer 事件;
    // jsdom 下 fireEvent.click 不完全模拟 pointerDown,但触发器应可点击不抛错
    renderWithProviders(<TopBar />);
    const trigger = screen.getByText('English').closest('button');
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAttribute('data-state', 'closed');
    fireEvent.click(trigger!);
    // 触发器点击后仍存在于 DOM 中(无异常抛出)
    expect(trigger).toBeInTheDocument();
  });

  it('hasNotification=true 时渲染通知铃铛', () => {
    // 覆盖模块级 mock 变量,模拟含邀请通知的租户
    mockTenantData = [{ role: 'invite' }];
    renderWithProviders(<TopBar />);
    // BellButton 通过 asLink 渲染,指向 user-setting/team
    const bellLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[href="/user-setting/team"]',
    );
    expect(bellLinks).toHaveLength(1);
    // 恢复默认 mock
    mockTenantData = [];
  });
});
