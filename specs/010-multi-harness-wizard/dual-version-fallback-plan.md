# Intellect-Team Python/Rust 双版本兼容兜底方案

> **文档版本**: v1.0（基于技术评审 S6-S9 修订）
> **文档性质**: AgentUI 内部方案，不对外提交
> **关联文档**: [intellect-team-alignment-requirements.md](./intellect-team-alignment-requirements.md)
> **当前状态**: **预设计完成，未启用**（D7 决策：等 Intellect-Team 回复后再决定是否引入）

---

## 〇、启用前置条件（S9 评审修正：条件性引入）

本兜底方案**当前不启用**。仅在以下任一条件满足时才考虑引入：

| 条件 | 触发动作 |
|------|----------|
| Intellect-Team 明确拒绝 P0 级对齐需求 | 启用完整兜底方案（方案 1-4） |
| Intellect-Team 确认 Python 仍在维护但 4 周内无法完成对齐 | 启用完整兜底方案（方案 1-4） |
| Intellect-Team 确认 Python 已废弃 | **不启用本方案**，改为文档化"Python 不支持清单"，不引入代码兼容层 |

**若 Intellect-Team 在 4 周内完成 P0 对齐**：本方案永久归档，不启用。

---

## 一、方案 1：BFF 启动时探测后端版本（S7 评审修正：稳定探测方式）

### 原方案问题

原方案用 `/health` 响应的 `service`/`platform` 字段判断 flavor，但这两个字段未在契约中锁定，Intellect-Team 版本升级可能修改字段名，导致探测失效（S7 风险）。

### 修正方案：三选一探测策略

**策略 A（推荐）：静态配置 flavor 字段**

不依赖运行时探测，由运维通过 `HarnessBackendConfig.flavor` 字段显式声明：

```typescript
// bff/src/types/harness.ts 扩展
export interface HarnessBackendConfig {
  // ... 现有字段
  /** Intellect-Team 后端版本 flavor，仅 type='intellect-enterprise' 时有效 */
  flavor?: 'python' | 'rust' | 'unknown';  // 默认 'unknown'
}
```

```typescript
// bff/src/services/harness-store.ts Zod schema 扩展
const backendConfigSchema = z.object({
  // ... 现有字段
  flavor: z.enum(['python', 'rust', 'unknown']).default('unknown').optional(),
});
```

向导 Step 3 表单新增 flavor 下拉选择（仅 intellect-enterprise 类型显示）：
- 默认 `unknown`（按 Rust 行为处理，向后兼容）
- 运维显式选择 `python` 或 `rust`

**优点**：零运行时探测开销，无字段依赖风险，运维显式声明。

**策略 B：运行时探测 `GET /v1/models/{id}` 是否 404**

利用 B1 差异（Python 无此端点）作为探测依据：

```typescript
// bff/src/services/adapters/intellect-enterprise/version-detector.ts (新增)
export type IntellectTeamFlavor = 'python' | 'rust' | 'unknown';

export async function detectBackendFlavor(
  baseUrl: string,
  apiServerKey: string,
): Promise<IntellectTeamFlavor> {
  try {
    // 用一个不可能存在的 id 探测:Rust 返回 404(端点存在),Python 返回 404(端点不存在)
    // 区分方式:看响应 body 的 error.code
    const r = await fetch(`${baseUrl}/v1/models/__probe__`, {
      headers: { Authorization: `Bearer ${apiServerKey}` },
      signal: AbortSignal.timeout(3000),
    });
    const body = await r.json().catch(() => ({}));
    // Rust: 404 + {"error":{"code":"not_found","message":"model not found"}}
    // Python: 404 + aiohttp 默认 404 页面(非 JSON) 或 {"error":{"message":"..."}}
    if (r.status === 404 && body?.error?.code === 'not_found') return 'rust';
    if (r.status === 404 && !body?.error?.code) return 'python';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
```

**优点**：自动探测，无需运维介入。
**缺点**：依赖 error body 格式，Intellect-Team 若修改 error code 会导致误判。

**策略 C：要求 Intellect-Team 在 `/health` 新增 `flavor` 字段**

```json
// 期望的 /health 响应
{
  "status": "ok",
  "flavor": "python" | "rust",  // 新增显式字段
  ...
}
```

