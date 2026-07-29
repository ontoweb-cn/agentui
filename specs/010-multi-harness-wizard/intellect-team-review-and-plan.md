# AgentUI 对齐需求评审与开发方案

> **评审日期**: 2026-07-29
> **评审人**: Intellect-Team
> **需求文档**: [intellect-team-alignment-requirements.md](./intellect-team-alignment-requirements.md)
> **提交说明**: [alignment-submission-cover.md](./alignment-submission-cover.md)

---

## 一、前置判断回复

AgentUI 团队提出的 P0/P1/P2 三个前置问题，根据代码仓库现状回复如下：

| # | 问题 | 回复 |
|---|------|------|
| **P0** | Python 版本是否仍在维护？ | **A. 仍在维护，接受功能对齐需求**。`adapter.py` 在过去 14 个 commit 中持续更新（最近 `6fa0c53`），与 Rust 版本同步演进 |
| **P1** | 若仍在维护，是否有废弃时间表？ | **A. 无时间表**。Python/Rust 双版本并行维护是当前架构策略，Python 版本承载存量部署，无废弃计划 |
| **P2** | 新部署默认使用哪个版本？ | **B. Rust**。Rust 版本功能更完整（8032 行 vs 5611 行），性能更优，是新部署的推荐版本 |

### 判断结果

P0=A → 本需求文档**全部 P0+P1 条目需实施**。P2 级建议后续版本统一补齐。

---

## 二、逐项代码验证

以下每条均经过 Rust `api_server.rs` 和 Python `adapter.py` 实码交叉验证。

### P0 级（Blocker）— 5 项全部确认

#### B1：Python 缺少 `GET /v1/models/{id}` 端点 ✅ 确认

| 维度 | Rust | Python |
|------|------|--------|
| 路由注册 | `api_server.rs:2432` `.route("/v1/models/{id}", routing::get(handle_get_model))` | `adapter.py:5087` 仅 `add_get("/v1/models", ...)` |
| Handler | `api_server.rs:4238-4250` `handle_get_model` — 从 model_catalogue 按 id 查找，404 时返回 `"model not found"` | 不存在 |
| BFF 影响 | — | `getAgent()` → 404 → `IntellectNotFoundError` |

**根因**: Python adapter 的 `_handle_models` (line 1204) 只返回列表，无单条查找逻辑。

#### B2：Python 缺少 `POST /v1/chat/completions/{sid}/clarify` 端点 ✅ 确认

| 维度 | Rust | Python |
|------|------|--------|
| 路由注册 | `api_server.rs:2418` `.route("/v1/chat/completions/{session_id}/clarify", routing::post(handle_clarify_response))` | `adapter.py:5128` 仅 `add_post("/v1/chat/completions", ...)`，grep "clarify" 零匹配 |
| Handler | `api_server.rs:1994-2021` — 接收 `{clarify_id, answer}`，从 `clarify_channels` HashMap 移除并 send answer | 不存在 |
| 状态码 | 200/400/401/403/404（完整） | 全部 404 |

**根因**: Python 侧 clarify 逻辑仅在 tool 层存在（`intellect-core` 的 clarify tool），API Server 层未暴露 HTTP 端点。

#### B3：SSE 工具调用事件名不一致 ✅ 确认

| 维度 | Rust (`api_server.rs:1564-1569`) | Python (`adapter.py:4518-4536`) |
|------|------|------|
| 事件名 | `"tool.progress"` | `"tool.started"` / `"tool.completed"` |
| 内层 type | `"type": "tool.started"` / `"type": "tool.completed"` | 无内层 type |
| 字段 | `tool_id, name, arguments/result, duration_s` | `tool, preview/duration, error` |

**BFF 影响**: `parse-intellect-enterprise-run-events-sse.ts:198-231` 只匹配 `tool.progress`，Python 的事件走 default → `console.warn` + 跳过。

#### B4：SSE 推理事件名不一致 ✅ 确认

| 维度 | Rust (`api_server.rs:1558-1559`) | Python (`adapter.py:4537-4543`) |
|------|------|------|
| 事件名 | `None`（默认 message 事件） | `"reasoning.available"` |
| 内层 type | `"type": "reasoning.delta"` | 无 |
| 字段 | `text` | `text`（字段名一致） |

