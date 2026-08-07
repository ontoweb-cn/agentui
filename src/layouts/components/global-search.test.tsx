// spec-013 P1-7: GlobalSearch Jest 单元测试
// 覆盖:渲染/占位符/onChange/⌘K 聚焦/快捷键提示/自定义 placeholder

import { render, screen, fireEvent } from '@testing-library/react';

import { GlobalSearch } from './global-search';

describe('GlobalSearch', () => {
  it('渲染搜索框 + 快捷键提示', () => {
    render(<GlobalSearch />);

    const input = screen.getByRole('textbox', { name: '全局搜索' });
    expect(input).toBeInTheDocument();
    expect(screen.getByTestId('global-search')).toBeInTheDocument();
    // 默认显示 ⌘K 快捷键提示
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('默认占位符', () => {
    render(<GlobalSearch />);
    expect(screen.getByPlaceholderText('搜索任务、应用、数据集...')).toBeInTheDocument();
  });

  it('自定义占位符', () => {
    render(<GlobalSearch placeholder="输入关键词..." />);
    expect(screen.getByPlaceholderText('输入关键词...')).toBeInTheDocument();
  });

  it('受控:value + onChange 透传', () => {
    const onChange = jest.fn();
    render(<GlobalSearch value="hello" onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: '全局搜索' }) as HTMLInputElement;
    expect(input.value).toBe('hello');

    fireEvent.change(input, { target: { value: 'world' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('world');
  });

  it('showShortcut=false 隐藏快捷键提示', () => {
    render(<GlobalSearch showShortcut={false} />);
    expect(screen.queryByText('⌘K')).not.toBeInTheDocument();
  });

  it('按 ⌘K 聚焦搜索框', () => {
    render(<GlobalSearch />);
    const input = screen.getByRole('textbox', { name: '全局搜索' });

    // 初始未聚焦
    expect(document.activeElement).not.toBe(input);

    // 模拟 ⌘K
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(document.activeElement).toBe(input);
  });

  it('按 Ctrl+K 聚焦搜索框(非 macOS)', () => {
    render(<GlobalSearch />);
    const input = screen.getByRole('textbox', { name: '全局搜索' });

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('⌘K 已聚焦时不重复触发 preventDefault', () => {
    render(<GlobalSearch />);
    const input = screen.getByRole('textbox', { name: '全局搜索' });

    // 先聚焦
    input.focus();
    expect(document.activeElement).toBe(input);

    // 已聚焦时按 ⌘K,不应抛异常,焦点保持
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    // preventDefault 不应被调用(因为已聚焦)
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    preventDefaultSpy.mockRestore();
  });

  it('其他快捷键不触发聚焦', () => {
    render(<GlobalSearch />);
    const input = screen.getByRole('textbox', { name: '全局搜索' });

    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: 'k' }); // 无 meta/ctrl
    expect(document.activeElement).not.toBe(input);
  });
});
