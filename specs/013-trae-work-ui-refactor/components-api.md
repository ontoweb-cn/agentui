# 组件 API 定义

> **版本**: v1.0 (2026-07-30)
> **状态**: 设计完成,待实施
> **依赖**: [Design Token](./design-tokens.md)

---

## 一、组件清单

### 阶段 0 组件(基础组件)

| 组件 | 路径 | 用途 |
|------|------|------|
| `TaskCard` | `src/components/trae-work/task-card.tsx` | 任务卡片(展示单个任务) |
| `TaskProgress` | `src/components/trae-work/task-progress.tsx` | 任务进度(节点化进度) |
| `ToolPanel` | `src/components/trae-work/tool-panel.tsx` | 工具面板(可折叠面板项) |
| `ModeSwitcher` | `src/components/trae-work/mode-switcher.tsx` | 模式切换(三段式) |

### 阶段 1 组件(布局组件)

| 组件 | 路径 | 用途 |
|------|------|------|
| `ThreeColumnLayout` | `src/layouts/three-column-layout.tsx` | 三栏布局容器 |
| `TaskSidebar` | `src/layouts/components/task-sidebar.tsx` | 左侧任务栏 |
| `ToolPanelHost` | `src/layouts/components/tool-panel-host.tsx` | 右侧工具面板容器 |
| `TopBar` | `src/layouts/components/top-bar.tsx` | 顶栏(替代 Header) |

---

## 二、阶段 0:基础组件 API

### 2.1 TaskCard

**用途**: 展示单个任务卡片,用于任务列表。对应 TRAE Work 任务卡片风格。

```typescript
// src/components/trae-work/task-card.tsx

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'pending';

export interface TaskCardProps {
  /** 任务 ID */
  id: string;
  /** 任务标题 */
  title: string;
  /** 任务描述(可选) */
  description?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 更新时间 ISO 8601(可选) */
  updatedAt?: string;
  /** 当前步骤(可选,如 "调用工具: kb-retrieve") */
  currentStep?: string;
  /** 进度百分比 0-100(可选) */
  progress?: number;
  /** 点击回调 */
  onClick?: (id: string) => void;
  /** 删除回调(可选) */
  onDelete?: (id: string) => void;
  /** 重试回调(可选,仅 failed 状态显示) */
  onRetry?: (id: string) => void;
  /** 选中状态 */
  selected?: boolean;
  /** 紧凑模式(可选,侧栏列表用) */
  compact?: boolean;
}
```

**视觉规范**:
- 边框: `1px solid var(--trae-line)`,悬停 `var(--trae-line-strong)`
- 圆角: `var(--trae-radius-xl)` (12px)
- 内边距: `18px 22px`
- 悬停: `transform: translateY(-2px)`,背景 `var(--trae-card-bg-hover)`
- 选中: 左侧 `2px solid var(--trae-green)`
- 状态色:
  - running: `var(--trae-green)` + spinner
  - completed: `var(--trae-green-dim)`
  - failed: `#ef4444` (红)
  - cancelled: `var(--trae-grey-2)`
  - pending: `var(--trae-grey-2)`

**Storybook 故事**:
- Default (running)
- Completed
- Failed (with retry button)
- Cancelled
- Pending
- Compact mode
- Selected
- With progress bar

---

### 2.2 TaskProgress

**用途**: 节点化进度展示,对应 TRAE Work 对话流中的工具调用节点。

```typescript
// src/components/trae-work/task-progress.tsx

export type ProgressNodeType = 'tool_call' | 'thinking' | 'artifact' | 'error';

// 注: 实现中提取为类型别名(见 types.ts),语义与内联联合类型一致
export type ProgressNodeStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface ProgressNode {
  /** 节点 ID */
  id: string;
  /** 节点类型 */
  type: ProgressNodeType;
  /** 节点标题(如 "调用工具: kb-retrieve") */
  title: string;
  /** 节点状态 */
  status: ProgressNodeStatus;
  /** 开始时间 ISO 8601(可选) */
  startedAt?: string;
  /** 结束时间 ISO 8601(可选) */
  endedAt?: string;
  /** 节点内容(可选,展开后显示) */
  content?: React.ReactNode;
  /** 子节点(可选,支持嵌套) */
  children?: ProgressNode[];
}

export interface TaskProgressProps {
  /** 进度节点列表 */
  nodes: ProgressNode[];
  /** 默认展开的节点 ID 列表(可选) */
  defaultExpanded?: string[];
  /** 受控展开(可选) */
  expanded?: string[];
  /** 展开/折叠回调(可选) */
  onExpandedChange?: (expanded: string[]) => void;
  /** 显示时间戳(可选,默认 true) */
  showTimestamp?: boolean;
  /** 自动滚动到最新节点(可选,默认 true) */
  autoScroll?: boolean;
}
```

