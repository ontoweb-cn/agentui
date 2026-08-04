// spec-013 P1-3: ToolPanelHost Jest 单元测试
// 覆盖:渲染多面板/展开折叠/手风琴/受控/非受控/折叠按钮/collapsed 状态

import { render, screen, fireEvent } from '@testing-library/react';

import { ToolPanelHost } from './tool-panel-host';
import type { ToolPanelProps } from '@/components/trae-work';

// mock ToolPanel 组件:暴露 expanded 状态与 toggle 按钮
jest.mock('@/components/trae-work', () => ({
  ToolPanel: ({ id, title, expanded, onExpandedChange }: ToolPanelProps) => (
    <div data-testid="tool-panel" data-panel-id={id} data-expanded={String(expanded)}>
      <button type="button" onClick={() => onExpandedChange?.(!expanded)}>
        toggle {title}
      </button>
      {title}
    </div>
  ),
}));

function makePanels(count = 3): ToolPanelProps[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `panel-${i + 1}`,
    title: `面板 ${i + 1}`,
    icon: 'Search',
    children: <div data-testid={`panel-content-${i + 1}`}>内容 {i + 1}</div>,
  }));
}

describe('ToolPanelHost', () => {
  it('渲染多个面板', () => {
    render(<ToolPanelHost panels={makePanels(3)} />);
    expect(screen.getAllByTestId('tool-panel')).toHaveLength(3);
    expect(screen.getByText('面板 1')).toBeInTheDocument();
    expect(screen.getByText('面板 2')).toBeInTheDocument();
    expect(screen.getByText('面板 3')).toBeInTheDocument();
  });

  it('默认标题为 "Tools"', () => {
    render(<ToolPanelHost panels={makePanels(1)} />);
    expect(screen.getByText('Tools')).toBeInTheDocument();
  });

  it('可通过 title prop 自定义标题', () => {
    render(<ToolPanelHost panels={makePanels(1)} title="自定义标题" />);
    expect(screen.getByText('自定义标题')).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
  });

  it('点击面板展开(非受控)', () => {
    render(<ToolPanelHost panels={makePanels(2)} />);
    const panel1 = screen.getAllByTestId('tool-panel')[0];
    expect(panel1).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(panel1).toHaveAttribute('data-expanded', 'true');
  });

  it('点击面板折叠(非受控,已展开)', () => {
    render(
      <ToolPanelHost
        panels={makePanels(1)}
        defaultExpandedPanels={['panel-1']}
      />,
    );
    const panel1 = screen.getByTestId('tool-panel');
    expect(panel1).toHaveAttribute('data-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(panel1).toHaveAttribute('data-expanded', 'false');
  });

  it('非手风琴模式:各面板独立展开/折叠', () => {
    render(<ToolPanelHost panels={makePanels(2)} accordion={false} />);

    const [panel1, panel2] = screen.getAllByTestId('tool-panel');

    // 同时展开两个面板
    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 2/ }));

    expect(panel1).toHaveAttribute('data-expanded', 'true');
    expect(panel2).toHaveAttribute('data-expanded', 'true');
  });

  it('非手风琴模式:折叠一个不影响其他面板', () => {
    render(
      <ToolPanelHost
        panels={makePanels(2)}
        defaultExpandedPanels={['panel-1', 'panel-2']}
      />,
    );

    const [panel1, panel2] = screen.getAllByTestId('tool-panel');
    expect(panel1).toHaveAttribute('data-expanded', 'true');
    expect(panel2).toHaveAttribute('data-expanded', 'true');

    // 折叠 panel-1,panel-2 仍展开
    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(panel1).toHaveAttribute('data-expanded', 'false');
    expect(panel2).toHaveAttribute('data-expanded', 'true');
  });

  it('手风琴模式:展开新面板自动折叠旧面板', () => {
    render(<ToolPanelHost panels={makePanels(2)} accordion={true} />);

    const [panel1, panel2] = screen.getAllByTestId('tool-panel');

    // 展开 panel-1
    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(panel1).toHaveAttribute('data-expanded', 'true');
    expect(panel2).toHaveAttribute('data-expanded', 'false');

    // 展开 panel-2,panel-1 应自动折叠
    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 2/ }));
    expect(panel1).toHaveAttribute('data-expanded', 'false');
    expect(panel2).toHaveAttribute('data-expanded', 'true');
  });

  it('手风琴模式:折叠当前已展开面板', () => {
    render(
      <ToolPanelHost
        panels={makePanels(2)}
        accordion={true}
        defaultExpandedPanels={['panel-1']}
      />,
    );

    const [panel1, panel2] = screen.getAllByTestId('tool-panel');
    expect(panel1).toHaveAttribute('data-expanded', 'true');
    expect(panel2).toHaveAttribute('data-expanded', 'false');

    // 点击已展开的 panel-1,折叠
    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(panel1).toHaveAttribute('data-expanded', 'false');
    expect(panel2).toHaveAttribute('data-expanded', 'false');
  });

  it('非受控模式:defaultExpandedPanels 初始化展开状态', () => {
    render(
      <ToolPanelHost
        panels={makePanels(3)}
        defaultExpandedPanels={['panel-1', 'panel-3']}
      />,
    );

    const [panel1, panel2, panel3] = screen.getAllByTestId('tool-panel');
    expect(panel1).toHaveAttribute('data-expanded', 'true');
    expect(panel2).toHaveAttribute('data-expanded', 'false');
    expect(panel3).toHaveAttribute('data-expanded', 'true');
  });

  it('受控模式:expandedPanels prop 控制展开状态', () => {
    render(
      <ToolPanelHost
        panels={makePanels(3)}
        expandedPanels={['panel-2']}
      />,
    );

    const [panel1, panel2, panel3] = screen.getAllByTestId('tool-panel');
    expect(panel1).toHaveAttribute('data-expanded', 'false');
    expect(panel2).toHaveAttribute('data-expanded', 'true');
    expect(panel3).toHaveAttribute('data-expanded', 'false');
  });

  it('受控模式:点击触发 onExpandedChange 但不内部更新', () => {
    const onExpandedChange = jest.fn();
    render(
      <ToolPanelHost
        panels={makePanels(1)}
        expandedPanels={[]}
        onExpandedChange={onExpandedChange}
      />,
    );

    const panel1 = screen.getByTestId('tool-panel');
    expect(panel1).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(onExpandedChange).toHaveBeenCalledWith(['panel-1']);
    // 受控模式:内部状态不变
    expect(panel1).toHaveAttribute('data-expanded', 'false');
  });

  it('非受控模式:点击触发 onExpandedChange 回调', () => {
    const onExpandedChange = jest.fn();
    render(
      <ToolPanelHost
        panels={makePanels(2)}
        onExpandedChange={onExpandedChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(onExpandedChange).toHaveBeenCalledWith(['panel-1']);
  });

  it('手风琴模式:点击触发 onExpandedChange 仅返回新展开的 ID', () => {
    const onExpandedChange = jest.fn();
    render(
      <ToolPanelHost
        panels={makePanels(2)}
        accordion={true}
        onExpandedChange={onExpandedChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(['panel-1']);

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 2/ }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(['panel-2']);
  });

  it('手风琴模式:折叠时 onExpandedChange 返回空数组', () => {
    const onExpandedChange = jest.fn();
    render(
      <ToolPanelHost
        panels={makePanels(1)}
        accordion={true}
        defaultExpandedPanels={['panel-1']}
        onExpandedChange={onExpandedChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
  });

  it('折叠按钮触发 onCollapsedChange', () => {
    const onCollapsedChange = jest.fn();
    render(
      <ToolPanelHost
        panels={makePanels(1)}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Collapse tool panel'));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('collapsed=true 时再次点击折叠按钮触发 onCollapsedChange(false)', () => {
    const onCollapsedChange = jest.fn();
    const { container } = render(
      <ToolPanelHost
        panels={makePanels(1)}
        collapsed={true}
        onCollapsedChange={onCollapsedChange}
      />,
    );

    // collapsed=true 时整个组件 hidden,但按钮仍可查询(DOM 仍在)
    const collapseBtn = container.querySelector('button[aria-label="Collapse tool panel"]');
    expect(collapseBtn).not.toBeNull();
    fireEvent.click(collapseBtn as Element);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('collapsed=true 时容器添加 hidden 类', () => {
    const { container } = render(
      <ToolPanelHost panels={makePanels(1)} collapsed={true} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('hidden');
    expect(root).toHaveAttribute('data-collapsed', 'true');
  });

  it('collapsed=false 时不添加 hidden 类', () => {
    const { container } = render(
      <ToolPanelHost panels={makePanels(1)} collapsed={false} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root).not.toHaveClass('hidden');
    expect(root).toHaveAttribute('data-collapsed', 'false');
  });

  it('空面板列表:不渲染面板区域但保留标题栏', () => {
    render(<ToolPanelHost panels={[]} />);
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.queryAllByTestId('tool-panel')).toHaveLength(0);
    // 折叠按钮仍存在
    expect(screen.getByLabelText('Collapse tool panel')).toBeInTheDocument();
  });

  it('ToolPanel 的 expanded 由 host 统一注入(忽略 panels prop 中的 expanded 字段)', () => {
    const panels = makePanels(2);
    // 强制在 panel-1 上设置 expanded,但 host 未将其加入展开列表
    panels[0] = { ...panels[0], expanded: true };

    render(<ToolPanelHost panels={panels} />);

    const [panel1, panel2] = screen.getAllByTestId('tool-panel');
    // host 未传入 expandedPanels/defaultExpandedPanels,默认全部折叠
    expect(panel1).toHaveAttribute('data-expanded', 'false');
    expect(panel2).toHaveAttribute('data-expanded', 'false');
  });

  it('ToolPanel 的 onExpandedChange 由 host 统一注入(忽略 panels prop 中的 onExpandedChange)', () => {
    const innerOnExpandedChange = jest.fn();
    const panels = makePanels(1);
    panels[0] = { ...panels[0], onExpandedChange: innerOnExpandedChange };

    const hostOnExpandedChange = jest.fn();
    render(
      <ToolPanelHost
        panels={panels}
        onExpandedChange={hostOnExpandedChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle 面板 1/ }));
    // host 的 onExpandedChange 被调用
    expect(hostOnExpandedChange).toHaveBeenCalledWith(['panel-1']);
    // panels prop 中的 onExpandedChange 不应被调用(被 host 覆盖)
    expect(innerOnExpandedChange).not.toHaveBeenCalled();
  });

  it('每个 ToolPanel 的 key 使用 panel.id', () => {
    const { container } = render(<ToolPanelHost panels={makePanels(2)} />);
    // 仅验证渲染数量正确即可(key 影响 reconciliation,不直接暴露)
    const panels = container.querySelectorAll('[data-testid="tool-panel"]');
    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveAttribute('data-panel-id', 'panel-1');
    expect(panels[1]).toHaveAttribute('data-panel-id', 'panel-2');
  });
});
