# Quickstart: Multi-Harness P1 — IntellectRagAdapter 实现 + 路由原生迁移

**Feature**: [002-multi-harness-p1](./)
**Date**: 2026-06-26

## 概述

本指南提供 P1 功能的端到端验证场景。每个场景证明一个 User Story 或 Success Criterion 达成。验证顺序按依赖关系编排,前一个场景失败时后续场景无需执行。

## 前置条件

1. **P0 已完成**:BFF 反向代理、HarnessStore、TenantStore 已实现并通过测试
2. **环境变量就位**:
   - `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` — Intellect RAG admin token
   - `HARNESS_INTELLECT_RAG_BASE_URL` — Intellect RAG API 根 URL(如 `http://localhost:9380/api/v1`)
3. **配置文件就位**:
   - `bff/data/harness-backends.json` — 含一个 `backendType: 'intellect-rag'` 的后端配置
   - `bff/data/tenants.json` — 含一个绑定该后端的 tenant
4. **Intellect RAG 运行中**:`curl ${HARNESS_INTELLECT_RAG_BASE_URL}/health` 返回 200
5. **依赖已安装**:`cd bff && npm install`(含 vitest)

## 验证场景

### 场景 1: AdapterRegistry 单元测试 (SC-003, SC-004)

**目标**: AdapterRegistry 正确创建/复用 Adapter 实例,Store 未就绪时返回错误。

**命令**:
```bash
cd bff && npx vitest run src/services/adapter-registry.test.ts
```

**预期结果**:
- 所有测试通过(exit code 0)
- 覆盖场景:同一 tenantId 返回同一 Adapter 实例(`===`)、tenantId 不存在抛 `TenantNotFoundError`、Store 未就绪抛 `RegistryNotReadyError`、backendId 不存在抛 `BackendNotConfiguredError`

---

### 场景 2: parseCanvasWorkflowSSE 契约测试 (SC-005)

**目标**: SSE 解析器正确将 Canvas Workflow 事件映射到 StreamChunk。

**命令**:
```bash
cd bff && npx vitest run src/services/adapters/intellect-rag/parse-canvas-workflow-sse.test.ts
```

**预期结果**:
- 所有测试通过
- 覆盖 5 种映射(见 [canvas-workflow-sse-mapping.ts](./contracts/canvas-workflow-sse-mapping.ts)):
  - `message` + `data.content` → `StreamDelta`
  - `message` + `start_to_think` → `StreamReasoning`
  - `message_end` + `reference` → `StreamDelta` + metadata.reference
  - `workflow_finished` → `StreamDone`
  - 解析失败 → `StreamError`
- 使用录制的 SSE fixture(非真实上游调用)

---

### 场景 3: IntellectRagAdapter 单元测试 (SC-004)

**目标**: Adapter 核心方法正确调用上游 API 并返回结构化响应。

**命令**:
```bash
cd bff && npx vitest run src/services/adapters/intellect-rag/intellect-rag-adapter.test.ts
```

**预期结果**:
- 所有测试通过
- 覆盖率 ≥ 80%(核心方法 listAgents/getAgent/createSession/listSessions/sendMessage 必有测试)
- Mock 上游 fetch,验证:
  - `listAgents` 调 `GET {baseUrl}/agents` 且注入 Authorization header
  - `createSession` 调 `POST {baseUrl}/agents/{agentId}/sessions` 且 body 含 title
  - `sendMessage` 调 `POST {baseUrl}/agents/chat/completions` 且返回 StreamIterable
  - 上游 404 时抛明确错误(含 URL + status)
  - **不注入** `X-Intellect-Team`/`X-Intellect-Project` 头(Principle V 单租户)

---

### 场景 4: TypeScript 编译通过 (SC-008)

**目标**: 整个 BFF 项目类型检查通过。

**命令**:
```bash
cd bff && npm run type-check
```

**预期结果**:
- exit code 0
- 零 TypeScript 错误
- 验证 IHarnessAdapter 契约调整(session 方法新增 agentId)在所有实现处已同步

---

### 场景 5: BFF Agent 路由冒烟测试 (SC-001, SC-007)

