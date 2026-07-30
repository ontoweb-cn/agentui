// spec-013 P0-7: ModeSwitcher Jest 单元测试
// 覆盖:渲染/三段切换/availableModes/size/disabled/showLabels/键盘交互

import { render, screen, fireEvent } from '@testing-library/react';

import { ModeSwitcher } from './mode-switcher';
import type { ModeSwitcherProps, WorkMode } from './types';

function makeProps(overrides: Partial<ModeSwitcherProps> = {}): ModeSwitcherProps {
  return {
    value: 'work',
    onChange: jest.fn(),
    ...overrides,
  };
}

describe('ModeSwitcher', () => {
  it('渲染三段(Work/Code/Canvas)', () => {
    render(<ModeSwitcher {...makeProps()} />);
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByText('Canvas')).toBeInTheDocument();
  });

  it('value=work 时 work 段为激活状态', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    const workBtn = screen.getByRole('radio', { name: 'Work' });
    expect(workBtn).toHaveAttribute('aria-checked', 'true');
    expect(workBtn).toHaveAttribute('data-active', 'true');
  });

  it('value=code 时 code 段为激活状态', () => {
    render(<ModeSwitcher {...makeProps({ value: 'code' })} />);
    const codeBtn = screen.getByRole('radio', { name: 'Code' });
    expect(codeBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('value=canvas 时 canvas 段为激活状态', () => {
    render(<ModeSwitcher {...makeProps({ value: 'canvas' })} />);
    const canvasBtn = screen.getByRole('radio', { name: 'Canvas' });
    expect(canvasBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('点击非激活段触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', onChange })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('点击当前激活段不触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', onChange })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Work' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('按 Enter 键触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', onChange })} />);
    const codeBtn = screen.getByRole('radio', { name: 'Code' });
    fireEvent.keyDown(codeBtn, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('按 Space 键触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', onChange })} />);
    const codeBtn = screen.getByRole('radio', { name: 'Code' });
    fireEvent.keyDown(codeBtn, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('按其他键不触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', onChange })} />);
    const codeBtn = screen.getByRole('radio', { name: 'Code' });
    fireEvent.keyDown(codeBtn, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('availableModes 限制可选模式', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', availableModes: ['work', 'code'] })} />);
    expect(screen.getByRole('radio', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Code' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Canvas' })).not.toBeInTheDocument();
  });

  it('availableModes 仅一个模式时只渲染一个段', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', availableModes: ['work'] })} />);
    expect(screen.getByRole('radio', { name: 'Work' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Canvas' })).not.toBeInTheDocument();
  });

  it('size=sm 应用小尺寸样式', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', size: 'sm' })} />);
    const workBtn = screen.getByRole('radio', { name: 'Work' });
    expect(workBtn.className).toContain('px-2');
    expect(workBtn.className).toContain('py-1');
  });

  it('size=md 应用中等尺寸样式(默认)', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', size: 'md' })} />);
    const workBtn = screen.getByRole('radio', { name: 'Work' });
    expect(workBtn.className).toContain('px-3');
    expect(workBtn.className).toContain('py-1.5');
  });

  it('size=lg 应用大尺寸样式', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', size: 'lg' })} />);
    const workBtn = screen.getByRole('radio', { name: 'Work' });
    expect(workBtn.className).toContain('px-4');
    expect(workBtn.className).toContain('py-2');
  });

  it('未指定 size 时默认 md', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    const workBtn = screen.getByRole('radio', { name: 'Work' });
    expect(workBtn.className).toContain('px-3');
    expect(workBtn.className).toContain('py-1.5');
  });

  it('disabled=true 时所有按钮禁用', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', disabled: true })} />);
    expect(screen.getByRole('radio', { name: 'Work' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Code' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Canvas' })).toBeDisabled();
  });

  it('disabled=true 时点击不触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', disabled: true, onChange })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled=true 时键盘不触发 onChange', () => {
    const onChange = jest.fn();
    render(<ModeSwitcher {...makeProps({ value: 'work', disabled: true, onChange })} />);
    const codeBtn = screen.getByRole('radio', { name: 'Code' });
    fireEvent.keyDown(codeBtn, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled=true 时容器有 aria-disabled=true', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', disabled: true })} />);
    expect(screen.getByTestId('mode-switcher')).toHaveAttribute('aria-disabled', 'true');
  });

  it('disabled=true 时容器 opacity-50', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', disabled: true })} />);
    expect(screen.getByTestId('mode-switcher').className).toContain('opacity-50');
  });

  it('showLabels=false 不渲染标签文字', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work', showLabels: false })} />);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    expect(screen.queryByText('Code')).not.toBeInTheDocument();
    expect(screen.queryByText('Canvas')).not.toBeInTheDocument();
  });

  it('showLabels=true(默认)渲染标签文字', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByText('Canvas')).toBeInTheDocument();
  });

  it('role=radiogroup 容器', () => {
    render(<ModeSwitcher {...makeProps()} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  // spec-013 P2-A3: radiogroup aria-label 测试
  it('radiogroup 有 aria-label 描述用途', () => {
    render(<ModeSwitcher {...makeProps()} />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', '工作模式切换');
  });

  it('每个段 role=radio', () => {
    render(<ModeSwitcher {...makeProps()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
  });

  it('激活段 tabIndex=0,非激活段 tabIndex=-1', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    const workBtn = screen.getByRole('radio', { name: 'Work' });
    const codeBtn = screen.getByRole('radio', { name: 'Code' });
    expect(workBtn).toHaveAttribute('tabindex', '0');
    expect(codeBtn).toHaveAttribute('tabindex', '-1');
  });

  it('data-value 反映当前值', () => {
    render(<ModeSwitcher {...makeProps({ value: 'code' })} />);
    expect(screen.getByTestId('mode-switcher')).toHaveAttribute('data-value', 'code');
  });

  it('data-mode 属性正确设置在每个段上', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute('data-mode', 'work');
    expect(screen.getByRole('radio', { name: 'Code' })).toHaveAttribute('data-mode', 'code');
    expect(screen.getByRole('radio', { name: 'Canvas' })).toHaveAttribute('data-mode', 'canvas');
  });

  it('data-active 属性反映激活状态', () => {
    render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('radio', { name: 'Code' })).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('radio', { name: 'Canvas' })).toHaveAttribute('data-active', 'false');
  });

  it('渲染三种图标(FileText/Code2/LayoutGrid)', () => {
    const { container } = render(<ModeSwitcher {...makeProps({ value: 'work' })} />);
    // 检查 svg 数量(3 个段对应 3 个图标)
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(3);
    // 检查每个 svg 都有 lucide 前缀的 class
    svgs.forEach((svg) => {
      const cls = svg.getAttribute('class') ?? '';
      expect(cls).toContain('lucide');
    });
  });
});