**BFF 影响**: `parse-intellect-enterprise-run-events-sse.ts:184-196` 只识别 `type === 'reasoning.delta'`，Python 的事件被跳过。

#### B5：`GET /api/sessions/{id}/messages` 响应 schema 不兼容 ✅ 确认

| 维度 | Rust (`api_server.rs:1139`) | Python (`adapter.py:2350-2354`) |
|------|------|------|
| 响应结构 | `{"messages": [...]}` | `{"object": "list", "session_id": "...", "data": [...]}` |
| 消息对象 | `MessageResp`（id, role, content, tool_calls, timestamp 等） | `_message_response(m)`（需检查字段对齐） |

**BFF 影响**: `getSessionMessages()` 取 `data?.messages` → `undefined` → 回退 `?? []` → 始终返回空数组。

---

### P1 级（Major）— 6 项全部确认

#### M1：`POST /api/sessions` 响应 schema 不兼容 ✅ 确认

| 维度 | Rust (`api_server.rs:845`) | Python (`adapter.py:2286`) |
|------|------|------|
| 响应结构 | `{"session_id": "..."}` | `{"object": "intellect.session", "session": {...}}` |

#### M2：`GET /api/sessions` 列表响应字段 ✅ 确认

| 维度 | Rust (`api_server.rs:758`) | Python (`adapter.py:2180-2186`) |
|------|------|------|
| 列表字段名 | `sessions` | `data` |
| 分页字段 | 无（Rust 当前未返回分页信息） | `limit, offset, has_more` |

**注**: Rust 版本也缺少分页字段，建议双方统一补齐而非单向对齐。

#### M3：`/api/tenant/info` 数据来源不同 ✅ 确认

- Rust (`api_server.rs:701-724`): TenantStore (PostgreSQL) → 真实 `enabled`/`display_name`，source=`"db"`
- Python (`adapter.py:1168-1201`): `os.environ.get("INTELLECT_TENANT_ID")` → `enabled` 恒 `true`，`display_name`=`tenant_id`，source=`"env"|"default"`
- **AgentUI 已确认降级为文档化**，不要求 Python 补 DB 访问路径

#### M4：tenant_id 格式校验冲突 ✅ 确认

- Rust: `auth.rs:317-321` + `tenants.rs:15-16` + DB migration 三层强制 32 位 hex
- Python: 无格式校验，`"default"` 可接受
- **AgentUI 已确认适配**（spec-011 测试用例改用 32 位 hex）

#### M5：`tenant_mismatch`/`invalid_tenant_id_format` 错误码仅 Rust ✅ 确认

- Rust (`api_server.rs:352-361`): `tenant_mismatch` → 403, `invalid_tenant_id_format` → 400
- Python (`adapter.py:733-735`): 仅 `invalid_api_key` → 401

#### M6：Error body schema 不同 ✅ 确认

| 维度 | Rust (`api_server.rs:360`) | Python (`adapter.py:733-735`) |
|------|------|------|
| 结构 | `{"error": {"code": ..., "message": ...}}` | `{"error": {"message": ..., "type": ..., "code": ...}}` |
| `type` 字段 | 无 | `"invalid_request_error"` |

---

### P2 级（Minor）— 5 项概览

| # | 差异点 | 现状 |
|---|--------|------|
| **m1** | `run.started`/`run.stopping` 事件 | Rust 发射（`api_server.rs:1586-1600`），Python 无 |
| **m2** | Team/Project PATCH | Rust 有（`api_server.rs:2441-2443`），Python 仅 GET/POST（`adapter.py:5109-5116`） |
| **m3** | Members OAuth/identities/roles | Rust 完整，Python 部分（`adapter.py:5093-5106`） |
| **m4** | `/version`/`/status`/`/v1/rag/retrieval` | Rust 有，Python 无 |
| **m5** | `/health` 响应 schema 差异 | Rust `{service, capabilities}` vs Python `{platform}` |

---

## 三、额外发现（需求文档未覆盖）

在代码审查过程中发现以下需求文档未提及的差异：

### E1：Rust `GET /api/sessions` 缺少分页字段

需求 M2 指出 Python 返回 `limit/offset/has_more` 但 BFF 不解析。实际上 **Rust 版本也不返回分页信息**（`api_server.rs:758` 仅 `{"sessions": [...]}`）。建议双向补齐：Rust 加分页字段，Python 改字段名为 `sessions`。

### E2：消息对象字段对比

