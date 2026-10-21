# AgentUI UI 风格与 TRAE 风格落地审计

> **基线**: `dev` @ `4bceebf`(2026-10-17),审计日期 2026-10-18
> **口径区分**
> - **字面 TRAE**:spec-013 定义的 TRAE Work Token、字体与 4 个 `trae-work` 组件。
> - **TRAE 类**:任务中心、工作台侧栏、节点化工具调用、Composer 芯片等交互范式(不要求使用 TRAE Token)。
>
> **审计方法**:代码检索 + git 历史 + 单测实跑(`npx jest src/components/trae-work` → 6 suites / 224 tests passed)。
>
> **评审状态**:已经 [评审记录](./trae-ui-style-audit-review.md) 复核;本版修正了构建 tree-shaking、
> canvas S1 挂载点、P1 可恢复性、“任务中心化”、组件完整性等结论。
>
> **时效声明**:§1-§7 为 2026-10-18 路线 B **实施前**的审计基线;实施后的当前状态见 §九,
> 两者不一致处以 §九 为准。

---

## 一、结论速览

1. **规范层已建、组件层已建、布局层已拆、业务页未迁移。**
   spec-013 的 Phase 0(token + 4 组件)仍在仓库中且测试全绿;Phase 1(三栏布局)已在
   `1a71494`(2026-10-10)被整体删除,当前应用回到 `Header + Outlet` 的 legacy 壳。
2. **字面 TRAE 风格在生产界面几乎不可见。**
   4 个 `trae-work` 组件**没有任何业务引用**;TRAE 颜色/表面 Token 只在
   `src/layouts/components/global-search.tsx` 的 ⌘K 徽标上有 1 处生产使用。
   审计时品牌色仍是青绿 `rgb(0, 190, 180)`,不是 TRAE 的 `#11C566`;路线 B 实施后已切换,见 §九。
3. **真正“像 TRAE”的部分是后来独立演进的,不是 spec-013 的产物。**
   - `HubLayout` 的可折叠工作台侧栏(首页/任务/知识);
   - 聊天页 `Sessions + 对话 + 设置` 三栏、Composer 芯片行、Slash 面板、ToolCallCard、ReasoningPanel、ApprovalCard。
   这些交互接近 TRAE Work / Intellect webui,但全部使用旧语义 Token。
4. **下一步最大的问题不是“继续写组件”,而是先决策。**
   是恢复 spec-013 的三栏工作台/模式切换,还是保留当前 hub IA、只吸收 TRAE 的视觉与交互,
   两种路线的后续任务完全不同。同日 `dbc5cbd` 已落地 HubLayout/hub 导航,
   实际方向更接近后者(提交说明未明示原因,属时间线推断)。

---

## 二、当前 UI 基座(非 TRAE 部分)

### 2.1 视觉 Token

| 维度 | 现状 | 证据 |
|---|---|---|
| 样式入口 | `tailwind.css` + `src/global.less` | `src/main.tsx:4-5` |
| 品牌/强调色(审计时) | teal `rgb(0, 190, 180)`;实施后已切 TRAE 绿 `17 197 102` | `tailwind.css:115`;见 §九 |
| 页面底色 | Light `#ffffff` / Dark `#161618` | `tailwind.css:94,234` |
| 卡片/分割 | `rgba(0,0,0,.05)` / `rgba(255,255,255,.05)` | `tailwind.css:96,235` |
| 主文本 | `rgb(22,22,24)` / `rgb(246,246,247)` | `tailwind.css:104,242` |
| 圆角 | shadcn `--radius: .5rem` + 自定义 5/7/8/10/12px 阶梯 | `tailwind.config.js:220-242` |
| 字体 | 正文 Inter;等宽 JetBrains Mono;Display Outfit(已加载未使用) | `src/global.less:3-10`;`tailwind.config.js:265-270` |
| 图标 | lucide-react | 组件内统一使用 |
| 主题 | `.dark` 选择器 | `tailwind.config.js:6`;`tailwind.css:137` |
| 组件库 | shadcn/ui(锁定,不得随意改) | `CLAUDE.md` |

### 2.2 布局与信息架构

