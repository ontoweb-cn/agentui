# AgentUI 对齐方案评审意见

> **评审日期**: 2026-07-29
> **评审对象**: [review-and-plan.md](./review-and-plan.md)
> **评审方式**: 逐项交叉验证 Rust `api_server.rs` ↔ Python `adapter.py` 实码

---

## 一、总体评价

方案整体方向正确，P0/P1 判断与实码吻合。但在 **M1 实施范围**、**B2 架构细节**、**缺失项处理** 三方面存在需要修正的问题。以下按严重程度排列。

---

## 二、必须修正（3 项）

### 🔴 R1：M1 Session 响应格式对齐范围有误

**方案说**：4 处（POST/GET/PATCH/fork）全部改为扁平 `{session_id, ...}`。

**实码验证**：

| 端点 | Rust 实际格式 | Python 实际格式 | 对齐方向 |
|------|-------------|---------------|---------|
| `POST /api/sessions` | `{"session_id": "..."}` (`api_server.rs:845`) | `{"object": "intellect.session", "session": {...}}` (`adapter.py:2286`) | ✅ 需改：`{session_id}` 扁平 |
| `GET /api/sessions/{id}` | `{"session": {...}}` (`api_server.rs:925`) | `{"object": "intellect.session", "session": {...}}` (`adapter.py:2296`) | ✅ 需改：去掉 `object` 包装，保留 `session` 嵌套 |
| `PATCH /api/sessions/{id}` | `{"object": "intellect.session", "session": {...}}` (`api_server.rs:986`) | `{"object": "intellect.session", "session": {...}}` (`adapter.py:2324`) | ❌ **已兼容，无需修改** |
| `POST .../fork` | `{"object": "intellect.session", "session": {...}}` (`api_server.rs:1045`) | `{"object": "intellect.session", "session": {...}}` (`adapter.py:2401`) | ❌ **已兼容，无需修改** |

**结论**：
- **POST 改扁平**，**GET 去掉 `object` 保留 `session`**，PATCH 和 fork **不改**
- 方案中的"4 处修改"高估了影响面，同时也**忽略了 Rust GET 与 POST 的格式本身就不同**这一事实
- BFF 侧 `getSession`/`updateSession` 已经能正确解包 `data.session`，改了反而可能引入回归

**修正工时**: M1 从 0.5d 降至 0.25d（仅改 POST + GET 两处，且改动方向不同）

---

### 🔴 R2：B2 Clarify 端点缺少 session_id 生命周期分析

**方案说**：`_build_clarify_callback` 使用 `session_id` 构造 `clarify_id`，HTTP handler 通过 `clarify_id` 查找 channel。

**遗漏的关键问题**：

1. **run_id ≠ session_id**。Rust `handle_create_run`（`api_server.rs:3696-3699`）:
   ```rust
   let run_id = format!("run_{}", uuid::Uuid::new_v4().simple());
   let session_id = req.session_id.clone()
       .or(stored_session_id)
       .unwrap_or_else(|| run_id.clone());  // 默认 fallback 为 run_id
   ```
   BFF 通过 `POST /v1/runs` 创建 run，通过 `GET /v1/runs/{run_id}/events` 监听 SSE，但 clarify 提交端点是 `POST /v1/chat/completions/{session_id}/clarify`——**URL 参数是 session_id 不是 run_id**。BFF 必须知道 session_id 才能提交 clarify 响应。方案未说明 Python 实现如何让 BFF 获知 session_id。

2. **Clarify SSE 事件应包含 session_id**。Rust `StreamEvent::Clarify` 的 SSE payload 不含 `session_id`（`api_server.rs:1584-1585`），但 BFF 需要从某处获取 session_id 来构造 clarify POST URL。方案中的 clarify event payload `{"type": "clarify", "question": ..., "choices": ..., "clarify_id": ...}` 缺少 `session_id` 字段，BFF 无法知道向哪个 session 提交答案。

3. **`/v1/runs/events` 路径 vs `/v1/chat/completions` SSE 路径**。BFF 使用的 SSE 通道是 `/v1/runs/{id}/events`，不是 `/v1/chat/completions`。Clarify SSE 事件必须在 `/v1/runs/events` 通道上发射。方案中的"伪代码"放在了 SSE streaming handler 上下文中，但未区分是哪个 SSE 路径。Python adapter 的 runs 机制（`_handle_run_events`，`adapter.py:4863`）完全独立于 chat completions SSE。

**修正建议**：
- 在 clarify event payload 中加入 `session_id` 字段，对齐 BFF 需求
- 明确 clarify callback 需要在 `/v1/runs` handler（`_handle_runs`）中传递，而非仅在 chat completions handler
- 检查 BFF 代码确认 `clarify_id` 的解析逻辑，确认是否需要 `session_id` 独立字段

