# Intellect-Team Python vs Rust 两版本对齐需求

> **文档版本**: v1.0（基于技术评审 S1-S10 修订）
> **提出方**: AgentUI 团队
> **提交对象**: Intellect-Team 维护团队
> **等待期限**: 4 周（D8 决策），超期后 AgentUI 将启用双版本兼容兜底方案
> **关联文档**: [dual-version-fallback-plan.md](./dual-version-fallback-plan.md)

---

## 〇、前置判断（需 Intellect-Team 先行确认）

在评估具体对齐需求前，请 Intellect-Team 先明确以下问题：

| # | 问题 | 选项 |
|---|------|------|
| **P0** | Python 版本（`plugins/platforms/api_server/adapter.py`）是否仍在维护？ | A. 仍在维护，接受功能对齐需求<br>B. 仅安全补丁，不接受功能对齐<br>C. 已废弃/计划废弃，新部署全部用 Rust |
| **P1** | 若仍在维护，是否有废弃时间表？ | A. 无时间表<br>B. 有时间表（请提供日期）<br>C. 不适用（Python 已废弃） |
| **P2** | 新部署默认使用哪个版本？ | A. Python<br>B. Rust<br>C. 用户可选 |

**判断结果对后续流程的影响**：
- **P0=A**：本需求文档全部 P0+P1 条目需 Intellect-Team 实施
- **P0=B**：仅 P0 级 Blocker 条目需实施，P1 级降级为文档化
- **P0=C**：本需求文档自动失效，AgentUI 仅在文档中标注"Python 版本不支持清单"，不对齐

**AgentUI 现状认知**（供 Intellect-Team 参考）：
- BFF SSE 解析器 `parse-intellect-enterprise-run-events-sse.ts` 注释明确引用 Rust `api_server.rs` 作为权威源
- AgentUI 近期测试均基于 Rust 版本（:8642）
- Rust `api_server.rs`（8032 行）已超越 Python `adapter.py`（5611 行）成为主版本

---

## 一、P0 级需求（Blocker，BFF 核心功能在 Python 后端不可用）

以下 5 项是 BFF v1.3.0/v1.4.0 契约的最低兼容基线，Python 版本必须补齐。

### B1：Python 缺少 `GET /v1/models/{id}` 端点

**现状**：
- Python `adapter.py:5087` 仅注册 `add_get("/v1/models", ...)`，无 `/{id}` 子路由
- Rust `api_server.rs:2432` 有 `.route("/v1/models/{id}", routing::get(handle_get_model))`，handler 在 line 4238

**BFF 影响**：
- BFF `IntellectEnterpriseAdapter.getAgent()` 调用 `GET /v1/models/${agentId}`
- Python 后端返回 404 → `IntellectNotFoundError` → 前端无法获取单个 agent 详情

**对齐要求**：
- Python `adapter.py` 新增 `add_get("/v1/models/{id}", _handle_get_model)`
- 按 id 查找并返回单个 model 对象，schema 对齐 Rust `api_server.rs:4238-4250`

---

### B2：Python 缺少 `POST /v1/chat/completions/{sid}/clarify` 端点

**现状**：
- Python `adapter.py` 中 grep "clarify" 无任何 HTTP 路由匹配（clarify 逻辑仅存在于 tool 层）
- Rust `api_server.rs:2418` 有 `.route("/v1/chat/completions/{session_id}/clarify", routing::post(handle_clarify_response))`，handler 在 line 1994

**BFF 影响**：
- BFF `IntellectEnterpriseAdapter.submitClarify()` 调用 `POST /v1/chat/completions/${sessionId}/clarify`
- Python 后端返回 404 → v1.4.0 clarify 流程在 Python 上 100% 不可用

**对齐要求**：
- Python `adapter.py` 新增 `add_post("/v1/chat/completions/{session_id}/clarify", _handle_clarify_response)`
- 接收 body `{clarify_id, answer}`
- 从 clarify_channels 移除 clarify_id 并发送 answer，对齐 Rust `api_server.rs:1994-2021`

---

### B3：SSE 工具调用事件名不一致（`/v1/runs/events` 通道）

**现状**：
- Python `adapter.py:4517-4534`（`_make_run_event_callback`）发射**独立事件名**：
  - `{"event": "tool.started", ...}`
  - `{"event": "tool.completed", ...}`
- Rust `api_server.rs:1564-1569`（`map_event_to_sse`）发射**统一事件名 + 内层 type**：
  - `{"event": "tool.progress", "type": "tool.started", ...}`
  - `{"event": "tool.progress", "type": "tool.completed", ...}`