Python `_message_response`（`adapter.py:2121-2125`）与 Rust `MessageResp`（`api_server.rs:205-216`）字段对比：

| 字段 | Rust | Python | 备注 |
|------|------|--------|------|
| `id` | ✅ `Option<i64>` | ✅ | |
| `role` | ✅ `String` | ✅ | |
| `content` | ✅ `Option<String>` | ✅ | |
| `tool_call_id` | ✅ `Option<String>` | ✅ | |
| `tool_calls` | ✅ `Option<Value>` | ✅ | |
| `tool_name` | ✅ `Option<String>` | ✅ | |
| `timestamp` | ✅ `f64` | ✅ | |
| `finish_reason` | ✅ `Option<String>` | ✅ | |
| `session_id` | ❌ | ✅ | Python 额外字段，BFF 可忽略 |
| `token_count` | ❌ | ✅ | Python 额外字段 |
| `reasoning` | ❌ | ✅ | Python 额外字段 |
| `reasoning_content` | ❌ | ✅ | Python 额外字段 |

**结论**: 核心字段完全对齐。B5 的 Blocker 级别问题仅在于外层包装格式（`{data: [...]}` vs `{messages: [...]}`），消息对象本身兼容。

### E3：Python SSE 事件回调缺少 `elapsed_s`/`silent_s` 字段

Python `adapter.py:4539-4543` 的 reasoning 事件只传 `text`，但 Rust `api_server.rs:1561-1563` 的 `ThinkingProgress` 事件还包含 `elapsed_s`/`silent_s`。

### E4：Python 缺少 `run.completed` 事件 — **建议提升为 P0**

Python 的 `_handle_run_events`（`adapter.py:4898-4901`）在 run 完成时仅发送 `: stream closed\n\n` SSE comment 后关闭连接，**不发射 `run.completed` 事件**。Rust `api_server.rs:1572-1577` + run 完成逻辑发射完整的 `run.completed` 事件（含 `messages`/`usage`/`session_id`）。

**BFF 影响**: 如果 BFF 依赖 `run.completed` 事件来判定 run 终止并停止 UI spinner，Python 后端会导致前端 spinner 永不停止。需 AgentUI 确认 BFF 是否仅依赖 SSE 连接关闭（`[DONE]` sentinel）还是也解析 `run.completed` 事件。

### E5：Python 缺少 `run.stopping` 过渡态事件

Rust `api_server.rs:1586-1600` 在 run 被 interrupt 时发射 `run.stopping` 事件。Python 无此事件。需 AgentUI 确认 BFF UI 是否依赖此事件展示"Stopping…"过渡态。

---

## 四、开发方案

### 总体策略

- **目标**: 4 周内完成 P0（5 项 Blocker）+ P1（6 项 Major）全部对齐
- **原则**: Python 对齐 Rust 格式（Rust 是 BFF 的权威参考实现）
- **P2 级**: 不阻塞，后续版本自然补齐

### Phase 1：P0 Blocker（Week 1-2，预计 4.5 人日）

**实施顺序**: B3+B4 先于 B2 —— B3/B4 确立了 SSE 统一事件格式规范（`事件名 + 内层 type`），B2 的 clarify SSE 事件应遵循同一套模式，避免返工。

| # | 任务 | 文件 | 工作量 | 关键实现点 |
|---|------|------|--------|-----------|
| **B1** | 新增 `GET /v1/models/{id}` | `adapter.py` | 0.5d | 新增 `_handle_get_model`，从 `_handle_models` 的 model list 中按 id 查找；404 返回 `{"error": "model not found"}`（对齐 Rust `not_found` 辅助函数格式） |
| **B5** | Session messages 响应改为 `{"messages": [...]}` | `adapter.py` | 0.25d | 修改 `_handle_session_messages` 返回格式，去掉 `{object, session_id, data}` 包裹。消息对象字段经 E2 验证已兼容 |
| **B3** | SSE 工具事件改为 `tool.progress` 统一格式 | `adapter.py` | 0.5d | 修改 `_make_run_event_callback`：`tool.started`/`tool.completed` → 事件名 `tool.progress` + 内层 `type: "tool.started"/"tool.completed"`；字段从 `tool`/`preview` 改为 `tool_id`/`name`/`arguments` |
| **B4** | SSE 推理事件改为 `message.delta` 格式 | `adapter.py` | 0.25d | 修改 `_make_run_event_callback`：`reasoning.available` → 默认事件 + `type: "reasoning.delta"` |
| **E4** | 新增 `run.completed` SSE 事件 | `adapter.py` | 0.5d | 在 `_handle_run_events` 的 run 完成路径中发射 `run.completed` 事件（含 `messages`/`usage`/`session_id`），对齐 Rust `api_server.rs:1572-1577` 的 `StreamEvent::Done` 处理 |
| **B2** | 新增 `POST /v1/chat/completions/{sid}/clarify` | `adapter.py` + `agent` | **2.5d** | 最复杂项。依赖 B3/B4 确立的 SSE 格式规范。详见下方 B2 专题分析 |