| 区域 | 结构 | 证据 |
|---|---|---|
| 应用壳 | `Header + main` 单列 | `src/layouts/root-layout.tsx:5-13` |
| 顶栏 | 三列 Grid:Logo / 全局导航 / 搜索+语言+主题+头像 | `src/layouts/components/header.tsx:70-96` |
| Hub 页(首页/任务/知识) | 可折叠侧栏 md+ 64px ↔ 303px(<md 固定 64px)+ 内容区 | `src/layouts/components/hub-layout.tsx:58-63` |
| 聊天页 | `Sessions + 对话 Card + ChatSettings` | `src/pages/next-chats/chat/index.tsx:144-206` |
| 管理台 | 独立 admin layout | `src/routes.tsx:193-230` |

**说明**:当前没有应用级三栏布局、没有 `TaskSidebar`、没有 `ToolPanelHost`、没有 `TopBar`。
聊天页自己的三栏是页面内布局,不是 spec-013 的 Phase 1。

### 2.3 组件与交互约定

- 基础组件走 `src/components/ui/**`(shadcn + 项目扩展),业务组件按域放在 `src/components/*` 与 `src/pages/*`。
- 交互组件大量使用 `Collapsible`、`DropdownMenu`、`Tooltip`、`Card`、`Button` 变体。
- 主题切换由 `ThemeProvider` + `.dark` 完成,无 CSS-in-JS 主题系统。
- 仍有旧 Less 变量(`@gray2`、`@purple` 等)与遗留 `src/theme/*` 未被引用,属于历史包袱。

---

## 三、TRAE 资产清单与真实状态

### 3.1 spec-013 资产

| 资产 | 状态 | 证据 |
|---|---|---|
| Design Token(Light + Dark) | ✅ 已落地 | `src/less/variable.less:7-124` |
| Tailwind Token 映射 | ✅ 已落地 | `tailwind.config.js:186-288` |
| Outfit / JetBrains Mono 字体 | ✅ 已加载 | `src/global.less:3-10`;`package.json:49-50` |
| `TaskCard` / `TaskProgress` / `ToolPanel` / `ModeSwitcher` | ⚠️ 功能实现,224 测试通过;规范验收未完全达标(见 §4.4) | `src/components/trae-work/**` |
| 4 组 Storybook 故事 | ✅ 存在 | `src/components/trae-work/*.stories.tsx` |
| i18n 键(`taskCard`/`taskProgress`/`toolPanel`/`modeSwitcher`) | ⚠️ 仅 zh/en 已存在;其余 15 种语言回退英文 | `src/locales/zh.ts:2888-2915`;`src/locales/en.ts:3526+` |
| Phase 1 三栏布局 / TaskSidebar / ToolPanelHost / TopBar / useLayoutMode / useWorkMode | ❌ 已删除(可从 `1a71494^` 恢复) | `git show 1a71494`;`git cat-file -e 1a71494^:...` |
| Phase 2/3/4(spec-014/015/016) | ❌ 未设计 | `specs/` 下只有 013 |
| 业务页面 Token 迁移 | ❌ 未做 | `grep -r "trae-" src` 仅命中 `trae-work` 与 `global-search` |

### 3.2 关键转折:Phase 1 被整体移除

`1a71494 refactor(ui): 移除三栏布局与 Langfuse 配置,顶栏精简`(2026-10-10)的提交说明:

> 布局收敛为 legacy 唯一:删 ThreeColumnLayout/TopBar/ActivityBar/TaskSidebar/
> ToolPanelHost/GlobalSearch/use-layout-mode/use-work-mode,root-layout 直渲染
> Header+Outlet,chat 页移除模式分支。

注意:GlobalSearch 后来被迁回 Header(`header.tsx:93-96`),所以它仍在,但已不是 TopBar 中列。

**同日转向**:移除后约 20 小时,`dbc5cbd feat(nav): 新增任务/知识一级导航...`(2026-10-10 22:54)
引入 `HubLayout`,把聊天/智能体/知识库/文件/搜索收敛为 hub 子菜单。两条提交连起来看,
三栏移除更像是转向 hub IA,而非单纯的半途而废(提交说明未明示原因,属时间线推断)。

**可恢复性**:被删文件在 `1a71494^` 中均可恢复(`git cat-file -e` 验证 6 个文件),
因此“恢复三栏”不等于从零重写。

### 3.3 文档漂移

| 文档 | 声明 | 实际 |
|---|---|---|
| `spec.md:3-6` | “Phase 0 已完成,Phase 1 已完成” | Phase 1 已删除 |
| `tasks.md:504,515-516` | 仍有 3 个未勾选手工验收项 | 未执行 |
| `components-api.md:3-4` | “设计完成,待实施” | P0 组件早已实施 |
| `components-api.md:507-514` | 验收清单全未勾选 | P0 实际已完成 |
| `file-inventory.md:222-225` | 文件清单全未勾选 | 实际文件已存在/已删除混杂 |

