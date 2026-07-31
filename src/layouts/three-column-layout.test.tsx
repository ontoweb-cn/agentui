// spec-013 P1-1: ThreeColumnLayout Jest 单元测试
// 覆盖:三栏渲染/topBar/折叠(受控/非受控)/回调/响应式断点/A11y/自定义宽度

import { fireEvent, render, screen } from '@testing-library/react';

import { ThreeColumnLayout } from './three-column-layout';

// Helper: mock window.matchMedia(返回统一 matches)
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation(() => ({
      matches,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

// Helper: mock window.matchMedia(按 query 内容判断 matches)
function mockMatchMediaPerQuery(matcher: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: matcher(query),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

beforeEach(() => {
  // 默认桌面模式:无任何断点匹配
  mockMatchMedia(false);
});

describe('ThreeColumnLayout', () => {
  it('渲染三栏(sidebar + main + toolPanel)', () => {
    render(
      <ThreeColumnLayout
        sidebar={<div data-testid="sidebar-content">Sidebar</div>}
        toolPanel={<div data-testid="toolpanel-content">ToolPanel</div>}
        defaultToolPanelCollapsed={false}
      >
        <div data-testid="main-content">Main</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-layout')).toBeInTheDocument();
    expect(screen.getByTestId('three-column-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('three-column-main')).toBeInTheDocument();
    expect(screen.getByTestId('three-column-toolpanel')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-content')).toBeInTheDocument();
    expect(screen.getByTestId('main-content')).toBeInTheDocument();
    expect(screen.getByTestId('toolpanel-content')).toBeInTheDocument();
  });

  it('渲染 topBar(跨三列,grid-column: 1 / -1)', () => {
    render(
      <ThreeColumnLayout
        topBar={<div data-testid="topbar-content">TopBar</div>}
        sidebar={<div>Sidebar</div>}
        toolPanel={<div>ToolPanel</div>}
        defaultToolPanelCollapsed={false}
      >
        <div>Main</div>
      </ThreeColumnLayout>,
    );
    const topbar = screen.getByTestId('three-column-topbar');
    expect(topbar).toBeInTheDocument();
    expect(screen.getByTestId('topbar-content')).toBeInTheDocument();
    expect(topbar.style.gridColumn).toBe('1 / -1');
  });

  it('不渲染 topBar 时只有 body 行', () => {
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} defaultToolPanelCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.queryByTestId('three-column-topbar')).not.toBeInTheDocument();
    const layout = screen.getByTestId('three-column-layout');
    expect(layout.style.gridTemplateRows).toBe('[body] 1fr');
  });

  it('渲染 topBar 时 grid-template-rows 含 topbar 和 body', () => {
    render(
      <ThreeColumnLayout topBar={<div>T</div>} sidebar={<div>S</div>}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    const layout = screen.getByTestId('three-column-layout');
    expect(layout.style.gridTemplateRows).toBe('[topbar] 56px [body] 1fr');
  });

  it('grid-template-columns 含 sidebar/main/toolpanel', () => {
    render(
      <ThreeColumnLayout
        sidebar={<div>S</div>}
        toolPanel={<div>T</div>}
        defaultToolPanelCollapsed={false}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    const layout = screen.getByTestId('three-column-layout');
    expect(layout.style.gridTemplateColumns).toBe(
      '[sidebar] auto [main] 1fr [toolpanel] auto',
    );
  });

  it('侧栏折叠(collapsed=true 时 width=0)', () => {
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={true}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('0px');
  });

  it('侧栏展开时 width=sidebarWidth(默认 280px)', () => {
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('280px');
  });

  it('工具面板折叠(collapsed=true 时 width=0)', () => {
    render(
      <ThreeColumnLayout toolPanel={<div>T</div>} toolPanelCollapsed={true}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('0px');
  });

  it('工具面板展开时 width=toolPanelWidth(默认 360px)', () => {
    render(
      <ThreeColumnLayout toolPanel={<div>T</div>} toolPanelCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('360px');
  });

  it('受控模式:sidebarCollapsed prop 控制(切换 rerender)', () => {
    const { rerender } = render(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={true}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('0px');

    rerender(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('280px');
  });

  it('受控模式:toolPanelCollapsed prop 控制(切换 rerender)', () => {
    const { rerender } = render(
      <ThreeColumnLayout toolPanel={<div>T</div>} toolPanelCollapsed={true}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('0px');

    rerender(
      <ThreeColumnLayout toolPanel={<div>T</div>} toolPanelCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('360px');
  });

  it('非受控模式:defaultSidebarCollapsed=true 初始化折叠', () => {
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} defaultSidebarCollapsed={true}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('0px');
    expect(screen.getByTestId('three-column-layout')).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
  });

  it('非受控模式:defaultSidebarCollapsed=false 默认展开', () => {
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} defaultSidebarCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('280px');
    expect(screen.getByTestId('three-column-layout')).toHaveAttribute(
      'data-sidebar-collapsed',
      'false',
    );
  });

  it('非受控模式:defaultToolPanelCollapsed=true 默认折叠', () => {
    render(
      <ThreeColumnLayout toolPanel={<div>T</div>}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('0px');
    expect(screen.getByTestId('three-column-layout')).toHaveAttribute(
      'data-toolpanel-collapsed',
      'true',
    );
  });

  it('非受控模式:defaultToolPanelCollapsed=false 默认展开', () => {
    render(
      <ThreeColumnLayout toolPanel={<div>T</div>} defaultToolPanelCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('360px');
  });

  it('响应式断点:移动端自动折叠侧栏并触发 onSidebarCollapsedChange(true)', () => {
    // 模拟移动端:(max-width: 767px) 匹配
    mockMatchMediaPerQuery((q) => q.includes('767'));
    const onSidebarCollapsedChange = jest.fn();
    render(
      <ThreeColumnLayout
        sidebar={<div>S</div>}
        onSidebarCollapsedChange={onSidebarCollapsedChange}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(onSidebarCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('three-column-layout')).toHaveAttribute(
      'data-is-mobile',
      'true',
    );
  });

  it('响应式断点:平板侧栏宽度为 56px(图标栏)', () => {
    // 模拟平板:(max-width: 1023px) 匹配,(max-width: 767px) 不匹配
    mockMatchMediaPerQuery((q) => q.includes('1023'));
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('56px');
    expect(screen.getByTestId('three-column-layout')).toHaveAttribute(
      'data-is-tablet',
      'true',
    );
    expect(screen.getByTestId('three-column-layout')).toHaveAttribute(
      'data-is-mobile',
      'false',
    );
  });

  it('响应式断点:移动端 sidebar 完全隐藏(width=0)', () => {
    mockMatchMediaPerQuery((q) => q.includes('767'));
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('0px');
  });

  it('响应式断点:移动端 toolPanel 为 overlay 模式(absolute + backdrop)', () => {
    mockMatchMediaPerQuery((q) => q.includes('767'));
    render(
      <ThreeColumnLayout
        toolPanel={<div data-testid="tp-content">T</div>}
        toolPanelCollapsed={false}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    const toolpanel = screen.getByTestId('three-column-toolpanel');
    expect(toolpanel).toHaveAttribute('data-overlay', 'true');
    expect(toolpanel.className).toContain('absolute');
    expect(toolpanel.className).toContain('z-50');
    expect(screen.getByTestId('three-column-backdrop')).toBeInTheDocument();
    expect(screen.getByTestId('tp-content')).toBeInTheDocument();
  });

  it('响应式断点:移动端 toolPanel 折叠时不渲染 backdrop', () => {
    mockMatchMediaPerQuery((q) => q.includes('767'));
    render(
      <ThreeColumnLayout
        toolPanel={<div>T</div>}
        toolPanelCollapsed={true}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.queryByTestId('three-column-backdrop')).not.toBeInTheDocument();
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('0px');
  });

  it('overlay backdrop 点击触发 onToolPanelCollapsedChange(true)', () => {
    mockMatchMediaPerQuery((q) => q.includes('767'));
    const onToolPanelCollapsedChange = jest.fn();
    render(
      <ThreeColumnLayout
        toolPanel={<div>T</div>}
        toolPanelCollapsed={false}
        onToolPanelCollapsedChange={onToolPanelCollapsedChange}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    fireEvent.click(screen.getByTestId('three-column-backdrop'));
    expect(onToolPanelCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('A11y:sidebar 区域有 role=complementary 和 aria-label=任务列表', () => {
    render(
      <ThreeColumnLayout sidebar={<div>S</div>} sidebarCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    const sidebar = screen.getByTestId('three-column-sidebar');
    expect(sidebar).toHaveAttribute('role', 'complementary');
    expect(sidebar).toHaveAttribute('aria-label', '任务列表');
  });

  it('A11y:toolPanel 区域有 role=complementary 和 aria-label=工具面板', () => {
    render(
      <ThreeColumnLayout toolPanel={<div>T</div>} toolPanelCollapsed={false}>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    const toolpanel = screen.getByTestId('three-column-toolpanel');
    expect(toolpanel).toHaveAttribute('role', 'complementary');
    expect(toolpanel).toHaveAttribute('aria-label', '工具面板');
  });

  it('A11y:main 区域有 role=main', () => {
    render(
      <ThreeColumnLayout>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-main')).toHaveAttribute(
      'role',
      'main',
    );
  });

  it('不渲染 sidebar 时不显示 sidebar 区域', () => {
    render(
      <ThreeColumnLayout>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.queryByTestId('three-column-sidebar')).not.toBeInTheDocument();
  });

  it('不渲染 toolPanel 时不显示 toolPanel 区域', () => {
    render(
      <ThreeColumnLayout>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(
      screen.queryByTestId('three-column-toolpanel'),
    ).not.toBeInTheDocument();
  });

  it('自定义 sidebarWidth(数字)', () => {
    render(
      <ThreeColumnLayout
        sidebar={<div>S</div>}
        sidebarCollapsed={false}
        sidebarWidth={320}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('320px');
  });

  it('自定义 sidebarWidth(字符串)', () => {
    render(
      <ThreeColumnLayout
        sidebar={<div>S</div>}
        sidebarCollapsed={false}
        sidebarWidth="20rem"
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('20rem');
  });

  it('自定义 toolPanelWidth', () => {
    render(
      <ThreeColumnLayout
        toolPanel={<div>T</div>}
        toolPanelCollapsed={false}
        toolPanelWidth={400}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('400px');
  });

  it('sidebarCollapsible=false 时即使 collapsed=true 也不折叠', () => {
    render(
      <ThreeColumnLayout
        sidebar={<div>S</div>}
        sidebarCollapsible={false}
        sidebarCollapsed={true}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-sidebar').style.width).toBe('280px');
  });

  it('toolPanelCollapsible=false 时即使 collapsed=true 也不折叠', () => {
    render(
      <ThreeColumnLayout
        toolPanel={<div>T</div>}
        toolPanelCollapsible={false}
        toolPanelCollapsed={true}
      >
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-toolpanel').style.width).toBe('360px');
  });

  it('主区域有 min-w-0 类(防溢出)', () => {
    render(
      <ThreeColumnLayout>
        <div>M</div>
      </ThreeColumnLayout>,
    );
    expect(screen.getByTestId('three-column-main').className).toContain('min-w-0');
  });
});