**Phase 1 小计**: 4.5 人日（含自测）

#### B2 专题：Clarify 端到端实现

B2 不仅是新增一个 HTTP 端点，还涉及 Agent 运行时与 API Server 之间的跨线程通信，以及 run_id ↔ session_id 映射。

**现状分析**：

- Python Agent 运行时**已有** clarify 支持：`AIAgent.__init__` 接受 `clarify_callback` 参数（`agent/agent_init.py:173,401`），`tool_executor.py:752-758` 在 `function_name == "clarify"` 时调用 `clarify_tool(callback=agent.clarify_callback)`，callback 签名是同步的 `(question, choices) -> str`
- 但 `adapter.py:_create_agent` **从未传递** `clarify_callback`，所以 agent 的 clarify 工具始终返回 `"Clarify tool is not available in this execution context."`（`tools/clarify_tool.py:57-60`）
- Agent 运行在 `loop.run_in_executor(None, _run)`（`adapter.py:4464`），即**独立线程**中——这意味着 clarify callback 可以使用 `queue.Queue`（线程安全）阻塞等待，不会阻塞 asyncio 事件循环

**`run_id` ↔ `session_id` 关系**（关键架构点）：

Rust `handle_create_run`（`api_server.rs:3696-3699`）:
```rust
let run_id = format!("run_{}", uuid::Uuid::new_v4().simple());
let session_id = req.session_id.clone()
    .or(stored_session_id)
    .unwrap_or_else(|| run_id.clone());  // fallback: session_id = run_id
```
BFF 通过 `POST /v1/runs` 创建 run（获得 `run_id`），通过 `GET /v1/runs/{run_id}/events` 监听 SSE。但 clarify 提交端点是 `POST /v1/chat/completions/{session_id}/clarify`——URL 参数是 `session_id`。BFF 必须从某处获知 `session_id`。Python 实现需：
1. 在 clarify SSE event payload 中携带 `session_id` 字段
2. 确保 `/v1/runs` 路径的 `session_id` 与 clarify 端点的 `{session_id}` 一致

**Rust 参考架构**（`api_server.rs:1396-1417`）:

```
build_clarify_fn:
  1. 生成 clarify_id = "{session_id}:{timestamp_ms}"
  2. 创建 std::sync::mpsc::channel()
  3. 将 sender 插入 clarify_channels (Mutex<HashMap>)
  4. 通过 stream_tx 发送 StreamEvent::Clarify SSE 事件
  5. rx.recv_timeout(120s) 阻塞等待
  6. 清理 clarify_channels 条目
  7. 返回 answer 或超时消息
```

**Python 实现方案**（需修改 4 处）:

1. **`_create_agent` 新增 `clarify_callback` 参数**（`adapter.py:1047-1116`）
   - 在参数列表添加 `clarify_callback=None`
   - 传递给 `AIAgent(..., clarify_callback=clarify_callback)`

2. **构建 clarify callback**（在 `/v1/runs` handler 中，类似 `_make_run_event_callback` 模式）
   ```python
   import queue, threading

   # 在 Adapter 实例上:
   # self._clarify_channels: dict[str, dict[str, queue.Queue]] = {}
   # self._clarify_lock = threading.Lock()

   def _build_clarify_callback(self, session_id: str, loop, sse_queue):
       """返回 (callback, channels_dict)，channels_dict 需注册到实例以便 HTTP handler 查找。"""
       channels: dict[str, queue.Queue] = {}

       def _callback(question: str, choices: list | None) -> str:
           cid = f"{session_id}:{int(time.time()*1000)}"
           q: queue.Queue = queue.Queue(maxsize=1)
           with self._clarify_lock:
               channels[cid] = q
           # SSE event: 遵循 B3/B4 的统一格式 = 事件名 + 内层 type
           event = {
               "type": "clarify",
               "clarify_id": cid,
               "session_id": session_id,   # ← BFF 需要此字段构造 POST URL
               "question": question,
               "choices": choices or [],
           }
           loop.call_soon_threadsafe(sse_queue.put_nowait, event)
           try:
               return q.get(timeout=120)
           except queue.Empty:
               return "The user did not respond within the time limit. Use your best judgement."
           finally:
               with self._clarify_lock:
                   channels.pop(cid, None)

       return _callback, channels
   ```

