// spec-013 P0-7: ModeSwitcher Storybook 故事
// 覆盖:Default/Code/Canvas/Small/Large/Disabled/NoLabels/CustomModes

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';

import { ModeSwitcher } from './mode-switcher';
import type { WorkMode } from './types';

const meta = {
  title: 'TRAE-Work/ModeSwitcher',
  component: ModeSwitcher,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## ModeSwitcher

三段式模式切换组件(Work/Code/Canvas)。对应 TRAE Work 顶部模式切换器风格。

特性:
- 三段式(Work/Code/Canvas),每段含图标 + 标签
- 受控组件(value + onChange)
- availableModes 控制可选模式
- 尺寸 sm/md/lg
- 键盘可访问(Enter/Space 触发)
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'select',
      options: ['work', 'code', 'canvas'] satisfies WorkMode[],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: {
      control: 'boolean',
    },
    showLabels: {
      control: 'boolean',
    },
  },
  args: {
    value: 'work',
    onChange: fn(),
  },
} satisfies Meta<typeof ModeSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'work',
    size: 'md',
  },
};

export const CodeActive: Story = {
  args: {
    value: 'code',
  },
};

export const CanvasActive: Story = {
  args: {
    value: 'canvas',
  },
};

export const Small: Story = {
  args: {
    value: 'work',
    size: 'sm',
  },
};

export const Large: Story = {
  args: {
    value: 'work',
    size: 'lg',
  },
};

export const Disabled: Story = {
  args: {
    value: 'work',
    disabled: true,
  },
};

export const NoLabels: Story = {
  args: {
    value: 'work',
    showLabels: false,
  },
};

export const CustomModes: Story = {
  args: {
    value: 'code',
    availableModes: ['work', 'code'],
  },
};

export const SingleMode: Story = {
  args: {
    value: 'work',
    availableModes: ['work'],
  },
};
