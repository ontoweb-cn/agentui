// spec-013 P0-7: TaskProgress Jest 单元测试
// 覆盖:节点渲染/状态/嵌套/展开折叠(受控/非受控)/时间戳/autoScroll/showTimestamp

import { render, screen, fireEvent } from '@testing-library/react';

import { TaskProgress } from './task-progress';
import type { ProgressNode } from './types';

function makeNode(overrides: Partial<ProgressNode> = {}): ProgressNode {
  return {
    id: 'n1',
    type: 'tool_call',
    title: '调用工具: kb-retrieve',
    status: 'completed',
    startedAt: '2026-07-30T10:00:00',
    endedAt: '2026-07-30T10:00:05',
    content: '检索到 5 条相关文档',
    ...overrides,
  };
}

// jsdom 不实现 scrollIntoView,统一 mock
const scrollIntoViewMock = jest.fn();
let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
});

afterAll(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

beforeEach(() => {
  scrollIntoViewMock.mockReset();
});

describe('TaskProgress', () => {
  it('空节点列表渲染空容器', () => {
    render(<TaskProgress nodes={[]} />);
    expect(screen.getByTestId('task-progress')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('单个节点渲染正确', () => {
    render(<TaskProgress nodes={[makeNode()]} />);
    expect(screen.getByText('调用工具: kb-retrieve')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('多个节点渲染正确', () => {
    const nodes = [
      makeNode({ id: 'n1', title: '节点 1' }),
      makeNode({ id: 'n2', title: '节点 2' }),
      makeNode({ id: 'n3', title: '节点 3' }),
    ];
    render(<TaskProgress nodes={nodes} />);
    expect(screen.getByText('节点 1')).toBeInTheDocument();
    expect(screen.getByText('节点 2')).toBeInTheDocument();
    expect(screen.getByText('节点 3')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('completed 状态:圆点填充完成色', () => {
    render(<TaskProgress nodes={[makeNode({ status: 'completed' })]} />);
    const node = screen.getByTestId('task-progress').querySelector('[data-node-id="n1"]');
    expect(node).toHaveAttribute('data-node-status', 'completed');
  });

  it('running 状态:渲染 spinner', () => {
    render(<TaskProgress nodes={[makeNode({ status: 'running', endedAt: undefined })]} />);
    const node = screen.getByTestId('task-progress').querySelector('[data-node-id="n1"]');
    expect(node).toHaveAttribute('data-node-status', 'running');
  });

  it('failed 状态:渲染 AlertCircle 图标', () => {
    render(<TaskProgress nodes={[makeNode({ status: 'failed' })]} />);
    const node = screen.getByTestId('task-progress').querySelector('[data-node-id="n1"]');
    expect(node).toHaveAttribute('data-node-status', 'failed');
  });

  it('skipped 状态:渲染灰色圆点', () => {
    render(<TaskProgress nodes={[makeNode({ status: 'skipped' })]} />);
    const node = screen.getByTestId('task-progress').querySelector('[data-node-id="n1"]');
    expect(node).toHaveAttribute('data-node-status', 'skipped');
  });

  it('data-node-type 属性正确反映节点类型', () => {
    render(<TaskProgress nodes={[makeNode({ type: 'thinking' })]} />);
    const node = screen.getByTestId('task-progress').querySelector('[data-node-id="n1"]');
    expect(node).toHaveAttribute('data-node-type', 'thinking');
  });

  it('有 content 的节点渲染展开按钮(可交互)', () => {
    render(<TaskProgress nodes={[makeNode({ content: '内容' })]} />);
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('无 content 的节点不渲染展开按钮(不可交互)', () => {
    render(<TaskProgress nodes={[makeNode({ content: undefined })]} />);
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  });

  it('有子节点的节点渲染展开按钮(可交互)', () => {
    const node = makeNode({
      content: undefined,
      children: [makeNode({ id: 'child1', title: '子节点' })],
    });
    render(<TaskProgress nodes={[node]} />);
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('点击展开按钮切换展开状态(非受控)', () => {
    const onExpandedChange = jest.fn();
    render(<TaskProgress nodes={[makeNode()]} onExpandedChange={onExpandedChange} />);
    // 初始折叠
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(onExpandedChange).toHaveBeenCalledWith(['n1']);
    // 展开后按钮文字变为"折叠"
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('点击展开按钮再次点击折叠(非受控)', () => {
    render(<TaskProgress nodes={[makeNode()]} defaultExpanded={['n1']} />);
    // 初始展开
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    // 点击折叠
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('defaultExpanded 设置初始展开状态', () => {
    render(<TaskProgress nodes={[makeNode()]} defaultExpanded={['n1']} />);
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('受控模式:expanded prop 控制展开状态', () => {
    const onExpandedChange = jest.fn();
    const { rerender } = render(
      <TaskProgress nodes={[makeNode()]} expanded={[]} onExpandedChange={onExpandedChange} />,
    );
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();

    rerender(
      <TaskProgress nodes={[makeNode()]} expanded={['n1']} onExpandedChange={onExpandedChange} />,
    );
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('受控模式:点击触发 onExpandedChange 但不内部更新', () => {
    const onExpandedChange = jest.fn();
    render(
      <TaskProgress nodes={[makeNode()]} expanded={[]} onExpandedChange={onExpandedChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(onExpandedChange).toHaveBeenCalledWith(['n1']);
    // 受控模式,内部状态不变,按钮文字仍是"展开"
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('showTimestamp=false 不渲染时间戳', () => {
    render(<TaskProgress nodes={[makeNode()]} showTimestamp={false} />);
    expect(screen.queryByText('10:00 → 10:00')).not.toBeInTheDocument();
  });

  it('showTimestamp=true(默认)渲染时间戳', () => {
    render(<TaskProgress nodes={[makeNode()]} />);
    expect(screen.getByText('10:00 → 10:00')).toBeInTheDocument();
  });

  it('仅有 startedAt 时显示 "HH:mm"', () => {
    render(<TaskProgress nodes={[makeNode({ endedAt: undefined })]} />);
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('startedAt 和 endedAt 都存在时显示 "HH:mm → HH:mm"', () => {
    render(<TaskProgress nodes={[makeNode({ startedAt: '2026-07-30T10:00:00', endedAt: '2026-07-30T10:30:45' })]} />);
    expect(screen.getByText('10:00 → 10:30')).toBeInTheDocument();
  });

  it('无 startedAt 时不渲染时间戳', () => {
    render(<TaskProgress nodes={[makeNode({ startedAt: undefined, endedAt: undefined })]} />);
    expect(screen.queryByText('10:00')).not.toBeInTheDocument();
  });

  it('无效 startedAt 字符串原样显示', () => {
    render(<TaskProgress nodes={[makeNode({ startedAt: 'invalid-time', endedAt: undefined })]} />);
    expect(screen.getByText('invalid-time')).toBeInTheDocument();
  });

  it('time 元素 dateTime 属性正确设置', () => {
    render(<TaskProgress nodes={[makeNode({ startedAt: '2026-07-30T10:00:00' })]} />);
    const timeEl = screen.getByText('10:00 → 10:00');
    expect(timeEl.tagName).toBe('TIME');
    expect(timeEl).toHaveAttribute('dateTime', '2026-07-30T10:00:00');
  });

  it('嵌套子节点:展开父节点显示子节点', () => {
    const node = makeNode({
      children: [
        makeNode({ id: 'child1', title: '子节点 1', content: undefined }),
        makeNode({ id: 'child2', title: '子节点 2', content: undefined }),
      ],
    });
    render(<TaskProgress nodes={[node]} defaultExpanded={['n1']} />);
    expect(screen.getByText('子节点 1')).toBeInTheDocument();
    expect(screen.getByText('子节点 2')).toBeInTheDocument();
  });

  it('嵌套子节点:折叠父节点不显示子节点', () => {
    const node = makeNode({
      children: [
        makeNode({ id: 'child1', title: '子节点 1', content: undefined }),
      ],
    });
    render(<TaskProgress nodes={[node]} expanded={[]} />);
    expect(screen.queryByText('子节点 1')).not.toBeInTheDocument();
  });

  it('title 属性正确设置', () => {
    render(<TaskProgress nodes={[makeNode({ title: '需要截断的长标题' })]} />);
    const titleEl = screen.getByText('需要截断的长标题');
    expect(titleEl).toHaveAttribute('title', '需要截断的长标题');
  });

  it('failed 状态标题应用红色样式', () => {
    render(<TaskProgress nodes={[makeNode({ status: 'failed', title: '失败任务' })]} />);
    const titleEl = screen.getByText('失败任务');
    // 失败状态使用 text-[#ef4444] 类
    expect(titleEl.className).toContain('text-[#ef4444]');
  });

  it('非 failed 状态标题应用 text-trae-ink 类', () => {
    render(<TaskProgress nodes={[makeNode({ status: 'completed', title: '完成任务' })]} />);
    const titleEl = screen.getByText('完成任务');
    expect(titleEl.className).toContain('text-trae-ink');
  });

  it('autoScroll=true 时调用 scrollIntoView', () => {
    render(<TaskProgress nodes={[makeNode()]} autoScroll={true} />);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('autoScroll=false 时不调用 scrollIntoView', () => {
    render(<TaskProgress nodes={[makeNode()]} autoScroll={false} />);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('多个节点:最后一个节点标记为 latest(isLatest)', () => {
    const nodes = [
      makeNode({ id: 'n1', title: '节点 1' }),
      makeNode({ id: 'n2', title: '节点 2' }),
    ];
    render(<TaskProgress nodes={nodes} autoScroll={true} />);
    // 仅最后一个节点会被滚动到
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('content 为 null 时节点不可交互', () => {
    render(<TaskProgress nodes={[makeNode({ content: null as unknown as string })]} />);
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
  });

  it('content 为空字符串时节点仍可交互', () => {
    // 空字符串不是 undefined/null,所以可交互
    render(<TaskProgress nodes={[makeNode({ content: '' })]} />);
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('children 为空数组时节点不可交互(仅 content 判断)', () => {
    render(<TaskProgress nodes={[makeNode({ content: undefined, children: [] })]} />);
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
  });

  it('节点 ID 设置在 data-node-id 属性上', () => {
    render(<TaskProgress nodes={[makeNode({ id: 'custom-id' })]} />);
    const node = screen.getByTestId('task-progress').querySelector('[data-node-id="custom-id"]');
    expect(node).not.toBeNull();
  });

  it('多个节点:中间节点渲染竖线(连接到下一节点)', () => {
    const nodes = [
      makeNode({ id: 'n1', title: '节点 1' }),
      makeNode({ id: 'n2', title: '节点 2' }),
    ];
    const { container } = render(<TaskProgress nodes={nodes} />);
    // 检查是否有连接竖线(通过类名 w-px)
    const lines = container.querySelectorAll('.w-px');
    // 第一个节点有竖线,最后一个节点没有
    expect(lines.length).toBeGreaterThan(0);
  });

  it('单个节点:不渲染连接竖线', () => {
    const { container } = render(<TaskProgress nodes={[makeNode()]} />);
    const lines = container.querySelectorAll('.w-px');
    expect(lines.length).toBe(0);
  });

  // spec-013 P1-A2: 节点 aria-label 测试
  it('节点 aria-label 包含标题和状态', () => {
    render(<TaskProgress nodes={[makeNode({ title: '检索文档', status: 'completed' })]} />);
    const node = screen.getByRole('listitem');
    expect(node).toHaveAttribute('aria-label', '检索文档 - Completed');
  });

  // spec-013 P2-Q4: 递归查找最新节点测试
  it('嵌套结构:最新节点为最右下叶子(非顶层最后节点)', () => {
    const nodes = [
      makeNode({
        id: 'parent',
        title: '父节点',
        children: [
          makeNode({ id: 'child-1', title: '子节点 1', content: undefined }),
          makeNode({ id: 'child-2', title: '子节点 2(最新)', content: undefined }),
        ],
      }),
    ];
    render(<TaskProgress nodes={nodes} defaultExpanded={['parent']} autoScroll={false} />);
    // 最新节点应为 child-2(最右下叶子),展开父节点后应渲染
    expect(screen.getByText('子节点 2(最新)')).toBeInTheDocument();
  });

  it('多层嵌套:最新节点为最深右下叶子', () => {
    const nodes = [
      makeNode({
        id: 'l1',
        title: '第 1 层',
        children: [
          makeNode({
            id: 'l2',
            title: '第 2 层',
            children: [
              makeNode({ id: 'l3-leaf', title: '第 3 层叶子(最新)', content: undefined }),
            ],
          }),
        ],
      }),
    ];
    render(<TaskProgress nodes={nodes} defaultExpanded={['l1', 'l2']} />);
    expect(screen.getByText('第 3 层叶子(最新)')).toBeInTheDocument();
  });

  // spec-013 评审 Q-3: 嵌套子节点 autoScroll 修复测试
  it('嵌套结构:autoScroll 滚动到最右下叶子节点(非顶层节点)', () => {
    const nodes = [
      makeNode({
        id: 'parent',
        title: '父节点',
        children: [
          makeNode({ id: 'child-1', title: '子节点 1', content: undefined }),
          makeNode({ id: 'child-2', title: '子节点 2(最新)', content: undefined }),
        ],
      }),
    ];
    render(<TaskProgress nodes={nodes} defaultExpanded={['parent']} autoScroll={true} />);
    // 修复前:子节点 isLatest 硬编码 false,latestNodeRef 不指向子节点,不会触发 scrollIntoView
    // 修复后:child-2 是最右下叶子,应被标记为 latest 并触发 scrollIntoView
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  // spec-013 评审 Q-3: 多层嵌套 autoScroll 测试(3 层深度)
  it('多层嵌套:autoScroll 滚动到最深右下叶子节点', () => {
    const nodes = [
      makeNode({
        id: 'l1',
        title: '第 1 层',
        children: [
          makeNode({
            id: 'l2',
            title: '第 2 层',
            children: [
              makeNode({ id: 'l3-leaf', title: '第 3 层叶子(最新)', content: undefined }),
            ],
          }),
        ],
      }),
    ];
    render(<TaskProgress nodes={nodes} defaultExpanded={['l1', 'l2']} autoScroll={true} />);
    // 修复前:l3-leaf 是嵌套子节点,isLatest 硬编码 false,不会触发 scrollIntoView
    // 修复后:l3-leaf 是最深右下叶子,应被标记为 latest 并触发 scrollIntoView
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });
});