**视觉规范**:
- 节点间用 `1px solid var(--trae-line)` 竖线连接
- 节点圆点: `4px solid var(--trae-grey)`,完成 `var(--trae-green)`
- 标题: `var(--trae-text-sm)` + `var(--trae-font-semibold)`
- 内容区: 折叠时隐藏,展开时显示(带左侧缩进 `var(--trae-space-4)`)
- 错误节点: 圆点 `#ef4444`,标题红色
- 时间戳: `var(--trae-text-xs)` + `var(--trae-grey-2)` + `var(--trae-font-mono)`

**Storybook 故事**:
- Single running node
- Single completed node
- Multiple nodes (mixed status)
- Nested nodes
- Error node with content
- Auto-scroll behavior

---

### 2.3 ToolPanel

**用途**: 可折叠的工具面板项,用于右侧工具面板容器内。每个 ToolPanel 展示一个工具(会话/文档/画布/终端)。

```typescript
// src/components/trae-work/tool-panel.tsx

export interface ToolPanelProps {
  /** 面板 ID */
  id: string;
  /** 面板标题(如 "会话", "文档", "画布") */
  title: string;
  /** 面板图标(Lucide icon name) */
  icon: string;
  /** 面板内容 */
  children: React.ReactNode;
  /** 默认展开(可选,默认 false) */
  defaultExpanded?: boolean;
  /** 受控展开(可选) */
  expanded?: boolean;
  /** 展开/折叠回调(可选) */
  onExpandedChange?: (expanded: boolean) => void;
  /** 面板头部右侧附加内容(可选,如操作按钮) */
  actions?: React.ReactNode;
  /** 加载状态(可选) */
  loading?: boolean;
  /** 空状态(可选) */
  empty?: React.ReactNode;
  /** 禁用(可选) */
  disabled?: boolean;
  /** 徽标数(可选,如未读消息数) */
  badge?: number;
}
```

**视觉规范**:
- 头部: 高度 `40px`,内边距 `0 var(--trae-space-4)`
- 标题: `var(--trae-text-sm-2)` + `var(--trae-font-semibold)` + `var(--trae-tracking-wide)`
- 图标: `16px`,颜色 `var(--trae-grey)`
- 展开/折叠: chevron 旋转 180deg
- 内容区: 展开时 `max-height: auto`,折叠时 `max-height: 0; overflow: hidden`
- 过渡: `var(--trae-transition-base)`
- 边框: 底部 `1px solid var(--trae-line)`
- 徽标: `var(--trae-green-bright)` 背景, `#000` 文字, `var(--trae-radius-full)` 圆角

**Storybook 故事**:
- Default collapsed
- Default expanded
- With loading
- With empty state
- With actions
- With badge
- Disabled

---

### 2.4 ModeSwitcher

**用途**: 三段式模式切换(Work/Code/Canvas),阶段 0 仅 UI 壳,阶段 2 接入实际逻辑。

```typescript
// src/components/trae-work/mode-switcher.tsx

export type WorkMode = 'work' | 'code' | 'canvas';

export interface ModeSwitcherProps {
  /** 当前模式(受控) */
  value: WorkMode;
  /** 模式切换回调 */
  onChange: (mode: WorkMode) => void;
  /** 可用模式(可选,默认全部) */
  availableModes?: WorkMode[];
  /** 尺寸(可选) */
  size?: 'sm' | 'md' | 'lg';
  /** 禁用(可选) */
  disabled?: boolean;
  /** 显示标签(可选,默认 true) */
  showLabels?: boolean;
}
```

**视觉规范**:
- 容器: `inline-flex`,背景 `var(--trae-card-bg-hover)`,圆角 `var(--trae-radius-md)`
- 选项: 内边距 `var(--trae-space-2) var(--trae-space-4)`,圆角 `var(--trae-radius-sm)`
- 激活: 背景 `var(--trae-green-bright)`,文字 `#000`
- 非激活: 文字 `var(--trae-grey)`,悬停 `var(--trae-green)`
- 图标: `14px`(Work=FileText, Code=Code2, Canvas=LayoutGrid)
- 过渡: `var(--trae-transition-base)`

**Storybook 故事**:
- Default (work selected)
- Code selected
- Canvas selected
- Disabled
- Hidden canvas mode (availableModes=['work','code'])
- Small size
- No labels (icons only)

---

## 三、阶段 1:布局组件 API

### 3.1 ThreeColumnLayout

**用途**: 三栏布局容器,替代当前 `RootLayoutContainer`。