3. **在 `_handle_runs` 中注册 channels**
   ```python
   # _handle_runs 创建 agent 时:
   callback, channels = self._build_clarify_callback(session_id, loop, run_queue)
   self._clarify_channels[session_id] = channels
   agent = self._create_agent(..., clarify_callback=callback)
   # SSE 连接断开时清理:
   # self._clarify_channels.pop(session_id, None)
   # 并 cancel 所有等待中的 queue（put 哨兵值）
   ```

4. **新增 `_handle_clarify_response` HTTP handler**
   ```python
   async def _handle_clarify_response(request):
       session_id = request.match_info["session_id"]
       body = await request.json()
       cid = body.get("clarify_id", "")
       answer = body.get("answer", "")
       if not cid or not answer:
           return web.json_response(
               {"error": {"code": "bad_request", "message": "clarify_id and answer are required"}},
               status=400)
       channels = self._clarify_channels.get(session_id)
       if not channels:
           return web.json_response(
               {"error": {"code": "not_found", "message": "no active clarify request for given clarify_id"}},
               status=404)
       with self._clarify_lock:
           q = channels.pop(cid, None)
       if q is None:
           return web.json_response(
               {"error": {"code": "not_found", "message": "no active clarify request for given clarify_id"}},
               status=404)
       q.put(answer)
       return web.json_response({"status": "ok"})
   ```
   - 路由注册：`add_post("/v1/chat/completions/{session_id}/clarify", ...)`
   - 错误处理：400（缺少参数）、401（auth 失败）、404（无活跃 clarify 请求）

5. **SSE 断连清理**: 当 SSE 客户端断开时，需从 `self._clarify_channels` 移除 session 条目并向所有等待中的 queue 发送哨兵值（超时消息），避免 agent 线程永久阻塞

**为什么 B2 工作量是 2.5d**:
- 跨线程通信设计（`queue.Queue` + `loop.call_soon_threadsafe`）
- `run_id` ↔ `session_id` 映射梳理 + BFF 契约对齐（SSE event 需携带 `session_id`）
- 需要在 `_create_agent`、`_handle_runs`、HTTP handler、SSE cleanup 四处协调修改
- 涉及 session 生命周期管理（SSE 断连时清理残留 clarify channels）
- 超时处理（120s 超时后 agent 继续执行）
- 优先在 `/v1/runs/events` 路径实现（BFF 使用的通道），后续扩展到 `/v1/chat/completions` SSE 路径

### Phase 2：P1 Major（Week 2-3，预计 2.85 人日）