**目标**: 前端切换路径后,Agent CRUD 行为零回归。

**前置**: Intellect RAG 运行中,已有测试 Agent 数据。

**命令**(需 BFF 已启动 `cd bff && npm run dev`):
```bash
# 1. 列出 Agent(对比 P0 透传与 P1 原生响应)
curl -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/agents

# 2. 对比 P0 透传响应(应完全一致)
curl -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/proxy/v1/agents

# 3. 获取单个 Agent
curl -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/agents/${AGENT_ID}
```

**预期结果**:
- 步骤 1 与步骤 2 响应 JSON 结构逐字段一致(SC-007)
- 步骤 3 返回 Agent 详情,结构与透传一致
- 404 场景:不存在的 agentId 返回 404,错误格式与透传一致

---

### 场景 6: BFF 流式对话冒烟测试 (SC-002)

**目标**: 前端通过 BFF Adapter 路由发起流式对话,收到完整增量流。

**前置**: 已创建 Agent 和 Session。

**命令**:
```bash
curl -N -X POST \
     -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"agent_id":"'"${AGENT_ID}"'","session_id":"'"${SESSION_ID}"'","content":"你好"}' \
     http://localhost:9390/api/bff/agents/chat/completions
```

**预期结果**:
- 收到 SSE 事件流(`data: {...}` 格式)
- 事件类型与前端 `use-send-message.ts` 期望一致(`workflow_started`/`message`/`message_end`/`workflow_finished`)
- 对话内容完整,逐字增量到达
- 流正常终止(`workflow_finished` 后连接关闭)
- 无截断、无死等

---

### 场景 7: P0 透明代理零回归 (SC-006)

**目标**: P1 迁移后,P0 透传路由继续正常工作(未迁移域不受影响)。

**命令**:
```bash
# Dataset 域(应继续走透传)
curl -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/proxy/v1/datasets

# Agent DSL 编辑(应继续走透传,Principle III)
curl -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/proxy/v1/agents/${AGENT_ID}/components
```

**预期结果**:
- Dataset 域返回 200,数据正常
- Agent DSL 编辑端点返回 200(Principle III 透传层不受 P1 影响)
- 无 404/500 错误

---

### 场景 8: TenantContext 中间件验证

**目标**: 中间件正确提取 tenantId,缺失时返回 400。

**命令**:
```bash
# 缺失 X-Tenant-Id(应返回 400)
curl -i -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/agents

# 合法 X-Tenant-Id(应正常)
curl -i -H "X-Tenant-Id: ${TENANT_ID}" \
     -H "Authorization: Bearer ${INTELLECT_RAG_TOKEN}" \
     http://localhost:9390/api/bff/agents
```

**预期结果**:
- 步骤 1 返回 400,错误消息明确指出缺失 `X-Tenant-Id`
- 步骤 2 返回 200,正常响应

---

## 验收清单

执行完所有场景后,确认以下 Success Criteria 达成:

- [ ] SC-001: 场景 5 通过(Agent CRUD 零回归)
- [ ] SC-002: 场景 6 通过(流式对话完整)
- [ ] SC-003: 场景 1 通过(Registry 100ms 内返回 Adapter)
- [ ] SC-004: 场景 1/3 通过(Adapter 覆盖率 ≥ 80%)
- [ ] SC-005: 场景 2 通过(5 种 chunk 类型契约测试)
- [ ] SC-006: 场景 7 通过(P0 透明代理零回归)
- [ ] SC-007: 场景 5 通过(响应逐字段一致)
- [ ] SC-008: 场景 4 通过(tsc + vitest 零错误)

## 故障排查

- **Adapter 调用 502**:检查 Intellect RAG 是否运行,`HARNESS_INTELLECT_RAG_BASE_URL` 是否正确
- **Registry 返回 503**:检查 `harness-backends.json` / `tenants.json` 是否存在且合法,Store 是否 load 成功
- **SSE 流截断**:检查 `parseCanvasWorkflowSSE` 是否正确处理 `workflow_finished` 终止信号
- **401 错误**:检查 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` 是否正确注入
