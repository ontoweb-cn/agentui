# spec-013 AgentUI 参考 TRAE Work 设计模板重构

> **版本**: v1.2 (2026-07-30 P0 实施完成,含评审修复记录)
> **状态**: Phase 0 已实施并通过评审,Phase 1 待实施
> **依赖**: 无外部 spec 依赖,独立前端重构
> **执行顺序**: P0(设计系统) → P1(三栏布局) → 评审验收
> **验收原则**: 现有页面 0 回归 + Storybook 故事完整 + Jest 单测通过
> **基线**: BFF 687 tests passed (2026-07-30)

---

## 评审记录(2026-07-30)

### 设计阶段评审:✅ 通过

### 评审维度

| 维度 | 结论 |
|------|------|
| 技术可行性 | ✅ 兼容,无需换栈 |
| 与 project memory 约束兼容性 | ✅ BFF 契约不变/shadcn 不变/canvas-plugin 不变/YAGNI/渐进式 |
| Token 定义正确性 | ✅ 与 TRAE 概览页源一致,Dark 主题微调已记录 |
| 组件 API 合理性 | ✅ 8 个组件 API 完整,复用现有组件 |
| 任务分解可执行性 | ✅ 17 个任务粒度适中,依赖清晰 |
| 风险识别 | ✅ R1-R5 已对齐,R6(Dark 层次不足)已处置 |

### 评审发现的一致性问题(已处置)

| # | 问题 | 处置 |
|---|------|------|
| C1 | spec.md §五「修改文件」与 file-inventory.md §1.2 一致性 | ✅ 已一致,无需处置 |
| C2 | 字体引入位置:design-tokens.md §五说 `main.tsx`/`app.tsx`,tasks.md P0-8 说 `global.less` | ✅ 统一为 `src/global.less`(与现有 `inter.less` 引入方式一致) |
| C3 | components-api.md §5.1 提到复用 `Segmented` 组件,未确认存在 | ⚠️ P0-6 实施时确认,不存在则 ModeSwitcher 自实现 |

### 微调项

- Dark 主题 `--trae-grey`/`--trae-grey-2` 从文档原值 `#fff` 微调为 `#c8ccc9`/`#9aa09c`(提升层次),已在 design-tokens.md §2.3 记录

---

## Phase 0 实施评审(2026-07-30)

### 评审结论:⚠️ 通过(条件性),已修复 P0 必修 + P1 应修 + P2 易修项

### 评审发现的问题与处置

| 优先级 | 编号 | 类型 | 问题 | 处置 |
|--------|------|------|------|------|
| P0 | C1 | 一致性 | spec.md 基线 680 与实际 687 不符 | ✅ 已更新 |
| P0 | C2 | 一致性 | design-tokens.md §五 字体引入位置未同步 | ✅ 已更新为 global.less |
| P0 | B1 | 正确性 | `--trae-ink-2` Dark 主题未覆盖 | ✅ 已补充覆盖 |
| P1 | C3 | 一致性 | components-api.md Segmented 决策未记录 | ✅ 已记录决策 |
| P1 | Q1 | 质量 | `WORK_MODE_ICON` 死代码 | ✅ 已删除 |
| P1 | Q2 | 质量 | ToolPanel button 嵌套 button | ✅ actions 移到 trigger 外 |
| P1 | Q3 | 质量 | TaskProgress 受控闭包陷阱 | ✅ 改用 ref 跟踪最新值 |
| P1 | A1 | 可访问性 | TaskCard 缺 aria-label | ✅ 已添加 |
| P1 | A2 | 可访问性 | TaskProgress 节点缺 aria-label | ✅ 已添加 |
| P2 | C4 | 一致性 | spec.md §五 缺 types.ts/constants.ts | ✅ 已补全 |
| P2 | B3 | 正确性 | Tailwind 缺 trae-card-hover 工具类 | ✅ 已添加 |
| P2 | Q4 | 质量 | TaskProgress 嵌套子节点不自动滚动 | ✅ 递归查找最新节点 |
| P2 | Q5 | 质量 | TaskProgress `level` prop 未使用 | ✅ 已移除 |
| P2 | Q6 | 质量 | TaskCard cursor-pointer 硬编码 | ✅ 条件化 |
| P2 | Q7 | 质量 | TaskCard `icon` prop 未实现 | ✅ 从 API 移除(YAGNI) |
| P2 | Q8 | 质量 | formatTime 冗余 try/catch | ✅ 已移除 |
| P2 | Q9 | 质量 | ToolPanel `import * as` 影响 tree-shaking | ✅ 改为显式映射 |
| P2 | A3 | 可访问性 | ModeSwitcher radiogroup 缺 aria-label | ✅ 已添加 |

