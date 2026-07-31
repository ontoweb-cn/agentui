// spec-013 P1-1: ThreeColumnLayout Storybook 故事
// 对齐 components-api.md §3.1 Storybook 故事清单

import type { Meta, StoryObj } from '@storybook/react-webpack5';
import * as React from 'react';

import { ThreeColumnLayout } from './three-column-layout';

const SidebarContent: React.FC = () => (
  <div className="p-4">
    <h3 className="mb-3 text-sm font-semibold text-[var(--trae-ink)]">
      任务列表
    </h3>
    <ul className="space-y-1 text-sm text-[var(--trae-grey)]">
      <li className="cursor-pointer rounded p-2 hover:bg-[image:var(--trae-card-bg-hover)]">
        任务 1 - 进行中
      </li>
      <li className="cursor-pointer rounded p-2 hover:bg-[image:var(--trae-card-bg-hover)]">
        任务 2 - 已完成
      </li>
      <li className="cursor-pointer rounded p-2 hover:bg-[image:var(--trae-card-bg-hover)]">
        任务 3 - 失败
      </li>
    </ul>
  </div>
);

const MainContent: React.FC = () => (
  <div className="p-6">
    <h2 className="mb-4 text-lg font-semibold text-[var(--trae-ink)]">
      主区域
    </h2>
    <p className="text-sm text-[var(--trae-grey)]">
      主区域可放置对话、画布、编辑器等内容。min-w-0 防止溢出。
    </p>
  </div>
);

const ToolPanelContent: React.FC = () => (
  <div className="p-4">
    <h3 className="mb-3 text-sm font-semibold text-[var(--trae-ink)]">
      工具面板
    </h3>
    <p className="text-sm text-[var(--trae-grey)]">
      知识库检索、文件、设置等工具。
    </p>
  </div>
);

const TopBarContent: React.FC = () => (
  <div className="flex h-full items-center justify-between px-4">
    <span className="font-semibold text-[var(--trae-ink)]">Logo</span>
    <span className="text-sm text-[var(--trae-grey-2)]">用户菜单</span>
  </div>
);

const meta = {
  title: 'Layout/ThreeColumnLayout',
  component: ThreeColumnLayout,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## ThreeColumnLayout

三栏布局容器,替代 RootLayoutContainer。

- CSS Grid: \`[topbar] 56px [body] 1fr\` × \`[sidebar] auto [main] 1fr [toolpanel] auto\`
- 受控/非受控折叠(sidebar/toolPanel)
- 响应式断点: \`< 1024px\` 侧栏图标栏, \`< 768px\` 工具面板 overlay
- A11y: sidebar/toolPanel 为 \`role=complementary\`,main 为 \`role=main\`
        `,
      },
    },
  },
  args: {
    sidebar: <SidebarContent />,
    children: <MainContent />,
    toolPanel: <ToolPanelContent />,
    topBar: <TopBarContent />,
  },
} satisfies Meta<typeof ThreeColumnLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    sidebarCollapsed: false,
    toolPanelCollapsed: false,
  },
};

export const SidebarCollapsed: Story = {
  args: {
    sidebarCollapsed: true,
    toolPanelCollapsed: false,
  },
};

export const ToolPanelCollapsed: Story = {
  args: {
    sidebarCollapsed: false,
    toolPanelCollapsed: true,
  },
};

export const BothCollapsed: Story = {
  args: {
    sidebarCollapsed: true,
    toolPanelCollapsed: true,
  },
};

export const CustomWidths: Story = {
  args: {
    sidebarWidth: 320,
    toolPanelWidth: 400,
    sidebarCollapsed: false,
    toolPanelCollapsed: false,
  },
};

export const NoTopBar: Story = {
  args: {
    topBar: undefined,
    sidebarCollapsed: false,
    toolPanelCollapsed: false,
  },
};

export const Responsive: Story = {
  args: {
    sidebarCollapsed: false,
    toolPanelCollapsed: false,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story:
          '模拟移动端视口(<768px):sidebar 完全隐藏,toolPanel 切换为 overlay 模式(此处 toolPanelCollapsed=false 时应显示 backdrop)。',
      },
    },
  },
};
