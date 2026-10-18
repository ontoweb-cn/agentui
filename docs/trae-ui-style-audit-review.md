# TRAE UI 风格审计 — 评审记录

> **评审对象**: [trae-ui-style-audit.md](./trae-ui-style-audit.md)(2026-10-18)
> **评审基线**: `dev` @ `4bceebf`
> **评审结论**: **有条件通过**。核心事实(Phase 1 删除、组件 0 引用、Token 未迁移)成立,
> 方向判断可用;但有 **6 处高优先级修正、10 处中优先级补充、5 项方法限制**。
> 修正后可作为“是否继续 TRAE 路线”的决策输入,不宜直接作为验收基线。
>
> **后续**:2026-10-18 已按路线 B 实施第一轮,见 [trae-route-b-implementation.md](./trae-route-b-implementation.md)。

---

## 一、总体评价

### 1.1 经复核成立的部分

| 结论 | 复核证据 |
|---|---|
| Phase 1 三栏布局已被 `1a71494` 删除 | `git show --stat 1a71494`;当前 `src/layouts/` 无 `three-column-layout.tsx` 等文件 |
| `trae-work` 组件 0 业务引用 | `grep -rn "trae-work" src` 仅命中组件目录自身;业务 import 为空 |
| GlobalSearch kbd 是唯一直接使用 TRAE 颜色/表面 Token 的生产代码 | `global-search.tsx:71-80`;全仓其余 `trae-*` 均在 `trae-work/` 内 |
| JetBrains Mono 通过 `font-mono` 生效,Outfit 的 Tailwind `font-display` 未使用 | `tailwind.config.js:269`;`grep "font-display" src/**/*.tsx` 为空 |
| 当前品牌色是 teal `rgb(0,190,180)`,不是 TRAE 绿 | `tailwind.css:115` |
| spec-013 文档漂移 | `spec.md:3-6`、`tasks.md:504,515-516`、`components-api.md:3-4,507-514`、`file-inventory.md:222-225` |
| spec-014/015/016 未设计 | `specs/` 仅有 013;全仓仅在 spec-013 的“预告”中提及 |
| Token 名称与设计文档一致 | `variable.less` 与 `design-tokens.md` 各 78 个 `--trae-*`,名称集合完全一致 |
| 组件测试与静态检查通过 | `npx jest src/components/trae-work` 6 suites / 224 tests;`npx tsc --noEmit`、`npx eslint src/components/trae-work` 均通过 |

### 1.2 一句话评价

盘点做得足够细,但**把“代码存在”近似成了“规范完成”,把“文档描述”近似成了“运行事实”**;
这两处近似导致了下面的主要修正项。

---

## 二、必须修正(高优先级)

### H1. “生产构建会被 tree-shaking 掉”只对 JS 成立,CSS 不是零成本

- **原文**:§4.1“`trae-work` 组件是孤岛,生产构建会被 tree-shaking 掉”。
- **问题**:`tailwind.config.js` 的 `content` 包含 `./src/components/**/*.tsx`,
  stories/tests 也在扫描面内;TRAE 工具类仍会被生成。
- **复核**:执行 `npx tailwindcss -i tailwind.css -o /tmp/agentui-tw.css --minify` 后,
  生成结果包含 `.text-trae-*` / `.bg-trae-*` / `.border-trae-*` / `.duration-trae-*` 等 **至少 19 个** 工具类。
- **修正**:改为“JS 会被 tree-shake;CSS 仍会产出 TRAE 工具类,且 `--trae-*` 变量经 less
  `additionalData` 注入,不能按零成本删除处理”。

### H2. “canvas S1 共享面是天然挂载点”是概念混淆

- **原文**:§5 P2-17“canvas S1 共享面是天然挂载点”。
- **问题**:canvas S1 的“共享面”是 `window.__AGENTUI_SHARED__` 的**模块共享面**
  (`docs/canvas-stage4-independent-build-spec.md:63`),不是聊天页右侧的 UI 面板;
  canvas spec 中没有“聊天侧 Files/Artifacts 面板”的设计。
- **修正**:改为“canvas S1 只解决模块共享,不提供聊天侧面板;右侧工作区需单独设计,
  并与 ChatSettings 的右槽冲突一起解决”。

### H3. “重写已删除的布局组件”高估了成本

- **原文**:§6 路线 A“重写已删除的 4 个布局组件”。
- **问题**:被删文件都在 `1a71494^` 中,可直接恢复。
- **复核**:`git cat-file -e 1a71494^:src/layouts/three-column-layout.tsx` 等 6 个文件均存在。
- **修正**:改为“从 git 历史恢复 + 适配”;路线 A 的成本应下调,
  但“与当前 hub IA 冲突”的结论不变。

### H4. “任务中心化 IA”不准确

