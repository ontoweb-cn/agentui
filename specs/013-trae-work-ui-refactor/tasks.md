# spec-013 任务分解

> **版本**: v1.1 (2026-07-30)
> **状态**: Phase 0 已完成,Phase 1 待实施
> **依赖**: spec-013 spec.md / design-tokens.md / components-api.md / file-inventory.md
> **执行顺序**: P0-1 → P0-2 → P0-3~P0-6(并行) → P0-7 → P0-8 → P1-1~P1-3(并行) → P1-4~P1-5 → P1-6 → P1-7 → P1-8 → P1-9
> **验收原则**: 现有页面 0 回归 + Storybook 故事完整 + Jest 单测覆盖率 ≥ 80%
> **基线**: BFF 687 tests passed (2026-07-30)

---

## Phase 0:设计系统对齐

### P0-1:改造 less/variable.less,引入 TRAE Work Token

- [ ] **任务**: 在 `src/less/variable.less` 中引入 TRAE Work CSS 变量作为权威源
- [ ] **文件**: `src/less/variable.less`
- [ ] **实施细节**:
  - 在文件顶部新增 `:root { ... }` 块,包含完整 TRAE Work Token(见 [design-tokens.md §三](./design-tokens.md#三css-变量定义复制到-variableless))
  - 新增 `.dark { ... }` 块,Dark 主题覆盖
  - 现有 Less 变量(`@gray2`/`@gray3` 等)保留,添加 `@deprecated` 注释
  - 确保不破坏现有 `var(--xxx)` 引用(如 `--background-card` 等)
- [ ] **验收**:
  - `variable.less` 含完整 TRAE Work Token(Light + Dark)
  - 现有页面视觉无变化(仅新增变量,不替换引用)
  - `npx jest` 现有测试 0 回归

### P0-2:扩展 tailwind.config.js,映射新 Token

- [ ] **任务**: 在 `tailwind.config.js` 的 `extend` 中映射 TRAE Work Token
- [ ] **文件**: `tailwind.config.js`
- [ ] **实施细节**:
  - `extend.colors.trae` 新增品牌色/中性色命名空间(见 [design-tokens.md §四](./design-tokens.md#四tailwind-映射tailwindconfigjs-扩展))
  - `extend.fontFamily` 新增 `display` 和 `mono`
  - `extend.fontSize` 新增 `trae-xs` 到 `trae-5xl`
  - `extend.borderRadius` 新增 `trae-xs` 到 `trae-full`
  - `extend.boxShadow` 新增 `trae-glow-sm` 等
  - `extend.transitionDuration` 新增 `trae-fast` 等
  - `extend.backdropBlur` 新增 `trae-nav`
  - `extend.letterSpacing` 新增 `trae-tight` 等
- [ ] **验收**:
  - Tailwind 工具类 `bg-trae-ink`/`text-trae-green` 等可用
  - `npx tailwindcss --content ./src/**/*.tsx --output /dev/null` 无错误

### P0-3:新增 TaskCard 组件

- [ ] **任务**: 实现 TaskCard 组件
- [ ] **文件**:
  - `src/components/trae-work/task-card.tsx`
  - `src/components/trae-work/types.ts`(共享类型)
  - `src/components/trae-work/constants.ts`(状态色映射)
- [ ] **实施细节**(对齐 [components-api.md §2.1](./components-api.md#21-taskcard)):
  - 实现 `TaskCardProps` 完整 API
  - 5 种状态(running/completed/failed/cancelled/pending)对应不同视觉
  - 使用 TRAE Work Token(`var(--trae-xxx)`),不硬编码颜色
  - 复用现有 [IntellectAvatar](../../src/components/intellect-avatar.tsx) 和 [Button](../../src/components/ui/button.tsx)
- [ ] **验收**:
  - 组件渲染正常,5 种状态视觉正确
  - 点击/删除/重试回调触发正常
  - 紧凑模式和选中状态正确

### P0-4:新增 TaskProgress 组件

- [ ] **任务**: 实现 TaskProgress 组件
- [ ] **文件**: `src/components/trae-work/task-progress.tsx`
- [ ] **实施细节**(对齐 [components-api.md §2.2](./components-api.md#22-taskprogress)):
  - 实现 `TaskProgressProps` 完整 API
  - 节点间竖线连接,圆点状态色
  - 支持嵌套子节点
  - 展开/折叠受控/非受控
  - 自动滚动到最新节点(用 `useRef` + `scrollIntoView`)
  - 复用现有 [Collapsible](../../src/components/ui/collapsible.tsx)
- [ ] **验收**:
  - 节点列表渲染正常,竖线连接正确
  - 展开/折叠正常
  - 嵌套节点正常
  - 自动滚动行为正常

### P0-5:新增 ToolPanel 组件

- [ ] **任务**: 实现 ToolPanel 组件
- [ ] **文件**: `src/components/trae-work/tool-panel.tsx`
- [ ] **实施细节**(对齐 [components-api.md §2.3](./components-api.md#23-toolpanel)):
  - 实现 `ToolPanelProps` 完整 API
  - 头部(图标 + 标题 + actions + chevron)+ 内容区
  - 展开/折叠受控/非受控
  - 徽标数显示
  - 加载/空状态/禁用
  - 复用现有 [Collapsible](../../src/components/ui/collapsible.tsx) 和 [Badge](../../src/components/ui/badge.tsx)
- [ ] **验收**:
  - 展开/折叠动画正常
  - 徽标数显示正确
  - 加载/空状态/禁用正确

### P0-6:新增 ModeSwitcher 组件

- [ ] **任务**: 实现 ModeSwitcher 组件
- [ ] **文件**: `src/components/trae-work/mode-switcher.tsx`
- [ ] **实施细节**(对齐 [components-api.md §2.4](./components-api.md#24-modeswitcher)):
  - 实现 `ModeSwitcherProps` 完整 API
  - 三段式(Work/Code/Canvas),每段含图标 + 标签
  - 受控组件(`value` + `onChange`)
  - `availableModes` 控制可选模式
  - 尺寸 sm/md/lg
  - 阶段 0 仅 UI 壳,`onChange` 回调不接业务逻辑
- [ ] **验收**:
  - 三段切换正常
  - `availableModes` 隐藏模式正确
  - 尺寸正确

### P0-7:Storybook 故事 + Jest 单测

- [ ] **任务**: 为 4 个基础组件编写 Storybook 故事和 Jest 单测
- [ ] **文件**:
  - `src/components/trae-work/task-card.stories.tsx`
  - `src/components/trae-work/task-card.test.tsx`
  - `src/components/trae-work/task-progress.stories.tsx`
  - `src/components/trae-work/task-progress.test.tsx`
  - `src/components/trae-work/tool-panel.stories.tsx`
  - `src/components/trae-work/tool-panel.test.tsx`
  - `src/components/trae-work/mode-switcher.stories.tsx`
  - `src/components/trae-work/mode-switcher.test.tsx`
  - `src/components/trae-work/index.ts`(re-export)
- [ ] **实施细节**:
  - 每个 Storybook 故事覆盖 §2.1-2.4 中列出的所有场景
  - Jest 单测覆盖:
    - 渲染测试(props 传递正确)
    - 交互测试(点击/回调触发)
    - 状态测试(受控/非受控)
    - 边界测试(空数据/禁用/错误)
  - 覆盖率 ≥ 80%
- [ ] **验收**:
  - `npm run storybook` 4 个组件故事完整可交互
  - `npx jest src/components/trae-work` 全部通过
  - 覆盖率 ≥ 80%

### P0-8:字体引入 + 回归测试

- [ ] **任务**: 引入 Outfit 和 JetBrains Mono 字体,执行回归测试
- [ ] **文件**:
  - `package.json`(新增 `@fontsource/outfit` 和 `@fontsource/jetbrains-mono`)
  - `src/global.less`(引入字体 CSS)
- [ ] **实施细节**:
  - `npm install @fontsource/outfit @fontsource/jetbrains-mono`
  - 在 `src/global.less` 顶部 `@import '@fontsource/outfit/400.css'` 等
  - 验证字体加载(Light/Dark 主题)
- [ ] **验收**:
  - 字体加载正常,Network 面板可见字体文件
  - `var(--trae-font-display)` 和 `var(--trae-font-mono)` 生效
  - `npx jest` 全套测试 0 回归
  - 手动验证核心流程(登录/聊天/画布/知识库)视觉无破坏

---

## Phase 1:三栏任务中心布局

### P1-1:新增 ThreeColumnLayout 组件

- [ ] **任务**: 实现三栏布局容器
- [ ] **文件**:
  - `src/layouts/three-column-layout.tsx`
  - `src/layouts/three-column-layout.stories.tsx`
  - `src/layouts/three-column-layout.test.tsx`
- [ ] **实施细节**(对齐 [components-api.md §3.1](./components-api.md#31-threecolumnlayout)):
  - CSS Grid 三栏布局 `grid-template-columns: [sidebar] [main] [toolpanel]`
  - 顶栏 + 主体两行 `grid-template-rows: [topbar] [body]`
  - 侧栏/工具面板可折叠(宽度过渡动画)
  - 响应式断点:< 1024px 侧栏变图标栏,< 768px 工具面板 overlay
  - 折叠状态受控/非受控
- [ ] **验收**:
  - 三栏布局正确渲染
  - 折叠/展开动画正常
  - 响应式断点正确
  - Storybook 故事 + Jest 单测通过

### P1-2:新增 TaskSidebar 组件

- [ ] **任务**: 实现左侧任务栏
- [ ] **文件**:
  - `src/layouts/components/task-sidebar.tsx`
  - `src/layouts/components/task-sidebar.stories.tsx`
  - `src/layouts/components/task-sidebar.test.tsx`
- [ ] **实施细节**(对齐 [components-api.md §3.2](./components-api.md#32-tasksidebar)):
  - 顶部:模式切换器(可选)+ 新建按钮 + 搜索框
  - 中部:任务列表(用 TaskCard compact 模式)
  - 底部:筛选器(可选)
  - 折叠状态:仅显示图标
  - 加载/空状态
- [ ] **验收**:
  - 任务列表渲染正常
  - 搜索/筛选正常
  - 折叠状态正确
  - Storybook 故事 + Jest 单测通过

### P1-3:新增 ToolPanelHost 组件

- [ ] **任务**: 实现右侧工具面板容器
- [ ] **文件**:
  - `src/layouts/components/tool-panel-host.tsx`
  - `src/layouts/components/tool-panel-host.stories.tsx`
  - `src/layouts/components/tool-panel-host.test.tsx`
- [ ] **实施细节**(对齐 [components-api.md §3.3](./components-api.md#33-toolpanelhost)):
  - 顶部标题 + 折叠按钮
  - 面板列表(用 ToolPanel 组件)
  - 手风琴模式(可选)
  - 展开/折叠受控/非受控
- [ ] **验收**:
  - 面板列表渲染正常
  - 手风琴模式正常
  - 折叠状态正确
  - Storybook 故事 + Jest 单测通过

### P1-4:重构 root-layout.tsx,集成三栏布局

- [ ] **任务**: 重构根布局,根据 feature flag 切换三栏或旧布局
- [ ] **文件**:
  - `src/layouts/root-layout.tsx`
  - `src/hooks/use-layout-mode.ts`
- [ ] **实施细节**:
  - 新增 `useLayoutMode` hook,读写 `localStorage.trae_work_layout`(值: `legacy` | `three-column`)
  - `RootLayout` 根据 hook 返回值切换:
    - `three-column`(默认):渲染 `ThreeColumnLayout`,children 作为主区内容
    - `legacy`:渲染旧 `RootLayoutContainer` + `Header`
  - `ThreeColumnLayout` 的 `sidebar` 暂用占位内容(阶段 2 接入实际任务列表)
  - `ThreeColumnLayout` 的 `toolPanel` 暂用占位内容
  - `topBar` 用 `TopBar` 组件(含 ModeSwitcher 占位)
- [ ] **验收**:
  - 默认渲染三栏布局
  - 切换 `localStorage.trae_work_layout=legacy` 回退到旧布局
  - 三栏布局中主区正确渲染 Outlet 内容

### P1-5:新增 TopBar 组件,重构 header

- [ ] **任务**: 实现简化顶栏
- [ ] **文件**:
  - `src/layouts/components/top-bar.tsx`
  - `src/layouts/components/top-bar.stories.tsx`
  - `src/layouts/components/top-bar.test.tsx`
  - `src/layouts/components/header.tsx`(标记 @deprecated)
- [ ] **实施细节**(对齐 [components-api.md §3.4](./components-api.md#34-topbar)):
  - 三列布局 `grid-template-columns: 1fr auto 1fr`
  - 左侧:Logo(保留 AgentUI Logo)
  - 中间:ModeSwitcher(阶段 1 仅 UI,不接逻辑)
  - 右侧:语言切换 + 帮助 + 主题切换 + 用户头像(复用现有逻辑)
  - 毛玻璃背景 `backdrop-filter: var(--trae-blur-nav)`
  - `header.tsx` 添加 `@deprecated` 注释,保留供 legacy 模式使用
- [ ] **验收**:
  - TopBar 渲染正常
  - Logo/语言/主题/头像功能正常
  - ModeSwitcher 显示(点击无实际效果)
  - Storybook 故事 + Jest 单测通过

### P1-6:适配核心页面到三栏布局

- [ ] **任务**: 适配 chat/home/agents 页面到三栏布局
- [ ] **文件**:
  - `src/pages/next-chats/chat/index.tsx`
  - `src/pages/home/index.tsx`
  - `src/pages/agents/index.tsx`
- [ ] **实施细节**:
  - `next-chats/chat/index.tsx`:移除内部 `RootLayoutContainer` 包裹(由 `ThreeColumnLayout` 承载),保留 `Sessions` 和 `ChatBox` 内容
  - `home/index.tsx`:首页适配,任务列表移至 `TaskSidebar`(占位,阶段 2 接入)
  - `agents/index.tsx`:Agents 页面适配
  - **不改业务逻辑**,仅调整布局包裹层
- [ ] **验收**:
  - 三个页面在三栏布局下正常渲染
  - 核心流程(聊天/画布/知识库)功能无回归
  - 切换到 legacy 模式仍能正常使用

### P1-7:Feature flag + 旧路由保留

- [ ] **任务**: 完善 feature flag 机制,确保旧路由可回退
- [ ] **文件**:
  - `src/hooks/use-layout-mode.ts`(完善)
  - `src/app.tsx`(如需全局 Provider)
- [ ] **实施细节**:
  - `useLayoutMode` 返回 `{ mode, setMode, toggleMode }`
  - 在设置页面或顶栏添加切换入口(可选,开发期用 console 切换)
  - 确保切换时页面刷新,状态不丢失
- [ ] **验收**:
  - `localStorage.trae_work_layout=legacy` 切换到旧布局
  - `localStorage.trae_work_layout=three-column`(或删除 key)切换到新布局
  - 切换后页面正常渲染

### P1-8:Storybook 故事 + Jest 单测(布局组件)

- [ ] **任务**: 为 4 个布局组件补充 Storybook 故事和 Jest 单测
- [ ] **文件**: 见 [file-inventory.md §2.1](./file-inventory.md#21-新增文件13-个)
- [ ] **实施细节**:
  - ThreeColumnLayout 故事:覆盖默认/折叠/响应式
  - TaskSidebar 故事:覆盖有任务/空/加载/折叠
  - ToolPanelHost 故事:覆盖多面板/手风琴/折叠
  - TopBar 故事:覆盖默认/自定义内容
  - Jest 单测覆盖渲染/交互/受控状态
  - 覆盖率 ≥ 80%
- [ ] **验收**:
  - `npm run storybook` 布局组件故事完整
  - `npx jest src/layouts` 全部通过
  - 覆盖率 ≥ 80%

### P1-9:回归测试

- [ ] **任务**: 全套测试 0 回归
- [ ] **命令**:
  - `npx jest` — 前端单测
  - `cd bff && npx vitest run` — BFF 单测(确认未被触碰)
  - `npm run storybook` — Storybook 故事验证
- [ ] **手动验证**:
  - 登录流程正常
  - 聊天流程正常(发送/接收/流式)
  - 画布流程正常(打开/编辑/保存)
  - 知识库流程正常(列表/详情/上传)
  - 主题切换正常(Light/Dark)
  - 响应式布局正常(桌面/平板/手机宽度)
  - Feature flag 切换正常(legacy ↔ three-column)
- [ ] **验收**:
  - Jest 现有测试 0 回归
  - BFF 测试 0 回归(680/680)
  - Storybook 所有故事可渲染
  - 手动验证全部通过

---

## 任务依赖关系

```
Phase 0:
P0-1(variable.less) → P0-2(tailwind.config)
                          ↓
                    P0-3(TaskCard) ─┐
                    P0-4(TaskProgress) ─┤(并行)
                    P0-5(ToolPanel) ─┤
                    P0-6(ModeSwitcher) ─┘
                          ↓
                    P0-7(Storybook + Jest)
                          ↓
                    P0-8(字体 + 回归测试)

Phase 1:
P1-1(ThreeColumnLayout) ─┐
P1-2(TaskSidebar) ─┤(并行,依赖 P0-3)
P1-3(ToolPanelHost) ─┤(并行,依赖 P0-5)
P1-5(TopBar) ─┘(并行,依赖 P0-6)
        ↓
P1-4(root-layout 集成,依赖 P1-1/P1-2/P1-3/P1-5)
        ↓
P1-6(页面适配,依赖 P1-4)
        ↓
P1-7(feature flag,依赖 P1-4)
        ↓
P1-8(Storybook + Jest,依赖 P1-1~P1-5)
        ↓
P1-9(回归测试,依赖全部)
```

---

## 风险项(对齐 spec §六)

| # | 风险 | 影响 | 处置 |
|---|------|------|------|
| R1 | Token 替换导致现有页面视觉破坏 | P0-1/P0-2 | 保留旧 Less 变量(@deprecated),新 Token 通过 CSS 变量层叠加,渐进替换 |
| R2 | 三栏布局在小屏幕不适配 | P1-1 | 响应式断点:< 1024px 折叠侧栏,< 768px 切回单栏 |
| R3 | Storybook 与 Jest 环境差异 | P0-7/P1-8 | 组件纯展示型,Storybook + Jest 双轨验证 |
| R4 | Feature flag 切换导致状态丢失 | P1-7 | flag 仅控制布局,不涉及业务状态;切换时刷新页面 |
| R5 | TRAE Work 配色与 AgentUI 品牌冲突 | P0-1 | 保留 AgentUI Logo,配色对齐 TRAE Work(已决策) |

---

## 验收总清单

### Phase 0 验收
- [x] `variable.less` 含完整 TRAE Work Token(Light + Dark)
- [x] `tailwind.config.js` 映射新 Token
- [x] 4 个基础组件(TaskCard/TaskProgress/ToolPanel/ModeSwitcher)实现完整
- [x] 4 个组件在 Storybook 中可交互
- [x] Jest 单测 130 个全部通过(TaskCard 33 + TaskProgress 37 + ToolPanel 31 + ModeSwitcher 29)
- [x] 现有 Jest 测试 0 回归(299/299 passed)
- [x] Outfit 和 JetBrains Mono 字体加载正常(dev server 验证 200 OK)
- [x] BFF 测试 0 回归(687/687 passed)
- [ ] 手动验证核心流程视觉无破坏(待人工执行)

### Phase 1 验收
- [ ] 4 个布局组件(ThreeColumnLayout/TaskSidebar/ToolPanelHost/TopBar)实现完整
- [ ] 三栏布局可用(侧栏 + 主区 + 工具面板)
- [ ] 侧栏可折叠,工具面板可折叠
- [ ] 旧路由通过 feature flag 可回退
- [ ] 核心流程(登录/聊天/画布/知识库)无回归
- [ ] Jest 单测覆盖率 ≥ 80%
- [ ] Storybook 故事完整
- [ ] BFF 测试 0 回归(687/687)
- [ ] 响应式布局正常(桌面/平板/手机宽度)
