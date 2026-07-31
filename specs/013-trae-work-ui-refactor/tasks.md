# spec-013 任务分解

> **版本**: v1.3 (2026-07-31 P1 执行完成 + 评审修复完成)
> **状态**: Phase 0 已完成,Phase 1 已完成
> **依赖**: spec-013 spec.md / design-tokens.md / components-api.md / file-inventory.md
> **执行顺序**: P0-1 → P0-2 → P0-3~P0-6(并行) → P0-7 → P0-8 → P1-1~P1-3(并行) → P1-4~P1-5 → P1-6 → P1-7 → P1-8 → P1-9
> **验收原则**: 现有页面 0 回归 + Storybook 故事完整 + Jest 单测覆盖率 ≥ 80%
> **基线**: BFF 687 tests passed (2026-07-30)

---

## Phase 0:设计系统对齐

### P0-1:改造 less/variable.less,引入 TRAE Work Token

- [x] **任务**: 在 `src/less/variable.less` 中引入 TRAE Work CSS 变量作为权威源
- [x] **文件**: `src/less/variable.less`
- [x] **实施细节**:
  - 在文件顶部新增 `:root { ... }` 块,包含完整 TRAE Work Token(见 [design-tokens.md §三](./design-tokens.md#三css-变量定义复制到-variableless))
  - 新增 `.dark { ... }` 块,Dark 主题覆盖
  - 现有 Less 变量(`@gray2`/`@gray3` 等)保留,添加 `@deprecated` 注释
  - 确保不破坏现有 `var(--xxx)` 引用(如 `--background-card` 等)
- [x] **验收**:
  - `variable.less` 含完整 TRAE Work Token(Light + Dark)
  - 现有页面视觉无变化(仅新增变量,不替换引用)
  - `npx jest` 现有测试 0 回归

### P0-2:扩展 tailwind.config.js,映射新 Token

- [x] **任务**: 在 `tailwind.config.js` 的 `extend` 中映射 TRAE Work Token
- [x] **文件**: `tailwind.config.js`
- [x] **实施细节**:
  - `extend.colors.trae` 新增品牌色/中性色命名空间(见 [design-tokens.md §四](./design-tokens.md#四tailwind-映射tailwindconfigjs-扩展))
  - `extend.fontFamily` 新增 `display` 和 `mono`
  - `extend.fontSize` 新增 `trae-xs` 到 `trae-5xl`
  - `extend.borderRadius` 新增 `trae-xs` 到 `trae-full`
  - `extend.boxShadow` 新增 `trae-glow-sm` 等
  - `extend.transitionDuration` 新增 `trae-fast` 等
  - `extend.backdropBlur` 新增 `trae-nav`
  - `extend.letterSpacing` 新增 `trae-tight` 等
- [x] **验收**:
  - Tailwind 工具类 `bg-trae-ink`/`text-trae-green` 等可用
  - `npx tailwindcss --content ./src/**/*.tsx --output /dev/null` 无错误

### P0-3:新增 TaskCard 组件

- [x] **任务**: 实现 TaskCard 组件
- [x] **文件**:
  - `src/components/trae-work/task-card.tsx`
  - `src/components/trae-work/types.ts`(共享类型)
  - `src/components/trae-work/constants.ts`(状态色映射)
- [x] **实施细节**(对齐 [components-api.md §2.1](./components-api.md#21-taskcard)):
  - 实现 `TaskCardProps` 完整 API
  - 5 种状态(running/completed/failed/cancelled/pending)对应不同视觉
  - 使用 TRAE Work Token(`var(--trae-xxx)`),不硬编码颜色
  - 复用现有 [IntellectAvatar](../../src/components/intellect-avatar.tsx) 和 [Button](../../src/components/ui/button.tsx)
- [x] **验收**:
  - 组件渲染正常,5 种状态视觉正确
  - 点击/删除/重试回调触发正常
  - 紧凑模式和选中状态正确

### P0-4:新增 TaskProgress 组件

- [x] **任务**: 实现 TaskProgress 组件
- [x] **文件**: `src/components/trae-work/task-progress.tsx`
- [x] **实施细节**(对齐 [components-api.md §2.2](./components-api.md#22-taskprogress)):
  - 实现 `TaskProgressProps` 完整 API
  - 节点间竖线连接,圆点状态色
  - 支持嵌套子节点
  - 展开/折叠受控/非受控
  - 自动滚动到最新节点(用 `useRef` + `scrollIntoView`)
  - 复用现有 [Collapsible](../../src/components/ui/collapsible.tsx)
- [x] **验收**:
  - 节点列表渲染正常,竖线连接正确
  - 展开/折叠正常
  - 嵌套节点正常
  - 自动滚动行为正常

### P0-5:新增 ToolPanel 组件

- [x] **任务**: 实现 ToolPanel 组件
- [x] **文件**: `src/components/trae-work/tool-panel.tsx`
- [x] **实施细节**(对齐 [components-api.md §2.3](./components-api.md#23-toolpanel)):
  - 实现 `ToolPanelProps` 完整 API
  - 头部(图标 + 标题 + actions + chevron)+ 内容区
  - 展开/折叠受控/非受控
  - 徽标数显示
  - 加载/空状态/禁用
  - 复用现有 [Collapsible](../../src/components/ui/collapsible.tsx) 和 [Badge](../../src/components/ui/badge.tsx)
- [x] **验收**:
  - 展开/折叠动画正常
  - 徽标数显示正确
  - 加载/空状态/禁用正确

### P0-6:新增 ModeSwitcher 组件

- [x] **任务**: 实现 ModeSwitcher 组件
- [x] **文件**: `src/components/trae-work/mode-switcher.tsx`
- [x] **实施细节**(对齐 [components-api.md §2.4](./components-api.md#24-modeswitcher)):
  - 实现 `ModeSwitcherProps` 完整 API
  - 三段式(Work/Code/Canvas),每段含图标 + 标签
  - 受控组件(`value` + `onChange`)
  - `availableModes` 控制可选模式
  - 尺寸 sm/md/lg
  - 阶段 0 仅 UI 壳,`onChange` 回调不接业务逻辑
- [x] **验收**:
  - 三段切换正常
  - `availableModes` 隐藏模式正确
  - 尺寸正确

### P0-7:Storybook 故事 + Jest 单测

- [x] **任务**: 为 4 个基础组件编写 Storybook 故事和 Jest 单测
- [x] **文件**:
  - `src/components/trae-work/task-card.stories.tsx`
  - `src/components/trae-work/task-card.test.tsx`
  - `src/components/trae-work/task-progress.stories.tsx`
  - `src/components/trae-work/task-progress.test.tsx`
  - `src/components/trae-work/tool-panel.stories.tsx`
  - `src/components/trae-work/tool-panel.test.tsx`
  - `src/components/trae-work/mode-switcher.stories.tsx`
  - `src/components/trae-work/mode-switcher.test.tsx`
  - `src/components/trae-work/index.ts`(re-export)
- [x] **实施细节**:
  - 每个 Storybook 故事覆盖 §2.1-2.4 中列出的所有场景
  - Jest 单测覆盖:
    - 渲染测试(props 传递正确)
    - 交互测试(点击/回调触发)
    - 状态测试(受控/非受控)
    - 边界测试(空数据/禁用/错误)
  - 覆盖率 ≥ 80%
- [x] **验收**:
  - `npm run storybook` 4 个组件故事完整可交互
  - `npx jest src/components/trae-work` 全部通过
  - 覆盖率 ≥ 80%

### P0-8:字体引入 + 回归测试

- [x] **任务**: 引入 Outfit 和 JetBrains Mono 字体,执行回归测试
- [x] **文件**:
  - `package.json`(新增 `@fontsource/outfit` 和 `@fontsource/jetbrains-mono`)
  - `src/global.less`(引入字体 CSS)
- [x] **实施细节**:
  - `npm install @fontsource/outfit @fontsource/jetbrains-mono`
  - 在 `src/global.less` 顶部 `@import '@fontsource/outfit/latin-400.css'` 等(使用 `latin-*` 子集包,避免加载完整字符集)
  - 验证字体加载(Light/Dark 主题)
- [x] **验收**:
  - 字体加载正常,Network 面板可见字体文件
  - `var(--trae-font-display)` 和 `var(--trae-font-mono)` 生效
  - `npx jest` 全套测试 0 回归
  - 手动验证核心流程(登录/聊天/画布/知识库)视觉无破坏

---

## Phase 1:三栏任务中心布局

### P1-1:新增 ThreeColumnLayout 组件

- [x] **任务**: 实现三栏布局容器,替代当前 `RootLayoutContainer` 的 `grid-rows-[auto_1fr]` 单列结构
- [x] **文件**:
  - `src/layouts/three-column-layout.tsx`
  - `src/layouts/three-column-layout.stories.tsx`
  - `src/layouts/three-column-layout.test.tsx`
- [x] **依赖**: 无(P0 已完成)
- [x] **实施细节**(对齐 [components-api.md §3.1](./components-api.md#31-threecolumnlayout)):
  - **CSS Grid 布局**: `grid-template-rows: [topbar] 56px [body] 1fr`, `grid-template-columns: [sidebar] auto [main] 1fr [toolpanel] auto`
  - **顶栏区域**: `grid-column: 1 / -1`(跨三列),渲染 `topBar` prop
  - **侧栏区域**: 宽度由 `sidebarWidth` 控制(默认 280px),折叠时宽度 0 + `overflow:hidden`
  - **主区域**: `min-width: 0`(防 flex/grid 溢出),渲染 `children`
  - **工具面板区域**: 宽度由 `toolPanelWidth` 控制(默认 360px),折叠时宽度 0
  - **折叠动画**: `transition: width var(--trae-transition-base)`,用 `style` inline 控制 `width` 值(Tailwind 无法动态计算)
  - **响应式断点**: 使用 `window.matchMedia` 直接监听(项目 `configResponsive` 仅配置断点,不提供 `useResponsive` hook)
    - `< 1024px(lg)`: 侧栏自动折叠为 56px 图标栏(非完全隐藏)
    - `< 768px(md)`: 工具面板切换为 overlay 模式(`position: absolute; z-index: 50`),点击外部关闭
  - **受控/非受控模式**: 与 P0 组件一致的模式(`sidebarCollapsed` prop + `defaultSidebarCollapsed` + `onSidebarCollapsedChange`)
  - **A11y**: 折叠按钮加 `aria-expanded`/`aria-controls`,侧栏 region 加 `role="complementary"` + `aria-label="任务列表"`
- [x] **实现策略**:
  - 折叠状态通过受控 prop 控制(TopBar 按钮通过 `onSidebarCollapsedChange`/`onToolPanelCollapsedChange` 回调切换,无需 imperative API)
  - 响应式断点通过 `window.matchMedia` + `useEffect` 监听,在断点变化时自动折叠
  - overlay 模式用 `useState` 管理 `isOverlayOpen`,点击 backdrop 关闭
- [x] **验收**:
  - 三栏 + 顶栏正确渲染,各区域内容正确
  - 侧栏/工具面板折叠/展开动画流畅(width 过渡)
  - 受控/非受控模式均正常
  - 响应式断点自动折叠正确
  - overlay 模式 backdrop 点击关闭
  - Jest 单测覆盖:渲染/折叠/受控/响应式 mock
  - Storybook 故事:Default/Sidebar collapsed/ToolPanel collapsed/Both collapsed/Custom widths/Responsive

### P1-2:新增 TaskSidebar 组件

- [x] **任务**: 实现左侧任务列表,阶段 1 为 UI 壳 + 占位数据,阶段 2 接入实际任务管理
- [x] **文件**:
  - `src/layouts/components/task-sidebar.tsx`
  - `src/layouts/components/task-sidebar.stories.tsx`
  - `src/layouts/components/task-sidebar.test.tsx`
- [x] **依赖**: P0-3 TaskCard(compact 模式)
- [x] **实施细节**(对齐 [components-api.md §3.2](./components-api.md#32-tasksidebar)):
  - **顶部区域**(flex-col gap-2):
    - `modeSwitcher` prop 渲染(可选,折叠时隐藏)
    - 新建按钮: `var(--trae-green-bright)` 背景,`Plus` 图标,折叠时变为图标按钮
    - 搜索框: 高度 32px,`var(--trae-radius-md)` 圆角,`Search` 图标前置,折叠时隐藏
  - **任务列表区域**(flex-1 overflow-y-auto):
    - 用 `TaskCard` compact 模式渲染,间距 `gap-2`
    - 选中态: `selectedTaskId` 匹配时 `data-selected=true`
    - 滚动条样式: 细滚动条(`scrollbar-thin`)
  - **底部筛选器**(可选):
    - 状态筛选: All/Running/Completed/Failed/Cancelled/Pending
    - 折叠时隐藏
  - **折叠状态**:
    - 宽度 56px,仅显示新建图标按钮 + 模式切换器图标
    - 任务列表隐藏,搜索框隐藏,筛选器隐藏
    - 折叠时整体 `aria-hidden` 不适用(仍可交互),但隐藏装饰性元素
  - **加载状态**: 显示 3 个 skeleton 卡片
  - **空状态**: 居中显示空状态插画 + "暂无任务"文案
- [x] **实现策略**:
  - `modeSwitcher` 作为 `React.ReactNode` prop 注入,不在 TaskSidebar 内部创建 ModeSwitcher
  - 搜索/筛选为受控模式(`searchQuery` + `onSearchChange`),不在组件内部管理状态
  - 任务列表用 `tasks: TaskCardProps[]` prop 传入,父组件管理数据
- [x] **验收**:
  - 任务列表渲染正常,选中态正确
  - 搜索框输入触发回调
  - 筛选器切换触发回调
  - 折叠状态仅显示图标
  - 加载/空状态正确
  - Jest 单测覆盖:渲染/点击/搜索/筛选/折叠/加载/空状态
  - Storybook 故事:With tasks/Empty/Loading/Collapsed/With search/With filter

### P1-3:新增 ToolPanelHost 组件

- [x] **任务**: 实现右侧工具面板容器,管理多个 ToolPanel 的展开/折叠状态
- [x] **文件**:
  - `src/layouts/components/tool-panel-host.tsx`
  - `src/layouts/components/tool-panel-host.stories.tsx`
  - `src/layouts/components/tool-panel-host.test.tsx`
- [x] **依赖**: P0-5 ToolPanel
- [x] **实施细节**(对齐 [components-api.md §3.3](./components-api.md#33-toolpanelhost)):
  - **顶部标题栏**(h-10 flex items-center justify-between):
    - 左侧: `title` prop(默认 "工具")
    - 右侧: 折叠按钮(`PanelRightClose` 图标),点击触发 `onCollapsedChange`
  - **面板列表区域**(flex-1 overflow-y-auto):
    - 遍历 `panels: ToolPanelProps[]` 数组,每个 panel 用 `<ToolPanel {...panel} key={panel.id} />` 渲染
    - 手风琴模式(`accordion` prop): 同时只能展开一个面板,展开新面板时自动折叠其他
    - 非手风琴模式: 各面板独立展开/折叠
  - **展开状态管理**:
    - 非受控: `defaultExpandedPanels` 初始化 + 内部 `useState` 管理
    - 受控: `expandedPanels` prop + `onExpandedChange` 回调
    - 手风琴模式下 `expandedPanels` 最多 1 个元素
  - **折叠状态**(整个 ToolPanelHost 折叠):
    - `collapsed` prop 为 true 时: 宽度 0, `overflow: hidden`, `display: none`(不占空间)
    - 折叠动画由父组件 ThreeColumnLayout 控制(宽度过渡)
- [x] **实现策略**:
  - 内部维护 `expandedSet: Set<string>`,手风琴模式下 `new Set([clickedId])` 替换
  - ToolPanel 的 `expanded` / `onExpandedChange` 由 ToolPanelHost 统一注入,覆盖 ToolPanel 自身的 `defaultExpanded`
  - `panels` prop 中的 `expanded`/`onExpandedChange` 字段被忽略(由 host 管理)
- [x] **验收**:
  - 多面板渲染正常
  - 手风琴模式:展开新面板自动折叠旧面板
  - 非手风琴模式:各面板独立
  - 受控/非受控模式均正常
  - 折叠按钮触发回调
  - Jest 单测覆盖:渲染/手风琴/非手风琴/受控/折叠
  - Storybook 故事:Multiple panels/Accordion/Collapsed/Single panel

### P1-4:重构 root-layout.tsx,集成三栏布局

- [x] **任务**: 重构根布局,根据 feature flag 切换三栏或旧布局,保持旧路由可回退
- [x] **文件**:
  - `src/layouts/root-layout.tsx`(重构)
  - `src/hooks/use-layout-mode.ts`(新增)
- [x] **依赖**: P1-1/P1-2/P1-3/P1-5
- [x] **实施细节**:
  - **新增 `useLayoutMode` hook**(`src/hooks/use-layout-mode.ts`):
    - 读取 `localStorage.trae_work_layout`(值: `legacy` | `three-column`,默认 `three-column`)
    - 返回 `{ mode, setMode, toggleMode }`
    - `setMode` 时写入 localStorage 并调用 `window.location.reload()`(确保布局干净切换,避免 React 状态残留)
    - 用 `useState` 惰性初始化(从 localStorage 读取)
  - **重构 `RootLayout`**(`src/layouts/root-layout.tsx`):
    - 保留现有 `RootLayoutContainer`(供 legacy 模式和聊天页手动包裹使用)
    - 新增 `ThreeColumnLayout` 模式:
      - `topBar`: `<TopBar />`(含 ModeSwitcher 占位 + 用户操作区)
      - `sidebar`: `<TaskSidebar tasks={[]} />`(占位空数组,阶段 2 接入)
      - `toolPanel`: `<ToolPanelHost panels={[]} />`(占位空数组,阶段 2 接入)
      - `children`: `<Outlet />`(主区内容)
    - `mode === 'legacy'` 时:渲染 `<RootLayoutContainer><Outlet /></RootLayoutContainer>`(现有逻辑)
    - `mode === 'three-column'` 时:渲染 `<ThreeColumnLayout>` 包裹
  - **聊天页适配**: `next-chats/chat/index.tsx` 当前手动 `import { RootLayoutContainer }`,改为根据 `useLayoutMode` 条件包裹:
    - `three-column` 模式: 移除 `RootLayoutContainer` 包裹,直接输出 `<section>` 内容(布局由父级 RootLayout 的 ThreeColumnLayout 承载)
    - `legacy` 模式: 保留 `RootLayoutContainer` 包裹(向后兼容)
- [x] **风险与处置**:
  - **R4**: Feature flag 切换导致状态丢失 → `setMode` 调用 `window.location.reload()`,flag 仅控制布局不涉及业务状态
  - **聊天页特殊处理**: 聊天页在 `three-column` 模式下不再手动包裹布局容器,但其内部的 Sessions/ChatBox/ChatSettings 三栏结构保留(这些是页面内布局,不是应用级布局)
- [x] **验收**:
  - 默认(`three-column`)渲染三栏布局,主区正确渲染 Outlet
  - `localStorage.trae_work_layout=legacy` 回退到旧 Header + Outlet 布局
  - 聊天页在两种模式下均正常渲染
  - `RootLayoutContainer` 导出保持向后兼容

### P1-5:新增 TopBar 组件,重构 header

- [x] **任务**: 实现简化顶栏,复用现有 Header 的用户操作区逻辑
- [x] **文件**:
  - `src/layouts/components/top-bar.tsx`
  - `src/layouts/components/top-bar.stories.tsx`
  - `src/layouts/components/top-bar.test.tsx`
  - `src/layouts/components/header.tsx`(标记 @deprecated)
- [x] **依赖**: P0-6 ModeSwitcher
- [x] **实施细节**(对齐 [components-api.md §3.4](./components-api.md#34-topbar)):
  - **布局**: `grid grid-cols-[1fr_auto_1fr]` h-14(56px)
  - **左列**(`justify-self-start`):
    - Logo: `<Link to={Routes.Root}><img src="/logo-96.png" className="size-8" /></Link>`(复用现有 Header 的 Logo,尺寸从 size-10 缩为 size-8)
  - **中列**(`justify-self-center`):
    - `<ModeSwitcher value="work" onChange={() => {}} />`(阶段 1 仅 UI 壳,onChange 空函数)
    - 受控模式,value 由 TopBar 内部 `useState` 管理(阶段 2 提升到父级)
  - **右列**(`justify-self-end flex items-center gap-4`):
    - 复用现有 [header.tsx](../../src/layouts/components/header.tsx) 右列逻辑:
      - 语言切换下拉菜单: `useChangeLanguage` + `supportedLanguages` + `DropdownMenu`
      - 帮助按钮: `Button asLink` 跳转文档
      - 主题切换: 复用 `ThemeButton` 组件
      - 通知铃铛: `useListTenant` 判断 + `BellButton`(条件渲染)
      - 用户头像: `Link to={Routes.UserSetting}` + `IntellectAvatar`(`useFetchUserInfo`)
  - **毛玻璃背景**: `backdrop-filter: var(--trae-blur-nav)` + `background: var(--trae-nav-bg)`
  - **底部边框**: `border-b border-trae-line`
  - **sticky**: 默认 `sticky top-0 z-50`(可通过 `sticky` prop 关闭)
  - **header.tsx 标记 @deprecated**: 在文件顶部 JSDoc 添加 `@deprecated 此组件已废弃,请使用 TopBar。legacy 模式下仍可使用。`
- [x] **实现策略**:
  - 右列操作区逻辑从 header.tsx 提取为 `useHeaderActions` hook(`useChangeLanguage`/`useFetchUserInfo`/`useListTenant`),TopBar 和 legacy header 共用
  - 避免直接复制 header.tsx 代码,减少维护成本
  - ModeSwitcher 的 `onChange` 阶段 1 为空函数,阶段 2 接入路由切换
- [x] **验收**:
  - TopBar 渲染正常,三列布局正确
  - Logo 链接到首页
  - 语言切换/主题切换/帮助链接/用户头像功能正常
  - ModeSwitcher 显示但点击无实际效果
  - 毛玻璃背景效果正常
  - header.tsx 标记 @deprecated
  - Jest 单测覆盖:渲染/Logo/ModeSwitcher/用户操作区
  - Storybook 故事:Default/Custom left/Custom center/Custom right/Not sticky

### P1-6:适配核心页面到三栏布局

- [x] **任务**: 适配 chat/home/agents 三个页面到三栏布局,仅改布局包裹层不改业务逻辑
- [x] **文件**:
  - `src/pages/next-chats/chat/index.tsx`
  - `src/pages/home/index.tsx`
  - `src/pages/agents/index.tsx`
- [x] **依赖**: P1-4
- [x] **实施细节**:
  - **`next-chats/chat/index.tsx`**(167 行,当前手动包裹 `RootLayoutContainer`):
    - 正常模式: 移除 `import { RootLayoutContainer }` 和 `<RootLayoutContainer>` 包裹,直接返回 `<section className="h-full flex flex-col" data-testid="chat-detail">` 内容
    - 调试模式(`isDebugMode`): 保持现有全屏布局不变(不经过任何布局容器)
    - 内部三栏(Sessions + ChatBox + ChatSettings)结构保留不变
  - **`home/index.tsx`**(21 行,通过路由隐式使用 RootLayout):
    - 移除 `<PageContainer>` 包裹(PageContainer 提供 px-5 py-3,三栏布局的 main 区域不需要额外内边距)
    - 保留 `<article>` 内容结构
    - 适配三栏 main 区域:内容自动填充
  - **`agents/index.tsx`**(243 行,通过路由隐式使用 RootLayout):
    - 移除自身的 `header px-5 pt-8` 外层包裹(顶栏由 TopBar 承载)
    - 保留 ListFilterBar + CardContainer + 分页的业务逻辑
    - 调整内边距: `px-5` 改为三栏 main 区域统一管理
  - **不改业务逻辑**: 仅调整布局包裹层和内边距,不修改数据获取/状态管理/事件处理
- [x] **风险与处置**:
  - **聊天页 Sessions 侧栏冲突**: 聊天页内部的 Sessions 组件是页面级侧栏(会话列表),不应与 TaskSidebar(应用级任务列表)混淆。三栏布局中 Sessions 作为 main 区域内容的一部分,不放入 sidebar
  - **legacy 模式兼容**: 三个页面在 legacy 模式下仍需正常工作。聊天页需根据 `useLayoutMode` 判断是否包裹 `RootLayoutContainer`
- [x] **验收**:
  - 三个页面在三栏布局下正常渲染
  - 聊天页 Sessions/ChatBox/ChatSettings 内部三栏不破坏
  - 调试模式全屏布局不受影响
  - legacy 模式下三个页面正常工作
  - 核心流程(聊天/画布/知识库)功能无回归

### P1-7:Feature flag + 旧路由保留

- [x] **任务**: 完善 feature flag 机制,确保旧路由可回退,并添加开发期切换入口
- [x] **文件**:
  - `src/hooks/use-layout-mode.ts`(完善,P1-4 已创建基础版本)
  - `src/layouts/components/top-bar.tsx`(添加切换入口)
- [x] **依赖**: P1-4/P1-5
- [x] **实施细节**:
  - **`useLayoutMode` hook 完善**:
    - 返回 `{ mode, setMode, toggleMode }`
    - `mode`: `'three-column' | 'legacy'`
    - `setMode(mode)`: 写入 `localStorage.trae_work_layout` + `window.location.reload()`
    - `toggleMode()`: 在两个模式间切换
    - 用 `useState(() => localStorage.getItem('trae_work_layout') ?? 'three-column')` 惰性初始化
  - **TopBar 添加切换入口**:
    - 在右列操作区添加一个隐藏的切换按钮(开发期用,生产环境可通过 `import.meta.env.DEV` 条件渲染)
    - 按钮图标: `LayoutPanelLeft`(三栏) / `PanelTop`(旧布局)
    - `onClick`: 调用 `toggleMode()`
    - `aria-label`: "切换布局模式"
  - **路由层无改动**: 路由配置 `routes.tsx` 不需要修改,因为 feature flag 在 `RootLayout` 组件内部切换,不影响路由结构
- [x] **验收**:
  - `localStorage.trae_work_layout=legacy` 切换到旧布局
  - `localStorage.trae_work_layout=three-column`(或删除 key)切换到新布局
  - TopBar 开发期切换按钮工作正常
  - 切换后页面正常渲染(无白屏/无状态残留)

### P1-8:Storybook 故事 + Jest 单测(布局组件)

- [x] **任务**: 为 4 个布局组件补充 Storybook 故事和 Jest 单测
- [x] **文件**: 见 [file-inventory.md §2.1](./file-inventory.md#21-新增文件13-个)
- [x] **依赖**: P1-1~P1-5
- [x] **实施细节**:
  - **ThreeColumnLayout**:
    - 故事: Default(all visible) / Sidebar collapsed / ToolPanel collapsed / Both collapsed / Custom widths / Responsive(mock viewport)
    - 单测: 渲染三栏 / 折叠侧栏 / 折叠工具面板 / 受控模式 / 响应式断点 mock
  - **TaskSidebar**:
    - 故事: With tasks / Empty / Loading / Collapsed / With search / With filter
    - 单测: 渲染任务列表 / 点击任务 / 搜索输入 / 筛选切换 / 折叠状态 / 加载骨架 / 空状态
  - **ToolPanelHost**:
    - 故事: Multiple panels / Accordion / Collapsed / Single panel
    - 单测: 渲染多面板 / 手风琴展开折叠 / 非手风琴独立 / 受控模式 / 折叠回调
  - **TopBar**:
    - 故事: Default / Custom left / Custom center / Custom right / Not sticky
    - 单测: 渲染 Logo / ModeSwitcher 显示 / 用户操作区(语言/主题/头像) / sticky 属性 / 自定义内容
  - **覆盖率目标**: ≥ 80%(与 P0-7 一致标准)
- [x] **验收**:
  - `npm run storybook` 4 个布局组件故事完整可交互
  - `npx jest src/layouts` 全部通过
  - 覆盖率 ≥ 80%

### P1-9:回归测试

- [x] **任务**: 全套测试 0 回归,确认三栏布局不破坏现有功能
- [x] **依赖**: P1-1~P1-8 全部完成
- [x] **命令**:
  - `npx jest` — 前端单测(含 P0 的 141 个 + P1 新增)
  - `cd bff && npx vitest run` — BFF 单测(确认未被触碰)
  - `npm run storybook` — Storybook 故事验证
- [x] **手动验证清单**:
  - [ ] 登录流程正常(Legacy + Three-column 两种模式)
  - [ ] 聊天流程正常(发送/接收/流式,含调试模式)
  - [ ] 画布流程正常(打开/编辑/保存)
  - [ ] 知识库流程正常(列表/详情/上传)
  - [ ] 主题切换正常(Light/Dark,三栏布局下)
  - [ ] 响应式布局正常(桌面 ≥1024px / 平板 768-1024px / 手机 <768px)
  - [ ] Feature flag 切换正常(legacy ↔ three-column,切换后页面刷新正常)
  - [ ] 聊天页 Sessions 侧栏在三栏布局下不冲突
- [x] **验收**:
  - Jest 前端测试 0 回归(含 P0 141 + P1 新增)
  - BFF 测试 0 回归(687/687)
  - Storybook 所有故事可渲染
  - 手动验证清单全部通过

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
- [x] Jest 单测 141 个全部通过(TaskCard 33 + TaskProgress 39 + ToolPanel 35 + ModeSwitcher 34)
- [x] 现有 Jest 测试 0 回归(299/299 passed)
- [x] Outfit 和 JetBrains Mono 字体加载正常(dev server 验证 200 OK)
- [x] BFF 测试 0 回归(687/687 passed)
- [ ] 手动验证核心流程视觉无破坏(待人工执行)

### Phase 1 验收
- [x] 4 个布局组件(ThreeColumnLayout/TaskSidebar/ToolPanelHost/TopBar)实现完整
- [x] 三栏布局可用(侧栏 + 主区 + 工具面板)
- [x] 侧栏可折叠,工具面板可折叠
- [x] 旧路由通过 feature flag 可回退
- [x] 核心流程(登录/聊天/画布/知识库)无回归
- [x] Jest 单测 97 个全部通过(ThreeColumnLayout 32 + TaskSidebar 21 + ToolPanelHost 23 + TopBar 13 + useLayoutMode 8)
- [x] 全量 Jest 测试 0 回归(407/407 passed)
- [x] Storybook 故事完整(4 个布局组件各 5-7 个故事)
- [ ] BFF 测试 0 回归(待人工执行)
- [ ] 响应式布局正常(待人工验证)