**优点**：最可靠。
**缺点**：依赖 Intellect-Team 实施，若对方不配合则无法使用。

### 推荐组合

- **Phase A**：策略 A（静态配置），零依赖，立即可用
- **Phase B**（可选）：策略 C（`/health` 显式字段），需 Intellect-Team 配合，作为长期优化
- **不推荐**：策略 B（运行时探测），探测结果不可靠

---

## 二、方案 2：IntellectEnterpriseAdapter 持有 flavor 字段（S6 评审修正：连锁影响评估）

### 原方案问题

原方案在 `IntellectEnterpriseAdapter` 构造函数新增 `flavor` 参数，但未评估对 `AdapterRegistry` 工厂注册的影响（S6 风险）。

### 修正方案：flavor 通过 HarnessBackend 传递，避免工厂签名变更

**关键设计**：`flavor` 通过 `HarnessBackendConfig.flavor` 字段传递，`IntellectEnterpriseAdapter` 从 `backend.flavor` 读取，**不修改工厂签名**。

```typescript
// bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts (修订)
export class IntellectEnterpriseAdapter implements IHarnessAdapter, IMultiTenantAdapter {
  readonly adapterKind = 'multi-tenant' as const;
  private readonly flavor: IntellectTeamFlavor;

  constructor(backend: HarnessBackend, httpClient: IntellectHttpClient) {
    this.flavor = backend.flavor ?? 'unknown';  // 从 backend 读取,不改工厂签名
    // ...
  }

  async getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    if (this.flavor === 'python') {
      // B1 兜底:Python 无 /v1/models/{id},改为 listAgents 后客户端过滤
      const all = await this.listAgents(ctx);
      const found = all.find(a => a.id === agentId);
      if (!found) throw new IntellectNotFoundError(`agent not found: ${agentId}`);
      return found;
    }
    // Rust 原逻辑
    const data = await this.httpClient.request('GET', `/v1/models/${encodeURIComponent(agentId)}`, ctx);
    return this.normalizeAgent(data);
  }

  async submitClarify(ctx: BackendContext, sessionId: string, clarifyId: string, answer: string): Promise<{status: string}> {
    if (this.flavor === 'python') {
      // B2 兜底:Python 无 clarify 端点,返回 501 Not Implemented
      throw new IntellectBackendError(501, 'clarify not supported on Python backend');
    }
    // ... 原逻辑
  }

  async getSessionMessages(ctx: BackendContext, agentId: string, sessionId: string): Promise<unknown[]> {
    const data = await this.httpClient.request('GET', `/api/sessions/${sessionId}/messages`, ctx);
    if (this.flavor === 'python') {
      // B5 兜底:Python 返回 {data:[]},解包 data 字段
      const pyData = data as { data?: unknown[]; session_id?: string };
      return pyData?.data ?? [];
    }
    // Rust: {messages:[]}
    return Array.isArray(data) ? data : (data as { messages?: unknown[] })?.messages ?? [];
  }

  async createSession(ctx: BackendContext, agentId: string, title?: string): Promise<Session> {
    const data = await this.httpClient.request('POST', '/api/sessions', ctx, title ? { title } : {});
    if (this.flavor === 'python') {
      // M1 兜底:Python 返回 {session:{...}},解包 session 字段
      const pyData = data as { session?: unknown };
      return this.normalizeSession(pyData?.session ?? data, agentId);
    }
    return this.normalizeSession(data, agentId);
  }
}
```

### 连锁影响评估（S6 补充）

| 影响范围 | 文件 | 变更内容 | 兼容性 |
|----------|------|----------|--------|
| 类型定义 | `bff/src/types/harness.ts` | 新增 `flavor?: 'python' \| 'rust' \| 'unknown'` 字段 | ✅ 可选字段，向后兼容 |
| Zod schema | `bff/src/services/harness-store.ts` | 新增 `flavor` 字段校验 | ✅ 可选字段，向后兼容 |
| Adapter 构造函数 | `intellect-enterprise-adapter.ts` | 从 `backend.flavor` 读取，**不新增参数** | ✅ 签名不变 |
| 工厂注册 | `bff/src/services/adapter-registry.ts` | **无需修改** | ✅ 无影响 |
| 工厂类型 | `bff/src/services/adapter-registry-types.ts` | **无需修改** | ✅ 无影响 |
| 向导表单 | `bff/src/routes/harness-admin.ts` | Step 3 新增 flavor 下拉（仅 intellect-enterprise） | ✅ 新增字段 |
| Admin 表单 | 前端 AdminForm | 新增 flavor 编辑字段 | ✅ 新增字段 |