**BFF 影响**：
- BFF 解析器 `parse-intellect-enterprise-run-events-sse.ts:198-231` 只识别 `tool.progress`
- Python 的 `tool.started`/`tool.completed` 走 default 分支 → `console.warn` + 跳过
- 工具调用生命周期事件被静默丢弃，前端 ToolCallCard 不渲染

**对齐要求**：
- Python `_make_run_event_callback` 改为发射 `tool.progress` 事件 + 内层 `type: "tool.started"|"tool.completed"`
- 与 Rust `api_server.rs:1564-1569` 格式一致

**补充说明（S2 评审补充）**：
- Python 在 `/v1/chat/completions` 通道还使用第三种格式 `intellect.tool.progress`（带 `intellect.` 前缀 + `status` 字段）
- 在 `/api/sessions/{id}/chat/stream` 通道又用独立事件名
- **本次对齐范围仅限 `/v1/runs/events` 通道**（BFF 唯一消费的通道），其他通道不在对齐范围
- 若 Intellect-Team 有计划统一所有 SSE 通道格式，欢迎同步推进，但不阻塞本次对齐

---

### B4：SSE 推理事件名不一致（`/v1/runs/events` 通道）

**现状**：
- Python `adapter.py:4537-4542` 发射 `{"event": "reasoning.available", "text": ...}`
- Rust `api_server.rs:1558-1559` + `3849` 发射 `{"event": "message.delta", "type": "reasoning.delta", "text": ...}`

**BFF 影响**：
- BFF 解析器 `parse-intellect-enterprise-run-events-sse.ts:184-196` 只识别 `message.delta` + `type === 'reasoning.delta'`
- Python 的 `reasoning.available` 走 default 分支 → 跳过
- 推理过程（thinking）在前端不显示

**对齐要求**：
- Python 推理事件改用 `message.delta` + `type: "reasoning.delta"`
- 废弃独立 `reasoning.available` 事件名
- 对齐 Rust `api_server.rs:1558-1559`

---

### B5：`GET /api/sessions/{id}/messages` 响应 schema 不兼容

**现状**：
- Python `adapter.py:2350-2354` 返回：
  ```json
  {"object": "list", "session_id": "...", "data": [...]}
  ```
- Rust `api_server.rs:1139` 返回：
  ```json
  {"messages": [...]}
  ```

**BFF 影响**：
- BFF `IntellectEnterpriseAdapter.getSessionMessages()` 取 `data?.messages` → `undefined` → 回退 `?? []` → **返回空数组**
- Python 后端上会话历史永远为空

**对齐要求**：
- Python `GET /api/sessions/{id}/messages` 响应改为 `{"messages": [...]}`
- 废弃 `{object, session_id, data}` 格式

---

## 二、P1 级需求（Major，功能可用但语义/安全有差异）

以下 6 项需 Intellect-Team 评估实施可行性，部分项若架构不可行可降级为文档化。

### M1：`POST /api/sessions` 创建响应 schema 不兼容

**现状**：
- Python `adapter.py:2286` 返回 `{"object": "intellect.session", "session": {...}}`（嵌套）
- Rust `api_server.rs:845` 返回 `{"session_id": "..."}`（扁平）

**BFF 影响**：
- BFF `createSession()` 未解包 `data.session`（对比 `getSession`/`updateSession` 已解包，属遗漏）
- Python 后端创建会话后 BFF 返回的 Session.id 为空字符串，后续操作无法定位会话

**对齐要求**：
- Python `POST /api/sessions` 响应改为扁平 `{"session_id": "...", ...}` 或 `{"id": "...", ...}`
- 对齐 Rust `api_server.rs:845`

---

### M2：`GET /api/sessions` 列表分页字段被忽略

**现状**：
- Python `adapter.py:2180` 返回 `{"object": "list", "data": [...], "limit": 50, "offset": 0, "has_more": false}`
- Rust `api_server.rs:758` 返回 `{"sessions": [...]}`

**BFF 影响**：
- BFF 兼容三种格式（裸数组 / `sessions` / `data`）可工作
- 但 Python 的分页字段（limit/offset/has_more）被 BFF 忽略

**对齐要求**：
- Python `GET /api/sessions` 响应改为 `{"sessions": [...], "limit": ..., "offset": ..., "has_more": ...}`
- 分页字段移到顶层，sessions 数组用 `sessions` 字段名

---

### M3：`/api/tenant/info` 数据来源不同（架构不可行，降级为文档化）

**现状**：
- Python `adapter.py:1168-1201` 仅读 `os.environ.get("INTELLECT_TENANT_ID")`，`enabled` 恒 `true`
- Python docstring 明确承认："the Python adapter has no direct access to TenantStore"
- Rust `api_server.rs:701-725` 优先从 TenantStore（PostgreSQL）查询，返回真实 `enabled`

