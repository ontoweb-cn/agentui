# Route B 收尾任务细化与评审

> 依据:评审遗留项(消息时间戳/会话分组时长/Task Hub/多模型状态/Storybook 视觉回归/硬编码色)
> 原则:先细化范围与数据阻塞,评审后实施;每项带验收与测试。

---

## 一、任务细化

### T1 消息时间戳

| 项 | 内容 |
|---|---|
| 数据源 | Gateway 消息原始字段含 `timestamp`(映射代码注释已确认);历史消息映射补 `createdAt`;新消息在 `addNewestQuestion/Answer` 时写入 `Date.now()` |
| 展示 | `IMessage.createdAt?: number`;MessageItem 底部 `<time>` 显示 `MM-DD HH:mm`;仅在有值时渲染 |
| 兼容 | 兼容 `timestamp`/`created_at`/`createdAt`;秒级时间戳自动 ×1000;无值不显示 |
| 验收 | 新消息、历史消息、无时间戳消息三种路径;工具函数单测 |

### T2 会话分组 / 时长(Task Hub 会话任务列表)

| 项 | 内容 |
|---|---|
| 数据源 | `useFetchChatList()` 返回真实 Gateway Session(`create_date`/`update_date`);`Sessions` 侧栏当前是单会话占位,不适合做分组 |
| 实现 | 新增 Tasks 索引页:`TaskCard` 列表 = 会话投影;按 Today/Yesterday/Earlier 分组;时长 = `update - create`(`formatDuration`);搜索 + 分页 |
| 状态 | 会话投影状态统一 `completed`;不伪造 running/failed |
| 验收 | 分组、时长、空态、搜索、分页、点击进入聊天 |

### T3 Task Hub 任务实体

| 项 | 内容 |
|---|---|
| 决策 | 后端暂无独立 task 实体/API;本轮实现 **Session-backed Task View Model**,字段与 `TaskCardProps` 对齐,文档标注“投影,非持久化任务”;最终建议见 [task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md) |
| 路由 | `/tasks` 索引渲染任务列表;Hub 子菜单增加“任务”;Chat/Agent 子菜单保留 |
| 后续 | 后端提供 task CRUD 后替换数据源,不改 TaskCard API |

### T4 多模型调试模式状态行

| 项 | 内容 |
|---|---|
| 数据源 | `next-multiple-chat-box.tsx` 每个 ChatCard 已有 `sendLoading`;取末条 assistant 的 `toolCalls.length` |
| 实现 | 每个 ChatCard 消息列表底部渲染 `StreamStatus`;终态默认 done(RAG 路径暂无 error) |
| 验收 | 每个 box 独立计时/工具数;不影响单聊 |

### T5 Storybook 视觉回归(Chromatic)

| 项 | 内容 |
|---|---|
| 实现 | 新增 devDependency `chromatic` + `npm run chromatic`(调用 `build-storybook`);文档记录 `CHROMATIC_PROJECT_TOKEN` |
| 限制 | 无 token 无法建立 baseline,本轮只验证 CLI/配置与 Storybook 构建;CI 接入需 token |
| 验收 | `npx chromatic --version` 可用;`build-storybook` 通过;文档含 CI 示例 |

### T6 历史硬编码色清理

| 范围 | 动作 |
|---|---|
| 旧品牌蓝 `#1677ff` | `next-markdown-content` 表格 caption 改 `rgb(var(--accent-primary))` |
| 未引用 `src/theme/*` | 删除 `theme.ts`/`vars.less`(全仓无 import) |
| Agent 卡片 emerald | approval/clarify/wizard 的绿色状态改用 `accent-primary-text`/`state-success` |
| 状态绿色 | gateway provider、modal success、data-source badges 改 `state-success` 系列 |
| 不清理 | `jsonjoy-builder` 第三方样式、图表色、语义红/黄;记录为第三方/状态色 |

---

## 二、评审记录(实施前)

| 维度 | 结论 |
|---|---|
| 数据可用性 | T1 有 `timestamp`;T2/T3 用 Session 投影;T4 有 `sendLoading`;T5 需外部 token;T6 无逻辑风险 |
| 安全 | 时间戳/会话名仅作文本;Chromatic 仅构建产物上传,需在 CI secret 中管理 token;颜色改动无运行时风险 |
| 兼容 | `IMessage.createdAt` 可选;Task 列表只读投影;多模型状态行仅新增 UI |
| 测试 | T1/T2 新增单测;T3 复用 TaskCard 测试;T4 复用 StreamStatus;T5 构建验证;T6 类型/构建 |
| 风险 | T2 `useFetchChatList` 分页仅当前页;分组标题按更新时间;Session 无 duration 字段,需前端算 |
| 裁决 | T2 放弃修改单会话 `Sessions` 侧栏,分组落在真实 Session 列表(Tasks);T3 明确为投影 |

---

## 三、实施顺序

1. T1 时间戳(工具函数 + 消息映射 + MessageItem + 测试)
2. T2/T3 会话任务列表(分组/时长/分页/路由/子菜单)
3. T4 多模型状态行
4. T5 Chromatic 配置 + 文档
5. T6 颜色清理
6. 全量 Jest、tsc、eslint、build、build-storybook、Chromatic CLI 版本检查
7. 文档回写

---

## 四、实施结果(2026-10-18)

| 任务 | 状态 | 验证 |
|---|---|---|
| T1 消息时间戳 | ✅ | message-time 5 例;历史/新消息映射 |
| T2 会话分组/时长 | ✅(Task 列表) | task-utils 4 例;TaskList 2 例 |
| T3 Task Hub 任务实体 | ✅ Session 投影 | TaskCard 列表 + 分组 + 分页;最终模型建议见 [task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md) |
| T4 多模型状态行 | ✅ | 每 ChatCard 独立 StreamStatus |
| T5 Chromatic | ⚠️ 配置就绪(待 token) | CLI 18.13.0、build-storybook、3 组新 stories;无 token 未建 baseline |
| T6 硬编码色 | ✅(范围清理) | 旧蓝/emerald/状态绿;删除未引用 src/theme;第三方保留 |

**验证**:Jest **670 passed / 44 suites**;tsc 通过;build 通过(52.44s);
build-storybook 通过。详见 [route-b-closeout-review.md](./route-b-closeout-review.md)。
