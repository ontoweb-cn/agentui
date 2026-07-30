// spec-013 P0-7: TaskCard Storybook 故事
// 覆盖:Default/Completed/Failed/Cancelled/Pending/Compact/Selected/WithProgress

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';

import { TaskCard } from './task-card';
import type { TaskStatus } from './types';

const meta = {
  title: 'TRAE-Work/TaskCard',
  component: TaskCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## TaskCard

任务卡片组件,用于任务列表。对应 TRAE Work 任务卡片风格。

支持 5 种状态:
- **running**: 进行中(绿色 spinner)
- **completed**: 已完成(深绿圆点)
- **failed**: 失败(红色圆点 + 重试按钮)
- **cancelled**: 已取消(灰色圆点)
- **pending**: 待处理(灰色圆点)
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['running', 'completed', 'failed', 'cancelled', 'pending'] satisfies TaskStatus[],
    },
  },
  args: {
    id: 'task-1',
    title: '分析数据集',
    description: '使用 kb-retrieve 工具检索并分析知识库内容',
    status: 'running',
    createdAt: '2026-07-30T10:00:00Z',
    updatedAt: '2026-07-30T10:05:00Z',
    currentStep: '调用工具: kb-retrieve',
    progress: 45,
    onClick: fn(),
    onDelete: fn(),
    onRetry: fn(),
    selected: false,
    compact: false,
  },
} satisfies Meta<typeof TaskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: 'running',
    progress: 45,
  },
};

export const Completed: Story = {
  args: {
    status: 'completed',
    title: '生成报告',
    description: '已完成数据分析并生成 Markdown 报告',
    currentStep: undefined,
    progress: undefined,
  },
};

export const Failed: Story = {
  args: {
    status: 'failed',
    title: '导出 PDF',
    description: '导出失败:模板渲染超时',
    currentStep: undefined,
    progress: undefined,
  },
};

export const Cancelled: Story = {
  args: {
    status: 'cancelled',
    title: '索引重建',
    description: '用户手动取消',
    currentStep: undefined,
    progress: undefined,
  },
};

export const Pending: Story = {
  args: {
    status: 'pending',
    title: '定时清理',
    description: '等待调度',
    currentStep: undefined,
    progress: undefined,
  },
};

export const Compact: Story = {
  args: {
    compact: true,
    description: undefined,
    currentStep: undefined,
    progress: undefined,
  },
  parameters: {
    layout: 'centered',
  },
};

export const Selected: Story = {
  args: {
    selected: true,
    title: '当前选中任务',
  },
};

export const WithProgress: Story = {
  args: {
    status: 'running',
    title: '批量处理',
    description: '正在处理 128/256 条记录',
    currentStep: 'kb-retrieve (50% 完成)',
    progress: 50,
  },
};