### 暂未处置项

| 优先级 | 编号 | 问题 | 暂不处置原因 |
|--------|------|------|------|
| P2 | B2 | `--trae-card-bg-hover` Light/Dark 相同 | 需 Storybook Dark 主题人工验证后再定值 |
| P2 | T1 | 覆盖率工具显示 0% | esbuild-jest 已知问题,需切换测试框架 |
| P2 | T2 | 无 Chromatic 视觉回归 | 工具未配置,留待后续 |

---

## 一、背景与动机

### 1.1 当前 AgentUI 的设计局限

AgentUI 当前采用「Header + Outlet」平铺布局,功能模块(Chats/Agents/Datasets/Memories)通过导航并列,存在以下局限:

| 维度 | 当前状态 | 问题 |
|------|----------|------|
| 布局 | [root-layout.tsx](../../src/layouts/root-layout.tsx) Header + Outlet | 功能平铺,缺少任务中心化视角 |
| 视觉 | [less/variable.less](../../src/less/variable.less) + Tailwind 双轨 | Design Token 分散,无统一设计系统 |
| 模式 | 无模式概念 | Canvas/Chat/Agent 平铺,用户需手动导航 |
| 交互 | 跳转页面查看产物 | 对话流与产物预览割裂 |

### 1.2 TRAE Work 的设计启示

TRAE Work 作为 AI 原生工作台,其设计范式值得借鉴:

- **任务驱动**:首页即任务下发入口,任务列表为中心
- **多模式切换**:Work/Code/Design 三模式,不同模式呈现不同工具集
- **对话内预览**:对话流中产出可在对话内直接预览验收
- **节点化进度**:工具调用折叠为可展开节点,delta 实时流式
- **工具面板**:右侧可折叠面板,实时跟随模式切换

### 1.3 重构动机

- **统一设计系统**:消除 Less/Tailwind 双轨,建立单一权威 Token 源
- **提升视觉一致性**:全面对齐 TRAE Work 视觉风格
- **优化交互范式**:从功能导航转向任务驱动
- **降低维护成本**:统一 Token 后,主题切换/响应式适配更易维护

---

## 二、重构范围(本次 spec 覆盖)

本次 spec 仅覆盖 **阶段 0 + 阶段 1**,后续阶段(模式切换/节点化对话流/任务管理)在后续 spec 中设计。

### 2.1 阶段 0:设计系统对齐

**目标**:建立 TRAE Work 风格的 Design Token,不改变现有功能

**范围**:
- 改造 [less/variable.less](../../src/less/variable.less),引入 CSS 变量层,对齐 TRAE Work 配色/圆角/阴影/字体
- 扩展 [tailwind.config.js](../../tailwind.config.js),映射新 Token 到 Tailwind 工具类
- 新增 4 个基础组件壳: `TaskCard` / `TaskProgress` / `ToolPanel` / `ModeSwitcher`
- 在 Storybook 中建立完整故事

**不在范围内**:
- 业务页面的视觉重构(阶段 1 处理)
- 现有组件的 API 变更(仅样式 token 替换)

### 2.2 阶段 1:三栏任务中心布局

**目标**:将 Header + Outlet 改造为 TRAE Work 风格的三栏布局

**范围**:
- 重构 [root-layout.tsx](../../src/layouts/root-layout.tsx) 为三栏 `grid-template-columns`
- 新增 `TaskSidebar`(左侧任务列表)
- 新增 `ToolPanelHost`(右侧可折叠工具面板容器)
- Header 简化为顶栏(Logo + 模式切换占位 + 用户)
- Nav 移至左侧栏顶部
- 旧路由保留作为回退(过渡期)

**不在范围内**:
- 模式切换的实际逻辑(阶段 2)
- 对话流节点化(阶段 3)
- 产物内嵌预览(阶段 3)

---

## 三、关键设计决策

### 3.1 视觉风格:全面对齐 TRAE Work

**决策**:视觉风格全面对齐 TRAE Work,包括配色/字体/圆角/阴影

