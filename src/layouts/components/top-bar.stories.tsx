// spec-013 P1-5: TopBar Storybook 故事
// 覆盖:Default/CustomLeft/CustomCenter/CustomRight/NotSticky

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { MemoryRouter } from 'react-router';
import { createElement } from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import { TopBar } from './top-bar';

/**
 * TopBar 默认右列使用 ThemeButton(useTheme) 与 Link(react-router),
 * 因此在 stories 中通过 decorator 注入 ThemeProvider + MemoryRouter,
 * 避免上下文缺失报错。
 */
const withProviders = (Story: () => React.ReactElement) =>
  createElement(
    ThemeProvider,
    null,
    createElement(MemoryRouter, null, createElement(Story)),
  );

const meta = {
  title: 'Layout/TopBar',
  component: TopBar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## TopBar

简化顶栏组件,用于替代 legacy Header。三列网格布局(左/中/右),支持毛玻璃背景与粘性定位。

特性:
- 三列网格布局 \`grid-cols-[1fr_auto_1fr]\`
- 毛玻璃背景 + 底部边框
- 默认渲染 Logo + ModeSwitcher + 用户操作区
- 各列支持自定义内容(left/center/right)
- 默认粘性 \`sticky top-0 z-50\`,可通过 \`sticky={false}\` 关闭
- 高度可通过 \`height\` prop 自定义(默认 56px)

> 注: legacy Header 已标记 \`@deprecated\`,新代码请使用 TopBar。
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    height: {
      control: 'number',
      description: '顶栏高度(数字按 px 处理,字符串原样应用)',
    },
    sticky: {
      control: 'boolean',
      description: '是否粘性定位(sticky top-0 z-50)',
    },
  },
  args: {
    height: 56,
    sticky: true,
  },
  decorators: [withProviders],
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomLeft: Story = {
  name: 'Custom Left',
  args: {
    left: (
      <div className="flex items-center gap-2 px-2">
        <span className="size-8 rounded-md bg-gradient-to-br from-trae-green to-blue-500" />
        <span className="font-semibold text-text-primary">自定义 Logo</span>
      </div>
    ),
  },
};

export const CustomCenter: Story = {
  name: 'Custom Center',
  args: {
    center: (
      <div className="rounded-md bg-trae-green/10 px-4 py-1.5 text-sm font-semibold text-trae-green">
        自定义中间内容
      </div>
    ),
  },
};

export const CustomRight: Story = {
  name: 'Custom Right',
  args: {
    right: (
      <div className="flex items-center gap-3 px-3 text-sm text-text-secondary">
        <span>自定义右侧</span>
        <button
          type="button"
          className="rounded-md bg-trae-green px-3 py-1 text-white"
        >
          登录
        </button>
      </div>
    ),
  },
};

export const NotSticky: Story = {
  name: 'Not Sticky',
  args: {
    sticky: false,
  },
};