结论:**spec-013 当前不能作为“已完成”基线使用**,继续开发前必须先校准文档状态。

---

## 四、已经使用 TRAE / TRAE 类风格的部分

### 4.1 字面 TRAE(使用了 TRAE Token / 组件)

| 使用点 | 程度 | 证据 |
|---|---|---|
| Design Token 层 | 完整定义,但生产引用极少 | `src/less/variable.less`;`tailwind.config.js:186-288` |
| 4 个 `trae-work` 组件 | 功能实现、224 测试通过、**0 业务引用**;但未完全满足“不硬编码颜色”等验收(见 §4.4) | `src/components/trae-work/index.ts`;全仓 `grep` 无业务 import |
| GlobalSearch ⌘K 徽标 | 唯一直接引用 TRAE 颜色/表面 Token 的生产代码 | `src/layouts/components/global-search.tsx:71-80`(`--trae-line`/`--trae-surface`/`text-trae-grey`) |
| JetBrains Mono | 通过 `font-mono` 在全站生效 | `tailwind.config.js:269`;工具名/管理台/代码块等约 20 处 |
| Outfit Display | 已加载但无任何 `font-display` 使用 | `grep -r "font-display" src` 为空 |
| Storybook | 有 `TRAE-Work/*` 故事,但预览未引入 token 文件(按代码推断) | `.storybook/preview.ts` 只 import `tailwind.css` |

**重要结论**:
- 除 `trae-work` 组件与 `global-search.tsx` 的 kbd 外,全仓没有 `trae-*` 工具类;业务代码中直接引用 `var(--trae-*)` 的仅 `global-search.tsx` 1 处(字体映射除外)。
- `trae-work` 组件是“孤岛”:JS 会被 tree-shake,但 Tailwind 仍会扫描 stories/tests 生成 `trae-*` 工具类(实测至少 19 个),CSS 不是零成本;其测试与故事仍消耗维护成本。
- 字面 TRAE 视觉(TRAE 绿、12px 卡片、发光阴影、毛玻璃顶栏、Outfit 标题)**在页面上看不到**。

### 4.2 结构性 TRAE 类(独立演进,未用 TRAE Token)

| 部分 | 对应 TRAE 概念 | 现状 | 证据 |
|---|---|---|---|
| `HubLayout` | 可折叠工作台侧栏 | 首页/任务/知识三处使用;md+ 64px ↔ 303px,<md 固定 64px | `hub-layout.tsx:58-63`;`pages/home`,`pages/tasks`,`pages/knowledge` |
| 任务 Hub | hub 化 IA 的一个域(非任务实体中心) | “任务”下挂 Chat/Agent 子菜单,无 task 实体 | `src/features/tasks/manifest.ts`;`pages/tasks/index.tsx` |
| 聊天工作台 | 会话列表 + 主区 + 右侧面板 | Sessions + Chat Card + ChatSettings | `chat/index.tsx:144-206` |
| Composer 芯片行 | TRAE/Intellect 式输入区 | 附件、语音、Thinking、模型、ContextRing、发送/停止 | `message-input/next.tsx:334-395` |
| Slash 命令面板 | 命令式操作 | 有 `/retry` `/undo` `/status` `/usage` `/model`;裸 `/` 不弹 | `slash-command-palette.tsx`;`interfaces/command.ts:80-85` |
| ToolCallCard | 节点化工具调用 | 折叠卡片:状态图标 + 工具名 + 参数/结果 | `next-message-item/tool-call-card.tsx:78-125` |
| ReasoningPanel | 思维链节点 | 流式自动展开、完成后折叠 | `next-message-item/reasoning-panel.tsx` |
| ApprovalCard / ClarifyCard | 人机协同节点 | 审批 4 选项、澄清输入 | `next-message-item/approval-card.tsx`,`clarify-card.tsx` |
| GlobalSearch ⌘K | 全局搜索入口(UI 壳) | UI 壳,`onChange` 直通,未接搜索逻辑 | `header.tsx:93-96`;`global-search.tsx` |

**这些部分“形似”TRAE,但视觉语言仍是旧体系**:teal 强调色、Inter 正文、shadcn 小圆角、无发光/毛玻璃。
它们与 spec-013 的 TRAE Token 没有代码关联。

