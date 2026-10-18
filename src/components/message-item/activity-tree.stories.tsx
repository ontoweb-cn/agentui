import type { Meta, StoryObj } from '@storybook/react-webpack5';

import { ActivityTree } from './activity-tree';

const meta = {
  title: 'Message/ActivityTree',
  component: ActivityTree,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityTree>;

export default meta;
type Story = StoryObj<typeof meta>;

const records = [
  {
    toolCallId: '1',
    toolName: 'kb-retrieve',
    status: 'completed' as const,
    startedAt: Date.now() - 5000,
    durationMs: 1200,
  },
  {
    toolCallId: '2',
    toolName: 'web-search',
    status: 'completed' as const,
    startedAt: Date.now() - 3000,
    durationMs: 800,
  },
];

export const Completed: Story = {
  args: { records, isStreaming: false },
};

export const Running: Story = {
  args: {
    records: [
      ...records,
      {
        toolCallId: '3',
        toolName: 'reasoning',
        status: 'running',
        startedAt: Date.now(),
      },
    ],
    isStreaming: true,
  },
};

export const Failed: Story = {
  args: {
    records: [
      records[0],
      {
        toolCallId: '3',
        toolName: 'broken-tool',
        status: 'failed',
        startedAt: Date.now(),
        durationMs: 300,
      },
    ],
    isStreaming: false,
  },
};

export const ManyTools: Story = {
  args: {
    records: Array.from({ length: 55 }, (_, index) => ({
      toolCallId: `tool-${index}`,
      toolName: `tool-${index}`,
      status: 'completed' as const,
      startedAt: Date.now() - index * 1000,
      durationMs: 100,
    })),
    isStreaming: false,
    defaultOpen: true,
  },
};