**Token 来源**:从 [TRAE 概览页](https://docs.trae.cn/ide_trae-overview) 提取的 CSS 变量

**核心 Token**(完整清单见 [design-tokens.md](./design-tokens.md)):

```css
:root {
  /* 品牌色 */
  --trae-green: #11C566;
  --trae-green-dim: #0e9e52;
  --trae-green-bright: #32F08C;

  /* 中性色(Light) */
  --trae-ink: #0d0f0e;       /* 主文本 */
  --trae-grey: #3a403c;      /* 次文本 */
  --trae-grey-2: #5e655f;    /* 弱文本 */
  --trae-line: rgba(0,0,0,.18);      /* 分割线 */
  --trae-line-strong: rgba(0,0,0,.30); /* 强分割线 */

  /* 字体 */
  --trae-font-body: 'Inter', -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --trae-font-display: 'Outfit', 'Instrument Sans', -apple-system, sans-serif;
  --trae-font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

**AgentUI 保留**:仅保留 Logo(品牌识别),配色/字体/圆角/阴影全面切换

### 3.2 Design Token 位置:改造 less/variable.less

**决策**:在现有 [less/variable.less](../../src/less/variable.less) 基础上扩展,引入 CSS 变量层,向后兼容

**理由**:
- 避免新建 `src/design-tokens/` 导致的 Less/Tailwind 双轨
- 现有组件已依赖 `var(--xxx)` 形式的 CSS 变量(见 [tailwind.config.js](../../tailwind.config.js#L34-L120))
- 改造后单一权威源在 `variable.less`,Tailwind 通过 `var()` 映射

**三层结构**:
```
Layer 1: Less 变量(@xxx)        — 旧代码兼容,标记 @deprecated
Layer 2: CSS 变量(var(--xxx))    — 新权威源,对齐 TRAE Work
Layer 3: Tailwind 工具类(bg-xxx) — 通过 var() 映射到 Layer 2
```

### 3.3 验收标准:Storybook + Jest + 现有页面无回归

**决策**:三者结合

**具体标准**:
1. **Storybook**:4 个基础组件 + 三栏布局组件有完整故事,Chromatic 视觉回归通过
2. **Jest 单测**:新增组件单测覆盖率 ≥ 80%
3. **现有页面无回归**:
   - Jest 现有测试 0 回归
   - 手动验证核心流程(登录/聊天/画布/知识库)视觉无破坏

### 3.4 回退策略:旧路由保留

**决策**:阶段 1 完成后,旧路由保留 2 周,通过 feature flag 切换

**实现**:通过 `localStorage.trae_work_layout` 控制(值: `legacy` | `three-column`),默认 `three-column`

---

## 四、阶段划分与验收

### 4.1 阶段 0:设计系统对齐(P0)

**任务清单**(详见 [tasks.md](./tasks.md)):
- P0-1: 改造 [less/variable.less](../../src/less/variable.less),引入 TRAE Work CSS 变量
- P0-2: 扩展 [tailwind.config.js](../../tailwind.config.js),映射新 Token
- P0-3: 新增 `TaskCard` 组件
- P0-4: 新增 `TaskProgress` 组件
- P0-5: 新增 `ToolPanel` 组件
- P0-6: 新增 `ModeSwitcher` 组件
- P0-7: Storybook 故事 + Jest 单测
- P0-8: 回归测试

**验收**:
- ✅ `variable.less` 含完整 TRAE Work Token(Light + Dark)
- ✅ Tailwind 工具类映射新 Token
- ✅ 4 个组件在 Storybook 中可交互
- ✅ Jest 单测覆盖率 ≥ 80%
- ✅ 现有 Jest 测试 0 回归
- ✅ 手动验证核心流程视觉无破坏

### 4.2 阶段 1:三栏任务中心布局(P1)

**任务清单**(详见 [tasks.md](./tasks.md)):
- P1-1: 新增 `ThreeColumnLayout` 布局组件
- P1-2: 新增 `TaskSidebar` 组件(左侧任务列表)
- P1-3: 新增 `ToolPanelHost` 组件(右侧可折叠面板容器)
- P1-4: 重构 [root-layout.tsx](../../src/layouts/root-layout.tsx),集成三栏布局
- P1-5: 重构 [header.tsx](../../src/layouts/components/header.tsx),简化为顶栏
- P1-6: 适配核心页面(chat/agents/datasets)到三栏布局
- P1-7: Feature flag + 旧路由保留
- P1-8: Storybook 故事 + Jest 单测
- P1-9: 回归测试

**验收**:
- ✅ 三栏布局可用(侧栏 + 主区 + 工具面板)
- ✅ 侧栏可折叠,工具面板可折叠
- ✅ 旧路由通过 feature flag 可回退
- ✅ 核心流程(登录/聊天/画布/知识库)无回归
- ✅ Jest 单测覆盖率 ≥ 80%
- ✅ Storybook 故事完整

---

## 五、文件清单(摘要)

完整清单见 [file-inventory.md](./file-inventory.md)。

### 5.1 新增文件

| 路径 | 用途 |
|------|------|
| `src/components/trae-work/types.ts` | 组件共享类型定义 |
| `src/components/trae-work/constants.ts` | 组件共享常量(状态色映射、图标映射等) |
| `src/components/trae-work/task-card.tsx` | 任务卡片组件 |
| `src/components/trae-work/task-progress.tsx` | 任务进度组件 |
| `src/components/trae-work/tool-panel.tsx` | 工具面板组件 |
| `src/components/trae-work/mode-switcher.tsx` | 模式切换组件 |
| `src/components/trae-work/index.ts` | 组件 re-export |
| `src/layouts/three-column-layout.tsx` | 三栏布局组件 |
| `src/layouts/components/task-sidebar.tsx` | 左侧任务栏 |
| `src/layouts/components/tool-panel-host.tsx` | 右侧工具面板容器 |
| `src/layouts/components/top-bar.tsx` | 简化顶栏(替代 header) |
| `src/components/trae-work/task-card.stories.tsx` | Storybook 故事 |
| `src/components/trae-work/task-progress.stories.tsx` | Storybook 故事 |
| `src/components/trae-work/tool-panel.stories.tsx` | Storybook 故事 |
| `src/components/trae-work/mode-switcher.stories.tsx` | Storybook 故事 |
| `src/layouts/three-column-layout.stories.tsx` | Storybook 故事 |
| `src/components/trae-work/task-card.test.tsx` | Jest 单测 |
| `src/components/trae-work/task-progress.test.tsx` | Jest 单测 |
| `src/components/trae-work/tool-panel.test.tsx` | Jest 单测 |
| `src/components/trae-work/mode-switcher.test.tsx` | Jest 单测 |
| `src/layouts/three-column-layout.test.tsx` | Jest 单测 |

### 5.2 修改文件

| 路径 | 改动 |
|------|------|
| `src/less/variable.less` | 引入 TRAE Work CSS 变量(权威源) |
| `tailwind.config.js` | 映射新 Token 到 Tailwind 工具类 |
| `src/layouts/root-layout.tsx` | 集成三栏布局 + feature flag |
| `src/layouts/components/header.tsx` | 简化为顶栏(过渡期保留) |
| `src/app.tsx` | 注入 feature flag provider(如需) |
| `.storybook/main.ts` | 确保 trae-work 组件被 Storybook 识别 |

### 5.3 不修改文件

- `bff/**` — BFF 契约不变
- `src/components/ui/**` — shadcn 基础组件不变(仅 token 引用层变化)
- `src/pages/**` 业务逻辑 — 阶段 1 仅适配布局,不改业务逻辑

---

## 六、风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | Token 替换导致现有页面视觉破坏 | 高 | 保留旧 Less 变量(@deprecated),新 Token 通过 CSS 变量层叠加,渐进替换 |
| R2 | 三栏布局在小屏幕不适配 | 中 | 响应式断点:< 1024px 折叠侧栏,< 768px 切回单栏 |
| R3 | Storybook 与 Jest 环境差异 | 低 | 组件纯展示型,Storybook + Jest 双轨验证 |
| R4 | Feature flag 切换导致状态丢失 | 低 | flag 仅控制布局,不涉及业务状态;切换时刷新页面 |
| R5 | TRAE Work 配色与 AgentUI 品牌冲突 | 中 | 保留 AgentUI Logo,配色对齐 TRAE Work(已决策) |

---

## 七、后续 spec 预告

本 spec 完成后,后续阶段将在独立 spec 中设计:

- **spec-014**: 阶段 2 — Work/Code/Canvas 模式切换
- **spec-015**: 阶段 3 — 节点化对话流 + 产物内嵌预览
- **spec-016**: 阶段 4 — 任务管理(可选)

---

## 八、参考文档

- [TRAE Work 概述](https://docs.trae.cn/work_what-is-trae-solo)
- [TRAE 概览(视觉规范来源)](https://docs.trae.cn/ide_trae-overview)
- [AgentUI 前端架构](../../docs/frontend-architecture.md)
- [Design Token 定义](./design-tokens.md)
- [组件 API 定义](./components-api.md)
- [文件清单](./file-inventory.md)
- [任务分解](./tasks.md)
