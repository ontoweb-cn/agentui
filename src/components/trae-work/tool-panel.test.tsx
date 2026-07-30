// spec-013 P0-7: ToolPanel Jest 单元测试
// 覆盖:渲染/展开折叠(受控/非受控)/徽标数/加载/空状态/禁用/图标/actions

import { render, screen, fireEvent } from '@testing-library/react';

import { ToolPanel } from './tool-panel';
import type { ToolPanelProps } from './types';

function makeProps(overrides: Partial<ToolPanelProps> = {}): ToolPanelProps {
  return {
    id: 'panel-1',
    title: '知识库检索',
    icon: 'Search',
    defaultExpanded: false,
    children: <div data-testid="panel-content">面板内容</div>,
    ...overrides,
  };
}

describe('ToolPanel', () => {
  it('渲染标题和图标', () => {
    render(<ToolPanel {...makeProps()} />);
    expect(screen.getByText('知识库检索')).toBeInTheDocument();
    expect(screen.getByTestId('tool-panel-panel-1')).toBeInTheDocument();
  });

  it('默认折叠,不显示内容', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false })} />);
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();
  });

  it('defaultExpanded=true 默认展开,显示内容', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true })} />);
    expect(screen.getByTestId('panel-content')).toBeInTheDocument();
  });

  it('点击头部展开(非受控)', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false })} />);
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();
    // 点击 chevron 按钮(有 aria-label)切换展开
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByTestId('panel-content')).toBeInTheDocument();
  });

  it('点击头部折叠(非受控,已展开)', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true })} />);
    expect(screen.getByTestId('panel-content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '折叠' }));
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();
  });

  it('非受控切换触发 onExpandedChange 回调', () => {
    const onExpandedChange = jest.fn();
    render(<ToolPanel {...makeProps({ defaultExpanded: false, onExpandedChange })} />);
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('受控模式:expanded prop 控制展开状态', () => {
    const onExpandedChange = jest.fn();
    const { rerender } = render(
      <ToolPanel {...makeProps({ expanded: false, onExpandedChange })} />,
    );
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();

    rerender(<ToolPanel {...makeProps({ expanded: true, onExpandedChange })} />);
    expect(screen.getByTestId('panel-content')).toBeInTheDocument();
  });

  it('受控模式:点击触发 onExpandedChange 但不内部更新', () => {
    const onExpandedChange = jest.fn();
    render(<ToolPanel {...makeProps({ expanded: false, onExpandedChange })} />);
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    // 受控模式,内部状态不变,内容仍不显示
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();
  });

  it('badge > 0 时显示徽标数', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, badge: 5 })} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByLabelText('5 条未读')).toBeInTheDocument();
  });

  it('badge > 99 显示 99+', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, badge: 150 })} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('badge = 0 不显示徽标', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, badge: 0 })} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/条未读/)).not.toBeInTheDocument();
  });

  it('badge 为 undefined 不显示徽标', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, badge: undefined })} />);
    expect(screen.queryByLabelText(/条未读/)).not.toBeInTheDocument();
  });

  it('badge 为负数不显示徽标', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, badge: -5 })} />);
    expect(screen.queryByLabelText(/条未读/)).not.toBeInTheDocument();
  });

  it('loading=true 显示加载状态(替代内容)', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true, loading: true })} />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();
  });

  it('empty 有值时显示空状态(替代内容)', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true, empty: '暂无数据', loading: false })} />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument();
  });

  it('loading 优先于 empty', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true, loading: true, empty: '暂无数据' })} />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument();
  });

  it('disabled=true 时按钮被禁用', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, disabled: true })} />);
    // 两个按钮(主 trigger + chevron)都应被禁用
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('disabled=true 时点击不触发 onExpandedChange', () => {
    const onExpandedChange = jest.fn();
    render(<ToolPanel {...makeProps({ defaultExpanded: false, disabled: true, onExpandedChange })} />);
    // 点击任一按钮都不应触发
    screen.getAllByRole('button').forEach((btn) => fireEvent.click(btn));
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('disabled=true 时 data-disabled=true', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false, disabled: true })} />);
    expect(screen.getByTestId('tool-panel-panel-1')).toHaveAttribute('data-disabled', 'true');
  });

  it('展开状态 data-expanded=true', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true })} />);
    expect(screen.getByTestId('tool-panel-panel-1')).toHaveAttribute('data-expanded', 'true');
  });

  it('折叠状态 data-expanded=false', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: false })} />);
    expect(screen.getByTestId('tool-panel-panel-1')).toHaveAttribute('data-expanded', 'false');
  });

  it('aria-expanded 反映展开状态', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true })} />);
    // 两个按钮都应有 aria-expanded=true
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('aria-controls 指向内容区 ID', () => {
    render(<ToolPanel {...makeProps({ defaultExpanded: true })} />);
    // 两个按钮的 aria-controls 都应指向内容区
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn.getAttribute('aria-controls')).toBe('tool-panel-content-panel-1');
    });
  });

  it('有效 icon 渲染对应图标', () => {
    const { container } = render(<ToolPanel {...makeProps({ icon: 'Search' })} />);
    // lucide 图标渲染为 svg
    const svg = container.querySelector('svg.lucide-search');
    expect(svg).not.toBeNull();
  });

  it('icon 为空字符串不渲染图标', () => {
    const { container } = render(<ToolPanel {...makeProps({ icon: '' })} />);
    // 头部仍有 chevron 图标,但不应有 Search 图标
    const searchIcon = container.querySelector('svg.lucide-search');
    expect(searchIcon).toBeNull();
  });

  it('无效 icon 名不渲染图标(不报错)', () => {
    const { container } = render(<ToolPanel {...makeProps({ icon: 'NonExistentIcon' })} />);
    const searchIcon = container.querySelector('svg.lucide-search');
    expect(searchIcon).toBeNull();
  });

  it('actions 区域渲染自定义内容', () => {
    render(
      <ToolPanel
        {...makeProps({ defaultExpanded: true })}
        actions={<button type="button" data-testid="action-btn">刷新</button>}
      />,
    );
    expect(screen.getByTestId('action-btn')).toBeInTheDocument();
  });

  it('actions 点击不触发 toggle(stopPropagation)', () => {
    const onExpandedChange = jest.fn();
    render(
      <ToolPanel
        {...makeProps({ defaultExpanded: false, onExpandedChange })}
        actions={<button type="button" data-testid="action-btn">刷新</button>}
      />,
    );
    fireEvent.click(screen.getByTestId('action-btn'));
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('title 属性正确设置', () => {
    render(<ToolPanel {...makeProps({ title: '长标题需要截断显示' })} />);
    const titleEl = screen.getByText('长标题需要截断显示');
    expect(titleEl).toHaveAttribute('title', '长标题需要截断显示');
  });

  it('chevron 图标在折叠时不旋转', () => {
    // useState 初始值仅在首次挂载时生效,rerender 不重置,需要分别挂载
    const { container: collapsedContainer } = render(<ToolPanel {...makeProps({ defaultExpanded: false })} />);
    const chevron = collapsedContainer.querySelector('svg.lucide-chevron-down');
    expect(chevron?.getAttribute('class') ?? '').not.toContain('rotate-180');
  });

  it('chevron 图标在展开时旋转 180 度', () => {
    const { container } = render(<ToolPanel {...makeProps({ defaultExpanded: true })} />);
    const chevron = container.querySelector('svg.lucide-chevron-down');
    // SVG className 是 SVGAnimatedString,需通过 getAttribute('class') 获取
    expect(chevron?.getAttribute('class') ?? '').toContain('rotate-180');
  });
});