```typescript
// src/layouts/three-column-layout.tsx

export interface ThreeColumnLayoutProps {
  /** 左侧栏内容(任务列表) */
  sidebar?: React.ReactNode;
  /** 主区域内容 */
  children: React.ReactNode;
  /** 右侧工具面板内容(可选) */
  toolPanel?: React.ReactNode;
  /** 顶栏内容(可选,默认渲染 TopBar) */
  topBar?: React.ReactNode;
  /** 左侧栏宽度(可选,默认 280px) */
  sidebarWidth?: number | string;
  /** 右侧面板宽度(可选,默认 360px) */
  toolPanelWidth?: number | string;
  /** 左侧栏是否可折叠(可选,默认 true) */
  sidebarCollapsible?: boolean;
  /** 右侧面板是否可折叠(可选,默认 true) */
  toolPanelCollapsible?: boolean;
  /** 左侧栏默认折叠(可选,默认 false) */
  defaultSidebarCollapsed?: boolean;
  /** 右侧面板默认折叠(可选,默认 true) */
  defaultToolPanelCollapsed?: boolean;
  /** 受控:左侧栏折叠状态(可选) */
  sidebarCollapsed?: boolean;
  /** 受控:右侧面板折叠状态(可选) */
  toolPanelCollapsed?: boolean;
  /** 折叠状态变更回调(可选) */
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /** 折叠状态变更回调(可选) */
  onToolPanelCollapsedChange?: (collapsed: boolean) => void;
}
```

**视觉规范**:
- 整体: `grid-template-columns: [sidebar] [main] [toolpanel]`,高度 `100vh`
- 顶栏: 高度 `56px`,毛玻璃 `backdrop-filter: var(--trae-blur-nav)`,背景 `var(--trae-nav-bg)`
- 左侧栏: 背景 `var(--trae-surface)`,右边框 `1px solid var(--trae-line)`
- 主区: `flex: 1`,最小宽度 `0`(防溢出)
- 右侧面板: 背景 `var(--trae-surface)`,左边框 `1px solid var(--trae-line)`
- 折叠动画: `width` 过渡 `var(--trae-transition-base)`

**响应式断点**:
- `< 1024px`: 左侧栏自动折叠为图标栏(宽度 56px)
- `< 768px`: 右侧面板隐藏,需手动展开(overlay 模式)

**Storybook 故事**:
- Default (all visible)
- Sidebar collapsed
- Tool panel collapsed
- Both collapsed
- Custom widths
- Responsive (mobile)

---

### 3.2 TaskSidebar

**用途**: 左侧任务列表,展示所有任务(会话),对应 TRAE Work 任务驱动范式。

```typescript
// src/layouts/components/task-sidebar.tsx

export interface TaskSidebarProps {
  /** 任务列表 */
  tasks: TaskCardProps[];
  /** 当前选中任务 ID */
  selectedTaskId?: string;
  /** 任务点击回调 */
  onTaskClick?: (id: string) => void;
  /** 新建任务回调(可选) */
  onCreateTask?: () => void;
  /** 搜索关键词(可选,受控) */
  searchQuery?: string;
  /** 搜索回调(可选) */
  onSearchChange?: (query: string) => void;
  /** 筛选状态(可选) */
  filter?: TaskStatus | 'all';
  /** 筛选回调(可选) */
  onFilterChange?: (filter: TaskStatus | 'all') => void;
  /** 顶部模式切换器(可选) */
  modeSwitcher?: React.ReactNode;
  /** 加载状态(可选) */
  loading?: boolean;
  /** 空状态内容(可选) */
  emptyState?: React.ReactNode;
  /** 折叠状态(可选,折叠时仅显示图标) */
  collapsed?: boolean;
}
```

**视觉规范**:
- 宽度: 280px(展开), 56px(折叠)
- 搜索框: 高度 `32px`,圆角 `var(--trae-radius-md)`
- 任务列表: 可滚动,`overflow-y: auto`
- 任务卡片间距: `var(--trae-space-2)`
- 新建按钮: 顶部,`var(--trae-green-bright)` 背景
- 折叠时: 仅显示模式切换器图标 + 新建图标

**Storybook 故事**:
- With tasks
- Empty state
- Loading
- Collapsed
- With search
- With filter

---

### 3.3 ToolPanelHost

**用途**: 右侧工具面板容器,包含多个可折叠的 ToolPanel。

```typescript
// src/layouts/components/tool-panel-host.tsx

export interface ToolPanelHostProps {
  /** 工具面板列表 */
  panels: ToolPanelProps[];
  /** 默认展开的面板 ID 列表(可选) */
  defaultExpandedPanels?: string[];
  /** 受控展开(可选) */
  expandedPanels?: string[];
  /** 展开变更回调(可选) */
  onExpandedChange?: (panelIds: string[]) => void;
  /** 手风琴模式(可选,默认 false,同时只能展开一个) */
  accordion?: boolean;
  /** 顶部标题(可选) */
  title?: string;
  /** 折叠状态(可选,折叠时隐藏整个面板) */
  collapsed?: boolean;
  /** 折叠回调(可选) */
  onCollapsedChange?: (collapsed: boolean) => void;
}
```

