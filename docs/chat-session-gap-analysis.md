# AgentUI 与 intellect-webui 会话功能差异分析及开发计划

> 对比对象：
> - AgentUI：`/Users/simon/project/agentui`（React + Vite + Hono BFF，画布/Agent 中心）
> - Intellect WebUI：`/Users/simon/project/intellect-webui`（Python + 原生 JS，会话/工作区中心）
>
> 项目约束（来自 project_memory）：
> - 企业版租户使用画布功能当前必须绑定 Intellect RAG
> - 前端 Intellect RAG 与企业版功能完全独立
> - BFF Tenant 绑定到 Intellect Tenant 实例
> - BFF 无需实现 ACP Adapter

---

## 一、AgentUI 会话模块现状

### 1.1 数据模型
AgentUI 沿用 Intellect RAG 的「Chat 助手 → Session → Message」三层模型，会话强绑定到 **Agent/画布**：

- `pages/agent/chat/`：画布内 Chat（调试/运行态），含 `box.tsx`、`chat-sheet.tsx`、`use-send-agent-message.ts`
- `pages/agent/explore/`：Agent Explore 会话列表 + 会话聊天
- `pages/agents/agent-log-page.tsx`：Agent 日志（会话历史）
- `services/next-chat-service.ts`：封装 Intellect RAG `/v1/chats`、`/v1/chats/{id}/sessions` API
- `utils/api.ts`：`createAgentSession`、`fetchAgentSessions` 指向 `/v1/agents/{id}/sessions`