**BFF 影响**：
- Python 后端上禁用租户无法被 BFF 检测（`TenantDisabledError` 永不触发）
- BFF 侧 `ensureTenantValid` 前置校验可部分缓解，但后端行为不一致

**对齐要求**（S4 评审修正：架构不可行，降级为文档化）：
- ❌ ~~Python adapter 增加 DB 查询路径~~（架构不可行，Python 无 TenantStore 访问途径）
- ✅ **文档化降级**：Intellect-Team 在 Python 版本文档中明确标注：
  - `enabled` 字段恒 `true`，租户禁用检测依赖 BFF 前置校验
  - `display_name` 退化为 `tenant_id`，无法返回真实显示名
  - `source` 字段仅 `env` 或 `default`，无 `db` 路径
- AgentUI BFF 侧在对接 Python 后端时，文档化"租户禁用检测失效"为已知限制

---

### M4：tenant_id 格式校验冲突（spec-011 测试用例适配）

**现状**：
- Python：无 tenant_id 格式校验，`"default"` 可用
- Rust：三层强制校验 32 位 hex
  - HTTP auth 层 `auth.rs:317-321`：非 32 位 hex → 400 `invalid_tenant_id_format`
  - Storage 层 `tenants.rs:15-16`：`validate_tenant_id` 强制 32 位 hex
  - DB migration `20260726000001_tenant_id_format.sql:27`：`CHECK (length(id) = 32 AND id ~ '^[0-9a-fA-F]{32}$')`

**BFF 影响**：
- spec-011 US1 测试用例用 `"default"` 作为 tenant_id
- Python 后端正常工作，Rust 后端返回 400
- **spec-011 与 Rust 实现存在冲突**

**对齐要求**（D6 决策：AgentUI 侧改用真实 32 位 hex）：
- ❌ ~~要求 Rust 放宽格式校验~~（S5 评审修正：DB migration 强制，放宽成本极高且影响存量数据）
- ✅ **AgentUI 侧适配**：spec-011 US1 测试用例改用真实 32 位 hex tenant_id（如 `"00000000000000000000000000000000"`）
- ✅ **Intellect-Team 侧**：文档化"Rust 版本强制 32 位 hex tenant_id"，作为部署前置条件

---

### M5：`tenant_mismatch`/`invalid_tenant_id_format` 错误码仅 Rust

**现状**：
- Python `adapter.py:666-736` `_check_auth` 仅返回 401 `invalid_api_key`
- Rust `api_server.rs:339-362` 新增：
  - `tenant_mismatch` → 403
  - `invalid_tenant_id_format` → 400

**BFF 影响**：
- Python 后端无 tenant 校验，可能允许跨 tenant 访问
- BFF 前置校验可缓解，但后端行为不一致

**对齐要求**：
- Python `_check_auth` 新增 tenant_mismatch → 403、invalid_tenant_id_format → 400 错误路径
- 对齐 Rust `api_server.rs:339-362`

---

### M6：error body schema 不同

**现状**：
- Python `adapter.py:733-735` 含 `type` 字段：`{"error": {"message", "type": "invalid_request_error", "code"}}`
- Rust `api_server.rs:360` 无 `type` 字段：`{"error": {"code", "message"}}`

**BFF 影响**：
- BFF 不解析 error body 的 JSON 结构，但未来按 `code` 分支处理时需注意

**对齐要求**：
- 两端统一 error body schema（建议 Rust 补齐 `type` 字段，或 Python 移除 `type` 字段）
- 或明确文档化两端差异，BFF 不依赖 `type` 字段

---

## 三、P2 级需求（Minor，不阻塞 BFF 功能）

以下 5 项不阻塞 BFF v1.3.0/v1.4.0 功能，建议 Intellect-Team 在后续版本统一补齐，不强制对齐时间线。

| # | 差异点 | 说明 |
|---|--------|------|
| **m1** | `run.started`/`run.stopping` 事件仅 Rust 发射 | Python 缺少状态过渡事件，前端无法感知"停止中"过渡态 |
| **m2** | Team/Project PATCH 仅 Rust 实现 | Python 无法更新 team/project 元数据（BFF 当前不调用） |
| **m3** | Members OAuth/identities/roles 路由仅 Rust | Python 缺少 OAuth 与角色管理（BFF 当前不调用） |
| **m4** | `/version`/`/status`/`/v1/rag/retrieval` 仅 Rust | 运维探测脚本在 Python 上 404 |
| **m5** | `/health` 响应 schema 不同 | Python `{platform}` vs Rust `{service, capabilities}`，BFF 不解析 body |

