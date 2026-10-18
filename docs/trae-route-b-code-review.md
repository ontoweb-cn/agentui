# Route B 代码评审 — 质量与安全

> **评审对象**:2026-10-18 Route B 实施改动(`git diff` + 新增文件)
> **评审结论**:**通过(有条件)**。未发现阻断性安全漏洞;评审中发现并修复 3 项中危质量问题
> (逐 token O(n) 扫描、StreamStatus 复用旧 startedAt、裸 `/` Enter 误执行命令),
> 仍有 7 项遗留(2 项可访问性、1 项对比度、2 项交互健壮性、2 项工程债)。
> **评审方式**:全量 diff 阅读 + 风险模式 grep + Jest/tsc/eslint/build + 手动 XSS/ARIA/timer/性能检查。

---

## 一、评审范围

| 类别 | 文件 |
|---|---|
| 新增组件 | `src/components/message-item/activity-tree.tsx`、`stream-status.tsx` |
| 新增工具/测试 | `src/utils/format-duration.ts`、`src/interfaces/command.test.ts`、`src/components/message-item/__tests__/*` |
| 修改(聊天) | `src/components/message-item/index.tsx`、`src/components/next-message-item/tool-call-card.tsx`、`src/pages/next-chats/chat/chat-box/single-chat-box.tsx`、`src/components/message-input/{next,slash-command-palette}.tsx` |
| 修改(TRAE 组件) | `src/components/trae-work/{constants,mode-switcher,task-card,task-progress,tool-panel}.tsx` |
| 品牌/Token | `tailwind.css`、`tailwind.config.js`、`src/less/variable.less`、`src/components/file-status-badge.tsx`、`src/components/image/index.tsx`、`src/pages/login-next/{index,bg}.tsx` |
| i18n | `src/locales/{zh,en}.ts` |

---

## 二、安全评审

### 2.1 结论

**未发现高危/阻断性安全问题。** 本轮改动不新增网络请求、不新增存储、不新增依赖、
不引入 HTML 注入面。发现 1 项用户操作安全风险(裸 `/` Enter 误执行命令),已修复。

### 2.2 逐项检查

| # | 检查项 | 结论 | 证据/说明 |
|---|---|---|---|
| S1 | XSS / DOM 注入 | ✅ 安全 | 新增/修改文件无 `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function`;ToolCallCard 把后端 `toolName`/`args`/`result`/`preview` 作为 React 文本节点渲染(`<pre>{text}</pre>`),React 自动转义 |
| S2 | 命令误执行 | ✅ 已修复 | 裸 `/` 打开面板后按 Enter 原会执行第一条 `/retry`;已在 `slash-command-palette.tsx:202-210` 增加 `if (!parsed?.commandName) return;`,并补测试 |
| S3 | 网络/密钥/存储 | ✅ 无新增 | 未新增 `fetch`/`localStorage`/token 处理;`single-chat-box.tsx` 现有 gateway fetches 未改动 |
| S4 | ReDoS | ✅ 安全 | `parseSlashCommand` 正则 `^\/\s*(\w*)(?:\s+(.*))?$` 无嵌套量词/回溯爆炸;输入来自 textarea |
| S5 | i18n 注入 | ✅ 安全 | 全局 `escapeValue:false`,但新增插值仅为本地数字 `duration`/`count`;无用户 HTML 进入 `t()` |
| S6 | 依赖供应链 | ✅ 可控 | 未新增运行时依赖;新增 devDependency `less-loader@12.2.0` 仅用于 Storybook,不进生产 bundle |
| S7 | 日志泄露 | ⚠️ 既有 | `login-next/index.tsx:479` 存在既有 `console.log('Failed:', errorInfo)`;非本轮引入,eslint warning 仍在 |
| S8 | CSS/class 注入 | ✅ 安全 | 状态类名来自 typed 常量/枚举;`className` 直接拼接到元素属性,React 转义,非 HTML |
| S9 | 权限/越权 | ✅ 无变化 | 未改鉴权、路由守卫、BFF 契约 |
| S10 | 敏感信息渲染 | ✅ 无新增 | `ActivityTree` 仅聚合已有 ToolCallCard;`StreamStatus` 只渲染本地计时 |

> **补充**:本轮未运行 `npm audit`;因未改依赖,供应链风险面与实施前一致。

---

## 三、质量评审

### 3.1 已修复(两轮评审)

