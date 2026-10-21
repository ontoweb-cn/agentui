# Route B 收尾代码评审(第二轮)

> **评审对象**:2026-10-18 收尾实现(T1-T6)+ 评审后修复
> **评审方式**:逐文件 diff、数据口径核对、安全面 grep、测试/构建验证
> **结论**:**通过(有条件)**。未发现阻断性安全漏洞;评审中修复 6 项(F1-F6),
> 接受/遗留 7 项(A1-A7),均为数据依赖或低优先级。

---

## 一、评审范围

| 模块 | 文件 |
|---|---|
| 时间戳 | `src/utils/message-time.ts`、`src/hooks/logic-hooks.ts`、`src/hooks/use-chat-request.ts`、`src/pages/next-chats/chat/chat-box/single-chat-box.tsx`、`src/components/message-item/index.tsx` |
| Task 列表/分组 | `src/pages/tasks/task-list.tsx`、`task-list-utils.ts`、`src/features/tasks/manifest.ts`、`src/pages/tasks/index.tsx` |
| 多模型状态 | `src/pages/next-chats/chat/chat-box/next-multiple-chat-box.tsx` |
| Chromatic | `package.json`、`.storybook/main.ts`、三个 `*.stories.tsx` |
| 颜色 | `next-markdown-content`、approval/clarify、wizard、data-source、template-sidebar、login-next/bg、删除 `src/theme/*` |

---

## 二、评审发现

### 2.1 评审中已修复

| # | 严重度 | 发现 | 修复 |
|---|---|---|---|
| F1 | 中 | StreamStatus 终态故事用 `setTimeout(100)` 切状态,Chromatic 可能截到 streaming 中间态 | 改为 `useEffect` 立即切终态,消除定时器竞态 |
| F2 | 中(安全) | Storybook 生产构建产出 `.map`,Chromatic 会上传源码映射 | `.storybook/main.ts` 生产模式 `devtool=false`;重建后 `.map` 数为 0 |
| F3 | 低 | `createdAt=0`/非法值会在 MessageItem 渲染 1970 时间 | 增加 `Number.isFinite && > 0` 守卫;`toEpochMs` 对 0 返回 undefined |
| F4 | 低 | 空 session 名称会渲染空 TaskCard 标题 | TaskList 回退 `chat.newConversation` |
| F5 | 低 | 会话超过 1 小时时 `formatDuration` 显示 `120:00`,易误读为 2 分钟/120 分 | `formatSessionTaskDuration` 改为 `2h 30m` / `1d 4h`;新增测试 |
| F6 | 低 | `#7561ff` 紫色光晕、`#80FFF8` 青色登录渐变仍属旧品牌 | 改 `accent-primary` + `--trae-green-glow` / `--trae-green-bright` |

> F2 的 `.map` 检查:重建 `storybook-static` 后 `find storybook-static -name '*.map' | wc -l` = **0**。

### 2.2 接受 / 遗留

| # | 严重度 | 项 | 说明 / 建议 |
|---|---|---|---|
| A1 | 中 | Task Hub 是 Session 投影,所有 task `completed` | 后端 task CRUD 落地后替换数据源;不要把 `completed` 当真实执行状态。模型建议见 [task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md);差异清单见 [task-hub-implementation-gap-analysis.md](./task-hub-implementation-gap-analysis.md) |
| A2 | 低 | Tasks 分组只覆盖当前分页(默认 50) | 需要后端全量/聚合接口 |
| A3 | 低 | `Sessions` 侧栏仍是单会话占位 | 需后端 session list + 导航模型改造;当前分组落在 Tasks |
| A4 | 低 | Chromatic 无 baseline | 需 `CHROMATIC_PROJECT_TOKEN`;CI 用 secret |
| A5 | 低 | 时间戳/多模型状态缺少组件级集成测试 | 已有 util/StreamStatus 测试;建议后续补 MessageItem 与 ChatCard 快照 |
| A6 | 低 | 第三方/语义硬编码色保留 | `jsonjoy-builder`、图表、语义红/黄;不与品牌色混用 |
| A7 | 低 | 跨午夜分组可能不自动刷新 | 页面保持打开时 `groups` memo 不重算;可加定时/可见性刷新 |

---

## 三、安全评审

| 检查项 | 结论 | 说明 |
|---|---|---|
| XSS/文本注入 | ✅ | 时间、Session 名、组名均为 React 文本;无 `dangerouslySetInnerHTML` |
| 新增网络/鉴权 | ✅ 无 | TaskList 复用 `useFetchChatList`;没有新 endpoint/token |
| Task 投影写操作 | ✅ 无 | TaskCard 只导航/展示,不删除/修改 session |
| Chromatic token | ✅ | 仅 `CHROMATIC_PROJECT_TOKEN` 环境变量;不写仓库 |
| Chromatic 源码外传 | ✅ 已缓解 | 生产 Storybook 关闭 sourcemap;仍上传压缩 bundle,需按数据政策确认 |
| 时间解析 | ✅ | `toEpochMs` 只解析数字/ISO,不 eval;非法值丢弃 |
| 颜色/主题删除 | ✅ | 删除 `src/theme` 前全仓 grep 无 import;`src/components/ui/**` 未改 |
| 锁定 UI | ✅ | 无 `src/components/ui/**` diff |

---

## 四、验证

| 检查 | 结果 |
|---|---|
| 全量 Jest | **670 passed / 44 suites** |
| `tsc --noEmit` | 通过 |
| ESLint(变更文件) | 0 error;既有 console/exhaustive-deps warning |
| `npm run build` | 通过(仅既有 chunk size warning) |
| `npm run build-storybook` | 通过;107 stories;`.map` = 0 |
| `npx chromatic --version` | 18.13.0;未上传 baseline |

---

## 五、结论

- **安全**:无阻断项;Chromatic 已关闭 sourcemap,仍需 token 管理与上传数据合规确认。
- **质量**:F1-F6 已修复;A1-A7 为数据/外部依赖或低优先级。
- **建议**:合入前确认 Task Hub “Session 投影”语义;有 token 后先跑 Chromatic 首轮;
  后续补 MessageItem/ChatCard 集成测试。