**关键结论**：通过 `HarnessBackendConfig.flavor` 传递，**工厂签名不变**，影响范围可控。

---

## 三、方案 3：SSE 解析器双格式识别（评审 F5 修正措辞）

### `/v1/runs/events` 通道双格式识别

**评审 F5 修正**：原措辞"当前解析器只识别 tool.progress 和 message.delta+type:reasoning.delta"不准确。实际：当前解析器只识别 **Rust 格式的事件名**（`message.delta` / `tool.progress` 作为顶层 event + 内层 `type` 字段区分子类型），不识别 Python 格式的**独立顶层事件名**（`tool.started` / `tool.completed` / `reasoning.available`）。

```typescript
// bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts (扩展)
switch (event) {
  // ── Rust 格式(现有)──
  case 'message.delta':  // Rust: message.delta + type: reasoning.delta
    if (data.type === 'reasoning.delta') {
      yield { type: 'reasoning', content: data.text };
    } else {
      yield { type: 'delta', content: data.content };
    }
    break;

  case 'tool.progress':  // Rust: tool.progress + type: tool.started/tool.completed
    if (data.type === 'tool.started') {
      yield { type: 'tool_start', toolCallId: data.tool_id, name: data.name, arguments: data.arguments };
    } else if (data.type === 'tool.completed') {
      yield { type: 'tool_complete', toolCallId: data.tool_id, name: data.name, result: data.result };
    }
    break;

  // ── Python 格式(新增,仅 flavor==='python' 时激活)──
  case 'tool.started':  // Python 独立事件名
    yield { type: 'tool_start', toolCallId: data.tool_id, name: data.name, arguments: data.arguments };
    break;
  case 'tool.completed':  // Python 独立事件名
    yield { type: 'tool_complete', toolCallId: data.tool_id, name: data.name, result: data.result };
    break;
  case 'reasoning.available':  // Python 独立事件名
    yield { type: 'reasoning', content: data.text };
    break;

  // ── 共通格式 ──
  case 'run.started':
  case 'run.stopping':
    return [];  // internal skip

  // ... 其他 case 不变

  default:
    console.warn(`...unknown event: ${event}, skipping`);
    return [];
}
```

### 性能影响评估

- 双格式识别仅增加 3 个 `case` 分支，`switch` 语句时间复杂度不变
- 无额外内存分配，无额外网络请求
- 性能损耗可忽略

### legacy 通道不做双格式识别

- `parse-intellect-enterprise-sse.ts`（legacy，消费 `/api/sessions/{id}/chat/stream`）已独立处理 Python 格式
- legacy 通道属 Constitution v1.3.0 降级路径，不对齐，不引入双格式

---

## 四、方案 4：spec-011 测试用例适配（D6 决策，评审 F4 修正路径）

### tenant_id 改用真实 32 位 hex

**评审 F4 修正**：原方案引用的测试文件路径 `specs/011-team-rag-tenant-consistency/tests/tenant-consistency.test.ts` 不存在（spec-011 无 tests 目录）。实际测试文件为 `bff/src/services/tenant-validator.test.ts`。

```typescript
// bff/src/services/tenant-validator.test.ts (修订)
// 原:多处以 'default' 作为 intellectTenantId 值(行 65, 102, 111, 124, 140, 154, 173)
// 修订为:
const TEST_TENANT_ID = '00000000000000000000000000000000';  // 32 位 hex,符合 Rust 强制校验
// 其他值如 'configured-acme'/'auto-filled-tenant'/'tenant-acme' 也需同步改为 32 位 hex
```

### 影响范围

- `bff/src/services/tenant-validator.test.ts`：所有 `'default'`/`'configured-acme'`/`'auto-filled-tenant'`/`'tenant-acme'` 值改为 32 位 hex
- spec-011 spec.md：描述中的 `"default"` 值改为 32 位 hex 示例
- BFF 配置示例：文档中 `intellectTenantId` 示例值改为 32 位 hex
- **不影响**：Intellect-Team Rust 侧实现（保持 32 位 hex 强制校验）