- **原文**:§4.2“任务 Hub | 任务中心化 IA”。
- **问题**:当前一级导航是 Home / 任务 / 知识 / 记忆 / 应用;“任务”只是其中一个 hub,
  其内容是 chat/agent 子菜单,没有 task 实体、没有任务列表、没有任务状态。
- **修正**:改为“hub 化 IA;任务只是其中一个域,不是任务实体中心”。

### H5. “4 个组件实现完整”应降级为“功能实现,规范未完全达标”

- **原文**:§3.1“`TaskCard`/`TaskProgress`/`ToolPanel`/`ModeSwitcher` ✅ 已实现”。
- **问题**:组件确实能跑、测试也绿,但与 spec 验收“使用 TRAE Token,不硬编码颜色”不符:
  - `constants.ts:10,28`、`task-progress.tsx:226`、`task-card.tsx:197` 硬编码 `#ef4444`;
  - `tool-panel.tsx:119` 硬编码 `#000`;
  - `mode-switcher.tsx:105` 使用 `text-black`;
  - 根因之一:TRAE Token 集本身没有 error/success 语义色(`design-tokens.md`/`variable.less` 均无),
    组件只能硬编码;整改时需先补 `--trae-error` 或复用 `--state-error`;
  - `ModeSwitcher` 的 Work/Code/Canvas 标签来自 `WORK_MODE_LABEL` 硬编码英文,未走 i18n;
  - `ToolPanel` 的 `ICON_MAP` 只有 5 个图标名,未列出的 icon 静默为 `null`;
  - `TaskCard` 外层 `role="button"`(`task-card.tsx:65`)内嵌 retry/delete 两个 `<button>`;
    操作区仅 `group-hover:opacity-100`(`task-card.tsx:181`),键盘聚焦时不可见;
  - `TaskCard` 外层 `onKeyDown`(`task-card.tsx:70-75`)未判断 `e.target === e.currentTarget`,
    嵌套按钮上的 Enter/Space 会冒泡触发整卡点击;
  - `TaskCard` 选中条用 `borderLeft`(`task-card.tsx:77`),`ModeSwitcher` 竖排指示条用
    `left-0`/`rounded-r-full`(`mode-switcher.tsx:118`),RTL 下方向错误。
- **修正**:结论改为“功能实现、测试通过;规范验收未完全达标”,并把上述项列入组件整改。

### H6. 遗漏同日转向 HubLayout 的关键时间线

- **原文**:§3.2 只写了 `1a71494` 删除三栏。
- **问题**:同日 20 小时后 `dbc5cbd`(2026-10-10 22:54)新增
  “任务/知识一级导航”,引入 `HubLayout`,把聊天/智能体/知识库/文件/搜索收敛为 hub 子菜单。
  这条提交是“转向 hub IA”的直接证据,遗漏会削弱路线 B 的判断。
- **修正**:在 §3.2 增加时间线,并标注“提交说明未明示原因,属时间线推断”。

---

## 三、应修正(中优先级)

| # | 问题 | 原文位置 | 修正 |
|---|---|---|---|
| M1 | **P2 清单来源混淆** | §5 P2 | 多数条目来自 `docs/chat-gateway-capability-and-composer-ui-analysis.md` 对 **Intellect webui** 的实测,不是 spec-013 的 TRAE Work;应标为“工作台类”,不要直接记作“TRAE 风格任务” |
| M2 | **未核查数据可用性** | §5 P2-15/18 | `IMessage`/`Message` 没有 `created_at`,`IMessage` 只有 `toolCalls`/`reasoning` 等;消息时间戳需 BFF 或客户端补数据。`IConversation` 有 `create_time`/`update_time`(可算时长),但无消息数字段 |
| M3 | **右侧面板与 ChatSettings 冲突** | §5 P2-17 | `ChatSettings` 已占 `w-[440px]` 右槽(`chat-settings.tsx:151`);新增 Files/Artifacts 需 tabs/替换/抽屉,不能并列追加 |
| M4 | **RTL/i18n 未覆盖** | §4.1/§3.1 | `left-0`/`rounded-r-full`/`borderLeft`/`text-left`;Work/Code/Canvas 标签硬编码英文;`taskCard`/`taskProgress`/`toolPanel` 键仅 zh/en,其余 15 种语言回退英文;应补 RTL 与 i18n 专项 |
| M5 | **canvas-plugin 有自己的 less 注入** | §5 P1-12 | `packages/canvas-plugin/vite.config.ts:232-244` 也有 `additionalData`;修正需同时处理宿主与插件两处 |
| M6 | **deprecated Less 变量并非全未使用** | §5 P1-8 | `@selectedBackgroundColor` 2 处、`@blurBackground` 2 处仍在用;清理前需迁移 `mixins.less`、两个 `chunk-card` 的 `index.module.less` |
| M7 | **P0 过载** | §5 P0 | 真正阻塞的是“去留决策”;品牌色/Storybook/文档校准可并行或后置,不必全部卡在 P0 |
| M8 | **“TRAE 类”术语过宽** | 全文 | HubLayout/聊天三栏/Composer 是通用“工作台类”模式,不是 TRAE 独有;建议改为“工作台类(TRAE / Intellect webui)” |
| M9 | **Storybook 结论是静态推断** | §4.1 | `preview.ts` 未引入 token 文件,推断 `--trae-*` 无值;但未实际打开 Storybook 验证,应标注“待运行验证” |
| M10 | **路线 C 的删除前提不完整** | §6 路线 C | 删除 TRAE Token 前必须先迁移 `global-search.tsx` 的 `--trae-line`/`--trae-surface`/`text-trae-grey`,否则 kbd 样式会坏 |

