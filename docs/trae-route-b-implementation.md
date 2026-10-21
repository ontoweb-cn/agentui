# Route B 实施记录 — TRAE 工作台风格

> **基线**: `dev` @ `4bceebf`(实施前)
> **实施日期**: 2026-10-18
> **决策**: 按评审路线 B 实施;品牌色采用 **全站切换 TRAE 绿 `#11C566`**(用户确认),
> **不恢复**三栏布局,保留现有 hub IA。

---

## 一、本轮范围

按路线 B 拆成 4 个可交付切片,本轮完成 **切片 B0-B5 + 组件整改**:

| 切片 | 内容 | 状态 |
|---|---|---|
| B0 | 全站 accent 切换 + TRAE Token 补齐 | ✅ 完成 |
| B1 | `trae-work` 组件整改(硬编码色/i18n/RTL/a11y) | ✅ 完成(含 TaskCard ARIA 重构) |
| B2 | 聊天活动树 + 流式状态行 | ✅ 完成 |
| B3 | 裸 `/` 触发全量命令面板 | ✅ 完成 |
| B4 | 右侧 Files/Artifacts 工作区 | ✅ 完成(Files/References tabs,与 ChatSettings 共用右槽) |
| B5 | 任务 Hub 接入 TaskCard | ✅ 完成(Session 投影;真实 task API 待后端) |

---

## 二、具体改动

### 2.1 全站 accent 切换(TRAE 绿)