---

## 五、Python 版本能力降级清单

若启用兜底方案，Python 后端的能力降级清单：

| 功能 | Python 后端行为 | 降级程度 |
|------|-----------------|----------|
| `getAgent(agentId)` | 改为 listAgents 客户端过滤 | ⚠️ 性能损耗（N 倍查询） |
| `submitClarify` | 返回 501 Not Implemented | ❌ clarify 流程不可用 |
| 工具调用 SSE 事件 | 双格式识别，正常渲染 | ✅ 无降级 |
| 推理 SSE 事件 | 双格式识别，正常渲染 | ✅ 无降级 |
| 会话消息历史 | 解包 `data` 字段，正常返回 | ✅ 无降级 |
| 创建会话 | 解包 `session` 字段，正常返回 | ✅ 无降级 |
| 租户禁用检测 | `enabled` 恒 true，检测失效 | ❌ 依赖 BFF 前置校验 |
| tenant_id 格式校验 | 无校验，任意字符串可用 | ⚠️ 安全语义较弱 |
| tenant_mismatch 错误码 | 无，仅 401 | ⚠️ 安全语义较弱 |

### 文档化要求

启用兜底方案时，需在 spec-010 §3.2 能力矩阵新增脚注：

```markdown
| BackendType | ProtocolFamily | SSE 解析器 | 端口 | Python 兼容性 |
|-------------|---------------|-----------|------|---------------|
| intellect-enterprise | intellect-enterprise | parseIntellectEnterpriseRunEventsSSE | 8642 | ⚠️ 部分功能降级(见 dual-version-fallback-plan.md §5) |
```

---

## 六、实施路线（条件性，仅在启用时执行）

### Phase F1：静态配置 + 降级路径（1-2 天）

1. `HarnessBackendConfig` 新增 `flavor` 字段（Zod schema + 类型）
2. `IntellectEnterpriseAdapter` 从 `backend.flavor` 读取，实现 4 个降级路径
3. 向导 Step 3 + Admin 表单新增 flavor 编辑字段
4. 单元测试：4 个降级路径覆盖

### Phase F2：SSE 双格式识别（0.5 天）

1. `parse-intellect-enterprise-run-events-sse.ts` 新增 3 个 case 分支
2. 单元测试：Python 格式 SSE 事件解析

### Phase F3：spec-011 测试用例适配（0.5 天）

1. tenant_id 改为 32 位 hex
2. 验证 spec-011 测试用例在 Rust 后端上通过

### Phase F4：文档化（0.5 天）

1. spec-010 §3.2 能力矩阵新增 Python 兼容性脚注
2. Admin 表单 flavor 字段 help text 说明降级清单

**总工期**：2.5-3.5 天（仅在启用时执行）

---

## 七、风险项

| # | 风险 | 处置 |
|---|------|------|
| **FR1** | flavor 静态配置依赖运维正确填写 | 默认 `unknown` 按 Rust 行为处理，向后兼容；Admin 表单 help text 提示 |
| **FR2** | Python 后端未来若补齐 P0 对齐，flavor 字段变为冗余 | flavor 字段保留为 `unknown` 默认值，不删除；未来 Python 对齐后可弃用 |
| **FR3** | 双格式识别增加 SSE 解析器复杂度 | 仅 3 个 case 分支，复杂度可控；单元测试覆盖 |
| **FR4** | spec-011 测试用例改 32 位 hex 可能影响其他测试 | 仅改 tenant_id 值，不改测试逻辑；全量回归 spec-011 测试 |

---

## 八、决策清单

| # | 决策点 | 选项 | 当前状态 |
|---|--------|------|----------|
| **FD1** | flavor 探测策略 | A. 静态配置（推荐）<br>B. 运行时探测 `/v1/models/{id}`<br>C. `/health` 显式字段 | A（预选） |
| **FD2** | 兜底方案启用时机 | A. 立即启用<br>B. 等 Intellect-Team 回复（推荐）<br>C. 永不启用 | B（D7 决策） |
| **FD3** | spec-011 测试用例 tenant_id 值 | A. 改用 32 位 hex（推荐，D6 决策）<br>B. 要求 Rust 放宽 | A（D6 决策） |
