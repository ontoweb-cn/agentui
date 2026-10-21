import type { Meta, StoryObj } from '@storybook/react-webpack5';

import { WorkspacePanel } from './workspace-panel';

const meta = {
  title: 'Chat/WorkspacePanel',
  component: WorkspacePanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[600px] justify-end bg-bg-base">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkspacePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    visible: true,
    onClose: () => {},
    messages: [],
  },
};