| 文件 | 改动 |
|---|---|
| `tailwind.css` | `--accent-primary: 0 190 180` → `17 197 102`(#11C566);新增 `--accent-primary-text`(浅色 #0a7a40 / 深色 #32F08C) |
| `src/components/file-status-badge.tsx` | RUNNING 状态底色/圆点从 teal 改绿;`mr-1` → `me-1` |
| `src/pages/login-next/index.tsx` | 登录按钮边框 `#00BEB4/#02bcdd` → `#11C566/#32F08C` |
| `src/pages/login-next/bg.tsx` | 背景描边 `#00BEB4` → `#11C566` |

> 说明:现有 `--accent-primary` 的 79 处消费点(按钮/焦点环/Slider/Switch/Progress/图表等)
> 通过该变量自动跟随,无需逐处改色。未改历史遗留的 `#1677ff` 等非 accent 色
> (如 markdown 表格 caption、未引用的 `src/theme/*`)。

### 2.2 TRAE Token 补齐与组件整改

| 文件 | 改动 |
|---|---|
| `src/less/variable.less` | 新增 `--trae-error`、`--trae-error-text`(RGB 三元组)、`--trae-on-accent` |
| `tailwind.config.js` | 新增 `trae.error`(支持透明度)、`trae.on-accent` 映射 |
| `src/components/trae-work/constants.ts` | `#ef4444` → `rgb(var(--trae-error))`;新增 `TASK_STATUS_TEXT_COLOR`(文本用 `accent-primary-text`/`trae-error-text`);`WORK_MODE_LABEL` → `WORK_MODE_LABEL_KEY` |
| `src/components/trae-work/mode-switcher.tsx` | 标签走 `modeSwitcher.work/code/canvas`;`text-black` → `text-trae-on-accent`;`left-0` → `start-0`;`rounded-r-full` → `rounded-e-full`;任意值 `bg-[image:...]` → `bg-trae-card-hover` |
| `src/components/trae-work/task-card.tsx` | `borderLeft` → `borderInlineStart`;删除按钮 `#ef4444` → `trae-error`;操作区补 `group-focus-within:opacity-100`;`onKeyDown` 增加 `e.target === e.currentTarget` 防冒泡;compact 箭头 `right-2` → `end-2` + RTL 翻转 |
| `src/components/trae-work/task-progress.tsx` | `text-[#ef4444]` → `text-trae-error-text`;节点色改为 `accent-primary-text` |
| `src/components/trae-work/tool-panel.tsx` | 徽标 `#000` → `var(--trae-on-accent)`;`text-left` → `text-start`;`bg-[image:...]` → `bg-trae-card-hover` |
| `src/components/next-message-item/tool-call-card.tsx` | `text-emerald-500`/`text-destructive` → `text-accent-primary-text`/`text-trae-error`;`text-left`/`ml-1` → `text-start`/`ms-1`;chevron RTL 翻转 |
| `src/components/message-input/next.tsx` | 联网按钮从 `variant="accent"`(白字)改为透明变体 + `!bg-accent-primary !text-trae-on-accent`,避免绿底白字低对比 |
| `src/components/message-input/slash-command-palette.tsx` | `left-0` → `start-0`(RTL) |

**ARIA**:`TaskCard` 已重构为"卡片主体 button + 操作区 sibling(绝对定位)";
retry/delete 不再嵌套在 `role="button"` 内,键盘冒泡与聚焦可见性问题一并消除。

### 2.3 聊天活动树

| 文件 | 改动 |
|---|---|
| `src/components/message-item/activity-tree.tsx` | 新增:Activity 标题 + 工具数 + 状态 + 累计时长;运行中默认展开,流式结束自动折叠(用户手动操作后不打扰);展开复用 ToolCallCard;最多渲染 50 条,超出显示 Show more/less |
| `src/components/message-item/index.tsx` | 平铺 ToolCallCard 列表替换为单个 ActivityTree;保留 pendingApproval 同名 running 过滤 |
| `src/components/message-item/__tests__/activity-tree.test.tsx` | 新增 7 例:空记录/运行中/折叠展开/自动折叠/失败状态/defaultOpen/50 条上限 |

### 2.4 流式状态行

| 文件 | 改动 |
|---|---|
| `src/components/message-item/stream-status.tsx` | 新增:`Working for Xs` / `Done in Xs`,完成后保留 3 秒自动隐藏;支持 `startedAt` 外部起点;工具数量可选 |
| `src/pages/next-chats/chat/chat-box/single-chat-box.tsx` | 消息列表底部接入;`streamToolCount` 取最后一条 assistant 消息的 toolCalls 数量 |
| `src/utils/format-duration.ts` | 新增统一时长格式化(<60s → `12s`,≥60s → `1:05`) |
| `src/components/message-item/__tests__/stream-status.test.tsx` | 新增 4 例:非流式不渲染/计时/完成 3 秒隐藏/外部 startedAt |

> 多模型调试模式(`MultipleChatBox`)本轮未接入状态行;其每个 box 走独立的
> `useSendSingleMessage`,需要按 box 传 `sendLoading` 后再接。

### 2.5 裸 `/` 全量命令面板

| 文件 | 改动 |
|---|---|
| `src/interfaces/command.ts` | `isSlashCommandVisible` 对裸 `/`(含尾随空格)返回 true;命令名/参数逻辑不变 |
| `src/interfaces/command.test.ts` | 新增解析/可见性测试,覆盖 `/`、`/ `、`/r`、`/model x`、非命令文本 |

### 2.6 i18n

| 文件 | 新增键 |
|---|---|
| `src/locales/zh.ts` / `en.ts` | `activity.title/summary(_one/_other)/expand/collapse`、`streamStatus.workingFor/doneIn/tools(_one/_other)`、`modeSwitcher.work/code/canvas` |

> 按项目 i18n 约定只补 zh/en;其余 15 种语言回退英文。

### 2.7 Storybook Token 注入

| 文件 | 改动 |
|---|---|
| `package.json` | 新增 devDependency `less-loader@12.2.0`(仅 Storybook,不进生产 bundle) |
| `.storybook/main.ts` | less rule 末尾接入 `less-loader`(`javascriptEnabled: true`) |
| `.storybook/preview.ts` | 引入 `../src/less/variable.less`,使 `TRAE-Work/*` 故事获得 `--trae-*` 变量 |
| 验证 | `npm run build-storybook` 通过;产物含 `--trae-ink`/`--accent-primary-text`,TRAE-Work 故事可索引 |

### 2.8 右侧工作区(Workspace)

| 文件 | 改动 |
|---|---|
| `src/pages/next-chats/chat/workspace/workspace-panel.tsx` | 新增右侧工作区:Files / References tabs;Files 汇总上传文件与可下载产物,References 复用引用文档列表;支持空态/计数/关闭;宽度 440px,与 ChatSettings 共用右槽(同时只开一个) |
| `src/pages/next-chats/chat/index.tsx` | 右侧状态改为 `none/settings/workspace`;头部新增工作区按钮(`LucideFolderOpen`);切换会话清空工作区消息 |
| `src/pages/next-chats/chat/chat-box/single-chat-box.tsx` | 新增 `workspaceOpen` / `onMessagesChange`;仅在打开时回传实时 `derivedMessages`,避免逐 token 更新父组件 |
| `src/components/next-message-item/uploaded-message-files.tsx` | props 放宽为 `(File \| IDocumentInfo \| UploadResponseDataType)[]`,供工作区复用 |
| `src/pages/next-chats/chat/workspace/__tests__/workspace-panel.test.tsx` | 新增 4 例:隐藏态/Files/References/去重/空态与关闭 |

---

### 2.9 消息时间戳

| 文件 | 改动 |
|---|---|
| `src/utils/message-time.ts` | 新增 `toEpochMs`/`getMessageCreatedAt`/`formatMessageTime`;兼容秒/毫秒时间戳、ISO/数字字符串 |
| `src/interfaces/database/chat.ts` | `IMessage.createdAt?: number` |
| `src/hooks/use-chat-request.ts` | Gateway 历史消息映射写入 `createdAt`(timestamp/created_at/createdAt) |
| `src/hooks/logic-hooks.ts` | 新消息/流式回答/引导语写入或保留 `createdAt` |
| `src/pages/next-chats/chat/chat-box/single-chat-box.tsx` | 会话消息载入时归一化 `createdAt` |
| `src/components/message-item/index.tsx` | 消息底部 `<time>` 显示 `MM-DD HH:mm`;仅合法值渲染 |
| `src/utils/__tests__/message-time.test.ts` | 5 例:秒/毫秒、字符串、非法值、三字段兼容、格式化 |

### 2.10 Task Hub 会话任务列表(分组/时长)

| 文件 | 改动 |
|---|---|
| `src/pages/tasks/task-list.tsx` | 新增:Session → Task 投影;Today/Yesterday/Earlier 分组;时长 = update-create;搜索 + 分页;点击进入聊天 |
| `src/pages/tasks/task-list-utils.ts` | 新增 `mapSessionToTask`/`groupSessionTasks`/`formatSessionTaskDuration` |
| `src/pages/tasks/__tests__/*` | 新增 5 例:映射/分组/时长/TaskList 渲染/空态 |
| `src/features/tasks/manifest.ts` | `/tasks` 索引由 redirect 改为 TaskList |
| `src/pages/tasks/index.tsx` | Hub 子菜单增加“任务”;Chat/Agent 保留 |

> **数据口径**:后端暂无独立 task 实体,任务为 Gateway Session 的只读投影,状态统一 `completed`;非持久化任务。
> `Sessions` 侧栏当前是单会话占位,分组/时长落在真实 Session 列表(Tasks)。

### 2.11 多模型调试模式状态行

| 文件 | 改动 |
|---|---|
| `src/pages/next-chats/chat/chat-box/next-multiple-chat-box.tsx` | 每个 ChatCard 消息列表底部接入 `StreamStatus`;工具数取末条 assistant |

### 2.12 Storybook 视觉回归(Chromatic)

| 文件 | 改动 |
|---|---|
| `package.json` | 新增 devDependency `chromatic@18.13.0`;script `npm run chromatic` |
| `src/components/message-item/activity-tree.stories.tsx` | Completed/Running/Failed/ManyTools 故事 |
| `src/components/message-item/stream-status.stories.tsx` | Streaming/Done/Failed/Stopped 故事 |
| `src/pages/next-chats/chat/workspace/workspace-panel.stories.tsx` | Empty 故事 |
| `docs/storybook-visual-regression.md` | Token/CI 使用说明;生产构建关闭 sourcemap |

> 无 `CHROMATIC_PROJECT_TOKEN`,未建立 baseline;`npx chromatic --version` 与 `build-storybook` 已验证。

### 2.13 历史硬编码色清理

| 范围 | 改动 |
|---|---|
| 旧品牌蓝 | `next-markdown-content` 的 `#1677ff` → `rgb(var(--accent-primary-text))` |
| 未引用主题 | 删除 `src/theme/theme.ts`、`src/theme/vars.less`(全仓无 import) |
| Agent 卡片 | approval/clarify 的 `emerald-500` → `accent-primary-text`/`accent-primary` |
| 状态绿 | wizard/modal/data-source/gateway-provider 的 green/emerald → `state-success`/`accent-primary-text` |
| 不清理 | `jsonjoy-builder` 第三方校验样式、图表色、语义红/黄;保持第三方语义色 |

## 三、代码评审(质量/安全)

实施后完成多轮质量/安全评审,记录见 [trae-route-b-code-review.md](./trae-route-b-code-review.md)、[trae-route-b-phase2-code-review.md](./trae-route-b-phase2-code-review.md) 与 [route-b-closeout-review.md](./route-b-closeout-review.md)。
评审意见已落实:

- 性能:`single-chat-box` 工具计数 O(n)/token → O(1);
- 计时:`StreamStatus` 第二轮流式不再复用旧 `startedAt`,并校验 NaN/未来时间;
- 命令安全:裸 `/` 按 Enter 不再误执行第一条命令;
- 可访问性:TaskCard 改为“卡片主体 button + 操作区 sibling”,消除嵌套交互;
  accent 文本/图标/focus ring 改用 `--accent-primary-text`(浅色 5.43:1 / 深色 12:1),
  错误文本新增 `--trae-error-text`(浅色 4.83:1 / 深色 6.53:1);
- 终态:`StreamStatus` 支持 done/failed/stopped;gateway 与 RAG 双路径均透传 `streamError`;
- 交互:ModeSwitcher 补方向键循环聚焦;ToolPanel icon 支持 ReactNode 并扩到 10 个;
- 工程债:`ChatKeys.gatewayModels()` 工厂替代裸 queryKey;
- Storybook:新增 devDependency `less-loader`,`.storybook` less rule 接入 `variable.less`,`build-storybook` 通过。

仍遗留:消息时间戳、会话分组/时长、Task Hub 任务实体、多模型状态行等 Route B 后续项仍受设计或数据阻塞;Storybook 视觉回归与历史硬编码色清理留后续。

## 四、验证

| 检查 | 结果 |
|---|---|
| `npx jest src/components/trae-work src/components/message-input src/components/message-item src/interfaces/command.test.ts` | **269 passed**(含评审回归用例) |
| `npx jest --silent`(全量) | **670 passed / 44 suites**(实施后 + 评审回归) |
| `npx tsc --noEmit` | 通过 |
| `npx eslint <changed files>` | **0 error**;既有 warning(console/exhaustive-deps)保留 |
| `npx tailwindcss -i tailwind.css -o /tmp/... --minify` | `text-trae-error` / `bg-trae-green-bright` / `text-trae-on-accent` / `bg-trae-card-hover` 等新类均生成 |
| `npm run build` | 通过(52.44s;仅有既有 chunk size warning);产物 CSS 含 `17 197 102`、`--accent-primary-text`、`--trae-error` |
| `npm run build-storybook` | 通过;含 TRAE-Work、ActivityTree、StreamStatus、WorkspacePanel 故事 |
| `npx chromatic --version` | 18.13.0;无 token 未上传 baseline |

---

## 五、未完成 / 下一步

| 优先级 | 项 | 阻塞点 |
|---|---|---|
| P2 | 真实 Task 实体/API | 当前 Task Hub 为 Gateway Session 投影,状态统一 `completed`;需后端 task CRUD 后替换数据源;模型建议见 [task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md) |
| P2 | ToolPanel/TaskProgress 复用到工作区 | 当前工作区复用 UploadedMessageFiles/DocumentDownloadButton/ReferenceDocumentList;ToolPanel/TaskProgress 若复用需 Props 适配层 |
| P3 | Chromatic baseline | 配置/脚本/故事已就绪,但无 `CHROMATIC_PROJECT_TOKEN`,未建立 baseline |
| P3 | 任务列表跨页分组 | 当前按当前页 Session 分组;后端若提供全量/聚合接口再优化 |
| P3 | 第三方/语义硬编码色 | `jsonjoy-builder`、图表色、语义红/黄保留,不做品牌化替换 |

---

## 六、回滚点

- 品牌色:把 `tailwind.css` 的 `--accent-primary` 改回 `0 190 180`,并回滚 login/file-status 的 3 处硬编码色。
- 活动树:`src/components/message-item/index.tsx` 恢复为平铺 ToolCallCard(旧代码见 git `HEAD`)。
- 状态行/裸 `/`:分别移除 `single-chat-box.tsx` 的 `<StreamStatus>` 与 `command.ts` 的 `firstLine === '/'` 分支。