**修正工时**: B2 从 2.0d 升至 **2.5d**（增加 session/run 映射梳理 + BFF 契约对齐）

---

### 🔴 R3：E3/E4 额外发现未纳入任何 Phase

**方案说**：E3（thinking progress 字段缺失）和 E4（`run.completed` 事件缺失）列为"额外发现"，但未出现在 Phase 1/2/3 的任何任务中。

**影响评估**：

| 发现 | BFF 影响 | 严重程度 |
|------|---------|---------|
| E3: `elapsed_s`/`silent_s` 字段缺失 | BFF 可能依赖这些字段展示"思考中… (12s)"类 UI | 待确认 |
| E4: `run.completed` 事件缺失 | BFF 可能依赖 `run.completed` 事件来判定 run 终止并停止 spinner | **可能为 Blocker** |

E4 尤其关键——如果 BFF 完全依赖 `run.completed` 事件（而非 `[DONE]` sentinel）来判断 run 结束，Python 后端会导致前端 spinner 永不停止。

**修正建议**：
- **E4 提升为 P0 级**，加入 Phase 1：在 `_handle_run_events` 的 run 完成逻辑中发射 `run.completed` 事件（含 `messages`/`usage`），对齐 Rust `api_server.rs:1572-1577` + `1600` 行附近的 `run.completed` 发射逻辑
- **E3 加入 Phase 2** 或标记为"需 AgentUI 确认是否需要"

**修正工时**: E4 加入 Phase 1（+0.5d），E3 加入 Phase 2 或待确认（+0.25d）

---

## 三、建议优化（4 项）

### 🟡 R4：Phase 实施顺序不合理

**当前顺序**: B1+B5 最先 → B2 → B3+B4 → M1+...

**问题**: B3/B4 定义了 SSE 事件的统一格式规范（`tool.progress` + 内层 `type`），而 B2 的 clarify callback 也需要发射 SSE 事件（`clarify` 事件）。如果 B2 先于 B3/B4 实施，clarify SSE 事件格式可能与后续统一的格式不一致，导致返工。

**建议顺序**:
```
Week 1: B1 + B5 + B3 + B4（无依赖，可并行）  → 1.5d
Week 1-2: B2（依赖 B3/B4 确立的 SSE 格式模式） → 2.5d
Week 2: M1 + M2 + E1（session schema 标准化）   → 1.0d
Week 2-3: M5 + M6 + E4 + M3/M4（auth + 文档）  → 1.5d
Week 3-4: Phase 3 联调                           → 2.0d
```

---

### 🟡 R5：B2 `_build_clarify_callback` 伪代码有作用域问题

**方案伪代码**（方案第 232-251 行）:
```python
def _build_clarify_callback(session_id, loop, sse_queue):
    lock = threading.Lock()
    channels: dict[str, queue.Queue] = {}  # ← 局部变量！

    def _callback(question, choices):
        ...
        return _callback, channels  # ← 返回给调用方
```

`channels` 是 `_build_clarify_callback` 的局部变量，返回给调用方后需要被**赋值到 adapter 实例属性或外层可访问作用域**，HTTP handler 才能查找到。方案第 262 行提到了这一点（`_active_clarify_channels`），但伪代码未体现。

**实际实现需包含**:
```python
# 在 _handle_runs 或 SSE handler 中：
callback, channels = _build_clarify_callback(session_id, loop, sse_queue)
self._active_clarify_channels[session_id] = channels

# 在 _handle_clarify_response 中：
channels = self._active_clarify_channels.get(session_id)
if not channels:
    return 404
with channels_lock:
    q = channels.pop(cid, None)
if q:
    q.put(answer)
```

另外还需处理：
- **SSE 客户端断连清理**: 当 SSE 连接断开时清理 `self._active_clarify_channels[session_id]`，并 cancel 所有等待中的 clarify queue
- **session 级别 vs clarify_id 级别**: channels dict 以 clarify_id 为 key（如伪代码），但外层的 `_active_clarify_channels` 以 session_id 为 key。两者关系需明确

---

### 🟡 R6：M5 tenant auth 缺少配置来源分析

**方案说**：`_check_auth` 新增 tenant_id 格式校验 + `tenant_mismatch` 检测。

**遗漏**: Python `_check_auth`（`adapter.py:666`）当前不访问 tenant_id。需要确认：
- Python adapter 能否访问 `INTELLECT_TENANT_ID` 环境变量（`_handle_tenant_info` 已用）——**可以**
- 但 `tenant_mismatch` 检测需要知道**请求方的 tenant_id**（来自 HTTP Header，如 `X-Intellect-Tenant-Id`）。Rust 从 `IntellectHeaders` 解析（`api_server.rs` 的 `authenticate` 函数）。Python 需要新增 header 解析逻辑
- Python 当前无 `IntellectHeaders` 等价物，需从 `X-Intellect-Tenant-Id` header 读取

