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

## 〇、实施进度总览（2026-07-26 复盘）

> **架构决策落地**：选择 **方案 B**（CHAT 直接通过 Gateway 对接 TEAM，复用 Intellect RAG `/v1/chats` API），未走方案 A（BFF 自建会话存储）。LLM 部署由 Gateway 端完成，BFF 仅作透明代理（`/api/bff/proxy/v1/*` → intellect-team Gateway）。

| 阶段 | 状态 | 说明 |
|---|---|---|
| **阶段 1** MVP 独立聊天 | ✅ 基本完成（方案 B） | 独立聊天页 `src/pages/next-chats/` 已落地，三栏布局（Sessions + ChatBox + ChatSettings，默认折叠）；Chat 列表/CRUD/分页/服务端搜索/重命名；Session list/get/new/update/delete（API 全有，rename UI 未接入）；SSE 流式（reasoning + 多轮 history）。**未走 BFF 自建存储路径** |
| **阶段 2** 会话操作完整性 | ⚠️ 部分 | 消息级：regenerate/delete/thumbup/TTS/mindmap/relatedQuestions 已实现；会话级：delete + 批量 delete + 临时会话；Chat rename ✅；Session rename API ⚠️（UI 未接入）；**未实现** clear/pin/archive/move/duplicate/branch/truncate/export/draft/toolsets/yolo |
| **阶段 3** 可靠性 | ❌ 未开始 | 无 sessions/events SSE、无 .bak 恢复、无 cancel_flags 清理、无离线横幅 |
| **阶段 4** 企业版 Team/Project 隔离 | ❌ 未开始（针对会话） | BFF 在 admin/teams/projects 路由有 RBAC，但会话路由（`bff/src/routes/session.ts`）仍是 stub，未应用 SessionListScope |
| **阶段 5** webui 全功能对齐 | ❌ 未开始 | 无压缩链/血缘/恢复/跨来源聚合/memory 生命周期/usage/FTS/worktree/approval/clarify |

**关键架构事实**：
- BFF `/api/session/*` 路由仍是 stub（[bff/src/routes/session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) 34 行假数据），**但已不是会话功能的实际路径**——会话通过 `/api/bff/proxy/v1/chats/*` 透传到 intellect-team Gateway
- 前端 `src/features/chats/manifest.ts` 已挂载 `src/pages/next-chats/` 真实页面（不再是 manifest 占位）
- 画布相关代码（原 `src/pages/agent/`）已迁移到 `packages/canvas-plugin/src/editor/`（spec-009 完成）
- `useWarnEmptyModel` 对 New Chat 的 LLM 检测已移除（CHAT 走 Gateway，LLM 由 Gateway 端部署）

---

## 一、AgentUI 会话模块现状

### 1.1 数据模型
AgentUI 沿用 Intellect RAG 的「Chat 助手 → Session → Message」三层模型，**会话已脱离画布成为顶级实体**（独立聊天页 `src/pages/next-chats/` 已落地，方案 B 路径）：

- **独立聊天页**（已落地）：`src/pages/next-chats/`
  - `index.tsx`：Chat 列表页（分页/服务端 keywords 搜索/创建/重命名/删除）
  - `chat/index.tsx`：三栏布局聊天页（Sessions + SingleChatBox + ChatSettings，默认折叠）
  - `chat/sessions.tsx`：会话侧边栏（客户端搜索/新建/批量删除/Embed）
  - `hooks/use-send-chat-message.ts`：独立聊天的 SSE 发送（POST `${restAPIv1}/chat/completions`）
- **画布内 Chat**（已迁移到 `packages/canvas-plugin/src/editor/chat/`）：`box.tsx`、`chat-sheet.tsx`、`use-send-agent-message.ts`
- **Agent Explore**（已迁移到 `packages/canvas-plugin/src/editor/explore/`）：会话列表 + 会话聊天
- `pages/agents/agent-log-page.tsx`：Agent 日志（会话历史）
- `services/next-chat-service.ts`：封装 Intellect RAG `/v1/chats`、`/v1/chats/{id}/sessions` API（经 BFF proxy 透传到 intellect-team Gateway）
- `utils/api.ts`：
  - Chat/Session URL 走 `restAPIv1 = /api/bff/proxy/v1`（透明代理 → intellect-team Gateway）
  - **Agent-scoped Session URL** 走 `bffAgents = /api/bff/agents`（BFF 原生路由 → `IntellectRagAdapter`，非透明代理），如 `createAgentSession`/`fetchAgentSessions` 指向 `${bffAgents}/{agentId}/sessions`

