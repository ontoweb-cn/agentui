# Quickstart: 显式 CanvasService — 画布脱离 Proxy 路由

**Feature**: 008-explicit-canvas-service
**Date**: 2026-06-27

本文档提供可运行的验证场景,证明本 spec 的 feature 端到端工作。每个场景含 prerequisites、commands、expected outcome。实施细节见 `tasks.md`(由 `/speckit-tasks` 生成)。

---

## Prerequisites

### 环境准备

1. **BFF 启动**(端口 9390):
   ```bash
   cd bff && pnpm dev
   ```
   预期输出:`[BFF] OpenKG AgentUI BFF running on http://localhost:9390`
   日志:`[BFF] Stores loaded: N backend(s), M tenant(s)`

2. **Intellect RAG 启动**(端口 9380):
   ```bash
   # 按 Intellect RAG 项目自身启动方式
   ```
   预期:`curl http://localhost:9380/health` 返回 200

3. **前端启动**(端口 5173 或 Vite 默认):
   ```bash
   pnpm dev
   ```

4. **HarnessStore 配置**(`bff/data/harness-backends.json`):
   至少 1 个 `type=intellect-rag` backend,`endpoint` 指向 `http://localhost:9380`,`adminToken` 有效

5. **TenantStore 配置**(`bff/data/bff-tenants.json`):
   - `default` 租户(社区版,无 `canvasBackendId`,或 `intellectBackendId` 指向 intellect-rag)
   - (可选)`tenant-001` 企业版租户,`canvasBackendId` 指向某 intellect-rag backend
   - (可选)`tenant-002` 企业版租户,**未设置** `canvasBackendId`(用于验证 503 场景)

### 鉴权准备

- 社区版:前端登录后携带 `Authorization: Bearer <user_token>`
- 企业版:前端登录后通过 cookie 携带 member token(P4b 已实现)

---

## Scenario 1: 社区版画布冒烟(零回归验证)

**Goal**: 验证 default 租户的画布操作 100% 经 `/api/bff/canvas/*`,响应与原透传模式逐字段一致(SC-001、SC-002、SC-005)。

### Steps

1. 前端登录,获取 `Authorization: Bearer <token>`
2. 在画布列表页,验证 `GET /api/bff/canvas` 返回画布列表:
   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:9390/api/bff/canvas
   ```
   **Expected**: 200,JSON 数组,字段与原 `GET /api/v1/agents` 透传响应 1:1

3. 创建画布:
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
        -H "Content-Type: application/json" \
        -d '{"name":"test-canvas","dsl":{}}' \
        http://localhost:9390/api/bff/canvas
   ```
   **Expected**: 200/201,返回新画布对象,含 `id`

4. 保存 DSL:
   ```bash
   curl -X PUT -H "Authorization: Bearer <token>" \
        -H "Content-Type: application/json" \
        -d '{"dsl":{"nodes":[]}}' \
        http://localhost:9390/api/bff/canvas/<id>
   ```
   **Expected**: 200,返回更新后的画布

5. 上传附件(multipart 流式透传):
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
        -F "file=@/path/to/file.pdf" \
        http://localhost:9390/api/bff/canvas/<id>/upload
   ```
   **Expected**: 200,返回上传结果;`Content-Type` 透传上游

6. 组件调试:
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
        -H "Content-Type: application/json" \
        -d '{"input":"test"}' \
        http://localhost:9390/api/bff/canvas/<id>/components/<cid>/debug
   ```
   **Expected**: 200,返回调试结果

7. trace 日志:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/canvas/<id>/logs/<messageId>
   ```
   **Expected**: 200,返回 trace 详情

8. 版本列表:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/canvas/<id>/versions
   ```
   **Expected**: 200,返回版本数组