**口径提醒**:本表多数“工作台类”证据来自 `docs/chat-gateway-capability-and-composer-ui-analysis.md`
对 **Intellect webui** 的实测,不是 spec-013 的 TRAE Work 原始范围;二者交互同源,
但不应把 Intellect webui 的改进项直接记作“TRAE 风格任务”。

### 4.3 尚未采用 TRAE / TRAE 类的部分

- 应用级三栏工作台、模式切换(Work/Code/Canvas)、任务列表/任务卡、工具面板宿主。
- 对话内产物预览 / 右侧 Files·Artifacts 工作区。
- 活动树聚合(目前工具卡是平铺列表,无 `Activity: N tools` 折叠行)。
- 消息时间戳、会话时间分组/过滤 chips/时长徽标、流式排队。
- 全局搜索的真实检索能力。
- 管理台、数据集、Agent、登录、用户设置等业务页的 TRAE 化视觉。

### 4.4 组件质量与验收缺口(评审补充)

- **硬编码颜色**:`constants.ts:10,28`、`task-progress.tsx:226`、`task-card.tsx:197` 使用 `#ef4444`;
  `tool-panel.tsx:119` 使用 `#000`;`mode-switcher.tsx:105` 使用 `text-black`。
  与 spec 验收“使用 TRAE Token,不硬编码颜色”不符。根因之一是 TRAE Token 集没有
  error/success 语义色,组件只能硬编码;需先补 `--trae-error` 或复用 `--state-error`。
- **i18n**:`ModeSwitcher` 的 Work/Code/Canvas 标签来自 `WORK_MODE_LABEL` 硬编码英文,
  仅 `aria-label` 使用了 `modeSwitcher.label`。
- **图标 API**:`ToolPanel` 的 `ICON_MAP` 仅 5 个图标名,未列出的 `icon` 静默为 `null`。
- **可访问性**:`TaskCard` 外层 `role="button"`(`task-card.tsx:65`)内嵌 retry/delete 两个 `<button>`;
  操作区仅 `group-hover:opacity-100`(`task-card.tsx:181`),键盘聚焦时不可见;
  外层 `onKeyDown`(`task-card.tsx:70-75`)未判断 `e.target === e.currentTarget`,
  嵌套按钮的 Enter/Space 会冒泡触发整卡点击。
- **RTL**:`TaskCard` 选中条用 `borderLeft`(`task-card.tsx:77`);`ModeSwitcher` 竖排指示条用
  `left-0`/`rounded-r-full`(`mode-switcher.tsx:118`);`ToolPanel` 使用 `text-left`(`tool-panel.tsx:94`)。

**结论**:4 个组件“功能实现、测试通过”,但**规范验收未完全达标**;若采用,应先做组件整改。

---

## 五、剩余任务清单

> 优先级口径:`P0` = 阻塞后续 / 文档与死代码;`P1` = 视觉系统收口;`P2` = 工作台类交互(TRAE / Intellect webui);`P3` = 任务中心/模式;`P4` = 质量门禁。

### P0 — 决策与清理(建议先做)

> 评审注:真正阻塞的是 1(去留决策);2-5 可并行/后置,不必全部视为 P0。

| # | 任务 | 说明 | 依赖 |
|---|---|---|---|
| 1 | **确定 spec-013 去留** | 恢复三栏工作台 vs 保留 hub IA;两种路线决定后续全部任务 | 产品决策 |
| 2 | **校准 spec 文档** | `spec.md` 状态、`tasks.md` 未勾选项、`components-api.md` “待实施”、`file-inventory.md` 清单 | 1 |
| 3 | **处理 `trae-work` 孤岛** | 采用(接入 hub/chat)或删除(连同 stories/tests/i18n 键);不要长期保留 0 引用代码 | 1 |
| 4 | **统一品牌色** | 当前 teal `rgb(0,190,180)` vs TRAE `#11C566`;二选一后收敛 `--accent-primary` 与 `trae-green` | 1 |
| 5 | **修复 Storybook Token 注入** | `preview.ts` 增加 `variable.less`/`global.less`;补 Light/Dark 切换与视觉回归 | 3;若删除 trae-work 则取消 |

### P1 — 视觉系统收口