### 1.2 已实现能力
| 能力 | 位置 | 说明 |
|---|---|---|
| 独立聊天页 | [src/pages/next-chats/chat/index.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/index.tsx) | 三栏：Sessions + SingleChatBox + ChatSettings（ChatSettings 默认折叠，可展开）；支持多模型对比模式（MultipleChatBox） |
| Chat 列表 | [src/pages/next-chats/index.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/index.tsx) | 分页、**服务端搜索**（keywords 参数）、创建、重命名、删除、批量删除 |
| Chat CRUD | [src/services/next-chat-service.ts](file:///Users/simon/project/agentui/src/services/next-chat-service.ts) | createChat/listChats/getChat/updateChat/patchChat/deleteChat/bulkDeleteChats |
| Chat 重命名 | [src/pages/next-chats/hooks/use-rename-chat.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-rename-chat.ts) | ✅ Chat 级 rename 通过 `usePatchChat` 实现（PATCH `/v1/chats/{id}`） |
| Session CRUD | [src/services/next-chat-service.ts](file:///Users/simon/project/agentui/src/services/next-chat-service.ts) | createSession/listSessions/getSession/updateSession/removeSessions；`useUpdateSession` hook 已实现（PATCH `/v1/chats/{id}/sessions/{sid}`），但 **UI 未接入 rename 入口**（[conversation-dropdown.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/conversation-dropdown.tsx) 仅 delete） |
| 会话侧边栏 | [src/pages/next-chats/chat/sessions.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/sessions.tsx) | **客户端搜索**（`data.filter(name.includes)`）、新建临时会话、批量删除、Embed 对话框 |
| SSE 流式发送（独立聊天） | [src/pages/next-chats/hooks/use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts) | useSendMessageWithSse → `${restAPIv1}/chat/completions`，支持 reasoning（`start_to_think`/`end_to_think` 标签包裹）+ 多轮 history |
| SSE 流式发送（画布） | [packages/canvas-plugin/src/editor/chat/use-send-agent-message.ts](file:///Users/simon/project/agentui/packages/canvas-plugin/src/editor/chat/use-send-agent-message.ts) | 544 行，含 stop/表单消息/附件 |
| 消息渲染 | [src/components/next-message-item/index.tsx](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx) | message-item + ReferenceDocumentList + ReferenceImageList + UploadedMessageFiles + thinking 折叠 |
| 消息辅助操作 | [src/components/next-message-item/group-button.tsx](file:///Users/simon/project/agentui/src/components/next-message-item/group-button.tsx) | regenerate（UserGroupButton）、delete、thumbup/feedback、TTS（useSpeech）、Prompt 查看、copy、log sheet、附件下载；mindmap/relatedQuestions 走 [useFetchMindMap](file:///Users/simon/project/agentui/src/hooks/use-chat-request.ts) / [useFetchRelatedQuestions](file:///Users/simon/project/agentui/src/hooks/use-chat-request.ts) |
| Agent 日志 | [src/pages/agents/agent-log-page.tsx](file:///Users/simon/project/agentui/src/pages/agents/agent-log-page.tsx) | 分页/日期/关键词/CSV 导出/详情 Modal |
| Embed/分享 | [src/pages/next-chats/share](file:///Users/simon/project/agentui/src/pages/next-chats/share)、[widget](file:///Users/simon/project/agentui/src/pages/next-chats/widget) | 分享页 + Widget 嵌入 |
| Chat 设置 | [src/pages/next-chats/chat/app-settings/chat-settings.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/app-settings/chat-settings.tsx) | 基础设置 + Prompt 引擎 + LLM 选择 + 动态变量（默认折叠，需手动展开） |

### 1.3 关键缺口
- **BFF 会话路由仍是 stub**：[bff/src/routes/session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) 34 行假数据 —— **但已不是会话功能实际路径**，会话通过 `/api/bff/proxy/v1/chats/*` 透传到 intellect-team Gateway（方案 B）
- **会话级操作不全**：✅ delete + 批量 delete + 临时会话；⚠️ Session rename API 已实现但 UI 未接入；❌ 缺 clear/pin/archive/move/duplicate/branch/truncate/export/draft/toolsets/yolo
- 无 SSE 事件总线（`/sessions/events`）、无会话恢复/压缩链/多用户隔离
- Composer 无 context ring / model 选择器 / slash 命令面板 / 草稿持久化
- 消息内无 tool_call/approval/clarify 内联卡片（工具调用仍走画布 LogSheet）
- 无 INFLIGHT 状态恢复（切换会话可能丢失正在发送的消息）

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

| 维度 | AgentUI（2026-07-26 状态） | intellect-webui |
|---|---|---|
| 会话定位 | ✅ 顶级独立实体（`src/pages/next-chats/`） | 顶级独立实体 |
| 会话存储 | ⚠️ 经 BFF proxy 透传到 intellect-team Gateway（方案 B），BFF 不自建存储 | 自有 JSON sidecar + state DB（PG）+ .bak |
| BFF 会话路由 | ❌ `/api/session/*` 仍是 stub（未使用）；实际走 `/api/bff/proxy/v1/chats/*` 透传 | 完整 60+ 端点 |
| 独立聊天页 | ✅ 三栏（Sessions + ChatBox + ChatSettings，第三栏默认折叠），含多模型对比模式 | 三栏 SSE 聊天 |
| 流式 | ✅ SSE + reasoning；❌ 缺 tool calls/approval/clarify 内联 | SSE + reasoning + tool calls + approval + clarify |
| 会话操作 | ⚠️ Chat rename ✅；Session delete/批量 delete/临时会话；Session rename API ⚠️（UI 未接入）；❌ 缺 clear/pin/archive/move/duplicate/branch/truncate/export/draft/toolsets/yolo | 重命名/置顶/归档/移动/复制/分支/压缩/截断/清空/导出/草稿/YOLO |
| Slash 命令 | ❌ 无 | /retry /undo /status /usage |
| 列表事件 | ❌ 轮询（TanStack Query refetch） | SSE sessions/events + Redis bridge |
| 跨来源聚合 | ❌ 无 | webui/cli/messaging/cron/tool 投影 |
| 压缩链 | ❌ 无 | 压缩链合并 + 血缘报告 |
| 多用户隔离 | ❌ 无（会话层） | SessionListScope + member/team RBAC |
| 恢复机制 | ❌ 无 | .bak 恢复 + 孤儿备份 + sidecar 物化 |
| 用量统计 | ❌ 无独立端点（仅 SSE message_end 携带 usage） | /status /usage /insights |
| Memory 生命周期 | ❌ 无 | generation 计数 + commit 边界 |
| Worktree | ❌ 无 | worktree 状态/移除 |
| FTS 搜索 | ⚠️ Chat 列表服务端 keywords 搜索；Session 列表客户端 `filter(name.includes)`；❌ 无服务端全文搜索 | 服务端全文搜索 |

---

## 四、需开发功能清单

### 决策点（已确认）
> **决策结果（2026-07-26）**：选择 **方案 B** — 复用 Intellect RAG/Gateway `/v1/chats` API（经 BFF proxy 透传），未走方案 A（BFF 自建会话存储）。
>
> 理由：CHAT 直接通过 intellect-team Gateway 对接 TEAM，LLM 部署由 Gateway 端完成；intellect-team Gateway 已实现 BFF 调用的 45/46 个路由（Rust gateway，端口 9091），无需 BFF 重复实现。
>
> **代价**：webui 的高级能力（压缩链/血缘/恢复/slash 命令/会话列表 SSE/FTS/草稿/置顶归档） intellect-team Gateway 不支持，需在 P3/P4 阶段视产品需求决定是否补齐或切换方案 A。

### 开发任务清单（含状态）

#### P0 — 基础会话生命周期 ✅ 基本完成
1. ⚠️ **BFF 会话存储层**：[bff/src/routes/session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) 仍是 stub —— **方案 B 下不再需要**，会话元数据由 intellect-team Gateway 管理
2. ⚠️ **会话 CRUD API**：Chat 级 list/get/new/delete/update/patch ✅（[next-chat-service.ts](file:///Users/simon/project/agentui/src/services/next-chat-service.ts)）；Session 级 list/get/new/update/delete ✅ API 已实现（[useUpdateSession](file:///Users/simon/project/agentui/src/hooks/use-chat-request.ts)）；✅ Chat rename UI 已接入（[use-rename-chat.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-rename-chat.ts)）；❌ Session rename UI 未接入；❌ 缺 clear/duplicate
3. ✅ **独立聊天页面**：[src/pages/next-chats/chat/index.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/index.tsx) 三栏布局已落地（ChatSettings 默认折叠）
4. ✅ **聊天 SSE 流式**：[use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts) → `${restAPIv1}/chat/completions`，支持 reasoning（`start_to_think`/`end_to_think` 标签包裹）；❌ 缺 tool calls/approval/clarify（BFF `serializeChunk` 过滤 tool_* 事件）
5. ✅ **会话侧边栏**：[sessions.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/sessions.tsx) 列表 + 客户端搜索 + 新建/批量删除 + 选中态 + URL 同步

#### P1 — 会话操作与编辑 ⚠️ 部分
6. ❌ **会话级操作 API**：truncate/branch/pin/archive/move/draft/toolsets/yolo 全部未实现
7. ❌ **Slash 命令**：未实现
8. ⚠️ **消息编辑/重试/分支**：✅ regenerate（[UserGroupButton](file:///Users/simon/project/agentui/src/components/next-message-item/group-button.tsx)）+ delete；❌ 编辑/分支未实现
9. ❌ **会话导出**：未实现
10. ❌ **草稿与 composer 增强**：草稿持久化未实现；✅ 附件已实现；❌ 模型/profile 选择未在 composer

#### P2 — 实时性与可靠性 ❌ 未开始
11. ❌ **会话列表 SSE 事件**：未实现（当前用 TanStack Query refetch）
12. ❌ **会话恢复机制**：未实现
13. ⚠️ **流式 cancel 与 stale state 清理**：✅ AbortController stop；❌ active_stream_id 清理 + 重连未实现
14. ❌ **离线/重连横幅**：未实现

#### P3 — 多用户与企业版 ❌ 未开始（会话层）
15. ❌ **会话可见性 RBAC**：SessionListScope 未实现（BFF admin/teams/projects 有 RBAC，但会话路由未应用）
16. ❌ **多成员 scoped 存储**：未实现
17. ⚠️ **BFF Tenant 绑定**：BFF 已绑定 intellect-team Tenant 实例（spec-011 完成），但会话层未应用 tenant 隔离

#### P4 — 高级能力 ❌ 未开始
18. ❌ **上下文压缩**
19. ❌ **跨来源聚合**
20. ❌ **Memory provider 生命周期**
21. ❌ **用量统计**（仅 SSE message_end 携带 usage chunk）
22. ❌ **全文搜索**
23. ❌ **Worktree 集成**
24. ❌ **审批/澄清 SSE**
25. ⚠️ **消息辅助操作**：✅ thumbup/TTS/mindmap/relatedQuestions 已声明并接入 group-button；❌ 选中文本回复未实现

---

## 五、分阶段开发计划

| 阶段 | 目标 | 关键交付 | 决策依赖 | 状态 |
|---|---|---|---|---|
| **阶段 1** | MVP 独立聊天 | P0 全部：BFF 存储层 + CRUD + 独立聊天页 + SSE 流式 + 侧边栏 | ~~需先确认方案 A/B/C~~ → 已选方案 B | ✅ 基本完成 |
| **阶段 2** | 会话操作完整性 | P1 全部：操作 API + slash 命令 + 消息编辑/分支 + 导出 + 草稿 | 阶段 1 落地后 | ⚠️ 部分（消息级 regenerate/delete 已实现） |
| **阶段 3** | 可靠性 | P2 全部：列表 SSE + 恢复机制 + cancel + 离线横幅 | 阶段 2 完成后 | ❌ 未开始 |
| **阶段 4** | 企业版 Team/Project 组织隔离 | P3 全部：RBAC + scoped 存储 + Tenant 绑定 | 对齐 Intellect-Team Tenant 实体进度 | ❌ 未开始（会话层） |
| **阶段 5** | webui 全功能对齐 | P4 全部：压缩链 + 跨来源 + memory 生命周期 + 用量 + FTS + worktree + 审批 | 视产品需求优先级 | ❌ 未开始 |

---

## 六、补充：AgentUI 独有的会话/UI 能力

AgentUI 因画布/Agent 调试定位，有 webui 完全不具备的能力，迁移/对齐时**不应丢失**：

> **注**：以下画布相关路径已迁移到 `packages/canvas-plugin/src/editor/`（spec-009 完成）。

### 6.1 画布与节点级调试
- **可视化画布**（ReactFlow）：30+ 节点类型（[canvas/index.tsx](file:///Users/simon/project/agentui/packages/canvas-plugin/src/editor/canvas/index.tsx)），含 Agent/Retrieval/Categorize/Switch/Iteration/Loop/Tool 等
- **单节点调试**：`debugSingle` API（`/v1/agents/{id}/debug/{componentId}`），可在画布内独立运行单个节点
- **运行日志时间线**：[LogSheet/workflow-timeline](file:///Users/simon/project/agentui/packages/canvas-plugin/src/editor/log-sheet/index.tsx)，按消息维度展示节点事件链
- **节点表单输入**：`inputForm`、`getInputElements`、`ParameterDialog`，画布 Begin 节点的结构化表单
- **Webhook Trace**：`fetchWebhookTrace`，外部触发链路追踪

### 6.2 知识库引用追溯
- **引用文档/图片列表**：`ReferenceDocumentList`、`ReferenceImageList`，消息内引用聚合展示
- **PDF 抽屉跳转**：[pdf-drawer](file:///Users/simon/project/agentui/src/components/pdf-drawer/index.tsx) + `clickDocumentButton`，从消息引用直达 PDF 片段
- **文档下载**：`DocumentDownloadButton`，消息附件下载
- **引用 marker 正则**：`citationMarkerReg`，markdown 内联引用渲染

### 6.3 消息辅助操作（已实现 ✅）
- **点赞/反馈/Prompt 查看**：[group-button.tsx](file:///Users/simon/project/agentui/src/components/next-message-item/group-button.tsx) `AssistantGroupButton`，含 `useSendFeedback`、`FeedbackDialog`、`PromptDialog`
- **TTS**：`useSpeech` 钩子（webui 也有，但 AgentUI 已组件化）
- **重新生成**：`IRegenerateMessage`、`SyncOutlined`
- **Mindmap/Related Questions**：[next-chat-service.ts](file:///Users/simon/project/agentui/src/services/next-chat-service.ts) 已声明 `chatsMindmap` / `chatsRelatedQuestions`

### 6.4 Agent 模板与多形态
- **Agent 模板库**：`listAgentTemplate`、`AgentTemplates` 页
- **Agent 分享/嵌入**：`AgentShare`、`EmbedDialog`、`FloatingChatWidget`、Chat Embed（[src/pages/next-chats/share](file:///Users/simon/project/agentui/src/pages/next-chats/share)、[widget](file:///Users/simon/project/agentui/src/pages/next-chats/widget)）
- **Agent 日志页**：[AgentLogPage](file:///Users/simon/project/agentui/src/pages/agents/agent-log-page.tsx)（分页+日期范围+CSV 导出，webui 无此维度的 Agent 日志）

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

> **决策更新（2026-07-26）**：当前选择 **方案 B**（不建 BFF 会话存储，走 BFF proxy 透传到 intellect-team Gateway）。下文为原始论证，保留作为后续若需切换方案 A 时的参考。

### 结论：**有必要，但分层建设**——BFF 自建会话元数据 + 消息索引，Intellect RAG/Agent 作为消息正文与生成后端。

### 7.1 必要性论证

| 必要性来源 | 说明 |
|---|---|
| **BFF 当前 session 路由是 stub** | [bff/src/routes/session.ts](file:///Users/simon/project/agentui/bff/src/routes/session.ts) 返回假数据，必须落地真实实现才能支撑任何会话功能 |
| **企业版 Team/Project 组织隔离约束** | project_memory 要求「BFF Tenant 绑定 Intellect Tenant 实例」「会话需 member/team RBAC」。RAG 的 `/v1/chats/sessions` 不持有 Tenant/Team 维度，无法满足企业版隔离 |
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

| 维度 | AgentUI（2026-07-26 状态） | intellect-webui |
|---|---|---|
| 技术栈 | React + Tailwind + shadcn/ui + Radix | 原生 JS + 手写 CSS + SSE |
| 布局 | ✅ 独立聊天页三栏（Sessions + ChatBox + ChatSettings）；画布全屏 + Sheet 抽屉 | 三栏固定（侧边栏/聊天/右栏） |
| 主题 | ThemeProvider（dark default） | CSS 变量 + skins |
| 国际化 | i18next | 自定义 t() + patch 脚本 |
| 状态管理 | TanStack Query + zustand | 全局 S 对象 + localStorage |
| 流式渲染 | ✅ useSendMessageWithSse + message-item（独立聊天）；useSendMessageBySSE（画布） | 增量 smd 解析器 + KaTeX 节流 |

### 8.2 Composer 区差别与可借鉴点

#### 当前 AgentUI Composer 能力（[next.tsx](file:///Users/simon/project/agentui/src/components/message-input/next.tsx)）✅ 已实现
- 文件上传（dropzone + 进度）
- Thinking / Internet 开关
- 语音输入
- Stop
- 自动高度

#### WebUI Composer 额外能力（可借鉴）— 全部 ❌ 未实现
| 能力 | webui 实现 | AgentUI 状态 | 借鉴价值 |
|---|---|---|---|
| **模型/profile/workspace 三联选择器** | `composerModelDropdown` + `composerModelChip` + profile select + workspace select | ❌ 未在 composer（Chat 设置面板有 LLM 选择） | 高 |
| **Context ring（上下文用量环）** | `context-ring` 按钮，显示 token 占用比例 | ❌ | 高 — 长会话必需 |
| **Slash 命令自动补全** | `commands.js` + `/api/models` 缓存，输入 `/` 弹出命令面板 | ❌ | 高 |
| **Composer 草稿持久化** | `/api/session/draft` + per-session localStorage | ❌ | 中 |
| **选中文本回复** | `_selectedTextReplyButton`，聊天区选中文本插入引用 | ❌ | 中 |
| **离线横幅 + 流式错误延迟** | `showOfflineBanner` + `_deferStreamErrorIfOffline` | ❌ | 中 |
| **附件预览增强** | 上传名/大小/进度 | ✅ 已有 | 中 — 可对齐细节 |
| **TTS 暂停 on focus** | composer focus 时 `speechSynthesis.pause()` | ❌ | 低 |

#### 建议优先借鉴（P0/P1）
1. **Context ring**：在 Composer 工具栏增加 token 用量环，对接 BFF `/api/session/status`
2. **模型/profile 选择器**：复用 AgentUI 已有 `llm-select`、`model-tree-select` 组件，下沉到 Composer
3. **Slash 命令面板**：新增 `commands` 钩子，输入 `/` 触发，对接 P1 的 slash 命令 API
4. **草稿持久化**：Composer value 按 sessionId 存 localStorage + BFF draft API

### 8.3 流式会议内容显示差别与可借鉴点

#### 当前 AgentUI 流式渲染
- 独立聊天：[use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts)：SSE 事件 → derivedMessages 累积
- 画布聊天：[use-send-agent-message.ts](file:///Users/simon/project/agentui/packages/canvas-plugin/src/editor/chat/use-send-agent-message.ts)（已迁移）
- [next-message-item](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx)：MarkdownContent + 引用 + thinking 折叠
- thinking 通过 `showThinking` 状态折叠，`Atom` 图标
- 工具调用：通过 `LogSheet` 的 `WorkFlowTimeline` 展示节点事件（非消息内联）

#### WebUI 流式渲染额外能力（可借鉴）— 全部 ❌ 未实现
| 能力 | webui 实现 | AgentUI 状态 | 借鉴价值 |
|---|---|---|---|
| **增量 streaming-markdown 解析** | `messages.js` 的 smd 增量 DOM 构建 + KaTeX 节流 | ❌ 整段 markdown 重渲染 | 高 — 性能关键 |
| **Tool call 内联卡片** | 消息内联渲染 `tool_calls`（OpenAI 格式）+ tool 输出索引匹配 | ❌ 仍在 LogSheet | 高 |
| **Approval 卡片** | `approval-card` + once/session/always/deny 四按钮 | ❌ | 高 — 人在回路 |
| **Clarify 卡片** | `clarify-card` + input + dock 折叠 | ❌ | 高 |
| **Reasoning 实时流** | `reasoningText` 增量 + think 标签剥离 + partial 标签隐藏 | ⚠️ 有 thinking 折叠，无实时增量 | 中 |
| **Provider error details** | `<details>` 折叠 provider 错误详情 | ❌ | 中 |
| **Live tool calls snippet** | `_partial_tool_calls` 增量片段 | ❌ | 中 |
| **INFLIGHT 状态恢复** | `INFLIGHT[activeSid]` 保存乐观消息 + 切换会话恢复 | ❌ | 高 — 切换会话不丢消息 |
| **Terminal 流式区分** | `terminal` clarify 来源标记 | ❌ | 低 |

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

## 九、建议（2026-07-26 更新）

1. ~~**优先解决决策点**：方案 A（BFF 自建）虽工作量大，但能完整对齐 webui 且与画布解耦，符合「Intellect RAG 与企业版功能完全独立」的约束。方案 B 无法实现 webui 的高级能力。~~ → **已决策选方案 B**，阶段 1 MVP 已落地；若 P3/P4 阶段需要 webui 高级能力（压缩链/恢复/FTS 等），再评估是否切换方案 A。
2. ~~**阶段 1 可借用现有资产**：复用 `use-send-agent-message.ts` 的 SSE 逻辑、`message-item` 组件、`next-chat-service.ts` 的 API 封装模式，降低 MVP 成本。~~ → **已完成**：独立聊天页基于 `useSendMessageWithSse` + `next-chat-service.ts` 落地。
3. **下一阶段重点（建议优先级）**：
   - **P1 会话操作完整性**：补齐会话 rename/pin/archive/duplicate（intellect-team Gateway 是否支持待确认）
   - **UI 借鉴**：增量 markdown 渲染 > Tool call 内联卡片 > Context ring > Slash 命令面板 > Approval/Clarify 卡片 > 草稿持久化 > INFLIGHT 状态恢复
   - **P3 企业版 Team/Project 组织隔离**需与 Intellect-Team Tenant 实体开发进度对齐，建议作为并行轨道而非阻塞
4. **P4 部分能力**（跨来源聚合、memory 生命周期）依赖 intellect-agent 运行时，若 AgentUI 不直接对接 agent runtime，可降级或省略。
5. **保留 AgentUI 独有优势**：画布可视化、节点调试、知识库引用追溯、Agent 模板/分享/嵌入等能力在迁移中不应丢失。
6. **BFF `/api/session/*` stub 处置**：方案 B 下该路由已废弃（无调用方），建议删除或在 README 标注「已弃用，会话走 `/api/bff/proxy/v1/chats/*`」，避免后续误读。
