// spec-013 P1-2: TaskSidebar Storybook 故事
// 覆盖:WithTasks/Empty/Loading/Collapsed/WithSearch/WithFilter

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';

import { TaskSidebar } from './task-sidebar';
import type { TaskCardProps } from '@/components/trae-work';

const sampleTasks: TaskCardProps[] = [
  {
    id: 'task-1',
    title: '分析数据集',
    description: '使用 kb-retrieve 工具检索并分析知识库内容',
    status: 'running',
    createdAt: '2026-07-30T10:00:00Z',
    currentStep: '调用工具: kb-retrieve',
    progress: 45,
  },
  {
    id: 'task-2',
    title: '生成报告',
    description: '已完成数据分析并生成 Markdown 报告',
    status: 'completed',
    createdAt: '2026-07-29T14:00:00Z',
    updatedAt: '2026-07-29T15:30:00Z',
  },
  {
    id: 'task-3',
    title: '导出 PDF',
    description: '导出失败:模板渲染超时',
    status: 'failed',
    createdAt: '2026-07-28T09:00:00Z',
  },
];

const meta = {
  title: 'TRAE-Work/TaskSidebar',
  component: TaskSidebar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## TaskSidebar

任务列表侧栏组件,用于 ThreeColumnLayout 左侧区域。
集成 TaskCard (compact 模式)展示任务列表,支持搜索/筛选/折叠/加载/空状态。

特性:
- 任务列表(TaskCard compact 模式)
- 搜索框(受控)
- 状态筛选器(6 个选项)
- 折叠模式(仅显示新建图标按钮)
- 加载骨架屏
- 空状态(默认/自定义)
- 顶部模式切换器插槽
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    filter: {
      control: 'select',
      options: ['all', 'running', 'completed', 'failed', 'cancelled', 'pending'],
    },
    collapsed: {
      control: 'boolean',
    },
    loading: {
      control: 'boolean',
    },
  },
  args: {
    tasks: sampleTasks,
    onTaskClick: fn(),
    onCreateTask: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, height: 600 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TaskSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTasks: Story = {
  args: {
    tasks: sampleTasks,
    selectedTaskId: 'task-1',
  },
};

export const Empty: Story = {
  args: {
    tasks: [],
  },
};

export const Loading: Story = {
  args: {
    tasks: [],
    loading: true,
  },
};

export const Collapsed: Story = {
  args: {
    tasks: sampleTasks,
    collapsed: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 56, height: 600 }}>
        <Story />
      </div>
    ),
  ],
};

export const WithSearch: Story = {
  args: {
    tasks: sampleTasks,
    searchQuery: '',
    onSearchChange: fn(),
  },
};

export const WithFilter: Story = {
  args: {
    tasks: sampleTasks,
    filter: 'all',
    onFilterChange: fn(),
  },
};