---

## 四、可保留但需标注证据等级

| 结论 | 证据等级 | 说明 |
|---|---|---|
| Phase 1 被删除 | 高 | git 历史 + 当前文件缺失 |
| 组件 0 业务引用 | 高 | 全仓 grep |
| GlobalSearch 唯一 TRAE 色使用 | 高 | grep + 代码 |
| Token 78/78 名称一致 | 高 | 集合比对 |
| 224 tests / tsc / eslint 通过 | 高 | 本机实跑 |
| 文档漂移 | 高 | 文件行号 |
| Storybook token 缺失 | **中低** | 静态推断,未运行 |
| canvas S1 可作挂载点 | **低(已否定)** | 文档概念误读 |
| “同日转向 hub IA” | **中** | 时间线推断,提交说明未明说 |
| “路线 B 更合适” | **中** | 基于代码演进方向的判断,需产品确认 |

---

## 五、方法论限制

1. **未做运行时/视觉验证**:没有启动 Storybook、没有浏览器截图、没有 Dark 模式实测;
   “字面 TRAE 视觉在页面上看不到”是基于代码与 Token 使用面的推断,不是视觉比对结论。
2. **未做完整生产构建**:只跑了 Tailwind CLI 验证工具类生成,未跑 `npm run build`;
   对 CSS 体积、tree-shaking 的实际影响没有量化。
3. **只审计了 `dev` 分支**:P1 代码存在于 `1a71494^` 及其他可能分支;
   “当前没有三栏”只对 `dev` 成立。
4. **测试范围有限**:只实跑 `trae-work` 测试与全仓 `tsc`/局部 eslint,
   未跑全量 Jest、未跑 e2e、未跑 Storybook 构建。
5. **TRAE 视觉基准来自文档**:没有对照 TRAE Work 实际产品截图做像素/规范比对;
   “TRAE 绿/12px 圆角/毛玻璃”等以 spec-013 的 `design-tokens.md` 为准。

---

## 六、修正后的建议

1. **路线 B 仍然推荐,但理由要加强**:
   同日 `dbc5cbd` 已落地 HubLayout/hub 导航,说明团队实际选择了 hub IA;
   继续恢复三栏会与既有导航/路由/页面适配冲突。
   复用 `ToolPanel`/`TaskProgress` 前需先整改 H5 的硬编码/a11y,并写适配层
   (二者 Props 与 `ToolCallRecord` 不直接匹配),不能当作即插即用。
2. **路线 A 的成本下调**:
   布局组件可从 `1a71494^` 恢复,不是从零重写;但恢复后仍需适配当前 hub 路由、
   能力门控、权限守卫与页面内边距,不能直接 `git revert`。
3. **路线 C 需补迁移步骤**:
   先迁移 `global-search` 的 TRAE Token,再删 Token/字体;否则会破坏现有 kbd 样式。
4. **优先级调整**:
   - P0:去留决策、`trae-work` 孤岛处置、文档校准;
   - P1:品牌色/Token 统一、Storybook 注入、组件硬编码/a11y 整改;
   - P2:工作台类交互(先确认数据可用性:时间戳/消息数/右侧面板);
   - P3:任务实体/模式切换(需后端与产品输入);
   - P4:视觉回归、RTL、i18n、手工验收。

---

## 七、复核清单

- [x] 复核 Phase 1 删除与文件可恢复性
- [x] 复核 `trae-work` 引用面与 Tailwind CSS 产出
- [x] 复核 Token 名称/文档漂移
- [x] 复核测试、tsc、eslint
- [x] 复核 canvas S1 概念与 ChatSettings 右槽
- [ ] 启动 Storybook 验证 `TRAE-Work/*` 故事的实际渲染
- [ ] 浏览器实测 Light/Dark 下 TRAE Token 与 teal 的对比
- [ ] 产品确认 spec-013 去留 / 品牌色
- [ ] 确认消息时间戳、会话消息数的数据来源
- [ ] RTL 与键盘可访问性专项验证