| # | 任务 | 文件 | 工作量 | 关键实现点 |
|---|------|------|--------|-----------|
| **M1** | Session 响应格式对齐（POST + GET） | `adapter.py` | 0.25d | **仅改 2 处**：① POST `_handle_create_session` 改为扁平 `{"session_id": id}`（对齐 Rust L845）；② GET `_handle_get_session` 去掉 `object` 包层改为 `{"session": {...}}`（对齐 Rust L925）。**PATCH 和 fork 已与 Rust 兼容，不改** |
| **M2** | `GET /api/sessions` 列表字段改为 `sessions` | `adapter.py` | 0.25d | `data` → `sessions`，保留 `limit/offset/has_more` 分页字段 |
| **M5** | Python auth 新增 tenant 错误码 | `adapter.py` | **0.75d** | ① 新增 `X-Intellect-Tenant-Id` header 解析（Python 当前无 `IntellectHeaders` 等价物）；② `_check_auth` 新增 tenant_id 格式校验（32 位 hex）+ 比对逻辑；③ 返回 400 `invalid_tenant_id_format` / 403 `tenant_mismatch`。tenant_id 从 `os.environ["INTELLECT_TENANT_ID"]` 读取 |
| **E1** | Rust `GET /api/sessions` 加分页字段 | `api_server.rs` | 0.5d | 新增 `limit/offset/has_more` 分页响应；修改 `handle_list_sessions` 支持 `Query<ListSessionsQuery>` |
| **E3** | SSE thinking progress 补齐 `elapsed_s`/`silent_s` | `adapter.py` | 0.25d | 修改 `_make_run_event_callback` reasoning 事件，增加 `elapsed_s`/`silent_s` 字段（对齐 Rust L1561-1563）。**需 AgentUI 确认 BFF 是否依赖** |
| **M3** | `/api/tenant/info` 文档化差异 | 文档 | 0.25d | 标注 `enabled` 恒 `true`、`display_name` 退化为 `tenant_id`、`source` 无 `db` 路径 |
| **M4** | tenant_id 格式文档化 | 文档 | 0.1d | 标注 Rust 强制 32 位 hex 的前置条件 |
| **M6** | Error body schema 统一 | `adapter.py` + `api_server.rs` | 0.25d | 双向对齐：Rust 补齐 `type` 字段（更符合 OpenAI API 惯例），Python 同步 |
| **E2** | 消息对象字段对齐审核（已验证兼容，文档化即可） | 文档 | 0.25d | E2 验证结论：核心字段完全对齐。仅需在文档中记录 Python 的 4 个额外字段（`session_id`/`token_count`/`reasoning`/`reasoning_content`） |

**Phase 2 小计**: 2.85 人日（含自测）

### Phase 3：联调验证（Week 3-4，预计 2.0 人日）

| # | 任务 | 工作量 | 前置条件 |
|---|------|--------|---------|
| **T0** | BFF 兼容性预确认 | 0.25d | **AgentUI 团队**确认 BFF 当前代码对 Python 新版式的兼容状态（B3/B4 解析器已对齐 Rust 格式，B5/M1/M2 需逐项确认），避免"Python 改了，BFF 反而挂了" |
| **T1** | Python adapter 单元测试补全（B1-B5 + E4 + M1/M2/M5） | 1d | Phase 1+2 代码完成 |
| **T2** | AgentUI BFF 对接 Python 后端集成测试（全路径回归：P0 5 项 + E4 + P1 6 项） | 0.5d | T0 + T1 完成 |
| **T3** | BFF 兼容性矩阵更新（附录表格） | 0.15d | T2 完成 |
| **T4** | 文档更新（Python API 文档标注 B3/B4/E4 SSE 格式变更、M1 响应格式变更） | 0.1d | T2 完成 |



### 总工时估算

| Phase | 内容 | 工时 |
|-------|------|------|
| Phase 1 | P0 Blocker（5 项 + E4） | 4.50 人日 |
| Phase 2 | P1 Major（6 项 + E1 + E3 + E2 文档化） | 2.85 人日 |
| Phase 3 | 联调验证（含 BFF 兼容性预确认） | 2.00 人日 |
| **合计** | | **9.35 人日** |

按 1 人投入计算约 **3 周**，按 2 人并行约 **1.5 周**，满足 4 周期限。

---

## 五、风险与注意事项

### 高风险

1. **B2 clarify 端点（最复杂 P0 项）**:
   - 需要新增跨线程 clarify callback 基础设施（`threading.Lock` + `queue.Queue` + `loop.call_soon_threadsafe`）
   - `run_id` ↔ `session_id` 映射：clarify POST URL 用 `session_id`，但 BFF 通过 `/v1/runs`（`run_id`）创建 run。需在 clarify SSE event payload 中携带 `session_id` 字段供 BFF 使用
   - Python Agent 运行时已有 clarify 支持（`agent_init.py:401`），但从未被 API Server 使用——本次是首次打通
   - SSE 客户端断连时需清理残留 clarify channels，防止 agent 线程永久阻塞
   - **缓解**: 先实现 `/v1/runs/events` 路径（BFF 主要使用的通道）；与 AgentUI 确认 BFF 如何从 SSE event 提取 `session_id` 来构造 clarify POST URL

