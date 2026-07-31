// spec-013 P1-3: ToolPanelHost Storybook 故事
// 覆盖:MultiplePanels/Accordion/Collapsed/SinglePanel/Empty

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';

import { ToolPanelHost } from './tool-panel-host';
import type { ToolPanelProps } from '@/components/trae-work';

const samplePanels: ToolPanelProps[] = [
  {
    id: 'panel-1',
    title: '知识库检索',
    icon: 'Search',
    children: <div className="py-2 text-sm">检索结果列表</div>,
  },
  {
    id: 'panel-2',
    title: '文件管理',
    icon: 'FileText',
    children: <div className="py-2 text-sm">文件列表</div>,
  },
  {
    id: 'panel-3',
    title: '大纲',
    icon: 'ListTree',
    children: <div className="py-2 text-sm">文档大纲</div>,
  },
];

const meta = {
  title: 'TRAE-Work/ToolPanelHost',
  component: ToolPanelHost,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## ToolPanelHost

工具面板容器,管理多个 ToolPanel 的展开/折叠状态。对应 TRAE Work 右侧工具面板容器风格。

特性:
- 支持受控/非受控展开状态
- 手风琴模式(同时只能展开一个面板)
- 整体折叠/展开(配合 ThreeColumnLayout 控制宽度过渡)
- 顶部标题栏 + 折叠按钮
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    title: {
      control: 'text',
      description: '顶部标题(默认 "工具")',
    },
    accordion: {
      control: 'boolean',
      description: '手风琴模式(同时只能展开一个面板)',
    },
    collapsed: {
      control: 'boolean',
      description: '折叠状态(折叠时隐藏整个面板)',
    },
  },
  args: {
    panels: samplePanels,
    title: '工具',
    accordion: false,
    collapsed: false,
    onExpandedChange: fn(),
    onCollapsedChange: fn(),
  },
} satisfies Meta<typeof ToolPanelHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultiplePanels: Story = {
  args: {
    defaultExpandedPanels: ['panel-1'],
  },
};

export const Accordion: Story = {
  args: {
    accordion: true,
    defaultExpandedPanels: ['panel-1'],
  },
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
  },
};

export const SinglePanel: Story = {
  args: {
    panels: [samplePanels[0]],
    defaultExpandedPanels: ['panel-1'],
  },
};

export const Empty: Story = {
  args: {
    panels: [],
  },
};