| # | 任务 | 说明 | 证据 |
|---|---|---|---|
| 6 | 统一两层 Token(选定权威层) | 避免 `--trae-*` 与 `--bg-*` 双轨;业务组件只依赖语义层 | `tailwind.config.js:186-288`;`tailwind.css:94-135` |
| 7 | 迁移 Header / Hub / Chat 到统一 Token | 当前 GlobalSearch 的 kbd 是唯一直接使用 TRAE 色的点,其余仍是旧色 | `global-search.tsx:71-80` |
| 8 | 清掉遗留 Less / theme | `variable.less:126-147` 的 `@deprecated` 变量(实际仍被 `@selectedBackgroundColor` 2 处、`@blurBackground` 2 处引用)、`src/theme/*` 未被引用 | `grep` 无 import;清理前需迁移 `mixins.less` 与两个 chunk-card |
| 9 | Dark 主题专项审计 | spec 遗留 B2(`--trae-card-bg-hover` Light/Dark 相同)未验证;补对比度与卡片层次 | `spec.md:68-75` |
| 10 | 字体策略收口 | Outfit 已加载但 Tailwind `font-display` 工具类 0 使用(`inter.less` 的 CSS `font-display: swap` 不算);要么应用,要么移除依赖 | `grep -r "font-display" src/**/*.tsx` 为空 |
| 11 | 硬编码颜色替换 | `text-emerald-500`、`bg-green-*`、`#ef4444`/`#000` 等统一到语义色;TRAE Token 集缺 error/success 语义色,需先补 `--trae-error` 或复用 `--state-error` | `tool-call-card.tsx:74`;`trae-work/constants.ts:10,28` |
| 12 | 收敛 Token 注入方式 | 宿主与 canvas 插件两处 `less.additionalData` 都把 `:root/.dark` 注入每个 `.less`,canvas 产物已出现哈希化 `._dark_*`;建议单一全局入口 | `vite.config.ts:229-239`;`packages/canvas-plugin/vite.config.ts:232-244`;`packages/canvas-plugin/ui/dist/index.css` |

### P2 — 工作台类交互(收益最高)

> 评审注:本节多数条目来自 Intellect webui 对比,不是 spec-013 TRAE Work 的原始范围;引用时应标为“工作台类”。

| # | 任务 | 说明 | 现状证据 |
|---|---|---|---|
| 13 | **活动树聚合** | 把平铺 ToolCallCard 聚合为 `Activity: N tools` 可折叠行 + 当前工具/计时 | `message-item/index.tsx:190-203` 为平铺列表 |
| 14 | **流式状态行** | `Searching workspace · Working for 00:34` / `Done in 59s` | 全仓无对应 UI |
| 15 | **消息时间戳 + hover 操作** | 用户消息 Edit/Fork、assistant Regenerate/Copy 对齐;数据缺口:`IMessage` 无 `created_at`,需 BFF 或客户端补时间 | 消息卡无时间戳 |
| 16 | **裸 `/` 弹全量命令列表** | 当前 `isSlashCommandVisible` 要求 commandName/arg 非空 | `interfaces/command.ts:80-85` |
| 17 | **右侧 Files/Artifacts 工作区面板** | 右侧已由 ChatSettings 占 `w-[440px]`(`chat-settings.tsx:151`),需 tabs/替换/抽屉;canvas S1 是模块共享面,不是现成 UI 挂载点,需单独设计 | `chat/index.tsx:202-205` |
| 18 | **会话列表分组/过滤/时长** | 当前仅搜索 + 列表,无 TODAY 分组/过滤 chips/时长;时长可由 `create_time`/`update_time` 计算,消息数列表 API 未提供,需确认 | `sessions.tsx:294-305` |
| 19 | **流式排队** | 流式中继续发送 → Queued messages,结束后依次发出 | 全仓无 queue 逻辑 |
| 20 | **空态建议卡** | 当前只有一行 `chat.noMessages` 文本 | `single-chat-box.tsx:162-169` |
| 21 | **Composer 观感收口** | 发送/停止形变已有;聚焦描边仍是 teal(非 TRAE 绿),统一主题色 | `message-input/next.tsx:229-235,380-395` |

### P3 — 任务中心 / 模式切换(取决于 P0-1)

