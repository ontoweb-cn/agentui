// spec-013 P0-7: ModeSwitcher Jest 单元测试
// 覆盖:渲染/三段切换/availableModes/size/disabled/showLabels/键盘交互

import { render, screen, fireEvent } from '@testing-library/react';

import { ModeSwitcher } from './mode-switcher';
import type { ModeSwitcherProps } from './types';

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
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', 'Work mode switcher');
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

  // ---- vertical 模式测试(spec-013 P0-7 补充) ----
  // 评审意见:orientation 是 Activity Bar 场景的关键能力,需补测试覆盖

  describe('orientation=vertical', () => {
    it('默认 orientation 为 horizontal', () => {
      render(<ModeSwitcher {...makeProps()} />);
      const switcher = screen.getByTestId('mode-switcher');
      expect(switcher).toHaveAttribute('data-orientation', 'horizontal');
      expect(switcher).toHaveAttribute('aria-orientation', 'horizontal');
    });

    it('orientation=vertical 设置 data-orientation 与 aria-orientation', () => {
      render(<ModeSwitcher {...makeProps({ orientation: 'vertical' })} />);
      const switcher = screen.getByTestId('mode-switcher');
      expect(switcher).toHaveAttribute('data-orientation', 'vertical');
      expect(switcher).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('vertical 容器使用 flex-col 排列', () => {
      render(<ModeSwitcher {...makeProps({ orientation: 'vertical' })} />);
      const switcher = screen.getByTestId('mode-switcher');
      expect(switcher.className).toContain('flex-col');
      expect(switcher.className).toContain('items-stretch');
    });

    it('horizontal 容器使用默认水平排列(无 flex-col)', () => {
      render(<ModeSwitcher {...makeProps({ orientation: 'horizontal' })} />);
      const switcher = screen.getByTestId('mode-switcher');
      expect(switcher.className).not.toContain('flex-col');
      expect(switcher.className).toContain('items-center');
    });

    it('vertical 模式下每个按钮使用 flex-col 布局', () => {
      render(<ModeSwitcher {...makeProps({ orientation: 'vertical' })} />);
      const radios = screen.getAllByRole('radio');
      radios.forEach((radio) => {
        expect(radio.className).toContain('flex-col');
        expect(radio.className).toContain('py-2');
      });
    });

    it('vertical 模式下激活段渲染左侧指示条(aria-hidden)', () => {
      render(<ModeSwitcher {...makeProps({ value: 'work', orientation: 'vertical' })} />);
      const workBtn = screen.getByRole('radio', { name: 'Work' });
      // 激活段应包含一个 aria-hidden 的指示条 span
      const indicator = workBtn.querySelector('span[aria-hidden]');
      expect(indicator).not.toBeNull();
      // 指示条带 left-0 定位与 bg-trae-green
      expect(indicator!.className).toContain('left-0');
      expect(indicator!.className).toContain('bg-trae-green');
    });

    it('vertical 模式下非激活段不渲染指示条', () => {
      render(<ModeSwitcher {...makeProps({ value: 'work', orientation: 'vertical' })} />);
      const codeBtn = screen.getByRole('radio', { name: 'Code' });
      const indicator = codeBtn.querySelector('span[aria-hidden]');
      expect(indicator).toBeNull();
    });

    it('horizontal 模式下激活段不渲染左侧指示条', () => {
      render(<ModeSwitcher {...makeProps({ value: 'work', orientation: 'horizontal' })} />);
      const workBtn = screen.getByRole('radio', { name: 'Work' });
      const indicator = workBtn.querySelector('span[aria-hidden]');
      // 水平模式不渲染指示条
      expect(indicator).toBeNull();
    });

    it('vertical 模式下激活段不使用水平样式 backgroundColor', () => {
      render(<ModeSwitcher {...makeProps({ value: 'work', orientation: 'vertical' })} />);
      const workBtn = screen.getByRole('radio', { name: 'Work' });
      // 水平模式才会 inline 设置 backgroundColor,vertical 模式应无此 style
      expect(workBtn.style.backgroundColor).toBe('');
    });

    it('vertical 模式下标签使用更小字号 text-[10px]', () => {
      render(<ModeSwitcher {...makeProps({ value: 'work', orientation: 'vertical' })} />);
      const labelSpans = screen
        .getByTestId('mode-switcher')
        .querySelectorAll('button > span:not([aria-hidden])');
      expect(labelSpans.length).toBeGreaterThan(0);
      labelSpans.forEach((span) => {
        expect(span.className).toContain('text-[10px]');
      });
    });

    it('vertical 模式下点击仍可切换', () => {
      const onChange = jest.fn();
      render(
        <ModeSwitcher
          {...makeProps({ value: 'work', orientation: 'vertical', onChange })}
        />,
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
      expect(onChange).toHaveBeenCalledWith('code');
    });

    it('vertical 模式下 disabled=true 仍禁用所有按钮', () => {
      render(
        <ModeSwitcher
          {...makeProps({ value: 'work', orientation: 'vertical', disabled: true })}
        />,
      );
      expect(screen.getByRole('radio', { name: 'Work' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'Code' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'Canvas' })).toBeDisabled();
    });

    it('vertical 模式下 data-active 与 data-mode 属性正确', () => {
      render(<ModeSwitcher {...makeProps({ value: 'code', orientation: 'vertical' })} />);
      const workBtn = screen.getByRole('radio', { name: 'Work' });
      const codeBtn = screen.getByRole('radio', { name: 'Code' });
      expect(workBtn).toHaveAttribute('data-mode', 'work');
      expect(workBtn).toHaveAttribute('data-active', 'false');
      expect(codeBtn).toHaveAttribute('data-mode', 'code');
      expect(codeBtn).toHaveAttribute('data-active', 'true');
    });

    it('vertical 模式下 showLabels=false 仍可隐藏标签', () => {
      render(
        <ModeSwitcher
          {...makeProps({ value: 'work', orientation: 'vertical', showLabels: false })}
        />,
      );
      expect(screen.queryByText('Work')).not.toBeInTheDocument();
      expect(screen.queryByText('Code')).not.toBeInTheDocument();
    });
  });
});