**视觉规范**:
- 宽度: 360px(展开), 0(折叠,overflow hidden)
- 顶部标题: 高度 `40px`,`var(--trae-text-sm-2)` + `var(--trae-font-semibold)`
- 面板列表: 可滚动,`overflow-y: auto`
- 折叠按钮: 右上角 chevron

**Storybook 故事**:
- With multiple panels
- Accordion mode
- Collapsed
- Single panel

---

### 3.4 TopBar

**用途**: 简化顶栏,替代当前 Header。仅保留 Logo + 模式切换 + 用户菜单。

```typescript
// src/layouts/components/top-bar.tsx

export interface TopBarProps {
  /** 左侧内容(可选,默认 Logo) */
  left?: React.ReactNode;
  /** 中间内容(可选,默认 ModeSwitcher) */
  center?: React.ReactNode;
  /** 右侧内容(可选,默认用户菜单) */
  right?: React.ReactNode;
  /** 高度(可选,默认 56px) */
  height?: number | string;
  /** 是否粘性(可选,默认 true) */
  sticky?: boolean;
}
```

**视觉规范**:
- 高度: 56px
- 背景: `var(--trae-nav-bg)` + `backdrop-filter: var(--trae-blur-nav)`
- 底部边框: `1px solid var(--trae-line)`
- 布局: `grid-template-columns: 1fr auto 1fr`
- Logo: 高度 `32px`
- 用户头像: `32px` 圆形

**Storybook 故事**:
- Default
- Custom left
- Custom center
- Custom right
- Not sticky

---

## 四、组件依赖关系

```
ThreeColumnLayout
├── TopBar (顶部)
│   └── ModeSwitcher (中间)
├── TaskSidebar (左侧)
│   ├── ModeSwitcher (顶部,折叠时)
│   └── TaskCard[] (列表)
└── ToolPanelHost (右侧)
    └── ToolPanel[] (多个)
```

**数据流**:
- `TaskSidebar` 通过 props 接收任务列表(父组件管理数据)
- `ToolPanelHost` 通过 props 接收面板配置(父组件管理状态)
- `ModeSwitcher` 受控组件,由父组件管理当前模式

---

## 五、与现有组件的关系

### 5.1 复用现有组件

| 新组件 | 复用的现有组件 |
|--------|---------------|
| TaskCard | [IntellectAvatar](../../src/components/intellect-avatar.tsx), [Button](../../src/components/ui/button.tsx) |
| TaskProgress | [Collapsible](../../src/components/ui/collapsible.tsx) |
| ToolPanel | [Collapsible](../../src/components/ui/collapsible.tsx), [Badge](../../src/components/ui/badge.tsx) |
| ModeSwitcher | **自实现**(不使用 Segmented,见下文决策记录) |
| TopBar | [IntellectAvatar](../../src/components/intellect-avatar.tsx), [DropdownMenu](../../src/components/ui/dropdown-menu.tsx) |

#### ModeSwitcher 决策记录(2026-07-30 P0-6 实施时确认)

经核查 [Segmented](../../src/components/ui/segmented.tsx) 组件存在,但 **不采用** 改造方案,改为自实现。原因:

1. Segmented 基于 CSS Anchor Positioning,浏览器兼容性受限
2. Segmented 不支持"图标 + 标签"组合渲染,需大幅改造
3. ModeSwitcher 三段式语义固定(Work/Code/Canvas),复用 Segmented 的泛化抽象收益低

自实现方案见 [mode-switcher.tsx](../../src/components/trae-work/mode-switcher.tsx),通过 `role="radiogroup"` + `role="radio"` 保证可访问性,通过 `data-active` 属性控制激活态样式。

### 5.2 不修改的现有组件

- `src/components/ui/**` — shadcn 基础组件不变
- `src/components/message-item/**` — 阶段 1 不改,阶段 3 改造
- `src/pages/**` — 阶段 1 仅适配布局,不改业务逻辑

---

## 六、验收清单

- [ ] 4 个基础组件(TaskCard/TaskProgress/ToolPanel/ModeSwitcher)API 实现完整
- [ ] 4 个布局组件(ThreeColumnLayout/TaskSidebar/ToolPanelHost/TopBar)API 实现完整
- [ ] 所有组件有 Storybook 故事
- [ ] 所有组件有 Jest 单测(覆盖率 ≥ 80%)
- [ ] 组件使用 TRAE Work Token(不硬编码颜色/间距)
- [ ] Light/Dark 主题切换正常