| # | 任务 | 说明 |
|---|---|---|
| 22 | 任务实体与列表 | `TaskCard` 需要 task 数据源;当前 “任务” 只是 chat/agent 的 hub,无任务实体,后端 API 未确认 |
| 23 | `TaskSidebar` + `ToolPanelHost` | spec-013 组件已删除,但 `1a71494^` 可恢复;需接真实数据 |
| 24 | Work/Code/Canvas 模式切换 | `ModeSwitcher` 只是 UI 壳;无路由、无工具集、无状态持久化 |
| 25 | 三栏布局 feature flag | 原 `useLayoutMode` 已删除但可从 `1a71494^` 恢复;仍需重新评估回退策略 |

### 与 spec-013 阶段规划的对应关系

| spec 阶段 | 原计划 | 当前状态 | 本次任务编号 |
|---|---|---|---|
| Phase 0 | Token + 4 个基础组件 | ⚠️ 功能完成,规范验收未完全达标;组件 0 引用 | 3、5、6-12 |
| Phase 1 | 三栏布局 + TaskSidebar + ToolPanelHost + TopBar | ⚠️ 曾完成,`1a71494` 已删除;可从历史恢复 | 22-25(仅恢复时) |
| Phase 2(spec-014) | Work/Code/Canvas 模式切换 | ❌ 未设计、未实现 | 24 |
| Phase 3(spec-015) | 节点化对话流 + 产物内嵌预览 | ⚠️ 有零散卡片,无聚合/预览 | 13-17 |
| Phase 4(spec-016) | 任务管理 | ❌ 未设计;当前“任务”只是 chat/agent hub | 22 |

### P4 — 质量门禁

| # | 任务 | 说明 |
|---|---|---|
| 26 | 手工回归清单 | `tasks.md:504,515-516` 未执行:登录/聊天/画布/知识库、Light/Dark、响应式 |
| 27 | 视觉回归 | 无 Chromatic/截图对比;Storybook 目前连 token 都没注入 |
| 28 | i18n 收口 | `modeSwitcher`/`toolPanelHost`/`taskProgress` 等键若删组件需清理;若保留需补齐语言;ModeSwitcher 标签当前硬编码英文 |
| 29 | 死代码/文档清理 | `trae-work`、`src/theme`、旧 Less、spec 漂移一次清完 |
| 30 | 可访问性/RTL 专项 | TaskCard 嵌套按钮/键盘冒泡/hover-only;ModeSwitcher `left-0`;TaskCard `borderLeft`;文本硬编码 |

---

## 六、建议路线

### 路线 A:继续 spec-013(恢复三栏 + 模式 + 任务中心)

- 适合:产品明确要做 TRAE Work 式工作台,且愿意承担布局重构。
- 代价:从 `1a71494^` 恢复已删除的布局组件 + 适配模式状态/任务数据模型;与当前 hub IA 冲突,需要迁移首页/任务/知识入口(成本低于“从零重写”)。
- 前置:先做 P0-1、P0-4,否则会在错误的品牌色/错误的布局假设上返工。

### 路线 B(建议):保留 hub IA,吸收 TRAE 视觉与交互

- 不动应用级布局,把 TRAE 的“工作台感”落在:
  1. 统一 Token/品牌色(P0-4、P1-6~12);
  2. 聊天活动树 + 流式状态 + 时间戳 + 裸 `/` + 右侧工作区(P2-13~18);
  3. 在任务 Hub 中接入 `TaskCard` 列表(P3-22,若任务数据可用);
  4. `ToolPanel`/`TaskProgress` 复用到右侧面板/活动树(需先整改 §4.4 的硬编码/a11y,并写 Props 适配层),而不是另起三栏。
- 收益:与现有代码演进方向一致(同日 `dbc5cbd` 已落地 HubLayout/hub 导航),单点可交付,回归面小。
- 代价:放弃 spec-013 的 Work/Code/Canvas 三模式形态(可另立 spec)。

### 路线 C:归档 spec-013

- 删除 `trae-work` 与 TRAE Token/字体,只保留 JetBrains Mono(已全站生效)与 GlobalSearch;删 Token 前先把 `global-search` 的 kbd 迁到语义 Token。
- 适合:确认不再走 TRAE 视觉。
- 代价:浪费已完成的 224 个测试与设计资产;不推荐在未评估前执行。

---

## 七、证据索引

### 7.1 关键文件

