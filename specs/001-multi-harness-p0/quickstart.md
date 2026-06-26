# Quickstart: Multi-Harness P0 Validation

**Date**: 2026-06-26
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Purpose

P0 完成后的可运行验证场景。每个场景对应 spec 的 Success Criteria(SC-001 ~ SC-010)。
按顺序执行即可端到端验证 P0 交付物。

---

## Prerequisites

1. **环境变量已设置**(`.env` 文件,从 `.env.example` 复制并填值,Constitution Principle VIII v1.1.0):
   ```bash
   HARNESS_INTELLECT_RAG_ADMIN_TOKEN=<your-intellect-rag-admin-token>
   HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY=<your-intellect-team-api-server-key>
   VITE_BFF_BASE=/api/bff
   ```
2. **Intellect RAG 后端运行中**(`http://localhost:9380` 可达)
3. **BFF 依赖已安装**:`npm install`(项目根目录)
4. **TypeScript 编译零错误**:`npm run type-check`(根目录)+ `cd bff && npm run type-check`

---

## Scenario 1: BFF 反向代理透传(SC-001, SC-002, SC-003)

**Goal**: 前端 API 路径常量切换后,所有功能行为不变,SSE 流式正常透传。

### Steps

1. 启动 BFF 与前端:
   ```bash
   npm run dev:all
   ```
2. 浏览器访问 `http://localhost:5173`
3. 执行冒烟用例(全部应通过):
   - 登录
   - 列出 Agent
   - 创建 Session
   - 发起流式对话(验证流式增量正常显示,首字延迟无明显增加)
   - 打开画布
   - 知识库 CRUD(列表/创建/上传文档/删除)
   - Admin 页面访问

### Expected

- 所有功能行为与切换 API 常量前完全一致
- 流式对话首字延迟 ≤ 50ms(本地环境,主观可接受)
- BFF 终端日志可见每条 `/api/bff/proxy/v1/*` 请求的 method/path/status/耗时

### Rollback Test

- 修改 `src/utils/api.ts` 中 `restAPIv1` 常量回 `/api/v1`(单行)
- 刷新页面,所有功能应瞬时恢复
- 改回 `/api/bff/proxy/v1`,功能再次正常

---

## Scenario 2: BFF 代理鉴权(SC-001)

**Goal**: 未授权请求被 BFF 拦截,不透传到后端。

### Steps

1. 用 curl 直接请求 BFF 代理,不带 Authorization:
   ```bash
   curl -i http://localhost:9390/api/bff/proxy/v1/agents
   ```

### Expected

- HTTP 401 Unauthorized
- BFF 日志记录鉴权失败
- Intellect RAG 后端日志无对应请求(被 BFF 拦截)

---

## Scenario 3: 契约文件独立编译(SC-004, SC-010)

**Goal**: Adapter 契约文件可独立编译,用契约写 mock adapter 能通过类型检查。

### Steps

1. 编译 BFF:
   ```bash
   cd bff && npm run type-check
   ```
2. 在 `bff/src/types/` 目录下,所有契约文件(`harness.ts` / `stream.ts` / `tenant.ts` / `adapter.ts` / `domain.ts` / `stores.ts`)应零错误编译通过。

### Mock Adapter Type Check (Manual)

3. 临时创建 `bff/src/services/adapters/mock-adapter.ts`:
   ```typescript
   import type { IHarnessAdapter } from '../../types/adapter';
   import type { HarnessBackend } from '../../types/harness';

   export class MockAdapter implements IHarnessAdapter {
     constructor(private backend: HarnessBackend) {}
     readonly backendId = this.backend.id;

     async listAgents() { return []; }
     async getAgent() { throw new Error('not impl'); }
     async createSession() { throw new Error('not impl'); }
     async listSessions() { return []; }
     async getSession() { throw new Error('not impl'); }
     async deleteSession() { return; }
     async sendMessage() { return (async function* () {})(); }
     async cancelMessage() { return; }
     async healthCheck() { return true; }
     async discoverCapabilities() { return this.backend.capabilities; }
   }
   ```
4. `npm run type-check` 应零错误(证明契约可被实现,无需修改契约)。
5. 删除 mock-adapter.ts(仅用于类型验证)。

### Expected

- TypeScript 编译零错误
- Mock adapter 实现契约无需修改契约文件

---

## Scenario 4: StreamChunk 覆盖两后端事件(SC-005)

**Goal**: `StreamChunk` type 枚举能表达 Intellect RAG 和企业版所有 SSE 事件(Constitution Principle IV v1.1.0)。

### Steps

1. 检查 `bff/src/types/stream.ts` 中 `StreamChunk` 的 type 枚举(8 个值):
   - `'delta'` — Intellect RAG `choices[0].delta.content` ✓ 企业版 `event: assistant.delta` ✓
   - `'reasoning'` — 企业版 `event: tool.progress`(`tool_name="_thinking"`)✓;Intellect RAG `reasoning_content` 可选扩展 ✓
   - `'tool_start'` — 企业版 `event: tool.started` ✓(P3 启用)
   - `'tool_complete'` — 企业版 `event: tool.completed` ✓(P3 启用)
   - `'tool_progress'` — 企业版 `event: tool.progress`(非 `_thinking` 的其他 `tool_name`)✓(P3 启用)
   - `'usage'` — 企业版 `run.completed.data.usage` ✓ Intellect RAG `usage` 字段 ✓
   - `'done'` — Intellect RAG `data: [DONE]` ✓ 企业版 `event: done` ✓
   - `'error'` — 任意后端错误 ✓;企业版 `event: error` 或 `tool.failed`(带 `toolCallId`)✓

