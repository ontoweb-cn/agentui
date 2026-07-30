// spec-013 P0-7: TaskProgress Storybook 故事
// 覆盖:Single running/completed/Multiple/Nested/Error/AutoScroll

import type { Meta, StoryObj } from '@storybook/react-webpack5';

import { TaskProgress } from './task-progress';
import type { ProgressNode } from './types';

const meta = {
  title: 'TRAE-Work/TaskProgress',
  component: TaskProgress,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## TaskProgress

节点化进度展示组件,对应 TRAE Work 对话流中的工具调用节点。

特性:
- 节点间竖线连接,圆点显示状态色
- 支持嵌套子节点
- 展开/折叠受控/非受控
- 自动滚动到最新节点
        `,
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TaskProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseNode: ProgressNode = {
  id: 'n1',
  type: 'tool_call',
  title: '调用工具: kb-retrieve',
  status: 'completed',
  startedAt: '2026-07-30T10:00:00Z',
  endedAt: '2026-07-30T10:00:05Z',
  content: '检索到 5 条相关文档,共 1.2KB',
};

export const SingleRunning: Story = {
  args: {
    nodes: [
      {
        ...baseNode,
        id: 'r1',
        status: 'running',
        title: '调用工具: qa-pipeline',
        endedAt: undefined,
        content: '正在分析查询...',
      },
    ],
  },
};

export const SingleCompleted: Story = {
  args: {
    nodes: [baseNode],
  },
};

export const Multiple: Story = {
  args: {
    nodes: [
      baseNode,
      {
        id: 'n2',
        type: 'thinking',
        title: '分析检索结果',
        status: 'completed',
        startedAt: '2026-07-30T10:00:05Z',
        endedAt: '2026-07-30T10:00:08Z',
        content: '基于 5 条文档,识别出 3 个关键概念。',
      },
      {
        id: 'n3',
        type: 'tool_call',
        title: '调用工具: qa-pipeline',
        status: 'running',
        startedAt: '2026-07-30T10:00:08Z',
        endedAt: undefined,
        content: '正在生成答案...',
      },
    ],
  },
};

export const Nested: Story = {
  args: {
    nodes: [
      {
        ...baseNode,
        id: 'parent',
        title: '检索 + 生成',
        status: 'completed',
        children: [
          {
            id: 'child-1',
            type: 'tool_call',
            title: 'kb-retrieve',
            status: 'completed',
            startedAt: '2026-07-30T10:00:00Z',
            endedAt: '2026-07-30T10:00:03Z',
          },
          {
            id: 'child-2',
            type: 'tool_call',
            title: 'qa-pipeline',
            status: 'completed',
            startedAt: '2026-07-30T10:00:03Z',
            endedAt: '2026-07-30T10:00:05Z',
          },
        ],
      },
    ],
  },
};

export const ErrorNode: Story = {
  args: {
    nodes: [
      baseNode,
      {
        id: 'err1',
        type: 'error',
        title: '导出 PDF 失败',
        status: 'failed',
        startedAt: '2026-07-30T10:00:10Z',
        endedAt: '2026-07-30T10:00:12Z',
        content: 'Error: 模板渲染超时(30s)',
      },
    ],
  },
};

export const HiddenTimestamp: Story = {
  args: {
    showTimestamp: false,
    nodes: [baseNode],
  },
};