| # | 严重度 | 问题 | 修复 | 验证 |
|---|---|---|---|---|
| Q1 | 中 | `single-chat-box` 每个流式 token 反向遍历全部消息求工具数,O(n)/token | 改为 O(1) 取末条消息 | tsc/Jest |
| Q2 | 中 | `StreamStatus` 第二轮流式复用上一轮 `startedAt` | 仅第一轮使用外部起点,后续用当前时间 | 新增回归测试 |
| Q3 | 中 | 裸 `/` + Enter 误执行第一条 `/retry` | Enter 要求 `commandName` 非空,裸 `/` 仅浏览 | 新增测试 |
| Q4 | 低 | TaskCard 嵌套按钮 Enter 冒泡无回归测试 | 新增嵌套 Delete Enter 不触发 onClick 测试 | 测试通过 |
| Q5 | **中** | `TaskCard` 外层 `role="button"` 内嵌操作按钮,ARIA 结构无效 | 重构为“卡片主体 button + 操作区 sibling(绝对定位)”;新增 sibling 断言 | 108 个 TaskCard 测试通过 |
| Q6 | **中** | `#11C566` 在浅色背景对比度 2.28:1,38 处 `text-accent-primary` 小字号文本不可读 | 新增 `--accent-primary-text`(浅色 #0a7a40 5.43:1 / 深色 #32F08C 12:1),迁移 23 个文件 38 处;新组件 `text-trae-green`/focus ring 同步切换;图片角标改深色字 | Tailwind 生成 `text-accent-primary-text` |
| Q7 | 中 | 手动停止/失败也显示 `Done in Xs` | `StreamStatus` 增加 `terminalState: done/failed/stopped`;gateway 路径接 `streamError`;新增失败/停止文案与测试 | 4 个终态用例 |
| Q8 | 低 | `ModeSwitcher` radiogroup 无方向键导航 | ArrowLeft/Right/Up/Down 循环切换并聚焦;新增 2 个测试 | 测试通过 |
| Q9 | 低 | `ToolPanel` 仅 5 个图标名,未知 icon 静默 null | 图标映射扩到 10 个;`icon` 支持 `ReactNode`;新增 ReactNode 测试 | 测试通过 |
| Q10 | 低 | `single-chat-box.tsx` 裸 `queryKey: ['gatewayModels']` | 抽 `ChatKeys.gatewayModels()` 工厂 | tsc/lint |
| Q13 | 低 | `StreamStatus` NaN/未来 `startedAt` 未校验 | `normalizeStartedAt` 校验 finite/大于 0/不晚于当前;新增测试 | 测试通过 |
| Q14 | 低 | TaskCard 操作按钮无 `focus-visible` 样式 | 两个操作按钮补 `focus-visible:ring-2 ring-accent-primary-text` | 测试通过 |
| Q7b | 中 | RAG SSE 错误被静默吞掉,失败仍按 `done` 展示 | `useSendMessageWithSse` 增加 `error` state:HTTP 非 2xx、SSE `code !== 0`、非 abort 异常均记录;`use-send-chat-message` 双路径透传;新增 2 个 hook 测试 | 670 tests |
| Q12 | 低 | Storybook 未注入 TRAE Token | 新增 devDependency `less-loader@12.2.0`;`.storybook/main.ts` less rule 接入 less-loader;`preview.ts` 引入 `variable.less`;`npm run build-storybook` 通过 | Storybook 产物含 `--trae-ink`/`--accent-primary-text` |
| Q11 | 低 | `ActivityTree` 展开时一次性渲染全部 ToolCallCard | 增加 50 条渲染上限;超出显示 `Show N more` / `Show less`;新增 55 条工具回归测试 | 670 tests |

### 3.2 仍遗留

代码评审项已清零。Route B 后续的数据/设计项(消息时间戳、会话分组/时长、Task Hub 任务实体、多模型状态行)不属于本轮评审缺陷,单独跟踪。

---

## 四、验证

| 检查 | 结果 |
|---|---|
| `npx jest` 全量 | **670 passed / 44 suites** |
| 目标集(`trae-work` + `message-input` + `message-item` + `command.test.ts`) | **269 passed** |
| `npx tsc --noEmit` | 通过 |
| `npx eslint <changed files>` | **0 error**;既有 warning 8 条(console/exhaustive-deps) |
| `npm run build` | 通过(约 1 分钟;仅既有 chunk size warning) |
| `npm run build-storybook` | 通过;产物含 `--trae-ink`/`--accent-primary-text`,TRAE-Work 故事可索引 |

> 第二阶段(Q11/右侧工作区/Q7b/Q12)另见 [trae-route-b-phase2-code-review.md](./trae-route-b-phase2-code-review.md)。
| 风险模式 grep | 新增/修改文件无 `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` |

---

## 五、优先级建议

1. **P1/P2/P3(本轮已清零)**:Q5/Q6/Q7/Q7b/Q11/Q12 均已修复。
2. **后续**:Route B 右侧工作区已实现;剩余数据/设计项单独跟踪。

---

## 六、结论

- **安全**:无阻断性问题;唯一用户操作安全风险(裸 `/` 误执行)已修复。
- **质量**:评审发现的问题(Q1-Q14、Q7b、Q11、Q12)已全部修复;核心功能有测试、类型/构建通过。
- **仍遗留**:无代码评审缺陷;Route B 的数据/设计项单独跟踪。
- **评审后状态**:可合入当前分支;Storybook 构建已验证。
