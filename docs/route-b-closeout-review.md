# Route B 收尾评审 — 时间戳 / 任务列表 / 多模型 / Chromatic / 颜色

> **评审对象**:2026-10-18 收尾改动(消息时间戳、Session Task 列表、多模型状态行、Chromatic、硬编码色)
> **评审结论**:**通过(有条件)**。无阻断性安全漏洞;T1-T6 均已落地(T5 为配置就绪),剩余 5 项低优先级/外部依赖。
> **方法**:计划评审 → 实现 → 代码 diff/风险 grep → 全量 Jest/tsc/eslint/build/Storybook。

---

## 一、任务与数据口径

| 任务 | 实现 | 数据口径 |
|---|---|---|
| T1 消息时间戳 | `createdAt` + MessageItem `<time>` | Gateway `timestamp`;新消息 `Date.now()`;可选,无值不显示 |
| T2 会话分组/时长 | Task Hub 列表 Today/Yesterday/Earlier + duration | Gateway Session `create_date`/`update_date`;前端算时长 |
| T3 Task Hub 任务实体 | Session → TaskCard 投影 | **非持久化 task 实体**;状态统一 `completed` |
| T4 多模型状态行 | 每个 ChatCard 独立 StreamStatus | 各 box 的 `sendLoading` + 末条 assistant toolCalls |
| T5 Storybook 视觉回归 | Chromatic 依赖/脚本 + 3 组新故事;生产无 sourcemap | 需 `CHROMATIC_PROJECT_TOKEN`;无 token 未建 baseline |
| T6 硬编码色 | 旧蓝/emerald/状态绿清理 | 第三方 jsonjoy/图表/语义红黄保留;`src/components/ui/**` 未改 |

> **重要口径**:`Sessions` 侧栏当前是单会话占位(`useFetchSessionList` 只返回当前 chat),不能做多会话分组;
> 分组落在真实 Session 列表(Tasks)。Task Hub 是 Session 投影,不是后端 task CRUD。

---

## 二、安全评审

| # | 检查项 | 结论 | 说明 |
|---|---|---|---|
| S1 | XSS/文本注入 | ✅ 安全 | Session 标题、消息时间、组名均作为 React 文本;无 `dangerouslySetInnerHTML` |
| S2 | 网络/鉴权 | ✅ 无新增 | Task 列表复用 `useFetchChatList`;未新增 fetch/endpoint/token |
| S3 | Chromatic token | ✅ 受控 | token 仅从 `CHROMATIC_PROJECT_TOKEN` 读取;CLI 仅上传构建产物/截图;devDependency |
| S4 | 依赖供应链 | ✅ 可控 | 新增 devDependency `chromatic`、`less-loader`,均不进生产 bundle |
| S5 | 本地时间解析 | ✅ 安全 | `toEpochMs` 只解析数字/ISO 字符串;非法值丢弃,不执行代码 |
| S6 | 任务投影 | ✅ 只读 | TaskCard 无删除/写操作;点击仅导航到既有 chat |
| S7 | 颜色改动 | ✅ 无运行时风险 | 仅 className/CSS 值;删除 `src/theme` 前确认全仓无 import |
| S8 | 锁定 UI | ✅ 未触碰 | `src/components/ui/**` 未修改(modal 曾改后已回滚) |

---

## 三、质量评审

### 3.1 已落实

| # | 项 | 说明 |
|---|---|---|
| Q1 | 时间戳兼容 | 秒/毫秒、ISO/数字字符串;MessageItem 对 NaN 做渲染守卫 |
| Q2 | 历史/新消息双路径 | Gateway 映射 + `addNewestQuestion/Answer`;流式回答保留 turn 起点 |
| Q3 | 任务分组/时长 | `mapSessionToTask`/`groupSessionTasks` 单测 5 例 |
| Q4 | TaskList 页面 | 搜索、分页、空态、标题回退;2 例组件测试 |
| Q5 | 多模型状态行 | 每 box 独立;复用 StreamStatus 测试 |
| Q6 | Chromatic 配置 | CLI 版本验证、脚本、3 组 stories、文档;生产构建关闭 sourcemap;`storybook-static` 无 `.map` |
| Q7 | 颜色清理 | 旧蓝/emerald 与注释残留清零;删除未引用 `src/theme`;第三方/语义色保留 |

### 3.2 遗留

| # | 严重度 | 问题 | 建议 |
|---|---|---|---|
| R1 | 中 | Task Hub 是 Session 投影,所有任务状态 `completed` | 后端 task CRUD 落地后替换数据源;模型建议见 [task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md);差异清单见 [task-hub-implementation-gap-analysis.md](./task-hub-implementation-gap-analysis.md) |
| R2 | 低 | 分组仅当前分页(默认 50) | 后端全量/聚合接口可解决 |
| R3 | 低 | `Sessions` 侧栏仍是单会话占位 | 需要后端 session list + 导航模型改造,当前不动 |
| R4 | 低 | Chromatic 无 baseline | 配 `CHROMATIC_PROJECT_TOKEN` 后跑首轮;CI 用 secret |
| R5 | 低 | 第三方/语义色未全清 | `jsonjoy-builder`、图表、语义红黄保留属合理范围 |

---

## 四、验证

| 检查 | 结果 |
|---|---|
| 全量 Jest | **670 passed / 44 suites** |
| `tsc --noEmit` | 通过 |
| ESLint(变更文件) | 0 error;既有 console warning |
| `npm run build` | 通过(52.44s,仅既有 chunk size warning) |
| `npm run build-storybook` | 通过;新故事已索引 |
| `npx chromatic --version` | 18.13.0 |
| 新增测试 | message-time 5、task-utils 4、TaskList 2、chat-group 2 |

---

## 五、结论

- **安全**:无阻断问题;Chromatic token 未落库,颜色/时间戳改动无运行时风险。
- **质量**:T1-T6 均可交付;Task Hub 明确为 Session 投影,不是后端 task 实体。
- **评审后状态**:可合入;Chromatic baseline 与真实 task API 作为后续外部依赖。