9. 重置画布:
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/canvas/<id>/reset
   ```
   **Expected**: 200

10. 删除画布:
    ```bash
    curl -X DELETE -H "Authorization: Bearer <token>" \
         http://localhost:9390/api/bff/canvas/<id>
    ```
    **Expected**: 200/204

### Verification

- 所有响应与迁移前(经 `/api/bff/proxy/v1/agents/*` 透传)逐字段一致
- BFF 日志显示请求路径均为 `/canvas/*`,无 `/proxy/v1/agents/*` 路径
- 前端 `api.ts` 中画布相关 endpoint 全部用 `${bffCanvas}`(grep 校验)

---

## Scenario 2: 企业版租户已绑定画布后端

**Goal**: 验证企业版租户(`tenant-001`)的画布操作按 `canvasBackendId` 路由到指定 Intellect RAG 后端(SC-003)。

### Prerequisites

- `bff/data/bff-tenants.json` 中 `tenant-001` 的 `canvasBackendId` 指向某 intellect-rag backend(记为 backend-B)
- 若有多个 intellect-rag backend,backend-B 与 default 回退的 backend 不同(用于验证路由到正确后端)

### Steps

1. 前端登录企业版租户,请求带 `X-Tenant-Id: tenant-001`
2. 调画布列表:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        -H "X-Tenant-Id: tenant-001" \
        http://localhost:9390/api/bff/canvas
   ```
   **Expected**: 200,返回 backend-B 上的画布列表(非 default backend 的列表)

3. 创建画布:
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
        -H "X-Tenant-Id: tenant-001" \
        -H "Content-Type: application/json" \
        -d '{"name":"enterprise-canvas"}' \
        http://localhost:9390/api/bff/canvas
   ```
   **Expected**: 200/201,画布创建在 backend-B 上

4. (可选)直接调 backend-B 的 `/api/v1/agents`,验证画布确实在 backend-B 而非 default backend

### Verification

- BFF 日志显示 `CanvasService` 调用 `IntellectRagAdapter`(实例化自 backend-B 配置)
- 画布出现在 backend-B,而非 default backend

---

## Scenario 3: 企业版租户未绑定画布后端(503 错误)

**Goal**: 验证企业版租户(`tenant-002`)未设置 `canvasBackendId` 时,画布操作返回 503,不静默回退(SC-003、SC-004)。

### Prerequisites

- `bff/data/bff-tenants.json` 中 `tenant-002` **未设置** `canvasBackendId`(且 `tenantId !== 'default'`)

### Steps

1. 前端登录企业版租户 `tenant-002`,请求带 `X-Tenant-Id: tenant-002`
2. 调画布列表:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        -H "X-Tenant-Id: tenant-002" \
        http://localhost:9390/api/bff/canvas
   ```
   **Expected**: 503,响应 body:
   ```json
   { "code": 503, "message": "Tenant tenant-002 has no canvas backend bound" }
   ```

3. 调任意画布子路径(如 `/canvas/templates`),预期同样 503

### Verification

- BFF 不调用任何 Intellect RAG 上游
- 错误信息明确指出租户名,便于排查
- 不静默回退到 default backend

---

## Scenario 4: canvasBackendId 指向无效后端(503 错误)

**Goal**: 验证 `canvasBackendId` 指向的 backend 不存在或类型非 `intellect-rag` 时,返回 503(SC-004)。

### Prerequisites

- 测试用例 1:`tenant-003` 的 `canvasBackendId` 指向不存在的 backend ID(如 `nonexistent-backend`)
- 测试用例 2(可选,需构造数据):`tenant-004` 的 `canvasBackendId` 指向 `type=intellect-enterprise` 的 backend

### Steps

**Case 1: backend 不存在**

```bash
curl -H "Authorization: Bearer <token>" \
     -H "X-Tenant-Id: tenant-003" \
     http://localhost:9390/api/bff/canvas
```

**Expected**: 503,响应 body:
```json
{ "code": 503, "message": "Tenant tenant-003 canvas backend nonexistent-backend not found or invalid" }
```

**Case 2: backend 类型非 intellect-rag**(若有构造数据)

```bash
curl -H "Authorization: Bearer <token>" \
     -H "X-Tenant-Id: tenant-004" \
     http://localhost:9390/api/bff/canvas
```

**Expected**: 503,响应 body:
```json
{ "code": 503, "message": "Tenant tenant-004 canvas backend <id> has invalid type intellect-enterprise, expected intellect-rag" }
```

### Verification

- 不调用上游
- 错误信息区分"not found"与"invalid type"

---

## Scenario 5: 上游不可达(502 错误)

**Goal**: 验证 Intellect RAG 不可达时,画布操作返回 502(SC-002 错误处理)。

### Prerequisites

- 停止 Intellect RAG 服务(或修改 `harness-backends.json` 中 backend endpoint 指向不可达地址)
- default 租户(社区版回退)

### Steps

```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:9390/api/bff/canvas
```

**Expected**: 502,响应 body:
```json
{ "code": 502, "message": "Canvas upstream error: <fetch error details>" }
```

### Verification

- BFF 日志记录上游 URL 与错误信息
- 不吞异常,前端可据 502 区分"配置错误"(503)与"上游故障"(502)

---

## Scenario 6: 鉴权失败(401)

**Goal**: 验证未携带有效 Authorization 的请求返回 401,不进入 CanvasService。

### Steps

```bash
curl http://localhost:9390/api/bff/canvas
```

**Expected**: 401(由 `authMiddleware` 返回)

### Verification

- BFF 不调用 Intellect RAG 上游
- 响应与现有 `/api/bff/agents/*` 鉴权失败行为一致(P1 已实现)

---

## Scenario 7: P1 路径零回归

**Goal**: 验证本 spec 迁移不影响 P1 已迁移的 `/api/bff/agents/*` 路径(SC-007)。

### Steps

1. 调 Agent 列表(P1 已迁移到 Adapter):
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/agents
   ```
   **Expected**: 200,返回 `IntellectRagAdapter.listAgents()` 结果,格式与 P1 一致

2. 调 Agent 详情:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/agents/<id>
   ```
   **Expected**: 200,`IntellectRagAdapter.getAgent()` 结果

3. 调 Session 列表:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/agents/<id>/sessions
   ```
   **Expected**: 200,`IntellectRagAdapter.listSessions()` 结果

4. 调画布执行(chat/completions,P1 已迁移,R4 保留):
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
        -H "Content-Type: application/json" \
        -d '{"agent_id":"<id>","session_id":"<sid>","content":"hello"}' \
        http://localhost:9390/api/bff/agents/chat/completions
   ```
   **Expected**: 200,`Content-Type: text/event-stream`,Canvas Workflow SSE 事件流(workflow_started/message/message_end/workflow_finished)

### Verification

- 所有响应与 P1 实施后行为一致
- `bff-agents.ts` 不再包含 POST/PUT/DELETE `/agents` passthrough 路由(grep 校验)
- `bff-agents.ts` 仍包含 GET `/agents`、GET `/agents/:id`、`/agents/:id/sessions/*`、POST `/agents/chat/completions`

---

## Scenario 8: P0 透明代理路径零回归

**Goal**: 验证本 spec 不删除 `/api/bff/proxy/v1/*` catch-all 路由,未迁移域(Dataset/KB/Search/Memory/MCP)继续工作(SC-006)。

### Steps

1. 调 Dataset 列表(仍走 proxy 透传):
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/proxy/v1/datasets
   ```
   **Expected**: 200,Intellect RAG `/api/v1/datasets` 响应透传

2. 调 Memory 列表:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/proxy/v1/memories
   ```
   **Expected**: 200,透传

3. 调 MCP server 列表:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        http://localhost:9390/api/bff/proxy/v1/mcp/servers
   ```
   **Expected**: 200,透传

### Verification

- proxy catch-all 路由保留,未迁移域继续工作
- 前端不再对画布相关路径发起 `/api/bff/proxy/v1/agents/*` 请求(grep `api.ts` 校验)

---

## Scenario 9: 前端瞬时回滚

**Goal**: 验证前端 `api.ts` 改回 `${restAPIv1}/agents/...` 可瞬时回滚到 US1 之前的透传行为(SC-011)。

### Steps

1. 前端 `api.ts` 中 `bffCanvas` 常量改回 `${restAPIv1}/agents`(单点改动)
2. 重启前端(或热更新)
3. 重复 Scenario 1 的画布冒烟操作

**Expected**: 所有画布操作经 `/api/bff/proxy/v1/agents/*` 透传,行为与迁移前一致(BFF `proxy.ts` catch-all 仍服务此路径)

### Verification

- 前端单点改动即可回滚,无需 BFF 配合
- BFF `/canvas/*` 路由保留(不删除),但前端不再调用

---

## Test Suite Verification

### BFF 单元测试 + 集成测试

```bash
cd bff && pnpm test
```

**Expected**:
- 既有测试(~185 个)100% 通过(SC-006、SC-007 零回归)
- 新增 `canvas-service.test.ts`:覆盖 listCanvas/saveCanvas/deleteCanvas/uploadAttachment/debugComponent/trace 等核心方法,以及 R3 三种绑定场景(已绑定/未绑定/default 回退),覆盖率 ≥ 80%(SC-009)
- 新增 `canvas.test.ts`:覆盖鉴权(401)、租户上下文注入、上游 502、上游 404、multipart 流式透传、SSE 透传(若 applicable)

### TypeScript 编译

```bash
cd bff && pnpm tsc --noEmit
cd .. && pnpm tsc --noEmit
```

**Expected**: 零错误(SC-008)

### 前端 grep 校验

```bash
# 画布相关 endpoint 不再使用 restAPIv1 或 bffAgents
grep -n "restAPIv1.*agents" src/utils/api.ts | grep -v "^//"
grep -n "bffAgents.*agents" src/utils/api.ts | grep -v "^//"
```

**Expected**: 仅保留 `listAgents`/`getAgent`/`agentChatCompletion`/`createAgentSession`/`fetchAgentSessions`/`fetchAgentSessionById`(P1 已迁移,本 spec 不动),其余画布相关 endpoint 全部用 `bffCanvas`

### BFF 路由表校验

```bash
grep -n "app.route\|app.use" bff/src/index.ts
```

**Expected**: 包含 `/canvas/*` 路由挂载,与 `/agents/*`、`/admin/*`、`/capabilities/*`、`/auth/*`、`/proxy/v1/*`、`/health` 并列

---

## References

- [Spec](./spec.md) — 24 FR / 11 SC / 8 Edge Cases
- [Research](./research.md) — 7 个设计决策(R1-R7)
- [Data Model](./data-model.md) — 6 个实体
- [Contract](./contracts/canvas-api.ts) — BFF Canvas API 权威契约
- [Constitution](../../.specify/memory/constitution.md) v1.2.0 — Principle I/III/V/VII
- [Design Doc](../../docs/multi-harness-design.md) §3.4 / §6.4 — 画布架构设计意图