### 1.2 已实现能力
| 能力 | 位置 | 说明 |
|---|---|---|
| SSE 流式发送 | [use-send-agent-message.ts](file:///Users/simon/project/agentui/src/pages/agent/chat/use-send-agent-message.ts) | 544 行，含 stop/表单消息/附件 |
| 画布内消息渲染 | [box.tsx](file:///Users/simon/project/agentui/src/pages/agent/chat/box.tsx) | message-item + PDF 抽屉 + 引用跳转 |
| 会话列表 | [session-list.tsx](file:///Users/simon/project/agentui/src/pages/agent/explore/components/session-list.tsx) | 客户端搜索、新建临时会话、删除 |
| 会话聊天 | [session-chat.tsx](file:///Users/simon/project/agentui/src/pages/agent/explore/components/session-chat.tsx) | 复用 message-item，URL 参数管理 sessionId |
| Agent 日志 | [agent-log-page.tsx](file:///Users/simon/project/agentui/src/pages/agents/agent-log-page.tsx) | 分页/日期/关键词/CSV 导出/详情 Modal |
| Chat Service 定义 | [next-chat-service.ts](file:///Users/simon/project/agentui/src/services/next-chat-service.ts) | 已声明 thumbup/tts/mindmap/relatedQuestions 等方法 |

### 1.3 关键缺口
- **BFF 会话路由是 stub**：[bff/src/routes/session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) 仅返回假数据，无真实存储
- **没有独立聊天页面**：`features/chats/` 只有 manifest/routes 占位，无页面
- 会话是画布附属物，无独立生命周期、无全局侧边栏
- 无 SSE 事件总线、无会话恢复/压缩链/多用户隔离

---

## 二、intellect-webui 会话管理功能

### 2.1 后端 API 全景（`api/routes.py` + `api/session_*.py`）

**会话 CRUD / 元数据**
`GET /api/sessions` · `GET /api/session/get` · `POST /api/session/new` · `duplicate` · `rename` · `delete` · `clear` · `truncate` · `branch` · `update` · `draft` · `toolsets` · `pin` · `archive` · `move` · `yolo` · `handoff-summary` · `conversation-rounds` · `export`

**会话操作（slash 命令）** — [session_ops.py](file:///Users/simon/project/intellect-webui/api/session_ops.py)
`/retry` · `/undo` · `/status` · `/usage`

**上下文压缩** — `compress/start` · `compress` · `compress/status`

**血缘与恢复** — `lineage/report` · `recovery/audit` · `recovery/repair-safe` · `recover` · `worktree/status` · `worktree/remove`

**搜索与事件** — `GET /api/sessions/search`（FTS）· `GET /api/sessions/events`（SSE 列表变更）· `GET /api/sessions/gateway/stream` · `POST /api/sessions/cleanup`

**聊天与协作** — `/api/chat/*`（SSE）· `/api/approval/*` · `/api/clarify/*` · `/api/terminal/*` · `/api/insights` · `/api/members/*`

### 2.2 后端核心模块
| 模块 | 作用 |
|---|---|
| [agent_sessions.py](file:///Users/simon/project/intellect-webui/api/agent_sessions.py) | Agent 会话投影：压缩链合并、来源归一化（webui/cli/messaging/cron/tool/api）、CLI 可见性、血缘根 |
| [session_lifecycle.py](file:///Users/simon/project/intellect-webui/api/session_lifecycle.py) | memory provider 生命周期：generation 计数、commit 边界、并发安全 |
| [session_events.py](file:///Users/simon/project/intellect-webui/api/session_events.py) | 会话列表变更事件（in-memory + Redis 多 worker bridge） |
| [session_visibility.py](file:///Users/simon/project/intellect-webui/api/session_visibility.py) | 成员/团队级可见性（SessionListScope、RBAC、deny-by-default、磁盘 hydrate） |
| [session_recovery.py](file:///Users/simon/project/intellect-webui/api/session_recovery.py) | .bak 快照恢复、孤儿备份重建、state DB sidecar 物化 |
| [streaming.py](file:///Users/simon/project/intellect-webui/api/streaming.py) | SSE 引擎：cancel、reasoning、tool calls、goal、metering、turn journal |

### 2.3 前端能力（`static/sessions.js` + `messages.js` + `ui.js`）
- **侧边栏**：列表 + 搜索 + 置顶/归档/移动/复制/删除/重命名；多成员 scoped localStorage；SSE 实时刷新；跨来源聚合；未读/attention 标记
- **聊天面板**：SSE 流式（reasoning/tool calls/approval/clarify）；编辑/重试/分支/压缩/撤销；选中文本回复；TTS；离线横幅；composer 草稿；模型/profile/workspace 切换；附件/语音/slash 命令；工作区终端/文件树

---

## 三、差异对比

| 维度 | AgentUI | intellect-webui |
|---|---|---|
| 会话定位 | 画布/Agent 附属 | 顶级独立实体 |
| 会话存储 | Intellect RAG `/v1/chats/sessions`（外部）+ BFF stub | 自有 JSON sidecar + state DB（PG）+ .bak |
| BFF 会话路由 | stub 占位 | 完整 60+ 端点 |
| 独立聊天页 | 无（仅 manifest） | 三栏 SSE 聊天 |
| 流式 | SSE（画布调试用） | SSE + reasoning + tool calls + approval + clarify |
| 会话操作 | 删除、新建临时 | 重命名/置顶/归档/移动/复制/分支/压缩/截断/清空/导出/草稿/YOLO |
| Slash 命令 | 无 | /retry /undo /status /usage |
| 列表事件 | 轮询 | SSE sessions/events + Redis bridge |
| 跨来源聚合 | 无 | webui/cli/messaging/cron/tool 投影 |
| 压缩链 | 无 | 压缩链合并 + 血缘报告 |
| 多用户隔离 | 无 | SessionListScope + member/team RBAC |
| 恢复机制 | 无 | .bak 恢复 + 孤儿备份 + sidecar 物化 |
| 用量统计 | 无 | /status /usage /insights |
| Memory 生命周期 | 无 | generation 计数 + commit 边界 |
| Worktree | 无 | worktree 状态/移除 |
| FTS 搜索 | 客户端按名搜索 | 服务端全文搜索 |

---

## 四、需开发功能清单

### 决策点（需先确认）
> 根据项目记忆：**企业版租户使用画布必须绑定 Intellect RAG，前端 Intellect RAG 与企业版功能完全独立**。因此需先决定会话功能的数据通路：

- **方案 A（推荐）**：BFF 自建会话层（独立存储 + Intellect RAG 作为可选后端），与画布解耦，对齐 webui 模型
- **方案 B**：复用 Intellect RAG `/v1/chats` API（已有 next-chat-service），但会缺失 webui 的高级能力（压缩链/血缘/恢复/slash 命令等 RAG 不支持）
- **方案 C**：混合 — 基础 CRUD 走 RAG，高级能力走 BFF 自建

> 详见第六节「BFF 是否有必要建会话存储」的论证。

### 开发任务清单

#### P0 — 基础会话生命周期（必做）
1. **BFF 会话存储层**：替换 [session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) stub，实现会话表结构（session/messages/index）+ 持久化
2. **会话 CRUD API**：list/get/new/delete/clear/rename/update/duplicate（对齐 webui 8 个核心端点）
3. **独立聊天页面**：在 `features/chats/` 下落地三栏布局（侧边栏 + 聊天 + 可选右栏），替换 manifest 占位
4. **聊天 SSE 流式**：BFF 侧 SSE 端点 + 前端 useSendMessageBySSE 复用，支持 reasoning/tool calls
5. **会话侧边栏**：列表 + 搜索 + 新建/删除/重命名 + 选中态 + URL 同步

#### P1 — 会话操作与编辑
6. **会话级操作 API**：truncate/branch/pin/archive/move/draft/toolsets/yolo
7. **Slash 命令**：/retry /undo /status /usage（前端命令解析 + BFF session_ops 对应实现）
8. **消息编辑/重试/分支**：消息级操作 UI + API
9. **会话导出**：export 端点 + 前端下载
10. **草稿与 composer 增强**：composer 草稿持久化、附件、模型/profile 选择

#### P2 — 实时性与可靠性
11. **会话列表 SSE 事件**：`/api/sessions/events` + 前端 EventSource + 列表实时刷新
12. **会话恢复机制**：.bak 快照写入 + 启动恢复 + `POST /api/session/recover` + recovery/audit
13. **流式 cancel 与 stale state 清理**：cancel_flags + active_stream_id 清理 + 重连
14. **离线/重连横幅**：navigator.onLine 检测 + 流式错误延迟

#### P3 — 多用户与企业版
15. **会话可见性 RBAC**：SessionListScope + member/team 过滤 + deny-by-default（对齐企业版 Tenant/Team 模型）
16. **多成员 scoped 存储**：per-member localStorage + 成员切换时重置
17. **BFF Tenant 绑定**：会话归属到 Intellect Tenant 实例（对齐 project_memory 约束）

#### P4 — 高级能力（对齐 webui 全功能）
18. **上下文压缩**：compress/start + compress/status + 压缩链投影 + 血缘报告
19. **跨来源聚合**：CLI/messaging/cron 会话投影 + 来源归一化 + CLI 可见性规则
20. **Memory provider 生命周期**：generation 计数 + commit 边界 + drain on shutdown
21. **用量统计**：/status /usage /insights + token/cost 展示
22. **全文搜索**：`/api/sessions/search` 服务端 FTS
23. **Worktree 集成**：worktree/status + worktree/remove（若需代码会话）
24. **审批/澄清 SSE**：approval/clarify 模态（若 Agent 需要人在回路）
25. **选中文本回复、TTS、related questions、mindmap**：复用 next-chat-service 已声明的方法

---

## 五、分阶段开发计划

| 阶段 | 目标 | 关键交付 | 决策依赖 |
|---|---|---|---|
| **阶段 1** | MVP 独立聊天 | P0 全部：BFF 存储层 + CRUD + 独立聊天页 + SSE 流式 + 侧边栏 | 需先确认方案 A/B/C |
| **阶段 2** | 会话操作完整性 | P1 全部：操作 API + slash 命令 + 消息编辑/分支 + 导出 + 草稿 | 阶段 1 落地后 |
| **阶段 3** | 可靠性 | P2 全部：列表 SSE + 恢复机制 + cancel + 离线横幅 | 阶段 2 完成后 |
| **阶段 4** | 企业版多租户 | P3 全部：RBAC + scoped 存储 + Tenant 绑定 | 对齐 Intellect-Team Tenant 实体进度 |
| **阶段 5** | webui 全功能对齐 | P4 全部：压缩链 + 跨来源 + memory 生命周期 + 用量 + FTS + worktree + 审批 | 视产品需求优先级 |

---

## 六、补充：AgentUI 独有的会话/UI 能力

AgentUI 因画布/Agent 调试定位，有 webui 完全不具备的能力，迁移/对齐时**不应丢失**：

### 6.1 画布与节点级调试
- **可视化画布**（ReactFlow）：30+ 节点类型（[canvas/index.tsx](file:///Users/simon/project/agentui/src/pages/agent/canvas/index.tsx)），含 Agent/Retrieval/Categorize/Switch/Iteration/Loop/Tool 等
- **单节点调试**：`debugSingle` API（`/v1/agents/{id}/debug/{componentId}`），可在画布内独立运行单个节点
- **运行日志时间线**：[LogSheet/workflow-timeline](file:///Users/simon/project/agentui/src/pages/agent/log-sheet/index.tsx)，按消息维度展示节点事件链
- **节点表单输入**：`inputForm`、`getInputElements`、`ParameterDialog`，画布 Begin 节点的结构化表单
- **Webhook Trace**：`fetchWebhookTrace`，外部触发链路追踪

### 6.2 知识库引用追溯
- **引用文档/图片列表**：`ReferenceDocumentList`、`ReferenceImageList`，消息内引用聚合展示
- **PDF 抽屉跳转**：[pdf-drawer](file:///Users/simon/project/agentui/src/components/pdf-drawer/index.tsx) + `clickDocumentButton`，从消息引用直达 PDF 片段
- **文档下载**：`DocumentDownloadButton`，消息附件下载
- **引用 marker 正则**：`citationMarkerReg`，markdown 内联引用渲染

### 6.3 消息辅助操作
- **点赞/反馈/Prompt 查看**：[group-button.tsx](file:///Users/simon/project/agentui/src/components/next-message-item/group-button.tsx) `AssistantGroupButton`，含 `useSendFeedback`、`FeedbackDialog`、`PromptDialog`
- **TTS**：`useSpeech` 钩子（webui 也有，但 AgentUI 已组件化）
- **重新生成**：`IRegenerateMessage`、`SyncOutlined`

### 6.4 Agent 模板与多形态
- **Agent 模板库**：`listAgentTemplate`、`AgentTemplates` 页
- **Agent 分享/嵌入**：`AgentShare`、`EmbedDialog`、`FloatingChatWidget`
- **Agent 日志页**：`AgentLogPage`（分页+日期范围+CSV 导出，webui 无此维度的 Agent 日志）

### 6.5 Composer 现有能力（[next.tsx](file:///Users/simon/project/agentui/src/components/message-input/next.tsx)）
- 文件上传（dropzone + 进度 + 拒绝回调）
- Thinking 模式开关（`Atom` 图标）
- Internet 搜索开关（`Globe` 图标）
- 语音输入（`AudioButton`）
- Stop 流式（`CircleStop`）
- 自动 textarea 高度（minRows 2 / maxRows 8）

> **结论**：AgentUI 在画布可视化、节点调试、知识库引用追溯方面远超 webui；webui 在会话生命周期、流式细节、多用户隔离方面远超 AgentUI。两者是互补关系。

---

## 七、BFF 是否有必要建会话存储？

### 结论：**有必要，但分层建设**——BFF 自建会话元数据 + 消息索引，Intellect RAG/Agent 作为消息正文与生成后端。

### 7.1 必要性论证

| 必要性来源 | 说明 |
|---|---|
| **BFF 当前 session 路由是 stub** | [bff/src/routes/session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) 返回假数据，必须落地真实实现才能支撑任何会话功能 |
| **企业版多租户隔离约束** | project_memory 要求「BFF Tenant 绑定 Intellect Tenant 实例」「会话需 member/team RBAC」。RAG 的 `/v1/chats/sessions` 不持有 Tenant/Team 维度，无法满足企业版隔离 |
| **RAG API 能力缺口** | Intellect RAG 不支持：压缩链/血缘/恢复/slash 命令/会话列表 SSE/FTS/草稿/置顶归档。这些是 webui 会话核心能力，无法靠 RAG 透传 |
| **会话与画布解耦需求** | 当前会话强绑 Agent/画布，无法支持「独立聊天页」「跨 Agent 会话聚合」。BFF 自建层才能让会话成为顶级实体 |
| **跨来源聚合** | webui 聚合 webui/cli/messaging/cron 来源；AgentUI 未来若接入多来源（MCP、外部 Agent），必须有 BFF 投影层 |
| **多 worker 一致性** | webui 用 Redis bridge 跨 worker 同步会话列表事件；BFF 若多实例部署，同样需要自有事件层 |

### 7.2 分层存储设计建议

```
┌─────────────────────────────────────────────────┐
│ BFF 自建层（必需）                                │
│  - sessions 表：id, tenant_id, member_id, team_id,│
│       title, source, parent_session_id, pinned,  │
│       archived, project_id, created_at, ...      │
│  - messages 索引表：id, session_id, role,         │
│       created_at, token_count                     │
│  - 会话列表 SSE 事件总线                          │
│  - RBAC scope 过滤                                │
└─────────────────────────────────────────────────┘
                    │ 消息正文 / 生成
                    ▼
┌─────────────────────────────────────────────────┐
│ 后端生成层（按场景选择）                          │
│  - Intellect RAG `/v1/chats`：基础聊天（社区版）  │
│  - Intellect Agent runtime：高级能力（压缩/血缘） │
│  - MCP 方式（未来）：企业版画布功能                │
└─────────────────────────────────────────────────┘
```

### 7.3 与 RAG 的关系
- **不替代 RAG**：RAG 仍负责知识库检索、文档解析、画布 DSL 执行
- **BFF 持有会话元数据主权**：会话归属、可见性、生命周期由 BFF 管理
- **消息正文双写或引用**：BFF 索引消息 ID + 元数据，正文可存 RAG 或 BFF（取决于是否需要 RAG 的引用追溯）
- **符合 project_memory**：前端 RAG 与企业版独立，BFF 层做隔离与路由

### 7.4 不建 BFF 存储的代价
- 无法满足企业版 Tenant/Team RBAC
- 无法实现 webui 的高级会话能力（约 60% 的会话功能缺失）
- 会话永远依附画布，无法做独立聊天页
- 多 worker/多实例部署无法保证一致性

---

## 八、UI 差别与 WebUI 可借鉴点

### 8.1 整体 UI 架构差别

| 维度 | AgentUI | intellect-webui |
|---|---|---|
| 技术栈 | React + Tailwind + shadcn/ui + Radix | 原生 JS + 手写 CSS + SSE |
| 布局 | 画布全屏 + Sheet 抽屉式聊天 | 三栏固定（侧边栏/聊天/右栏） |
| 主题 | ThemeProvider（dark default） | CSS 变量 + skins |
| 国际化 | i18next | 自定义 t() + patch 脚本 |
| 状态管理 | TanStack Query + zustand | 全局 S 对象 + localStorage |
| 流式渲染 | useSendMessageBySSE + message-item | 增量 smd 解析器 + KaTeX 节流 |

### 8.2 Composer 区差别与可借鉴点

#### 当前 AgentUI Composer 能力（[next.tsx](file:///Users/simon/project/agentui/src/components/message-input/next.tsx)）
- 文件上传（dropzone + 进度）
- Thinking / Internet 开关
- 语音输入
- Stop
- 自动高度

#### WebUI Composer 额外能力（可借鉴）
| 能力 | webui 实现 | AgentUI 借鉴价值 |
|---|---|---|
| **模型/profile/workspace 三联选择器** | `composerModelDropdown` + `composerModelChip` + profile select + workspace select | 高 — 当前 AgentUI 模型选择在画布节点内，独立聊天页需在 Composer 内 |
| **Context ring（上下文用量环）** | `context-ring` 按钮，显示 token 占用比例 | 高 — 长会话必需，AgentUI 完全没有 |
| **Slash 命令自动补全** | `commands.js` + `/api/models` 缓存，输入 `/` 弹出命令面板 | 高 — /retry /undo /compress 等需此入口 |
| **Composer 草稿持久化** | `/api/session/draft` + per-session localStorage | 中 — 切换会话不丢输入 |
| **选中文本回复** | `_selectedTextReplyButton`，聊天区选中文本插入引用 | 中 — 提升追问体验 |
| **离线横幅 + 流式错误延迟** | `showOfflineBanner` + `_deferStreamErrorIfOffline` | 中 — 弱网体验 |
| **附件预览增强** | 上传名/大小/进度 | 中 — AgentUI 已有，可对齐细节 |
| **TTS 暂停 on focus** | composer focus 时 `speechSynthesis.pause()` | 低 — 细节优化 |

#### 建议优先借鉴（P0/P1）
1. **Context ring**：在 Composer 工具栏增加 token 用量环，对接 BFF `/api/session/status`
2. **模型/profile 选择器**：复用 AgentUI 已有 `llm-select`、`model-tree-select` 组件，下沉到 Composer
3. **Slash 命令面板**：新增 `commands` 钩子，输入 `/` 触发，对接 P1 的 slash 命令 API
4. **草稿持久化**：Composer value 按 sessionId 存 localStorage + BFF draft API

### 8.3 流式会议内容显示差别与可借鉴点

#### 当前 AgentUI 流式渲染
- [use-send-agent-message.ts](file:///Users/simon/project/agentui/src/pages/agent/chat/use-send-agent-message.ts)：SSE 事件 → derivedMessages 累积
- [next-message-item](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx)：MarkdownContent + 引用 + thinking 折叠
- thinking 通过 `showThinking` 状态折叠，`Atom` 图标
- 工具调用：通过 `LogSheet` 的 `WorkFlowTimeline` 展示节点事件（非消息内联）

#### WebUI 流式渲染额外能力（可借鉴）
| 能力 | webui 实现 | AgentUI 借鉴价值 |
|---|---|---|
| **增量 streaming-markdown 解析** | `messages.js` 的 smd 增量 DOM 构建 + KaTeX 节流 | 高 — AgentUI 当前整段 markdown 重渲染，长文本卡顿 |
| **Tool call 内联卡片** | 消息内联渲染 `tool_calls`（OpenAI 格式）+ tool 输出索引匹配 | 高 — AgentUI 工具调用在 LogSheet，消息内无内联 |
| **Approval 卡片** | `approval-card` + once/session/always/deny 四按钮 | 高 — 若 Agent 需人在回路，消息内审批优于弹窗 |
| **Clarify 卡片** | `clarify-card` + input + dock 折叠 | 高 — 澄清提问内联，不离开聊天流 |
| **Reasoning 实时流** | `reasoningText` 增量 + think 标签剥离 + partial 标签隐藏 | 中 — AgentUI 有 thinking 折叠，但无实时增量 |
| **Provider error details** | `<details>` 折叠 provider 错误详情 | 中 — 调试友好 |
| **Live tool calls snippet** | `_partial_tool_calls` 增量片段 | 中 — 工具执行过程可见 |
| **INFLIGHT 状态恢复** | `INFLIGHT[activeSid]` 保存乐观消息 + 切换会话恢复 | 高 — 切换会话不丢正在发送的消息 |
| **Terminal 流式区分** | `terminal` clarify 来源标记 | 低 |

#### 建议优先借鉴（P0/P1）
1. **增量 markdown 渲染**：替换 `MarkdownContent` 为流式增量解析，避免长文本重渲染（性能关键）
2. **Tool call 内联卡片**：在 `next-message-item` 内增加 `ToolCallCard` 组件，复用 `LogSheet` 事件数据
3. **Approval/Clarify 内联卡片**：新增 `ApprovalCard`/`ClarifyCard` 组件，SSE 事件驱动，替代未来弹窗方案
4. **INFLIGHT 状态**：`useSendAgentMessage` 增加 `inflight` ref，切换会话时保存/恢复乐观消息
5. **Reasoning 实时增量**：thinking 区改为增量流式 + partial 标签隐藏

### 8.4 不建议借鉴的部分
- **三栏固定布局**：AgentUI 的画布全屏 + Sheet 抽屉更适合调试场景，独立聊天页可三栏但画布页保留
- **原生 JS 状态管理**：AgentUI 的 TanStack Query + zustand 更现代，不回退
- **手写 CSS**：保留 Tailwind + shadcn/ui

---

## 九、建议

1. **优先解决决策点**：方案 A（BFF 自建）虽工作量大，但能完整对齐 webui 且与画布解耦，符合「Intellect RAG 与企业版功能完全独立」的约束。方案 B 无法实现 webui 的高级能力。
2. **阶段 1 可借用现有资产**：复用 `use-send-agent-message.ts` 的 SSE 逻辑、`message-item` 组件、`next-chat-service.ts` 的 API 封装模式，降低 MVP 成本。
3. **P3 企业版多租户**需与 Intellect-Team Tenant 实体开发进度对齐，建议作为并行轨道而非阻塞。
4. **P4 部分能力**（跨来源聚合、memory 生命周期）依赖 intellect-agent 运行时，若 AgentUI 不直接对接 agent runtime，可降级或省略。
5. **UI 借鉴优先级**：增量 markdown 渲染 > Tool call 内联卡片 > Context ring > Slash 命令面板 > Approval/Clarify 卡片 > 草稿持久化。
6. **保留 AgentUI 独有优势**：画布可视化、节点调试、知识库引用追溯、Agent 模板/分享/嵌入等能力在迁移中不应丢失。