| 文件 | 作用 |
|---|---|
| `specs/013-trae-work-ui-refactor/spec.md` | 范围、阶段、后续 spec 预告 |
| `specs/013-trae-work-ui-refactor/tasks.md` | P0/P1 任务与验收(含未勾选项) |
| `specs/013-trae-work-ui-refactor/design-tokens.md` | Token 全量定义 |
| `specs/013-trae-work-ui-refactor/components-api.md` | 8 个组件的 API(状态已过期) |
| `src/less/variable.less` | TRAE Token 权威源 |
| `tailwind.config.js` | Token → Tailwind 映射 |
| `src/global.less` | 字体引入 |
| `src/components/trae-work/` | 4 组件 + stories + tests |
| `src/layouts/components/global-search.tsx` | 唯一直接使用 TRAE 颜色/表面 Token 的生产点 |
| `src/layouts/components/hub-layout.tsx` | 当前工作台式侧栏 |
| `src/pages/next-chats/chat/index.tsx` | 聊天三栏 |
| `src/components/message-input/next.tsx` | Composer 芯片/模型/ContextRing/停止 |
| `src/components/message-item/index.tsx` | 工具卡平铺列表 |
| `docs/chat-gateway-capability-and-composer-ui-analysis.md` | TRAE 类 Composer/工作台差距与 P0-P3 方案 |

### 7.2 关键命令

```bash
# TRAE Token/类名使用面
grep -rn "trae-" src --include="*.tsx" --include="*.ts"
# 结果为:trae-work/* + layouts/components/global-search.tsx

# trae-work 组件是否被业务引用
grep -rn "trae-work" src --include="*.ts" --include="*.tsx" | grep -v "src/components/trae-work/"
# 结果为空

# Phase 1 移除证据
git show --stat 1a71494

# 单测
npx jest src/components/trae-work
# 6 suites / 224 tests passed(2026-10-18 实跑)

# 同日 hub IA 转向证据
git show --stat dbc5cbd

# 被删 P1 文件可恢复性
git cat-file -e 1a71494^:src/layouts/three-column-layout.tsx && echo ok

# CSS 不是零成本:Tailwind 仍生成 trae-* 工具类(实测至少 19 个)
npx tailwindcss -i tailwind.css -o /tmp/agentui-tw.css --minify

# 静态检查
npx tsc --noEmit
npx eslint src/components/trae-work --ext .ts,.tsx
```

---

## 八、评审记录

本审计已由 [trae-ui-style-audit-review.md](./trae-ui-style-audit-review.md) 复核。
评审结论:**有条件通过**。已按评审修正构建 tree-shaking、canvas S1 挂载点、P1 可恢复性、
“任务中心化”、组件完整性等 6 处高优先级问题,并补充数据可用性、RTL/i18n、
ChatSettings 右槽冲突等范围缺口。

---

## 九、路线 B 实施进展(2026-10-18)

已按评审路线 B 完成第一轮实施,详见 [trae-route-b-implementation.md](./trae-route-b-implementation.md):

- **全站 accent 切换 TRAE 绿**:`--accent-primary` → `17 197 102`;登录页/文件状态徽标同步。
- **组件整改**:新增 `--trae-error`/`--trae-on-accent`;硬编码色、ModeSwitcher i18n、RTL、
  TaskCard 已重构为“卡片主体 button + 操作区 sibling”,嵌套交互元素问题已消除。
- **聊天工作台**:活动树聚合(`Activity · N tools`,50 条渲染上限 + Show more/less)、
  流式状态行(`Working for`/`Done in`)、裸 `/` 全量命令面板已落地;zh/en i18n 已补。
- **右侧工作区**:Files/References tabs,汇总上传文件、可下载产物与引用文档;与 ChatSettings 共用右槽。
- **收尾项**:消息时间戳、Task Hub 会话任务列表(分组/时长/分页)、多模型状态行、
  Chromatic 配置 + 新故事、旧蓝/emerald/状态色清理已完成。
- **验证**:全量 Jest **670 passed / 44 suites**;`tsc --noEmit` 通过;`build`/`build-storybook` 通过。
- **代码评审**:质量/安全评审见 [trae-route-b-code-review.md](./trae-route-b-code-review.md);
  已修复 O(n)/token、StreamStatus 旧 startedAt、裸 `/` 误执行、TaskCard 嵌套 ARIA、
  accent 文本对比度、StreamStatus 失败/停止终态等中危问题。
- **仍待外部依赖**:真实 Task 实体/API(当前为 Session 投影)、Chromatic baseline(token)、
  `Sessions` 侧栏多会话数据模型、第三方/语义硬编码色(保留)。
- **收尾评审**:见 [route-b-closeout-review.md](./route-b-closeout-review.md)。
