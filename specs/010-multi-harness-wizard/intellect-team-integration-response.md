# AgentUI 配合 Intellect-Team 对齐工作回复

> **回复日期**: 2026-07-29
> **回复方**: AgentUI 团队
> **对应 Intellect-Team 文档**: [intellect-team-review-and-plan.md](./intellect-team-review-and-plan.md)
> **涵盖任务**: T0(BFF 兼容性预确认) + T2(集成测试计划) + E4/E5 依赖确认

---

## 一、E4/E5 依赖确认(对应 Intellect-Team 第七节"需 AgentUI 配合确认")

### E4:`run.completed` 事件 — **BFF 强依赖,已验证通过 ✅**

**结论**: BFF 解析器**强依赖** `run.completed` SSE 事件判定 run 终止。Python 缺失此事件会导致前端 spinner 永不停止。**Intellect-Team Phase 1 E4 已部署到 intellect-gateway v0.6.8,2026-07-29 验证通过**:SSE 流正常发射 `run.completed` 事件,payload 含 `usage`(input_tokens/output_tokens/total_tokens)+ `output` 字段,流自然结束(curl exit code 0)。详见 [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md)。

**代码证据**:

1. [parse-intellect-enterprise-run-events-sse.ts L309-347](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts#L309-L347) 显式处理 `run.completed` 事件:
   ```typescript
   case 'run.completed': {
     const usage = (data.usage as Record<string, unknown>) ?? {};
     // ... 提取 usage tokens
     return [usageChunk, { type: 'done' }];  // 产出 usage + done
   }
   ```

2. [L74-79](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts#L74-L79) 容错路径:若 SSE 流自然结束但未见终态事件,产出 `error: 'stream interrupted: no terminal event'`:
   ```typescript
   if (!sawTerminal && producedAny) {
     yield { type: 'error', message: 'stream interrupted: no terminal event' };
   }
   ```

3. `run.completed` 是**唯一**能产出 `done` chunk 的正常路径(其它终态 `run.failed`/`run.cancelled` 产出 `error`)。无此事件 → 前端无法收到 `done` → spinner 永挂。

**BFF 依赖的 payload 字段**(Python 实现需对齐):

| 字段 | 类型 | 用途 |
|------|------|------|
| `event` | `"run.completed"` | 事件名(必需) |
| `usage` | `object` | token 用量统计 |
| `usage.input_tokens` 或 `usage.prompt_tokens` | `number` | 输入 token 数(BFF 兼容两种字段名) |
| `usage.output_tokens` 或 `usage.completion_tokens` | `number` | 输出 token 数(BFF 兼容两种字段名) |
| `output` | `string`(可选) | 兜底内容:若整条流未产出 delta,用 output 作为最终内容 |
| `error` | `string`(可选) | 若 run 完成但有错误,产出 error 而非 done |

**建议**: Python `run.completed` 事件 payload 至少包含 `event` + `usage`(含 `input_tokens`/`output_tokens`),与 Rust `api_server.rs:1572-1577` 完全对齐。

---

### E5:`run.stopping` 事件 — **BFF 不依赖,可降级 P2**

**结论**: BFF 解析器和前端代码**均不依赖** `run.stopping` 事件。可降级为 P2,后续版本补齐。

**代码证据**:

1. [parse-intellect-enterprise-run-events-sse.ts](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts) `switch` 语句中**无 `run.stopping` case**(grep `run\.stopping|stopping` 在 BFF 源码零匹配)。若 Python 不发射此事件,BFF 行为完全不受影响。

2. 前端 `src/` 目录 grep `run.stopping|stopping` 仅一处匹配 — [context-ring.tsx L7](../../src/components/context-ring.tsx#L7) 的注释提到 `run.completed`,与 `stopping` 无关。前端 UI 无"Stopping…"过渡态展示逻辑。

3. BFF 当前 cancel 流程通过 [cancelMessage](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L295-L298) stub(no-op)+ 前端 `AbortController` 实现,不依赖 `run.stopping` 事件。

**建议**: E5 降级为 P2。Python 后续版本若补齐 `run.stopping`,BFF 解析器可在 `default` 分支前新增 `case 'run.stopping': return [];`(静默忽略,不产出 chunk),无需立即实施。

---

### B2 clarify:`session_id` 获取方式确认 + 通道要求

**Intellect-Team 问题**: BFF 如何从 clarify SSE event 获取 `session_id` 以构造 `POST /v1/chat/completions/{session_id}/clarify` URL?

#### ⚠️ 通道要求(前置条件,必须满足)

BFF 的 `sendMessage` **只走 `/v1/runs/{run_id}/events` 通道**([intellect-enterprise-adapter.ts L265-292](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L265-L292)):
```
POST /v1/runs → GET /v1/runs/{run_id}/events → parseIntellectEnterpriseRunEventsSSE
```
BFF **不走** `/v1/chat/completions` 流式端点。因此:

- ✅ Intellect-Team **必须**在 `/v1/runs` handler 中注入 `clarify_fn`(即 `build_clarify_fn` 在 run 创建路径中注册)
- ❌ 若 `clarify_fn` 仅在 `/v1/chat/completions` handler 注入(如 Rust 当前实现),BFF **永远收不到 clarify 事件**,clarify 端到端流程失败

Intellect-Team 开发方案 §四.B2 第 5 步已明确"优先在 `/v1/runs/events` 路径实现(BFF 使用的通道)",此为 BFF 兼容性的**硬性前置条件**。

#### `session_id` 获取流程

**AgentUI 回复**:

BFF 从 clarify SSE 事件的 payload 顶层 `session_id` 字段获取,流程如下:

1. **SSE 解析阶段**([parse-intellect-enterprise-run-events-sse.ts L287-290](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts#L287-L290)):
   ```typescript
   const sessionId =
     typeof data.session_id === 'string'
       ? data.session_id           // 优先取顶层 session_id
       : clarifyId.split(':')[0] ?? '';  // 兜底:从 clarify_id 切分
   ```
   - **优先**:从 SSE event payload 顶层 `session_id` 字段读取
   - **兜底**:若缺失,从 `clarify_id` 中切分(`clarify_id` 格式为 `{session_id}:{timestamp_ms}`)

2. **SSE 透传阶段**([bff-agents.ts L777-787](../../bff/src/routes/bff-agents.ts#L777-L787)):
   ```typescript
   case 'clarify_request': {
     payload = {
       event: 'clarify_request',
       data: {
         question: cl.question,
         choices: cl.choices,
         clarify_id: cl.clarifyId,
         session_id: cl.sessionId,  // ← 透传给前端
       },
     };
   }
   ```

3. **前端提交阶段**:前端从 `clarify_request` 事件 data 中取 `session_id`,构造 URL `POST /api/bff/agents/:agentId/sessions/:sessionId/clarify`

4. **BFF 路由阶段**([bff-agents.ts L440-470](../../bff/src/routes/bff-agents.ts#L440-L470)):从 URL path param 提取 `sessionId`,调用 `adapter.submitClarify(ctx, sessionId, clarifyId, answer)`

5. **Adapter 阶段**([intellect-enterprise-adapter.ts L381](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L381)):构造 `POST /v1/chat/completions/${encodeURIComponent(sessionId)}/clarify`

**对 Intellect-Team 的要求**:

Python clarify SSE event payload **必须包含** `session_id` 顶层字段:
```json
{
  "event": "clarify",
  "clarify_id": "sess-xxx:1700000000000",
  "session_id": "sess-xxx",        // ← 必需,BFF 用此构造 POST URL
  "question": "您想了解什么?",
  "choices": []
}
```

`clarify_id` 格式建议遵循 Rust 规范 `{session_id}:{timestamp_ms}`,作为 `session_id` 缺失时的兜底切分源。

---

## 二、T0:BFF 兼容性预确认(对应 Intellect-Team Phase 3 T0)

### 总览

| # | Intellect-Team 改动 | BFF 当前兼容性 | 状态 | 备注 |
|---|---------------------|---------------|------|------|
| B1 | Python 新增 `GET /v1/models/{id}` | ✅ 已兼容 | 无需 BFF 改动 | BFF `getAgent` 调用此端点,404 抛 `IntellectNotFoundError` |
| B2 | Python 新增 clarify 端点 + SSE event | ⚠️ 有条件兼容 | 无需 BFF 改动 | **需 Intellect-Team 在 `/v1/runs/events` 路径注入 clarify_fn**(BFF 不走 `/v1/chat/completions` 通道),详见 §一.B2 |
| B3 | Python SSE 工具事件改 `tool.progress` | ✅ 已兼容 | 无需 BFF 改动 | BFF 只匹配 `tool.progress`+内层 `type` |
| B4 | Python SSE 推理事件改 `message.delta`+`type:"reasoning.delta"` | ✅ 已兼容 | 无需 BFF 改动 | BFF 只匹配此格式 |
| B5 | Python `GET /sessions/{id}/messages` 改 `{messages:[...]}` | ✅ 已兼容 | 无需 BFF 改动 | BFF 取 `data?.messages ?? []` |
| E4 | Python 新增 `run.completed` SSE 事件 | ✅ **已验证** | 无需 BFF 改动 | BFF 强依赖此事件,**已部署到 intellect-gateway v0.6.8 验证通过**,详见 §一.E4 |
| M1 | Python `POST /api/sessions` 改 `{session_id}` | ✅ 已兼容 | 无需 BFF 改动 | X-T1 已扩展 `normalizeSession` 支持三种格式 |
| M2 | Python `GET /api/sessions` 列表字段 `data`→`sessions` | ✅ 已兼容 | 无需 BFF 改动 | BFF 取 `data?.sessions ?? data?.data ?? []` |
| M3 | `/api/tenant/info` 文档化 | ✅ 已兼容 | 无需 BFF 改动 | BFF 已实现降级逻辑 |
| M4 | tenant_id 格式 32 位 hex | ✅ 已兼容 | 无需 BFF 改动 | BFF 启动校验已强制 32 位 hex |
| M5 | Python auth 新增 tenant 错误码 | ✅ 已兼容 | 无需 BFF 改动 | BFF `tenant-validator` 已处理 403/400 |
| M6 | Error body schema 统一 | ✅ 已兼容 | 无需 BFF 改动 | BFF 不解析 error body JSON |

**总结论**: BFF 当前代码**对 Python 新版式(P0+P1 对齐后)基本兼容,无需 BFF 侧任何改动**。其中 B2 为**有条件兼容**:需 Intellect-Team 在 `/v1/runs/events` 路径(而非 `/v1/chat/completions`)注入 clarify_fn。其余 11 项(B1/B3/B4/B5/E4/M1/M2/M3/M4/M5/M6)无条件兼容。**T2 集成测试已于 2026-07-29 执行完成**,Phase 1 REST 12/12 + Phase 2 SSE 6/6 + BFF 单元测试 559/559 全部通过,E4 Blocker 已解除。详见 [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md)。

### 逐项验证细节

#### B1:`GET /v1/models/{id}` ✅

- **BFF 代码**: [intellect-enterprise-adapter.ts L136-143](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L136-L143) `getAgent()` 调用 `GET /v1/models/${agentId}`
- **Python 对齐后**: 端点存在,返回单 model 对象
- **兼容性**: ✅ 无需改动。Python 对齐前 404 抛 `IntellectNotFoundError`,对齐后正常返回

#### B3:`tool.progress` SSE 事件 ✅

- **BFF 代码**: [parse-intellect-enterprise-run-events-sse.ts L198-231](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts#L198-L231) `case 'tool.progress'` 匹配,按内层 `type` 区分 `tool.started`/`tool.completed`
- **Python 对齐前**: 发射 `tool.started`/`tool.completed` 独立事件名 → BFF `default` 分支 → `console.warn` + 跳过
- **Python 对齐后**: 发射 `tool.progress` + 内层 `type:"tool.started"/"tool.completed"` → BFF 正确解析为 `tool_start`/`tool_complete` chunk
- **兼容性**: ✅ 无需改动。BFF 只识别新格式,旧格式静默丢弃(不中断流)

#### B4:`reasoning.delta` SSE 事件 ✅

- **BFF 代码**: [parse-intellect-enterprise-run-events-sse.ts L184-196](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts#L184-L196) `case 'message.delta'` + `innerType === 'reasoning.delta'` → `StreamReasoning`
- **Python 对齐前**: 发射 `reasoning.available` 事件名 → BFF `default` 分支 → 跳过
- **Python 对齐后**: 发射 `message.delta` + 内层 `type:"reasoning.delta"` → BFF 正确解析
- **兼容性**: ✅ 无需改动

#### B5:`{messages:[...]}` 响应格式 ✅

- **BFF 代码**: [intellect-enterprise-adapter.ts L232-237](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L232-L237) `getSessionMessages` 取 `Array.isArray(data) ? data : data?.messages ?? []`
- **Python 对齐前**: 返回 `{object, session_id, data:[...]}` → BFF 取 `data?.messages` = `undefined` → 回退 `[]` → 空数组
- **Python 对齐后**: 返回 `{messages:[...]}` → BFF 取 `data?.messages` = `[...]` → 正确
- **兼容性**: ✅ 无需改动

#### E4:`run.completed` SSE 事件 ✅

- **BFF 代码**: [parse-intellect-enterprise-run-events-sse.ts L309-347](../../bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts#L309-L347) 显式 `case 'run.completed'`
- **Python 对齐前**: 不发射此事件,仅发 `: stream closed` SSE comment → BFF 流自然结束 → 产出 `error: 'stream interrupted: no terminal event'`
- **Python 对齐后**: 发射 `run.completed` 事件 → BFF 产出 `usage` + `done` → 前端正常停止 spinner
- **兼容性**: ✅ 无需改动。**BFF 强依赖此事件**(详见 §一.E4)

#### M1:`POST /api/sessions` 响应格式 ✅

- **BFF 代码**: [intellect-enterprise-adapter.ts L464-L485](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L464-L485) `normalizeSession` 已扩展(X-T1)支持三种格式:
  1. `{session_id}` (Python 对齐后)
  2. `{session:{id}}` (Python 当前嵌套)
  3. `{id}` (Rust)
- **兼容性**: ✅ 无需改动。X-T1 已完成,并有 4 个新测试覆盖

#### M2:`GET /api/sessions` 列表字段 ✅

- **BFF 代码**: [intellect-enterprise-adapter.ts L172-175](../../bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts#L172-L175) `listSessions` 取 `data?.sessions ?? data?.data ?? []`
- **Python 对齐前**: 返回 `{data:[...]}` → BFF 取 `data?.data`
- **Python 对齐后**: 返回 `{sessions:[...]}` → BFF 取 `data?.sessions`(优先匹配)
- **兼容性**: ✅ 无需改动。两种格式都支持

---

## 三、T2:集成测试计划(对应 Intellect-Team Phase 3 T2)

### 测试前置条件

1. Intellect-Team Phase 1(B1+B3+B4+B5+E4+B2)+ Phase 2(M1+M2+M5+E1+E3+M3+M4+M6)代码完成 ✅
2. Python 后端部署可访问(默认 `http://localhost:8642`)✅(intellect-gateway v0.6.8)
3. BFF 配置 `intellect-enterprise` backend 指向 Python 实例 ✅
4. 测试账号:32 位 hex tenant_id + API_SERVER_KEY ✅

> **执行状态**: ✅ **已于 2026-07-29 执行完成**。Phase 1 REST 12/12 + Phase 2 SSE 6/6 + BFF 单元测试 559/559 全部通过。详见 [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md)。

### 测试矩阵

#### P0 Blocker(6 项,必通过)

| # | 测试场景 | BFF 调用路径 | 期望行为 | 验证方法 |
|---|---------|-------------|---------|---------|
| **B1** | Python `GET /v1/models/{id}` 返回单 model | `GET /api/bff/agents/:agentId` | 返回 `AgentSummary{id, name}` | curl + 断言 `code:0, data.id=agentId` |
| **B1-neg** | Python `GET /v1/models/{id}` 404 | `GET /api/bff/agents/nonexistent` | BFF 返回 404 | curl + 断言 `code:404` |
| **B5** | Python `GET /api/sessions/{id}/messages` 返回 `{messages:[...]}` | `GET /api/bff/agents/:agentId/sessions/:sessionId/messages` | 返回消息数组 | curl + 断言 `data` 为数组,长度 > 0 |
| **B3** | Python SSE 工具事件 `tool.progress`+`type:"tool.started"` | `POST /api/bff/agents/:agentId/sessions/:sessionId/chat` (stream) | 前端收到 `tool_start` chunk | SSE 抓包 + 断言 `event:"tool_start"` |
| **B4** | Python SSE 推理事件 `message.delta`+`type:"reasoning.delta"` | 同上 | 前端收到 `reasoning` chunk | SSE 抓包 + 断言 `event:"reasoning"` |
| **E4** | Python `run.completed` 事件 | 同上 | 前端收到 `usage` + `done` chunk,spinner 停止 | SSE 抓包 + 断言最后两帧为 `usage`/`done` |
| **E4-neg** | Python 旧版式(无 run.completed) | 同上 | **应产出 error** `stream interrupted: no terminal event` | 验证降级行为(仅用于回归测试) |
| **B2** | Python clarify 端到端 | `POST /api/bff/.../clarify` | 前端收到 `clarify_request` → 提交答案 → agent 继续 | 触发 clarify 工具(如"请使用 clarify 工具问我") |
| **B2-payload** | clarify SSE event 含 `session_id` 字段 | SSE 抓包 | `clarify_request` 事件 data 含 `session_id` | 断言 `data.session_id` 非空 |
| **B2-channel** | ⚠️ clarify_fn 在 `/v1/runs` 路径注入(非 `/v1/chat/completions`) | Python 后端代码审查 | `/v1/runs` handler 注册 clarify_fn | grep `build_clarify_fn` 出现在 `/v1/runs` 创建路径 |
| **B3-old** | Python 旧格式 `tool.started`/`tool.completed`(防御性,不应出现) | SSE 抓包 | BFF `default` 分支静默跳过 + `console.warn` | SSE 抓包 + 断言无 `tool_start`/`tool_complete` chunk(旧格式被跳过) |
| **B4-old** | Python 旧格式 `reasoning.available`(防御性,不应出现) | SSE 抓包 | BFF `default` 分支静默跳过 | SSE 抓包 + 断言无 `reasoning` chunk(旧格式被跳过) |

#### P1 Major(6 项,必通过)

| # | 测试场景 | BFF 调用路径 | 期望行为 | 验证方法 |
|---|---------|-------------|---------|---------|
| **M1-post** | Python `POST /api/sessions` 返回 `{session_id}` | `POST /api/bff/agents/:agentId/sessions` | BFF 返回 `Session{id: session_id}` | curl + 断言 `data.id` 非空 |
| **M1-get** | Python `GET /api/sessions/{id}` 返回 `{session:{id}}` | `GET /api/bff/agents/:agentId/sessions/:sessionId` | BFF 返回 `Session{id}` | curl + 断言 `data.id` 匹配 |
| **M1-patch** | Python `PATCH /api/sessions/{id}` 响应格式(验证 Intellect-Team 声称"PATCH 不改"的假设) | `PATCH /api/bff/agents/:agentId/sessions/:sessionId` body `{title}` | BFF 返回 `Session{id}` | curl + 断言 `data.id` 匹配 + `data.title` 更新 |
| **M2** | Python `GET /api/sessions` 返回 `{sessions:[...]}` | `GET /api/bff/agents/:agentId/sessions` | BFF 返回 `Session[]` | curl + 断言 `data` 为数组 |
| **M2-pagination** | Python 返回分页字段 `limit/offset/has_more` | 同上 | BFF 忽略分页字段,返回完整数组 | curl + 断言 `data` 长度 = Python 返回数组长度 |
| **M5-format** | Python auth 32 位 hex 格式校验 | BFF 启动 `validateTenantConfigs` | 启动通过 | BFF 启动日志 `tenant_id OK` |
| **M5-mismatch** | Python auth tenant_id 不一致 | BFF 启动 | 启动拒绝 | BFF 启动日志 `FATAL: tenant_id MISMATCH` + 进程退出 |
| **M5-400** | Python 返回 `invalid_tenant_id_format` (400) | BFF 运行时请求 | BFF 透传 400 | curl + 断言 `code:400` |
| **M5-403** | Python 返回 `tenant_mismatch` (403) | BFF 运行时请求 | BFF 透传 403 | curl + 断言 `code:403` |
| **M6** | Python error body `{error:{code, message, type}}` | 任意错误路径 | BFF 透传错误(不解析 body) | curl + 断言 `code` 非 0 |
| **E1** | Rust `GET /api/sessions` 加分页字段 | `GET /api/bff/agents/:agentId/sessions` (Rust 实例) | BFF 忽略分页字段 | 仅 Rust 实例测试 |
| **E3** | Python SSE reasoning 事件含 `elapsed_s`/`silent_s` | SSE 抓包 | BFF 不依赖此字段,忽略 | SSE 抓包 + 断言 reasoning chunk 正常产出 |

#### 回归测试(确保 Rust 后端不受影响)

| # | 测试场景 | 验证方法 |
|---|---------|---------|
| **R-reg-1** | Rust 后端全路径回归 | 切换 BFF backend 到 Rust 实例,重跑 BFF 单元测试 `npm test` |
| **R-reg-2** | Rust `run.completed` 正常 | SSE 抓包 + 断言 `usage`/`done` chunk |
| **R-reg-3** | Rust `tool.progress` 正常 | SSE 抓包 + 断言 `tool_start`/`tool_complete` chunk |

### 测试执行步骤

```bash
# Step 1: 启动 Python 后端(intellect-team Phase 1+2 完成后)
cd ~/workspace/intellect-team
INTELLECT_TENANT_ID=00000000000000000000000000000000 python -m intellect_team.api_server

# Step 2: 启动 BFF(指向 Python 实例)
cd ~/workspace/agentui/bff
# .env 配置 HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY + INTELLECT_TENANT_ID
npm run dev

# Step 3: BFF 单元测试回归(确保 BFF 自身无变化)
npm test

# Step 4: 手动集成测试(按上述矩阵逐项 curl)
# 4.1 B1: 获取单个 agent
curl http://localhost:9390/api/bff/agents/chat

# 4.2 M1: 创建 session
curl -X POST http://localhost:9390/api/bff/agents/chat/sessions \
  -H "Content-Type: application/json" -d '{"title":"测试"}'

# 4.3 B5: 获取消息历史(需先有消息)
curl http://localhost:9390/api/bff/agents/chat/sessions/<sessionId>/messages

# 4.4 B3/B4/E4: SSE 流式对话(观察事件序列)
curl -N -X POST http://localhost:9390/api/bff/agents/chat/sessions/<sessionId>/chat \
  -H "Content-Type: application/json" -d '{"content":"你好"}'

# 4.5 B2: clarify 端到端(触发 clarify 工具)
curl -N -X POST http://localhost:9390/api/bff/agents/chat/sessions/<sessionId>/chat \
  -H "Content-Type: application/json" -d '{"content":"请使用 clarify 工具问我:您想了解什么?"}'
# 收到 clarify_request 事件后:
curl -X POST http://localhost:9390/api/bff/agents/chat/sessions/<sessionId>/clarify \
  -H "Content-Type: application/json" \
  -d '{"clarify_id":"<从SSE事件获取>","answer":"测试答案"}'

# Step 5: 前端 UI 端到端验证
cd ~/workspace/agentui
npm run dev
# 浏览器访问 http://localhost:9392/chat/api_xxx
# 验证:消息流正常、spinner 正常停止、clarify 弹窗正常、工具调用正常展示

# Step 6: Rust 实例回归(用于 E1/E3 验证 + Rust 兼容性回归)
# 6.1 启动 Rust 后端(intellect-team Rust 版本)
cd ~/workspace/intellect-team
cargo run --bin api_server  # 默认监听 8642

# 6.2 切换 BFF backend 指向 Rust 实例(修改 bff/data/harness-backends.json 的 endpoint,
#     或通过 Admin UI 编辑 backend 配置,确保 type=intellect-enterprise 且 endpoint 指向 Rust)
# 6.3 重启 BFF(管理操作后需重启以清除 Adapter 缓存)
cd ~/workspace/agentui/bff && npm run dev

# 6.4 重跑 E1/E3 相关 curl
# E1: Rust 加分页字段后,BFF 忽略分页字段
curl http://localhost:9390/api/bff/agents/chat/sessions
# E3: Rust reasoning 事件含 elapsed_s/silent_s,BFF 忽略
curl -N -X POST http://localhost:9390/api/bff/agents/chat/sessions/<sessionId>/chat \
  -H "Content-Type: application/json" -d '{"content":"你好"}'

# 6.5 Rust 全路径回归(BFF 单元测试已覆盖,可选)
npm test
```

### 通过标准

- **P0(6 项核心 + 5 项验证)**: 100% 通过(含 B1/B3/B4/B5/E4/B2 + B2-channel/B2-payload/B3-old/B4-old/E4-neg 防御性验证)
- **P1(6 项核心 + 1 项验证)**: 100% 通过(含 M1-post/M1-get/**M1-patch**/M2/M5/M6/E1/E3)
- **Rust 回归**: 100% 通过(BFF 单元测试 0 回归 + E1/E3 Rust 实例验证)
- **前端 UI**: spinner 正常停止、clarify 弹窗正常、工具调用正常展示

---

## 四、总结

### 对 Intellect-Team 的回复

1. **E4(run.completed)**: **BFF 强依赖,已验证通过 ✅**。Intellect-Team Phase 1 E4 已部署到 intellect-gateway v0.6.8,2026-07-29 验证通过。SSE 流正常发射 `run.completed` 事件,payload 含 `event` + `usage`(input_tokens/output_tokens/total_tokens)+ `output` 字段,流自然结束。详见 §一.E4 + [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md)。

2. **E5(run.stopping)**: **BFF 不依赖,降级 P2**。Python 后续版本补齐即可,BFF 解析器可在 `default` 分支前新增 `case 'run.stopping': return [];` 静默忽略。

3. **B2 clarify session_id + 通道要求**: **BFF 从 SSE event payload 顶层 `session_id` 字段获取**(兜底从 `clarify_id` 切分)。Python clarify SSE event **必须包含** `session_id` 顶层字段。**⚠️ 前置条件**:Intellect-Team **必须**在 `/v1/runs/events` 路径注入 clarify_fn(BFF 不走 `/v1/chat/completions` 通道)。详见 §一.B2。

4. **T0 BFF 兼容性预确认**: **BFF 当前代码对 Python 新版式基本兼容,无需 BFF 侧任何改动**。11 项(B1/B3/B4/B5/E4/M1/M2/M3/M4/M5/M6)无条件 ✅ 兼容;B2 为 ⚠️ **有条件兼容**(需 clarify_fn 在 `/v1/runs` 路径注入)。详见 §二。

5. **T2 集成测试计划**: ✅ **已执行完成**(2026-07-29)。Phase 1 REST 12/12 + Phase 2 SSE 6/6(E4/run.completed + E4-usage + E4-stream-end + B4-default + B3-old + B4-old)+ BFF 单元测试 559/559,0 回归。详见 §三 + [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md)。

### AgentUI 侧无需改动确认

| 改动项 | 是否需要 BFF 改动 | 是否需要前端改动 |
|--------|------------------|-----------------|
| B1/B3/B4/B5/E4 | ❌ 不需要 | ❌ 不需要 |
| B2 clarify | ❌ 不需要(⚠️ 需 Intellect-Team 在 `/v1/runs` 路径注入 clarify_fn) | ❌ 不需要 |
| M1/M2 | ❌ 不需要(X-T1 已完成) | ❌ 不需要 |
| M3/M4/M5/M6 | ❌ 不需要 | ❌ 不需要 |
| E1/E3 | ❌ 不需要 | ❌ 不需要 |
| E5 | ❌ 不需要(降级 P2) | ❌ 不需要 |

**结论**: Intellect-Team Phase 1+2 完成后,直接进入 T2 集成测试即可。BFF 和前端均无需任何代码改动。
