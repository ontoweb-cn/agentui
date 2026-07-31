// spec-013 P1-2: TaskSidebar Jest 单元测试
// 覆盖:渲染任务列表/点击/选中态/搜索/筛选/折叠/加载/空状态/新建按钮

import { render, screen, fireEvent } from '@testing-library/react';

import { TaskSidebar } from './task-sidebar';
import type { TaskCardProps } from '@/components/trae-work';

// mock TaskCard 组件避免依赖其内部实现
jest.mock('@/components/trae-work', () => ({
  TaskCard: (props: any) => (
    <div
      data-testid="task-card"
      data-selected={props.selected}
      data-task-id={props.id}
      onClick={() => props.onClick?.(props.id)}
    >
      {props.title}
    </div>
  ),
}));

// mock react-i18next:返回 defaultValue(若存在),否则返回 key
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

function makeTasks(count = 3): TaskCardProps[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    title: `任务 ${i + 1}`,
    status: 'running' as const,
    createdAt: '2026-07-30T10:00:00Z',
  }));
}

describe('TaskSidebar', () => {
  it('渲染任务列表（传入 3 个 task）', () => {
    render(<TaskSidebar tasks={makeTasks(3)} />);
    expect(screen.getAllByTestId('task-card')).toHaveLength(3);
    expect(screen.getByText('任务 1')).toBeInTheDocument();
    expect(screen.getByText('任务 2')).toBeInTheDocument();
    expect(screen.getByText('任务 3')).toBeInTheDocument();
  });

  it('点击任务触发 onTaskClick', () => {
    const onTaskClick = jest.fn();
    render(<TaskSidebar tasks={makeTasks(3)} onTaskClick={onTaskClick} />);
    const cards = screen.getAllByTestId('task-card');
    fireEvent.click(cards[1]);
    expect(onTaskClick).toHaveBeenCalledWith('task-2');
  });

  it('选中态正确（selectedTaskId 匹配的 task 有 data-selected="true"）', () => {
    render(<TaskSidebar tasks={makeTasks(3)} selectedTaskId="task-2" />);
    const cards = screen.getAllByTestId('task-card');
    expect(cards[0]).toHaveAttribute('data-selected', 'false');
    expect(cards[1]).toHaveAttribute('data-selected', 'true');
    expect(cards[2]).toHaveAttribute('data-selected', 'false');
  });

  it('搜索框输入触发 onSearchChange', () => {
    const onSearchChange = jest.fn();
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        searchQuery=""
        onSearchChange={onSearchChange}
      />,
    );
    const input = screen.getByTestId('task-sidebar-search');
    fireEvent.change(input, { target: { value: '关键词' } });
    expect(onSearchChange).toHaveBeenCalledWith('关键词');
  });

  it('筛选器切换触发 onFilterChange', () => {
    const onFilterChange = jest.fn();
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        filter="all"
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByTestId('task-sidebar-filter-running'));
    expect(onFilterChange).toHaveBeenCalledWith('running');
  });

  it('筛选器渲染全部 6 个选项', () => {
    const onFilterChange = jest.fn();
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        filter="all"
        onFilterChange={onFilterChange}
      />,
    );
    expect(screen.getByTestId('task-sidebar-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('task-sidebar-filter-running')).toBeInTheDocument();
    expect(screen.getByTestId('task-sidebar-filter-completed')).toBeInTheDocument();
    expect(screen.getByTestId('task-sidebar-filter-failed')).toBeInTheDocument();
    expect(screen.getByTestId('task-sidebar-filter-cancelled')).toBeInTheDocument();
    expect(screen.getByTestId('task-sidebar-filter-pending')).toBeInTheDocument();
  });

  it('当前 filter 对应的筛选按钮 data-active="true"', () => {
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        filter="running"
        onFilterChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId('task-sidebar-filter-running')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByTestId('task-sidebar-filter-all')).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('折叠状态（collapsed=true 时仅显示新建按钮）', () => {
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        collapsed
        onCreateTask={jest.fn()}
        onSearchChange={jest.fn()}
        onFilterChange={jest.fn()}
      />,
    );
    // 新建按钮仍存在
    expect(screen.getByTestId('task-sidebar-create')).toBeInTheDocument();
    // 任务列表不渲染
    expect(screen.queryAllByTestId('task-card')).toHaveLength(0);
    // 搜索框不渲染
    expect(screen.queryByTestId('task-sidebar-search')).not.toBeInTheDocument();
    // 筛选器不渲染
    expect(screen.queryByTestId('task-sidebar-filter-all')).not.toBeInTheDocument();
    // data-collapsed="true"
    expect(screen.getByTestId('task-sidebar')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
  });

  it('加载状态（loading=true 时显示 skeleton）', () => {
    render(<TaskSidebar tasks={[]} loading />);
    expect(screen.getAllByTestId('task-sidebar-skeleton')).toHaveLength(3);
    // 不渲染任务卡片
    expect(screen.queryAllByTestId('task-card')).toHaveLength(0);
  });

  it('空状态（tasks=[] 时显示空状态文案）', () => {
    render(<TaskSidebar tasks={[]} />);
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
    expect(screen.queryAllByTestId('task-card')).toHaveLength(0);
  });

  it('新建按钮点击触发 onCreateTask', () => {
    const onCreateTask = jest.fn();
    render(<TaskSidebar tasks={makeTasks(3)} onCreateTask={onCreateTask} />);
    fireEvent.click(screen.getByTestId('task-sidebar-create'));
    expect(onCreateTask).toHaveBeenCalled();
  });

  it('自定义空状态内容覆盖默认文案', () => {
    render(
      <TaskSidebar
        tasks={[]}
        emptyState={<div data-testid="custom-empty">没有任务哦</div>}
      />,
    );
    expect(screen.getByTestId('custom-empty')).toBeInTheDocument();
    expect(screen.queryByText('暂无任务')).not.toBeInTheDocument();
  });

  it('modeSwitcher 渲染在顶部区域', () => {
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        modeSwitcher={<div data-testid="mode-switcher">Mode</div>}
      />,
    );
    expect(screen.getByTestId('mode-switcher')).toBeInTheDocument();
  });

  it('collapsed=true 时隐藏 modeSwitcher', () => {
    render(
      <TaskSidebar
        tasks={makeTasks(3)}
        collapsed
        modeSwitcher={<div data-testid="mode-switcher">Mode</div>}
        onCreateTask={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument();
  });

  it('无 onCreateTask 时不渲染新建按钮', () => {
    render(<TaskSidebar tasks={makeTasks(3)} />);
    expect(screen.queryByTestId('task-sidebar-create')).not.toBeInTheDocument();
  });

  it('无 onSearchChange 时不渲染搜索框', () => {
    render(<TaskSidebar tasks={makeTasks(3)} />);
    expect(screen.queryByTestId('task-sidebar-search')).not.toBeInTheDocument();
  });

  it('无 onFilterChange 时不渲染筛选器', () => {
    render(<TaskSidebar tasks={makeTasks(3)} />);
    expect(screen.queryByTestId('task-sidebar-filter-all')).not.toBeInTheDocument();
  });

  it('collapsed=true 且无 onCreateTask 时不渲染新建按钮', () => {
    render(<TaskSidebar tasks={makeTasks(3)} collapsed />);
    expect(screen.queryByTestId('task-sidebar-create')).not.toBeInTheDocument();
  });

  it('loading=true 优先于空状态(即使 tasks 为空也显示 skeleton)', () => {
    render(<TaskSidebar tasks={[]} loading />);
    expect(screen.getAllByTestId('task-sidebar-skeleton')).toHaveLength(3);
    expect(screen.queryByText('暂无任务')).not.toBeInTheDocument();
  });

  it('新建按钮有 aria-label', () => {
    render(<TaskSidebar tasks={makeTasks(3)} onCreateTask={jest.fn()} />);
    expect(screen.getByTestId('task-sidebar-create')).toHaveAttribute(
      'aria-label',
      '新建任务',
    );
  });

  it('collapsed 时新建按钮有 aria-label', () => {
    render(
      <TaskSidebar tasks={makeTasks(3)} collapsed onCreateTask={jest.fn()} />,
    );
    expect(screen.getByTestId('task-sidebar-create')).toHaveAttribute(
      'aria-label',
      '新建任务',
    );
  });
});