### Expected

- 8 个 type 值覆盖两后端所有事件
- 事件名以 intellect-team `plugins/platforms/api_server/adapter.py` `_handle_session_chat_stream` 实际实现为准
- 无需 P3 时回头扩展枚举(向后兼容)

---

## Scenario 5: HarnessStore 加载默认配置(SC-006, SC-007)

**Goal**: BFF 启动时加载默认 Intellect RAG 后端,token 从环境变量读取,JSON 无明文。

### Steps

1. 检查 `bff/data/harness-backends.json` 存在,内容形如:
   ```json
   {
     "backends": [
       {
         "id": "intellect-rag-default",
         "name": "Intellect RAG (Default)",
         "type": "intellect-rag",
         "endpoint": "http://localhost:9380",
         "adminTokenEnvVar": "HARNESS_INTELLECT_RAG_ADMIN_TOKEN",
         "capabilities": {
           "canvas": true,
           "knowledgeBase": true,
           "memory": true,
           "mcp": false,
           "multiTenant": false,
           "modelManagement": false
         },
         "defaultForTenant": true
       }
     ]
   }
   ```
2. 启动 BFF,观察启动日志:应输出"Loaded backend: intellect-rag-default"
3. 调用 BFF health 接口验证 store 已加载(若 health 暴露 store 状态)或通过代理行为间接验证

### Token Security Check

4. 用 grep 扫描 `bff/data/harness-backends.json`:
   ```bash
   grep -iE 'token|secret|password|key' bff/data/harness-backends.json
   ```
5. 输出应只包含 `adminTokenEnvVar` 字段名,不含任何明文 token 值。

### Env Missing Behavior

6. 临时删除 `.env` 中的 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`,重启 BFF
7. BFF 应输出告警"Backend intellect-rag-default skipped: env var HARNESS_INTELLECT_RAG_ADMIN_TOKEN not set"
8. BFF 应正常启动(不崩溃),`HarnessStore.list()` 返回空数组。

### Expected

- 默认配置加载成功
- JSON 文件零 token 明文
- 环境变量缺失时 BFF 不崩溃,只告警

---

## Scenario 6: TenantStore 绑定(SC-008)

**Goal**: 一个 BFF Tenant 能同时绑定主后端 + 画布后端,分别查询。

### Steps

由于 P0 不实现 Admin 页面(留待 P2),通过手工编辑 `bff/data/bff-tenants.json` 或 BFF 启动时初始化脚本验证:

1. 编辑 `bff/data/bff-tenants.json`:
   ```json
   {
     "tenants": [
       {
         "id": "tenant-demo",
         "name": "Demo Tenant",
         "intellectBackendId": "intellect-enterprise-default",
         "canvasBackendId": "intellect-rag-default",
         "createdAt": "2026-06-26T00:00:00Z",
         "updatedAt": "2026-06-26T00:00:00Z"
       }
     ]
   }
   ```
2. 启动 BFF,`TenantStore.load()` 应加载成功
3. (P0 验证手段)在 BFF 启动后,通过临时调试端点或单元测试调用:
   - `tenantStore.getHarnessBinding('tenant-demo')` → 返回 `'intellect-enterprise-default'`
   - `tenantStore.getCanvasBinding('tenant-demo')` → 返回 `'intellect-rag-default'`

### Canvas Binding Type Check

4. 临时把 `canvasBackendId` 改为 `intellect-enterprise-default`(非 intellect-rag 类型)
5. 重启 BFF,`TenantStore.load()` 应抛出错误"canvasBackendId must be intellect-rag type, got: intellect-enterprise"

### Expected

- 主后端与画布后端绑定独立查询
- 画布后端类型校验生效(必须是 intellect-rag)

---

## Scenario 7: 现有功能无回归(SC-009, SC-010)

**Goal**: P0 不影响现有 BFF 路由(agent/session/admin/health)行为。

### Steps

1. `cd bff && npm run type-check` 零错误
2. 启动 BFF,直接访问现有路由(不经代理):
   - `curl http://localhost:9390/api/agent/list`
   - `curl http://localhost:9390/api/session/list`
   - `curl http://localhost:9390/api/health`
3. 行为应与 P0 实施前完全一致

### Expected

- TypeScript 编译零错误
- 现有路由行为 100% 不变

---

## Acceptance Summary

| Scenario | SC covered | Pass criteria |
|----------|-----------|---------------|
| 1. 反向代理透传 | SC-001, SC-002, SC-003 | 冒烟用例全通过,首字延迟 ≤ 50ms,BFF 日志可见 |
| 2. 代理鉴权 | SC-001 | 401 返回,后端无请求 |
| 3. 契约独立编译 | SC-004, SC-010 | tsc 零错误,mock adapter 通过类型检查 |
| 4. StreamChunk 覆盖 | SC-005 | 8 个 type 覆盖两后端所有事件 |
| 5. HarnessStore 加载 | SC-006, SC-007 | 默认配置加载,JSON 无明文,env 缺失不崩溃 |
| 6. TenantStore 绑定 | SC-008 | 主/画布绑定独立查询,类型校验生效 |
| 7. 现有功能无回归 | SC-009, SC-010 | tsc 零错误,现有路由行为不变 |

全部通过即 P0 验收完成,可进入 P1(IntellectRagAdapter 实现)。
