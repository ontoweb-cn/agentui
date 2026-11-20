# RAGFlow UI 对 agentui 的改进建议(UI 风格 + 内容)

> 生成时间:2026-11-21 00:45
> 对比基线:
> - 上游 RAGFlow `web/`:`infiniflow/ragflow` @ `91c702e`(2026-11-20),前端半年 1198 提交,+17.4 万/−9.5 万行
> - agentui:Intellect AgentUI v0.4.4(gitee `wustbd/agentui`),2026-06-25 前后自 RAGFlow `web/` 分叉,285 commits 独立演进
> 证据:`web/AGENTS.md`、两侧 `src/` 目录树实测、`pages/agent`(441 文件)vs `pages/agents`(20 文件)、tailwind.css token 计数(上游 48 / agentui 1)

---

## 〇、关系判断(分析前提)

`agentui` 是 **2026-06-25 前后从 RAGFlow `web/` 分叉的独立前端**(285 commits,gitee 独立演进),并非从零自研:

- 同源痕迹:`src/pages/` 与上游几乎同名(`next-chats`/`memories`/`skills`/`dataflow-result`/`login-next`),`CLAUDE.md` 与上游 `web/AGENTS.md` 多段文字逐字相同(CSS 调试纪律、scope/boundaries)
- 自有资产:**BFF(Hono)**、**canvas-plugin(339 文件)/ plugin-sdk / plugin-template 插件化画布**、features 注册表(11-15 新建)、20 个语言包(多于上游 19)
- 已有选择性 cherry-pick:`mineru-options-form-field`、`memories-form-field` 等上游 10 月组件已同步进来
- 关键差距:上游 `pages/agent`(画布)**441 个文件**,agentui `pages/agents` 仅 20 个;画布能力在 plugin 里但页面层联动缺失

因此改进建议的主轴是:**把上游半年的 UI 演进成果系统性地收进来,同时保住 agentui 的插件化差异化**。

---

## 一、UI 风格(设计系统与工程纪律)

### 1.1 语义色彩 Token 体系(最优先)

上游已建立强制规范——所有颜色必须用 `src/tailwind.css` 定义的语义 token(`bg-bg-base`、`text-text-primary`、`border-border-button`、`bg-bg-card`),**禁止在组件里写任意 hex/RGB 或 Tailwind 默认调色板**(如 `emerald-500`),且 token 同时定义亮/暗两套(web/AGENTS.md "Color Tokens" 节)。

> **2026-11-21 勘误**:实测 agentui 的 `tailwind.css` 其实**已包含**上游全套 design-color 段(`--bg-*`/`--text-*`/`--border-*` 及 `.dark` 覆盖,`tailwind.config.js` 映射齐全)——此前"仅 1 处命中 vs 上游 48 处"是 grep 口径差异造成的误判(两次对比用了不同匹配模式)。真实缺口是:这些语义角色在 agentui 自有的 `--colors-*` 命名法下**没有角色别名**(`text-colors-*` 风格工具类不可用),且缺少防裸色值回归的守卫机制。

**建议(已按此执行,见文末实施记录)**:在 `--colors-*` 命名下为缺失语义角色补别名(引用现有 design-color 变量,亮暗自动跟随,零值重复),并新增棘轮式守卫脚本拦截新增裸色值——存量违规记基线、只降不升,不强制一次性清理。

### 1.2 文本溢出纪律(上游踩坑换来的规范)

上游规定(web/AGENTS.md "Text Overflow" 节):任何渲染**用户生成/服务端返回文本**的元素必须有显式溢出策略(`truncate` / `line-clamp-N` / `break-words` 三选一),flex 链路逐层加 `min-w-0`,并提供共享组件 `TruncatedText`(`src/components/truncated-text.tsx`,仅在实际截断时显示 tooltip)。

agentui 的 `CLAUDE.md` 只有 flex 调试纪律,**缺溢出纪律与该组件**(已确认缺失)。建议:移植 `truncated-text.tsx` + 把上游 AGENTS.md 的 Text Overflow 一节并入 agentui 的 CLAUDE.md;长文案用 `overflow-check` 类浏览器实测(jsdom 测不出布局)。

### 1.3 工具链与测试约定

| 项 | 上游 | agentui | 建议 |
|---|---|---|---|
| Lint/格式化 | **oxlint + oxfmt**(Rust,快一个量级)+ lefthook 强制 pre-commit | eslint + prettier + husky | 引入 oxlint 作为快检(husky 可保留),大仓 lint 时间显著下降 |
| 测试目录 | 强制 `__tests__/`(`git mv` 迁移旧 `tests/`) | 混用 | 对齐 `__tests__/` 约定 |
| 浏览器级验证 | `overflow-check` skill(jsdom 测不出布局) | `.screenshots/` + storybook/chromatic | 引入等价的浏览器截图检查到 storybook 流程 |

### 1.4 视觉风格细节