**修正工时**: M5 从 0.5d 升至 0.75d（增加 header 解析）

---

### 🟡 R7：Phase 3 联调缺少 BFF 侧前置依赖确认

**方案说**：T2 "AgentUI BFF 对接 Python 后端集成测试" 放在 Week 3-4。

**遗漏**: BFF 需要**先更新**以适配新的 Python 响应格式，才能做集成测试：
- B5 改 `{messages:[...]}` 后，BFF 的 `getSessionMessages()` 需取 `data.messages` → 改为取 `data.messages`（当前取 `data?.messages` 已兼容）
- M1 POST 改 `{session_id}` 后，BFF 的 `createSession()` 可能不需要改动（如果 BFF 已经做了 `data.session_id ?? data.session?.id`）
- B3/B4 改 SSE 格式后，BFF 解析器可能已经兼容（因为 BFF 解析器已对齐 Rust 格式）

**结论**: 大部分 BFF 改动已在 Rust 对齐过程中完成。但需 AgentUI 团队**提前确认 BFF 当前代码对 Python 新版式的兼容性**，再进入联调，否则可能出现"Python 改了对齐了，BFF 反而挂了"的情况。

---

## 四、低优先级（2 项）

### 🟢 R8：B1 返回格式建议与 Rust 完全一致

**方案说**：404 返回 `{"error": {"code": "not_found", "message": "model not found"}}`。

**Rust 实际**（`api_server.rs:4248`）: `.ok_or_else(|| not_found("model not found"))` → `not_found` 函数返回 `(StatusCode::NOT_FOUND, Json(json!({"error": "model not found"})))`——是 `{"error": "..."} ` 字符串，不是 `{code, message}` 对象。

建议 Python 对齐 Rust 的 `{"error": "model not found"}` 格式，或在 M6 统一 error schema 后再决定。

### 🟢 R9：`run.stopping` 过渡态事件

需求文档 m1 列为 P2 Minor，但方案未提及。Rust `api_server.rs:1586-1600` 在 run 被 interrupt 时发射 `run.stopping` 事件。如果 BFF UI 依赖此事件展示"Stopping…"过渡态，Python 缺失可能导致 UX 差异。建议向 AgentUI 确认是否依赖此事件。

---

## 五、修正后的工时汇总

| 项 | 原估算 | 修正 | 原因 |
|----|--------|------|------|
| B1 | 0.50d | 0.50d | 不变 |
| B2 | 2.00d | **2.50d** | 增加 session/run 映射 + BFF 契约对齐（R2） |
| B3 | 0.50d | 0.50d | 不变 |
| B4 | 0.25d | 0.25d | 不变 |
| B5 | 0.25d | 0.25d | 不变 |
| **+E4** | — | **0.50d** | P0 新增：`run.completed` 事件（R3） |
| **Phase 1** | 3.50d | **4.50d** | |
| M1 | 0.50d | **0.25d** | 仅改 POST+GET（R1） |
| M2 | 0.25d | 0.25d | 不变 |
| M3 | 0.25d | 0.25d | 不变 |
| M4 | 0.10d | 0.10d | 不变 |
| M5 | 0.50d | **0.75d** | 增加 header 解析（R6） |
| M6 | 0.25d | 0.25d | 不变 |
| E1 | 0.50d | 0.50d | 不变 |
| E2 | 0.25d | 0.25d | 不变 |
| **+E3** | — | **0.25d** | thinking progress 字段（R3） |
| **Phase 2** | 2.60d | **2.85d** | |
| Phase 3 | 2.00d | 2.00d | 不变 |
| **合计** | **8.10d** | **9.35d** | |

按 1 人投入约 **3 周**，仍在 4 周期限内。

---

## 六、总结

| 类别 | 数量 | 关键项 |
|------|------|--------|
| 🔴 必须修正 | 3 | M1 范围（R1）、B2 session_id 分析（R2）、E4 遗漏（R3） |
| 🟡 建议优化 | 4 | 实施顺序（R4）、作用域（R5）、M5 配置来源（R6）、联调前置（R7） |
| 🟢 低优先级 | 2 | B1 error 格式（R8）、run.stopping（R9） |

**核心建议**: 在进入 Phase 1 编码前，先完成以下 3 件事：
1. **修正 M1** 的实施范围（仅改 POST/GET，PATCH/fork 不动）
2. **增加 E4**（`run.completed` 事件）到 Phase 1，优先级与 B3/B4 同级
3. **与 AgentUI 确认** B2 clarify 流程中 BFF 如何获知 `session_id`（从 SSE event payload 还是从 run 创建响应）

这三项修正后，方案即可进入实施阶段。