---

## 四、不兼容项清单（Python 版本已知限制）

以下项因架构差异或成本过高，**不对齐**，作为 Python 版本已知限制文档化：

| # | 限制 | 原因 | BFF 侧处置 |
|---|------|------|-----------|
| **L1** | `/api/tenant/info` 的 `enabled` 恒 `true` | Python adapter 无 TenantStore 访问途径（M3） | BFF 前置校验 `ensureTenantValid` 缓解 |
| **L2** | `/api/tenant/info` 的 `display_name` 退化为 `tenant_id` | 同 L1 | BFF 不依赖 `display_name` |
| **L3** | tenant_id 格式校验缺失 | Python 无校验，Rust 强制 32 位 hex（M4） | AgentUI 测试用例适配 Rust 格式 |
| **L4** | localhost bypass 鉴权 | Python `adapter.py:681-706` 对 loopback/RFC1918 跳过 auth，Rust 无 | BFF 生产环境始终注入 API_SERVER_KEY，无影响 |
| **L5** | SSE legacy 通道格式分歧 | Python `/api/sessions/{id}/chat/stream` 通道用第三种格式 | BFF legacy 解析器 `parse-intellect-enterprise-sse.ts` 已独立处理，不在对齐范围 |

---

## 五、等待期限与兜底方案

### 等待期限（D8 决策）

- **4 周**：从本需求文档提交给 Intellect-Team 之日起计算
- 超期后 AgentUI 将启用双版本兼容兜底方案（见 [dual-version-fallback-plan.md](./dual-version-fallback-plan.md)）
- 若 Intellect-Team 在 4 周内明确回复"无法实施"或"Python 已废弃"，立即触发兜底方案决策

### 兜底方案引入时机（D7 决策）

- **当前阶段不引入**：等 Intellect-Team 回复后再决定
- 兜底方案已预设计完成，文档见 [dual-version-fallback-plan.md](./dual-version-fallback-plan.md)
- 兜底方案启用前置条件：
  - Intellect-Team 明确拒绝 P0 级对齐需求
  - 或 Intellect-Team 确认 Python 版本仍在维护但无法在 4 周内完成对齐
  - 或 Intellect-Team 确认 Python 版本已废弃（此时兜底方案降级为"文档化 Python 不支持清单"，不引入代码兼容层）

---

## 六、附录：BFF 当前依赖端点兼容性矩阵

| BFF 调用端点 | Python | Rust | BFF 兼容性 | 严重程度 |
|---|---|---|---|---|
| `GET /health` | ✅ | ✅ | ✅ 兼容 | Minor（schema 差异） |
| `GET /api/tenant/info` | ✅ env | ✅ db | ✅ 兼容（仅比对 tenant_id） | Major（enabled 检测失效，L1） |
| `GET /v1/capabilities` | ✅ | ✅ | ✅ 兼容 | Minor |
| `GET /v1/models` | ✅ 1 model | ✅ 3 models | ✅ 兼容 | Minor |
| `GET /v1/models/{id}` | ❌ 404 | ✅ | ❌ **Blocker**（B1） | Blocker |
| `POST /api/sessions` | ✅ `{session:{}}` | ✅ `{session_id}` | ⚠️ id 解包失败（M1） | Major |
| `GET /api/sessions` | ✅ `{data:[]}` | ✅ `{sessions:[]}` | ✅ 兼容 | Major（分页丢失，M2） |
| `GET /api/sessions/{id}` | ✅ `{session:{}}` | ✅ `{session:{}}` | ✅ 兼容 | Major |
| `PATCH /api/sessions/{id}` | ✅ `{session:{}}` | ✅ `{session:{}}` | ✅ 兼容 | Major |
| `DELETE /api/sessions/{id}` | ✅ `{deleted}` | ✅ `{ok}` | ✅ 兼容（不解析 body） | Major |
| `GET /api/sessions/{id}/messages` | ❌ `{data:[]}` | ✅ `{messages:[]}` | ❌ **Blocker**（B5） | Blocker |
| `POST /v1/runs` | ✅ | ✅ | ✅ 兼容 | Compatible |
| `GET /v1/runs/{id}/events` SSE | ✅ 不同事件名 | ✅ | ❌ **Blocker**（B3+B4） | Blocker |
| `POST /v1/runs/{id}/approval` | ✅ | ✅ | ✅ 兼容 | Compatible |
| `POST /v1/chat/completions/{sid}/clarify` | ❌ 404 | ✅ | ❌ **Blocker**（B2） | Blocker |