- **字体**:agentui 用 `@fontsource/outfit + jetbrains-mono`(品牌字体),上游无字体依赖。建议保留 Outfit 作为品牌差异,但**把字号/行高做成 token**(配合 1.1),避免组件里散落任意值。
- **i18n overlay**:上游 10-29 起用 `ee-stub/locales` 覆盖层承载私有文案(共享语言文件只 merge,#21667/#21696/#22304)。agentui 的 20 个语言包里有 Intellect 专有词条,建议同样拆 overlay——这是后续继续 cherry-pick 上游语言文件不冲突的前提。
- **shadcn 锁定策略**:两侧一致(agentui 的 `src/components/ui/` 锁定条款与上游同源),保持;wrapper 优先的扩展模式 agentui 已有,无需改。

---

## 二、内容(页面与功能)

### 2.1 信息架构(IA)收敛

| 上游动作 | agentui 现状 | 建议 |
|---|---|---|
| `knowledge` 页并入 `datasets` | 仍有 `pages/knowledge` | 收敛到 datasets,旧路由 301 兜底 |
| `agent` → `agents` + Agent tab 置顶(#21621) | `pages/agents` 已有 | 对齐 tab 排序与空态 |
| 新增 `builtin-pipeline`(11-13,内置管道只读展示 #20656) | **无** | 后端暴露 builtin pipelines 时补该页 |
| `next-chats` / `next-search(es)` / `login-next` 新一代页面 | 已有(next-chats 早于上游,10-19) | **以 agentui 实现为基准双向对照**,收回上游 11 月迭代 |
| `tasks` / `wizard` / `aihub` / `applications` | agentui 特有 | 保留(差异化),迁入 overlay 结构(见 2.4) |

### 2.2 聊天与搜索(明确缺口)

- **联网搜索 provider**:上游已支持 **AnySearch / Perplexity / Search1API / SearchApi / Serply** + 专用 `web-search-form-field` 组件(含 API key 必填校验与配套测试);agentui **没有** web-search 表单组件(`llm.ts` 里只有孤立的 Perplexity 常量)。建议整体移植该组件族——它同时是 `next-chats` 新聊天页的依赖。
- **对话体验细节**:用户消息禁用 LaTeX 渲染(#19624)、自检 prompt/数据集矛盾设置(#18274)、检索阈值百分比化(#18974)。

### 2.3 知识库与数据集体验

- **虚拟滚动**:CSV 查看器与 chunk 列表(#19621)——大数据集必备;
- **分块引用图预览源文档**(#20895)——RAG 可信度展示的关键体验;
- **解析器选项由后端下发**(#22535):配合 Go 化后端,前端 parser select 改为"后端贡献选项追加",避免前端硬编码;
- 检索测试表单 Enter 提交(#17741)、MultiSelect locked option(#19658)、模型实例按卡片保存(#21708)、可扩展模型引用(#22448)。

### 2.4 Agent 画布(差距最大、也是 agentui 的机会)

- 上游 `pages/agent` 半年 **299 commits**(441 文件):DSL 多版本桥接(`dsl-bridge` / `download-dsl` / `empty-dsl`)、画布模板、运行事件流调试、single mode 暴露(#22608);
- agentui 的 canvas-plugin(339 文件)是**插件化**的差异化架构——建议**不要推倒**,而是:
  1. 对齐上游画布新增的**交互与运行时能力**(事件流渲染、user-fillup 表单、interrupt/resume 状态展示)——直接依赖 Go 侧 `agent-go-port-design.md` 的事件契约(workflow_started / message / user_inputs / interrupt / cancel 两段式);
  2. plugin-sdk 暴露的 DSL 读写 API 对齐上游 `NormalizeForCanvas` 单一形态(设计文档 §5),保证插件与宿主看到同一份规范化 DSL;
  3. `dataflow-result` 页与摄入进度事件(I/O progress,上游 #22194)打通。

### 2.5 企业缝与同步策略(保住差异化资产)

- 上游 10-29 起前端全面 **ee overlay 化**:`src/ee-stub/` 空实现 + 目录别名(`@/ee/...`),企业实现在另一仓库 `src/ee/`;共享代码只 import 逻辑路径,编辑期由别名选择,禁止运行时 `isEnterprise` 分支。agentui **没有**这层。建议:把 agentui 特有内容(`wizard`、`tasks`、`aihub`、`applications`、BFF 专属页面)迁入 `src/ee/` 式 overlay,共享层保持与上游同构——后续同步上游 web/ 子树时冲突面最小。
- **同步机制**:当前是零散 cherry-pick。建议建立**定期子树同步**:上游 `web/` → agentui 根目录的 subtree merge 脚本(类似已有 `sync:hiedu-shared`),每月一次;冲突集中在 overlay 外的文件即为健康信号。
- 版本/语言文件、API endpoint 常量的私有部分一律走 overlay(`ee-stub/locales/<lang>-private.ts`、`ee-stub/utils/api-private.ts` 模式),不内联进共享文件。

### 2.6 BFF 与后端契约(agentui 独有,需守住)

- BFF(Hono)是 agentui 相对上游的独有层,保留;但要**明确它与 nginx 直连后端的比例**,Go 化后(RAG 流程)dev proxy 路由对齐 `vite.config.ts`(上游规则:前端只面向 Go API,禁止后端探测分支,如 `useIsGoBackend`/`pickByBackend` 一类原语不得回归);
- 事件流契约(workflow_started / message / user_inputs / …)建议版本化——与 `agent-go-port-design.md` §7.5 的两段式 cancel、interrupt 协议配套。

---

## 三、落地优先级

- **P0(1-2 周)**:色彩 token 体系移植(1.1)+ `TruncatedText`/溢出纪律(1.2)+ web-search 组件补齐(2.2)+ IA 收敛 knowledge→datasets(2.1)
- **P1(1 个月)**:ee overlay 化改造(2.5)+ 画布页面对齐上游事件流/DSL 桥(2.4)+ oxlint 引入(1.3)
- **P2(随版本)**:虚拟滚动/引用预览(2.3)、builtin-pipeline 页、i18n overlay 拆分、字体 token 化(1.4)

## 四、核心判断

agentui 的插件化画布 + BFF 是值得保留的差异化;真正的债是**设计 token 层缺失**和**与上游半年演进的漂移**。先统一 token 与溢出纪律(风格),再按"上游 IA + 自有 overlay"重组内容,配合 RAG Go 化节奏把画布事件契约对齐——三步做完,agentui 就能以"RAGFlow UI 的企业分支"姿态长期低成本跟进上游。

---

## 五、P0 实施记录(2026-11-21)

按本文档 P0 范围执行,全程保留 Intellect 命名风格(未改名任何既有页面/路由/token/惯例)。源文件取自本地 `/home/simon/projects/ragflow/web`。

**交付物**:

- token 别名:`tailwind.css` 的 `:root` 与 `.dark` 各补 9 个语义角色别名(`--colors-background-neutral-card/component/input/list`、`--colors-text-neutral-disabled/title/subtitle`、`--colors-outline-neutral-button/sentiment-accent`),值为对现有 design-color 变量的引用;`tailwind.config.js` 同步 9 条映射
- 守卫:`scripts/check-color-tokens.mjs`(棘轮模式,基线 `scripts/color-token-baseline.json` = 299 处/64 文件,只降不升),接入 `npm run type-check`
- 溢出:`src/components/truncated-text.tsx` + `__tests__`(3 用例);`CLAUDE.md` 新增 "Text Overflow" 章节
- web-search:`src/constants/chat.ts` 补 `WebSearchProvider` 枚举(14 provider)+ `KEYLESS_WEB_SEARCH_PROVIDERS`;`src/pages/next-chats/chat/web-search-api-key.ts`(+52 断言测试);`src/components/web-search-form-field.tsx`(shadcn Form 原语适配,`useTranslate` 惯例保留);14 个 provider logo 资源;`chat-prompt-engine.tsx` 以 `WebSearchFormField` 替换旧 `TavilyFormField`;`use-show-internet.ts` 改用 `hasWebSearchProvider`;`use-chat-setting-schema.tsx` 补 per-provider key 字段 + `web_search_provider` 枚举 + `superRefine` 保存拦截;`interfaces/database/chat.ts` 类型同步;`zh.ts`/`en.ts` 增补 33 个 `chat.webSearch*`/`*ApiKeyTip|Message` 键(跳过已存在的 tavily 三键)

**验证结果**:`npm run type-check` 全绿(含 token 守卫);变更文件 eslint 0 违规;`src/pages/next-chats` + `src/components/__tests__` 回归 5 套件/67 测试全过;`npm run dev` 启动正常(HTTP 200)。Storybook 目视核对留待人工(新组件暂无 story)。

**存量环境问题(与本次改动无关,已绕过/修复)**:

1. jest 的 esbuild 宿主(0.25.12)与二进制(0.28.1)错配——用 `ESBUILD_BINARY_PATH=/tmp/esb025/node_modules/esbuild/bin/esbuild` 临时绕过;根治建议在 `package.json` `overrides` 固定 `@esbuild/linux-x64` 与 `esbuild` 同版本;
2. `node_modules` 缺 `@rollup/rollup-linux-x64-gnu`(此前为 Windows 侧安装)——已 `npm i --no-save` 补装,`npm run dev` 恢复;正式修复建议重装依赖或补 optionalDependencies 说明。

**已知边界**:intellect-rag 后端(v0.26.1 fork)对新增 provider(Perplexity/Serply/SearchApi/Search1API/AnySearch 等)的枚举可能未同步,后端侧支持属 intellect-rag 仓库事项;前端表单与保存校验已就绪。
