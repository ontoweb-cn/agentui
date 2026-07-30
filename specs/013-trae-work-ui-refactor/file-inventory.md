# 文件清单

> **版本**: v1.0 (2026-07-30)
> **状态**: 权威清单,实施时按此创建/修改

---

## 一、阶段 0:设计系统对齐

### 1.1 新增文件(19 个)

#### 1.1.1 基础组件(4 个)

| 路径 | 用途 | API 文档 |
|------|------|---------|
| `src/components/trae-work/task-card.tsx` | 任务卡片组件 | [components-api.md §2.1](./components-api.md#21-taskcard) |
| `src/components/trae-work/task-progress.tsx` | 任务进度组件 | [components-api.md §2.2](./components-api.md#22-taskprogress) |
| `src/components/trae-work/tool-panel.tsx` | 工具面板组件 | [components-api.md §2.3](./components-api.md#23-toolpanel) |
| `src/components/trae-work/mode-switcher.tsx` | 模式切换组件 | [components-api.md §2.4](./components-api.md#24-modeswitcher) |

#### 1.1.2 组件 re-export(1 个)

| 路径 | 用途 |
|------|------|
| `src/components/trae-work/index.ts` | 统一 re-export 4 个基础组件 |

#### 1.1.3 Storybook 故事(4 个)

| 路径 | 用途 |
|------|------|
| `src/components/trae-work/task-card.stories.tsx` | TaskCard 故事 |
| `src/components/trae-work/task-progress.stories.tsx` | TaskProgress 故事 |
| `src/components/trae-work/tool-panel.stories.tsx` | ToolPanel 故事 |
| `src/components/trae-work/mode-switcher.stories.tsx` | ModeSwitcher 故事 |

#### 1.1.4 Jest 单测(4 个)

| 路径 | 用途 |
|------|------|
| `src/components/trae-work/task-card.test.tsx` | TaskCard 单测 |
| `src/components/trae-work/task-progress.test.tsx` | TaskProgress 单测 |
| `src/components/trae-work/tool-panel.test.tsx` | ToolPanel 单测 |
| `src/components/trae-work/mode-switcher.test.tsx` | ModeSwitcher 单测 |

#### 1.1.5 类型定义(2 个)

| 路径 | 用途 |
|------|------|
| `src/components/trae-work/types.ts` | 共享类型(TaskStatus, ProgressNode, WorkMode 等) |
| `src/components/trae-work/constants.ts` | 常量(状态色映射、图标映射等) |

#### 1.1.6 字体资源(2 个 — 通过 npm 包引入)

| 路径 | 用途 |
|------|------|
| `node_modules/@fontsource/outfit/` | Outfit 字体(npm install) |
| `node_modules/@fontsource/jetbrains-mono/` | JetBrains Mono 字体(npm install) |

> 实际不新增文件到仓库,通过 `package.json` 依赖管理。

### 1.2 修改文件(5 个)

| 路径 | 改动类型 | 改动说明 |
|------|---------|---------|
| `src/less/variable.less` | **重大修改** | 引入 TRAE Work CSS 变量(权威源),旧 Less 变量标记 `@deprecated` 但保留 |
| `tailwind.config.js` | **扩展** | `extend.colors` 新增 `trae` 命名空间,映射新 Token;`extend.fontSize/borderRadius/boxShadow` 等同步扩展 |
| `src/global.less` | **小修改** | 引入 `@fontsource/outfit` 和 `@fontsource/jetbrains-mono` 的 CSS |
| `package.json` | **小修改** | 新增 `@fontsource/outfit` 和 `@fontsource/jetbrains-mono` 依赖 |
| `.storybook/main.ts` | **小修改** | 确保 `src/components/trae-work/**/*.stories.tsx` 被 Storybook 识别(通常默认 glob 已覆盖) |

### 1.3 删除文件

无。

---

## 二、阶段 1:三栏任务中心布局

### 2.1 新增文件(13 个)

#### 2.1.1 布局组件(4 个)

| 路径 | 用途 | API 文档 |
|------|------|---------|
| `src/layouts/three-column-layout.tsx` | 三栏布局容器 | [components-api.md §3.1](./components-api.md#31-threecolumnlayout) |
| `src/layouts/components/task-sidebar.tsx` | 左侧任务栏 | [components-api.md §3.2](./components-api.md#32-tasksidebar) |
| `src/layouts/components/tool-panel-host.tsx` | 右侧工具面板容器 | [components-api.md §3.3](./components-api.md#33-toolpanelhost) |
| `src/layouts/components/top-bar.tsx` | 顶栏 | [components-api.md §3.4](./components-api.md#34-topbar) |

#### 2.1.2 Feature Flag Hook(1 个)

| 路径 | 用途 |
|------|------|
| `src/hooks/use-layout-mode.ts` | 读取/写入 `localStorage.trae_work_layout`,控制布局切换 |

#### 2.1.3 Storybook 故事(4 个)

| 路径 | 用途 |
|------|------|
| `src/layouts/three-column-layout.stories.tsx` | ThreeColumnLayout 故事 |
| `src/layouts/components/task-sidebar.stories.tsx` | TaskSidebar 故事 |
| `src/layouts/components/tool-panel-host.stories.tsx` | ToolPanelHost 故事 |
| `src/layouts/components/top-bar.stories.tsx` | TopBar 故事 |

#### 2.1.4 Jest 单测(4 个)

| 路径 | 用途 |
|------|------|
| `src/layouts/three-column-layout.test.tsx` | ThreeColumnLayout 单测 |
| `src/layouts/components/task-sidebar.test.tsx` | TaskSidebar 单测 |
| `src/layouts/components/tool-panel-host.test.tsx` | ToolPanelHost 单测 |
| `src/layouts/components/top-bar.test.tsx` | TopBar 单测 |

### 2.2 修改文件(4 个)

| 路径 | 改动类型 | 改动说明 |
|------|---------|---------|
| `src/layouts/root-layout.tsx` | **重构** | 根据 feature flag 切换 `ThreeColumnLayout` 或旧 `RootLayoutContainer`;默认 `three-column` |
| `src/layouts/components/header.tsx` | **保留但标记 @deprecated** | 旧 Header 保留,仅 `legacy` 模式使用;新代码用 `TopBar` |
| `src/app.tsx` | **小修改** | 注入 `TaskSidebar` 和 `ToolPanelHost` 的数据源 Provider(如需全局共享任务列表) |
| `src/routes/index.ts` 或 `src/routes.tsx` | **小修改** | 确保路由 layout 使用新的 `RootLayout`(内含 feature flag 切换) |

### 2.3 适配文件(3 个 — 仅布局适配,不改业务逻辑)

| 路径 | 改动类型 | 改动说明 |
|------|---------|---------|
| `src/pages/next-chats/chat/index.tsx` | **布局适配** | 移除内部 `RootLayoutContainer` 包裹,改为直接输出内容(由 `ThreeColumnLayout` 的 `children` 承载) |
| `src/pages/home/index.tsx` | **布局适配** | Home 页面适配三栏布局,任务列表移至 `TaskSidebar` |
| `src/pages/agents/index.tsx` | **布局适配** | Agents 页面适配三栏布局 |

### 2.4 删除文件

无(旧 Header 保留,过渡期使用)。

---

## 三、完整文件树

```
agentui/
├── src/
│   ├── components/
│   │   └── trae-work/                    # [新增] 阶段 0 基础组件
│   │       ├── task-card.tsx             # [新增]
│   │       ├── task-card.stories.tsx     # [新增]
│   │       ├── task-card.test.tsx        # [新增]
│   │       ├── task-progress.tsx         # [新增]
│   │       ├── task-progress.stories.tsx # [新增]
│   │       ├── task-progress.test.tsx    # [新增]
│   │       ├── tool-panel.tsx            # [新增]
│   │       ├── tool-panel.stories.tsx    # [新增]
│   │       ├── tool-panel.test.tsx       # [新增]
│   │       ├── mode-switcher.tsx         # [新增]
│   │       ├── mode-switcher.stories.tsx # [新增]
│   │       ├── mode-switcher.test.tsx    # [新增]
│   │       ├── types.ts                  # [新增] 共享类型
│   │       ├── constants.ts              # [新增] 常量
│   │       └── index.ts                  # [新增] re-export
│   ├── layouts/
│   │   ├── three-column-layout.tsx       # [新增] 阶段 1 三栏布局
│   │   ├── three-column-layout.stories.tsx # [新增]
│   │   ├── three-column-layout.test.tsx  # [新增]
│   │   ├── root-layout.tsx               # [修改] 集成 feature flag
│   │   └── components/
│   │       ├── header.tsx                # [修改] 标记 @deprecated
│   │       ├── top-bar.tsx               # [新增]
│   │       ├── top-bar.stories.tsx       # [新增]
│   │       ├── top-bar.test.tsx          # [新增]
│   │       ├── task-sidebar.tsx          # [新增]
│   │       ├── task-sidebar.stories.tsx  # [新增]
│   │       ├── task-sidebar.test.tsx     # [新增]
│   │       ├── tool-panel-host.tsx       # [新增]
│   │       ├── tool-panel-host.stories.tsx # [新增]
│   │       └── tool-panel-host.test.tsx  # [新增]
│   ├── hooks/
│   │   └── use-layout-mode.ts            # [新增] feature flag hook
│   ├── less/
│   │   └── variable.less                 # [修改] 引入 TRAE Work Token
│   ├── pages/
│   │   ├── home/index.tsx                # [修改] 布局适配
│   │   ├── agents/index.tsx              # [修改] 布局适配
│   │   └── next-chats/chat/index.tsx     # [修改] 布局适配
│   ├── app.tsx                           # [修改] Provider 调整
│   └── global.less                       # [修改] 字体引入
├── tailwind.config.js                    # [修改] Token 映射
├── package.json                          # [修改] 字体依赖
└── .storybook/main.ts                    # [修改] 确保 glob 覆盖
```

---

## 四、文件统计

| 阶段 | 新增 | 修改 | 删除 | 总计 |
|------|------|------|------|------|
| 阶段 0 | 17(含 4 组件 + 4 故事 + 4 单测 + 2 类型 + 2 字体包) | 5 | 0 | 22 |
| 阶段 1 | 13(含 4 布局 + 1 hook + 4 故事 + 4 单测) | 7(含 3 适配) | 0 | 20 |
| **合计** | **30** | **12** | **0** | **42** |

> **注**: 字体包通过 npm 引入,不计入仓库文件数。

---

## 五、不修改的关键文件(契约边界)

以下文件**不修改**,确保重构不破坏现有契约:

| 路径 | 不修改理由 |
|------|-----------|
| `bff/**` | BFF API 契约不变 |
| `src/components/ui/**` | shadcn 基础组件不变(仅 token 引用层变化) |
| `src/components/message-item/**` | 阶段 1 不改,阶段 3 改造 |
| `src/types/**` | 业务类型不变 |
| `src/hooks/use-send-message.ts` | 聊天逻辑不变 |
| `src/interfaces/**` | 接口定义不变 |
| `packages/canvas-plugin/**` | 画布插件不变 |

---

## 六、验收清单

- [ ] 阶段 0 新增 17 个文件全部创建
- [ ] 阶段 0 修改 5 个文件全部完成
- [ ] 阶段 1 新增 13 个文件全部创建
- [ ] 阶段 1 修改 7 个文件全部完成
- [ ] 不修改文件清单中的文件未被触碰
- [ ] 文件树与本文档一致
