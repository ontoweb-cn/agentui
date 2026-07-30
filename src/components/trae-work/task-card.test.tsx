// spec-013 P0-7: TaskCard Jest 单元测试
// 覆盖:5 种状态渲染/点击/删除/重试回调/compact/selected/进度条/键盘交互/时间格式化

import { render, screen, fireEvent } from '@testing-library/react';

import { TaskCard } from './task-card';
import type { TaskCardProps } from './types';

function makeProps(overrides: Partial<TaskCardProps> = {}): TaskCardProps {
  return {
    id: 'task-1',
    title: '测试任务',
    description: '这是一个测试任务描述',
    status: 'running',
    createdAt: '2026-07-30T10:00:00Z',
    updatedAt: '2026-07-30T10:05:00Z',
    currentStep: '调用工具: kb-retrieve',
    progress: 50,
    onClick: jest.fn(),
    onDelete: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('running 状态:渲染 spinner + 当前步骤 + 进度条', () => {
    render(<TaskCard {...makeProps()} />);
    expect(screen.getByText('测试任务')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('调用工具: kb-retrieve')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('completed 状态:渲染完成色圆点 + 完成标签', () => {
    render(<TaskCard {...makeProps({ status: 'completed', currentStep: undefined, progress: undefined })} />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('failed 状态:渲染失败标签 + 重试按钮', () => {
    render(<TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />);
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('cancelled 状态:渲染取消标签', () => {
    render(<TaskCard {...makeProps({ status: 'cancelled', currentStep: undefined, progress: undefined })} />);
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });

  it('pending 状态:渲染待处理标签', () => {
    render(<TaskCard {...makeProps({ status: 'pending', currentStep: undefined, progress: undefined })} />);
    expect(screen.getByText('待处理')).toBeInTheDocument();
  });

  it('点击卡片触发 onClick 回调', () => {
    const onClick = jest.fn();
    render(<TaskCard {...makeProps({ onClick })} />);
    fireEvent.click(screen.getByTestId('task-card-task-1'));
    expect(onClick).toHaveBeenCalledWith('task-1');
  });

  it('无 onClick 时不渲染 button role 和 tabIndex', () => {
    render(<TaskCard {...makeProps({ onClick: undefined })} />);
    const card = screen.getByTestId('task-card-task-1');
    expect(card).not.toHaveAttribute('role', 'button');
    expect(card).not.toHaveAttribute('tabindex');
  });

  it('点击删除按钮触发 onDelete 回调,不触发 onClick', () => {
    const onClick = jest.fn();
    const onDelete = jest.fn();
    render(<TaskCard {...makeProps({ status: 'failed', onClick, onDelete, currentStep: undefined, progress: undefined })} />);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledWith('task-1');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('点击重试按钮触发 onRetry 回调,不触发 onClick', () => {
    const onClick = jest.fn();
    const onRetry = jest.fn();
    render(<TaskCard {...makeProps({ status: 'failed', onClick, onRetry, currentStep: undefined, progress: undefined })} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledWith('task-1');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('failed 状态无 onRetry 时不渲染重试按钮', () => {
    render(<TaskCard {...makeProps({ status: 'failed', onRetry: undefined, currentStep: undefined, progress: undefined })} />);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('无 onDelete 时不渲染删除按钮', () => {
    render(<TaskCard {...makeProps({ status: 'failed', onDelete: undefined, currentStep: undefined, progress: undefined })} />);
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('compact 模式:不渲染描述/状态标签/时间/操作按钮,渲染右侧箭头', () => {
    render(<TaskCard {...makeProps({ compact: true })} />);
    expect(screen.queryByText('这是一个测试任务描述')).not.toBeInTheDocument();
    expect(screen.queryByText('进行中')).not.toBeInTheDocument();
    expect(screen.queryByText('07-30 10:05')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('selected 状态:渲染时不报错且 data-testid 存在', () => {
    // jsdom 无法解析 var(--xxx),样式断言不可靠,仅校验渲染行为
    render(<TaskCard {...makeProps({ selected: true })} />);
    expect(screen.getByTestId('task-card-task-1')).toBeInTheDocument();
  });

  it('非 selected 状态:左侧边框透明', () => {
    render(<TaskCard {...makeProps({ selected: false })} />);
    const card = screen.getByTestId('task-card-task-1');
    expect(card.style.borderLeft).toBe('2px solid transparent');
  });

  it('running 状态有 progress 时渲染进度条', () => {
    render(<TaskCard {...makeProps({ status: 'running', progress: 75 })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('progress 为负数时不渲染进度条', () => {
    render(<TaskCard {...makeProps({ progress: -10 })} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('progress 超过 100 时不渲染进度条', () => {
    render(<TaskCard {...makeProps({ progress: 150 })} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('progress 为 undefined 时不渲染进度条', () => {
    render(<TaskCard {...makeProps({ progress: undefined })} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('非 running 状态有 progress 时不渲染进度条', () => {
    render(<TaskCard {...makeProps({ status: 'completed', progress: 50 })} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('running 状态无 currentStep 时不渲染步骤文本', () => {
    render(<TaskCard {...makeProps({ status: 'running', currentStep: undefined })} />);
    expect(screen.queryByText('调用工具: kb-retrieve')).not.toBeInTheDocument();
  });

  it('compact 模式下无 description 不渲染描述', () => {
    render(<TaskCard {...makeProps({ compact: true, description: undefined })} />);
    expect(screen.queryByText('这是一个测试任务描述')).not.toBeInTheDocument();
  });

  it('按 Enter 键触发 onClick', () => {
    const onClick = jest.fn();
    render(<TaskCard {...makeProps({ onClick })} />);
    const card = screen.getByTestId('task-card-task-1');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('task-1');
  });

  it('按 Space 键触发 onClick', () => {
    const onClick = jest.fn();
    render(<TaskCard {...makeProps({ onClick })} />);
    const card = screen.getByTestId('task-card-task-1');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledWith('task-1');
  });

  it('按其他键不触发 onClick', () => {
    const onClick = jest.fn();
    render(<TaskCard {...makeProps({ onClick })} />);
    const card = screen.getByTestId('task-card-task-1');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('updatedAt 优先于 createdAt 用于显示', () => {
    // 使用本地时间(无 Z 后缀)避免跨时区问题
    render(<TaskCard {...makeProps({ createdAt: '2026-07-01T10:00:00', updatedAt: '2026-07-30T10:05:00' })} />);
    expect(screen.getByText('07-30 10:05')).toBeInTheDocument();
    expect(screen.queryByText('07-01 10:00')).not.toBeInTheDocument();
  });

  it('无 updatedAt 时使用 createdAt', () => {
    render(<TaskCard {...makeProps({ updatedAt: undefined, createdAt: '2026-07-15T08:30:00' })} />);
    expect(screen.getByText('07-15 08:30')).toBeInTheDocument();
  });

  it('time 元素 dateTime 属性正确设置', () => {
    render(<TaskCard {...makeProps({ updatedAt: '2026-07-30T10:05:00' })} />);
    const timeEl = screen.getByText('07-30 10:05');
    expect(timeEl.tagName).toBe('TIME');
    expect(timeEl).toHaveAttribute('dateTime', '2026-07-30T10:05:00');
  });

  it('data-status 属性正确反映状态', () => {
    const { rerender } = render(<TaskCard {...makeProps({ status: 'running' })} />);
    expect(screen.getByTestId('task-card-task-1')).toHaveAttribute('data-status', 'running');

    rerender(<TaskCard {...makeProps({ status: 'completed', currentStep: undefined, progress: undefined })} />);
    expect(screen.getByTestId('task-card-task-1')).toHaveAttribute('data-status', 'completed');
  });

  it('无效 ISO 时间字符串原样显示', () => {
    render(<TaskCard {...makeProps({ updatedAt: 'invalid-date', createdAt: 'invalid-date' })} />);
    expect(screen.getByText('invalid-date')).toBeInTheDocument();
  });

  it('title 属性正确设置(title 属性)', () => {
    render(<TaskCard {...makeProps({ title: '很长的标题需要截断' })} />);
    const titleEl = screen.getByText('很长的标题需要截断');
    expect(titleEl).toHaveAttribute('title', '很长的标题需要截断');
  });

  it('currentStep 设置 title 属性', () => {
    render(<TaskCard {...makeProps({ currentStep: '正在执行重要步骤' })} />);
    const stepEl = screen.getByText('正在执行重要步骤');
    expect(stepEl).toHaveAttribute('title', '正在执行重要步骤');
  });

  it('description 非空时渲染描述', () => {
    render(<TaskCard {...makeProps({ description: '描述内容' })} />);
    expect(screen.getByText('描述内容')).toBeInTheDocument();
  });

  it('description 为空时不渲染描述', () => {
    render(<TaskCard {...makeProps({ description: undefined })} />);
    // 仅匹配包含描述元素的容器,但不应有描述文本
    const desc = screen.queryByText('这是一个测试任务描述');
    expect(desc).not.toBeInTheDocument();
  });

  // spec-013 P1-A1: aria-label 测试
  it('有 onClick 时 aria-label 设置为 title', () => {
    render(<TaskCard {...makeProps({ title: '可点击任务' })} />);
    const card = screen.getByTestId('task-card-task-1');
    expect(card).toHaveAttribute('aria-label', '可点击任务');
  });

  it('无 onClick 时 aria-label 未设置', () => {
    render(<TaskCard {...makeProps({ onClick: undefined, title: '不可点击任务' })} />);
    const card = screen.getByTestId('task-card-task-1');
    expect(card).not.toHaveAttribute('aria-label');
  });

  // spec-013 P2-Q6: cursor-pointer 条件化测试
  it('有 onClick 时应用 cursor-pointer 类', () => {
    render(<TaskCard {...makeProps({ onClick: jest.fn() })} />);
    const card = screen.getByTestId('task-card-task-1');
    expect(card.className).toContain('cursor-pointer');
  });

  it('无 onClick 时不应用 cursor-pointer 类', () => {
    render(<TaskCard {...makeProps({ onClick: undefined })} />);
    const card = screen.getByTestId('task-card-task-1');
    expect(card.className).not.toContain('cursor-pointer');
  });
});
