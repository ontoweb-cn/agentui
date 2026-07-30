// spec-013 P0-7: ToolPanel Storybook 故事
// 覆盖:Default/Expanded/WithBadge/Loading/Empty/Disabled/WithActions/Controlled

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';
import { Button } from '@/components/ui/button';

import { ToolPanel } from './tool-panel';

const meta = {
  title: 'TRAE-Work/ToolPanel',
  component: ToolPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## ToolPanel

可折叠的工具面板项,用于右侧工具面板容器。对应 TRAE Work 右侧工具面板的子项风格。

特性:
- 头部(图标 + 标题 + actions + chevron)+ 内容区
- 展开/折叠受控/非受控
- 徽标数(badge)显示
- 加载/空状态/禁用
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    icon: {
      control: 'text',
      description: 'Lucide 图标名(如 "Search"、"FileText")',
    },
    badge: {
      control: 'number',
      description: '徽标数(>0 时显示,>99 显示 99+)',
    },
    disabled: {
      control: 'boolean',
    },
    loading: {
      control: 'boolean',
    },
    defaultExpanded: {
      control: 'boolean',
    },
  },
  args: {
    id: 'panel-1',
    title: '知识库检索',
    icon: 'Search',
    defaultExpanded: true,
    onExpandedChange: fn(),
    children: (
      <div className="space-y-2 py-2">
        <div className="rounded-trae-sm bg-[image:var(--trae-card-bg-hover)] px-3 py-2 text-trae-sm text-trae-ink">
          检索到 5 条相关文档
        </div>
        <div className="rounded-trae-sm bg-[image:var(--trae-card-bg-hover)] px-3 py-2 text-trae-sm text-trae-ink">
          总计 1.2KB
        </div>
      </div>
    ),
  },
} satisfies Meta<typeof ToolPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultExpanded: false,
  },
};

export const Expanded: Story = {
  args: {
    defaultExpanded: true,
  },
};

export const WithBadge: Story = {
  args: {
    defaultExpanded: false,
    badge: 5,
  },
};

export const WithLargeBadge: Story = {
  args: {
    defaultExpanded: false,
    badge: 150,
  },
};

export const Loading: Story = {
  args: {
    defaultExpanded: true,
    loading: true,
    children: undefined,
  },
};

export const Empty: Story = {
  args: {
    defaultExpanded: true,
    empty: '暂无数据',
    children: undefined,
  },
};

export const Disabled: Story = {
  args: {
    defaultExpanded: false,
    disabled: true,
    title: '禁用面板',
  },
};

export const WithActions: Story = {
  args: {
    defaultExpanded: true,
    title: '带操作按钮的面板',
    actions: <Button size="sm" variant="ghost">刷新</Button>,
  },
};

export const NoIcon: Story = {
  args: {
    defaultExpanded: false,
    icon: '',
    title: '无图标面板',
  },
};

export const InvalidIcon: Story = {
  args: {
    defaultExpanded: false,
    icon: 'NonExistentIcon',
    title: '无效图标面板',
  },
};

export const Controlled: Story = {
  args: {
    expanded: true,
    onExpandedChange: fn(),
  },
};