2. **B3/B4/E4 SSE 格式变更（BFF 核心依赖）**: 
   - 修改 `_make_run_event_callback` 和 `_handle_run_events` 会影响 `/v1/runs/{id}/events` 通道的所有消费者
   - BFF 解析器 `parse-intellect-enterprise-run-events-sse.ts` 只识别新格式，旧格式事件被静默丢弃
   - **E4 尤为关键**：如果 BFF 依赖 `run.completed` 事件判定 run 终止，Python 缺失会导致前端 spinner 永不停止
   - **缓解**: Phase 3 T0 预确认步骤让 AgentUI 逐项验证 BFF 兼容性

### 中风险

3. **M1 session 响应格式变更**:
   - POST `_handle_create_session` 和 GET `_handle_get_session` 两处返回格式变更
   - PATCH 和 fork 经实码验证已与 Rust 兼容（均使用 `{object, session}`），**不做修改**，降低风险
   - 需全局搜索 `"object": "intellect.session"` 确认 TUI/其他内部调用方对 POST/GET 格式的依赖

4. **M5 tenant auth**: Python `_check_auth` 需新增 `X-Intellect-Tenant-Id` header 解析（当前无 `IntellectHeaders` 等价物）。tenant_id 从 `os.environ["INTELLECT_TENANT_ID"]` 读取，确认 Python adapter 启动时已注入此环境变量。

### 低风险

5. **M6 error schema**: 变动影响面小（仅 auth 失败路径），BFF 不解析 error body JSON。

6. **E4 需 AgentUI 确认**: `run.completed` 事件是否被 BFF 作为 run 终止信号。若 BFF 仅依赖 SSE 连接关闭（`[DONE]` sentinel），E4 可降级为 P2。

---

## 六、实施建议

**实施顺序**（基于依赖关系优化）：

```
Week 1 ─── B1 + B5 + B3 + B4 + E4  （无依赖，可并行）          → 2.0d
Week 1-2 ─ B2                        （依赖 B3/B4 确立的 SSE 格式） → 2.5d
Week 2 ─── M1 + M2 + E1              （session schema 标准化）     → 1.0d
Week 2-3 ─ M5 + E3 + M3 + M4 + M6   （auth + thinking + 文档）   → 1.85d
Week 3-4 ─ Phase 3 联调              （需 AgentUI 配合）          → 2.0d
```

1. **B3+B4+E4 必须在 B2 之前**：B2 的 clarify SSE 事件格式（`"clarify"` 事件 + 内层 `type`）应遵循 B3/B4 确立的统一 SSE 格式规范（`事件名 + 内层 type`），避免返工
2. **B2 优先在 `/v1/runs/events` 路径实现**：BFF 主用此通道；`/v1/chat/completions` SSE 路径后续扩展
3. **M1 仅改 POST 和 GET**：PATCH 和 fork 经实码验证已与 Rust 兼容，无需修改
4. **Phase 3 前必须完成 T0**：AgentUI 团队提前确认 BFF 对 Python 新版式的兼容性，避免联调发现阻塞性回归
5. **M3+M4+M6 文档化为主**，轻量改动，可穿插在 Phase 2 任意时间进行

---

## 七、回复 AgentUI 团队

基于以上评审，Intellect-Team 回复如下：

1. **P0/P1/P2**: Python 仍在维护（A），无废弃时间表（A），新部署默认 Rust（B）
2. **P0 全部接受**：5 项 Blocker + E4（`run.completed` 事件，经评审认为可能为隐式 Blocker）将在 4 周内完成对齐
3. **P1 全部接受**：6 项 Major 将在 4 周内完成对齐（M3/M4 文档化，M5 增强 auth，M6 双向统一 error schema）
4. **P2 不阻塞**：5 项 Minor 建议后续版本自然补齐
5. **时间表**: Phase 1（P0 + E4）Week 1-2，Phase 2（P1 + E1/E3）Week 2-3，Phase 3（联调）Week 3-4
6. **不需要启用兜底方案**：Python 版本将继续维护并对齐 Rust API 契约
7. **需 AgentUI 配合确认**：
   - E4：BFF 是否依赖 `run.completed` SSE 事件判定 run 终止？（如是则为 Blocker，如仅依赖 SSE 连接关闭则可降级）
   - E5：BFF UI 是否依赖 `run.stopping` 过渡态事件？
   - B2：BFF 如何从 clarify SSE event 获取 `session_id` 以构造 `POST /v1/chat/completions/{session_id}/clarify` URL？

**总工时**: 9.35 人日（约 3 周/1 人），在 4 周期限（2026-08-26）内。
