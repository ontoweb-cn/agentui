# 010 — Multi-Harness 扩展 + 接入向导

> **版本**: v7 评审修订
> **状态**: 待评审
> **依赖**: spec-001 (P0 契约) / spec-002 (P1 RAG Adapter) / spec-003 (Admin) / spec-004 (Enterprise Adapter) / spec-008 (Canvas Service)

> **v7 修订摘要**(基于 v6 二次评审):
> - **B1**: `ICanvasAdapter` 接口扩展为高层语义方法 + `request()`/`proxy()` 透传方法,覆盖 CanvasService 全部 20+ 方法依赖
> - **B2**: 明确 `getCanvasBackendForBackend(tenantId)` spec-008 契约保留,CanvasService 改造不破坏签名;§15 新增 spec-008 兼容性说明
> - **B3**: `OpenAICompatibleBaseAdapter` 强制删除客户端 `X-Intellect-*`/`Authorization` 头,落实 S1.1 安全约束
> - **M1-M7**: SSE usage 顺序 / intellect-llm 不注册工厂 / TokenVault 异步 / Bootstrap 多实例约束 / Token 脱敏打印 / SSRF 防护强化 / sendMessage 多轮模型说明
> - **m1-m8**: 路径前缀统一 / ProtocolFamily 类型导出 / mcp 能力脚注 / adapterKind 字段 / 默认 endpoint 示例 / KAG KB 路径澄清 / 向导状态机 / R6-Principle IV 联动

---

## 一、背景与目标

### 1.1 现状

AgentUI 已完成与 Intellect 企业版的对接，具备以下能力：

- **Adapter 抽象层**: `IHarnessAdapter` (Layer 1) + `IMultiTenantAdapter` (Layer 2) 已定义 ([adapter.ts](file:///Users/simon/project/agentui/bff/src/types/adapter.ts))
- **已接入后端**: `intellect-rag` (:9380, 画布+KB) / `intellect-enterprise` (:8642, Team/Project) / `intellect-llm` (stub)
- **Admin CRUD**: `/admin/harness-backends` 路由 + 前端页面已完成
- **能力探测**: `/capabilities` 端点 + `useHarnessCapabilities` hook
- **SSE 双协议**: `parseCanvasWorkflowSSE` + `parseIntellectEnterpriseSSE` 已实现
- **双绑定机制**: `BffTenant.intellectBackendId` + `canvasBackendId` (spec-008)

### 1.2 目标

1. **新增 Harness 类型**: 支持 `intellect-community` / `hermes` / `kag` / `agent-scope` 四类后端平台
2. **接入向导**:
   - 2.1 全新安装时(无任何后端配置)通过向导完成首次对接
   - 2.2 已有后端时在 Admin 页实现切换或新增

### 1.3 关键决策(用户确认)

| # | 决策 | 选项 |
|---|------|------|
| D1 | BackendType 是否保留 intellect-rag? | **A. 保留** — BackendType 语义是"协议/Adapter 类型",非"项目归属" |
| D2 | intellect-community 定义? | **intellect-agent 社区版**(纯 Agent 运行时,OpenAI 兼容) |
| D3 | intellect-rag 项目合并是否文档化? | **A. 是** — 在 harness.ts 注释 + design.md 说明 |
| D4 | intellect-rag 合并形态? | **A. 后端项目代码合并** — 端口分开(:9380 + :8642),协议不变 |
| D5 | Principle III 是否修订? | **保持 "Hard-Bound Intellect RAG"** — 画布引擎作为 enterprise 内嵌 RAG 子系统 |
| D6 | KAG 知识库扩展接口? | **Phase A 预留 `IKnowledgeBaseAdapter`** |

### 1.4 项目合并说明(D3 + D4)

intellect-rag 项目代码已合并到 intellect-enterprise 仓库,但部署上仍分两个端口:
- **intellect-rag 子系统** (:9380): 画布引擎 + 知识库,Canvas Workflow SSE
- **intellect-enterprise 子系统** (:8642): Team/Project + multiTenant,自定义事件 SSE

BackendType 保留 `intellect-rag` / `intellect-enterprise` 两个字面量,表示两个独立部署的子系统。**BackendType 的语义是"协议/Adapter 类型",不是"项目归属"**。

---

## 二、BackendType 最终定义

```typescript
// bff/src/types/harness.ts (v6)

/**
 * Harness 后端类型字面量。
 *
 * 命名说明:
 * - 'intellect-rag' / 'intellect-enterprise' 在项目层面已合并到 intellect-enterprise
 *   仓库,但作为 BackendType 保留两个字面量,表示两个独立部署的子系统:
 *   - intellect-rag: RAG 子系统(画布引擎 + 知识库,:9380,Canvas Workflow SSE)
 *   - intellect-enterprise: Team/Project 子系统(:8642,自定义事件 SSE,multiTenant)
 *   BackendType 的语义是"协议/Adapter 类型",不是"项目归属"。
 * - 'intellect-community' 指 intellect-agent 社区版(纯 Agent 运行时,OpenAI 兼容)。
 *   历史误用指将 'intellect-community' 指代 intellect-rag,现已澄清。
 * - 'intellect-llm' 保留为 legacy 类型,仅经 JSON 配置,不走 Admin 表单/向导
 *   (其能力由 intellect-enterprise 的 modelManagement 表达)。
 */
export type BackendType =
  | 'intellect-rag'
  | 'intellect-enterprise'
  | 'intellect-llm'           // legacy:仅 JSON 配置,不进表单/向导
  | 'intellect-community'
  | 'hermes'
  | 'kag'
  | 'agent-scope';

/**
 * 协议族(m2 修正:显式导出类型,供 Adapter 选择 SSE 解析器使用)。
 *
 * 与 BackendType 的映射见 §3.1 协议族分类表。
 */
export type ProtocolFamily =
  | 'canvas-workflow'      // Intellect RAG 专用,parseCanvasWorkflowSSE
  | 'intellect-enterprise' // Intellect Enterprise 专用,parseIntellectEnterpriseSSE
  | 'openai-compatible';   // 4 个新后端 + Intellect RAG OpenAI 兼容端点,parseOpenAISSE
```

### 2.1 Constitution 命名约束修订(B1 修正)

原 [harness.ts:24](file:///Users/simon/project/agentui/bff/src/types/harness.ts#L24) 写:

> 禁用历史误用 'intellect-community'。

v6 修订为:

> 'intellect-community' 指 intellect-agent 社区版(纯 Agent 运行时,OpenAI 兼容)。
> 历史误用指将 'intellect-community' 指代 intellect-rag,现已澄清。

同步更新 `.specify/memory/constitution.md` 的命名约束段落。

---

## 三、协议族与 Adapter 复用

### 3.1 协议族分类

| BackendType | ProtocolFamily | SSE 解析器 | 端口 |
|-------------|---------------|-----------|------|
| `intellect-rag` | canvas-workflow | `parseCanvasWorkflowSSE` (已有) | :9380 |
| `intellect-enterprise` | intellect-enterprise | `parseIntellectEnterpriseSSE` (已有) | :8642 |
| `intellect-community` | openai-compatible | `parseOpenAISSE` (新增) | 任意 |
| `hermes` | openai-compatible | `parseOpenAISSE` (复用) | 任意 |
| `kag` | openai-compatible | `parseOpenAISSE` (复用) | 任意 |
| `agent-scope` | openai-compatible | `parseOpenAISSE` (复用) | 任意 |

### 3.2 能力矩阵

```typescript
const DEFAULT_CAPABILITIES: Record<BackendType, HarnessCapabilities> = {
  'intellect-rag':         { canvas: true,  knowledgeBase: true,  memory: true, mcp: false, multiTenant: false, modelManagement: false },
  'intellect-enterprise':  { canvas: false, knowledgeBase: false, memory: true, mcp: true,  multiTenant: true,  modelManagement: true  },
  'intellect-community':   { canvas: false, knowledgeBase: false, memory: false, mcp: false, multiTenant: false, modelManagement: false },
  'hermes':                { canvas: false, knowledgeBase: false, memory: true,  mcp: true,  multiTenant: false, modelManagement: false },
  'kag':                   { canvas: false, knowledgeBase: true,  memory: false, mcp: false, multiTenant: false, modelManagement: false },
  'agent-scope':           { canvas: false, knowledgeBase: false, memory: true,  mcp: true,  multiTenant: false, modelManagement: false },
};
```

**m3 能力声明依据脚注**:
- `mcp: true` for `hermes`/`agent-scope`:基于 OpenAI function calling 协议(工具调用),待 Phase C research 确认各后端具体实现差异
- `mcp: true` for `intellect-enterprise`:已确认,基于 intellect-team 自定义 tool.started/tool.completed SSE 事件(spec-004)
- `knowledgeBase: true` for `kag`:基于 KAG 自有 KB API,Phase C P4 research 确认端点格式
- 所有待 research 的能力在 Phase C 实施前需更新本矩阵,避免误判

**m6 KAG KB 路径澄清**:
- KAG 的 `knowledgeBase: true` 走 `IKnowledgeBaseAdapter` 接口(KagAdapter 实现)
- 与 `rag.provider` 配置无关:`rag.provider` 固定为 `intellect-rag`(project_memory 约束),仅控制 Intellect RAG 子系统的 RAG 引擎选择
- KAG KB 是独立 BackendType 的扩展能力,不参与 `rag.provider` 配置路径

**Constitution 约束**:
- `canvas: true` 仅 `intellect-rag` 允许 (Principle III)
- `multiTenant: true` 仅 `intellect-enterprise` 允许

### 3.3 鉴权方式

| BackendType | 鉴权 | 头格式 |
|-------------|------|--------|
| `intellect-rag` | email + password → JWT 登录 | `Authorization: <JWT>` (RagTokenProvider 机制) |
| `intellect-enterprise` | API_SERVER_KEY | `X-API-SERVER-KEY: <key>` (Principle VIII) |
| `intellect-community` | Bearer token | `Authorization: Bearer <token>` |
| `hermes` | Bearer token | `Authorization: Bearer <token>` |
| `kag` | Bearer token | `Authorization: Bearer <token>` |
| `agent-scope` | Bearer token | `Authorization: Bearer <token>` |

---

## 四、Adapter 接口架构

### 4.1 Layered 设计

```
IHarnessAdapter (Layer 1 - 核心层,所有后端必选)
  ├─ OpenAICompatibleBaseAdapter (抽象基类,4 个新后端复用)
  │   ├─ IntellectCommunityAdapter
  │   ├─ HermesAdapter
  │   ├─ KagAdapter (同时实现 IKnowledgeBaseAdapter)
  │   └─ AgentScopeAdapter
  ├─ IntellectRagAdapter (独立实现,Canvas Workflow SSE + 画布 + KB)
  └─ IntellectEnterpriseAdapter (独立实现,自定义事件 SSE + multiTenant)

ICanvasAdapter (Layer 2 - 画布扩展,仅 intellect-rag)
  └─ IntellectRagAdapter (实现)

IKnowledgeBaseAdapter (Layer 2 - KB 扩展,可选)
  ├─ IntellectRagAdapter (实现)
  └─ KagAdapter (实现,Phase C P4)

IMultiTenantAdapter (Layer 2 - multiTenant 扩展,仅 intellect-enterprise)
  └─ IntellectEnterpriseAdapter (实现,已有)
```

### 4.2 接口定义

```typescript
// bff/src/types/adapter.ts (扩展)

/**
 * Adapter 类型标识(m4 修正:类型守卫基于此字段,避免方法名存在性判断的脆弱性)。
 * - 'harness-core':    仅实现 IHarnessAdapter(Layer 1)
 * - 'canvas':          额外实现 ICanvasAdapter
 * - 'knowledge-base':  额外实现 IKnowledgeBaseAdapter
 * - 'multi-tenant':    额外实现 IMultiTenantAdapter
 *
 * 多能力 Adapter(如 IntellectRagAdapter)取主能力标识:
 * - IntellectRagAdapter:        'canvas'(主能力画布)
 * - IntellectEnterpriseAdapter: 'multi-tenant'
 * - KagAdapter:                 'knowledge-base'
 */
export type AdapterKind = 'harness-core' | 'canvas' | 'knowledge-base' | 'multi-tenant';

// Layer 1 核心(扩展:新增 adapterKind 字段)
export interface IHarnessAdapter {
  readonly backendId: string;
  readonly backendType: BackendType;
  /** Adapter 类型标识,用于类型守卫(m4) */
  readonly adapterKind: AdapterKind;
  listAgents(ctx: BackendContext): Promise<AgentSummary[]>;
  getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary>;
  createSession(ctx: BackendContext, agentId: string, title?: string): Promise<Session>;
  listSessions(ctx: BackendContext, agentId: string): Promise<Session[]>;
  getSession(ctx: BackendContext, agentId: string, sessionId: string): Promise<Session>;
  deleteSession(ctx: BackendContext, agentId: string, sessionId: string): Promise<void>;
  sendMessage(ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable>;
  cancelMessage(ctx: BackendContext, sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
  discoverCapabilities(): Promise<HarnessCapabilities>;
}

/**
 * Layer 2 扩展:画布(B2 修正:方案 B 高层语义接口 + 透传方法)。
 *
 * 设计原则:
 * - 高层语义方法(listCanvas/createCanvas 等)对应业务操作,便于未来跨 Adapter 复用
 * - request<T>() / proxy() 透传方法覆盖 CanvasService 的 20+ 透传场景(模板/tags/版本/
 *   组件/trace/webhook/upload/download 等),避免接口爆炸(B1 修正)
 * - CanvasService 通过 ICanvasAdapter 接口调用,不再依赖 IntellectRagAdapter 具体类
 */
export interface ICanvasAdapter extends IHarnessAdapter {
  // ── 高层语义方法(业务操作)──
  listCanvas(ctx: BackendContext): Promise<CanvasAgent[]>;
  getCanvas(ctx: BackendContext, id: string): Promise<CanvasAgent>;
  createCanvas(ctx: BackendContext, body: CreateCanvasBody): Promise<CanvasAgent>;
  saveCanvas(ctx: BackendContext, id: string, body: SaveCanvasBody): Promise<CanvasAgent>;
  deleteCanvas(ctx: BackendContext, id: string): Promise<void>;
  resetCanvas(ctx: BackendContext, id: string): Promise<void>;

  // ── 透传方法(B1 修正:覆盖 CanvasService 20+ 透传场景)──
  /**
   * JSON 请求透传。CanvasService 的 templates/tags/versions/components/trace/
   * prompts/db/webhook/rerun/cancel/external-inputs 等方法均通过此方法调用上游。
   */
  request<T>(
    method: string,
    path: string,
    body?: unknown,
    ctx?: BackendContext,
  ): Promise<T>;

  /**
   * 流式/二进制透传。CanvasService 的 uploadAttachment/downloadAttachment/
   * downloadFile 通过此方法调用上游,保留 ReadableStream 供 BFF 路由层透传。
   */
  proxy(
    method: string,
    path: string,
    req: { headers: Headers; body?: ReadableStream<Uint8Array> | null; query: string },
    ctx?: BackendContext,
  ): Promise<Response>;
}

// Layer 2 扩展:知识库
export interface IKnowledgeBaseAdapter extends IHarnessAdapter {
  listDatasets(ctx: BackendContext): Promise<Dataset[]>;
  createDataset(ctx: BackendContext, name: string, description?: string): Promise<Dataset>;
  getDataset(ctx: BackendContext, datasetId: string): Promise<Dataset>;
  updateDataset(ctx: BackendContext, datasetId: string, patch: Partial<Dataset>): Promise<Dataset>;
  deleteDataset(ctx: BackendContext, datasetId: string): Promise<void>;
  listDocuments(ctx: BackendContext, datasetId: string): Promise<KbDocument[]>;
  uploadDocument(ctx: BackendContext, datasetId: string, file: File | Blob, metadata?: Record<string, unknown>): Promise<KbDocument>;
  deleteDocument(ctx: BackendContext, datasetId: string, documentId: string): Promise<void>;
}

// Layer 2 扩展:多租户(已有,不变)
export interface IMultiTenantAdapter extends IHarnessAdapter { /* ... */ }

// 类型守卫集合(m4 修正:基于 adapterKind 字段,非方法名存在性)
export function isCanvasAdapter(a: IHarnessAdapter): a is ICanvasAdapter {
  return a.adapterKind === 'canvas';
}
export function isKnowledgeBaseAdapter(a: IHarnessAdapter): a is IKnowledgeBaseAdapter {
  return a.adapterKind === 'knowledge-base';
}
export function isMultiTenantAdapter(a: IHarnessAdapter): a is IMultiTenantAdapter {
  return a.adapterKind === 'multi-tenant';
}
```

### 4.3 IntellectEnterpriseAdapter 不实现 ICanvasAdapter(M6 修正)

当前 `IntellectEnterpriseAdapter` **不实现** `ICanvasAdapter`(画布仍由 intellect-rag :9380 端口承载)。

未来若 intellect-enterprise :8642 端口暴露画布 API,`IntellectEnterpriseAdapter` 可补实现 `ICanvasAdapter`,届时 CanvasService 需支持按 backendType 路由到不同 Adapter。

---

## 五、OpenAI 兼容 Adapter 基类

### 5.0 设计原则(B3 修正)

OpenAI 兼容基类虽然面向 4 个新后端(community/hermes/kag/agent-scope),仍需落实 S1.1 安全约束:
- **强制删除客户端可能注入的 `X-Intellect-User`/`X-Intellect-Team`/`X-Intellect-Project` 头**,防止客户端伪造身份头
- **强制覆盖 `Authorization` 头**为 Adapter 实例的 admin token,不接受客户端传入
- 子类(KagAdapter 等)未来若需注入身份头,在基类删除后由子类显式注入

### 5.1 基类实现

```typescript
// bff/src/services/adapters/shared/openai-base-adapter.ts
export abstract class OpenAICompatibleBaseAdapter implements IHarnessAdapter {
  readonly backendId: string;
  abstract readonly backendType: BackendType;
  /** m4:类型守卫用,子类需声明主能力 */
  abstract readonly adapterKind: AdapterKind;
  protected readonly baseUrl: string;
  protected readonly adminToken: string;
  protected abstract readonly defaultCapabilities: HarnessCapabilities;

  constructor(protected readonly backend: HarnessBackend) {
    this.backendId = backend.id;                    // M7 修正:基类构造函数赋值
    this.baseUrl = backend.endpoint.replace(/\/$/, '');
    this.adminToken = backend.adminToken;
  }

  /**
   * 列出所有 Agent。
   * 默认调用 OpenAI 兼容端点 /v1/models。
   * 子类可覆盖此方法适配各自端点(M8)。
   */
  async listAgents(ctx: BackendContext): Promise<AgentSummary[]> {
    const data = await this.request<{
      data?: { id: string; description?: string }[];
    } | { id: string; description?: string }[]>(
      'GET', '/v1/models', undefined, ctx,
    );
    const arr = Array.isArray(data) ? data : data?.data ?? [];
    return arr.map((m) => ({ id: m.id, name: m.id, description: m.description ?? '' }));
  }

  async getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    const m = await this.request<{ id: string; description?: string }>(
      'GET', `/v1/models/${encodeURIComponent(agentId)}`, undefined, ctx,
    );
    return { id: m.id, name: m.id, description: m.description ?? '' };
  }

  // OpenAI 兼容后端通常无状态,BFF 本地维护 session 映射(可选)
  async createSession(_ctx: BackendContext, agentId: string, title?: string): Promise<Session> {
    return {
      id: crypto.randomUUID(),
      agentId,
      title: title ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  async listSessions(_ctx: BackendContext, _agentId: string): Promise<Session[]> {
    return [];
  }
  async getSession(_ctx: BackendContext, agentId: string, sessionId: string): Promise<Session> {
    return { id: sessionId, agentId, title: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  async deleteSession(_ctx: BackendContext, _agentId: string, _sessionId: string): Promise<void> {
    // no-op
  }

  /**
   * 发送消息(M7 修正:多轮对话模型说明)。
   *
   * 多轮对话策略(OpenAI 兼容后端无状态):
   * - **方案 A(推荐,P1-P3 采用)**:前端每次发送完整 history,后端不维护 session 状态。
   *   SendMessageRequest 需扩展可选 `history: { role: 'user'|'assistant'; content: string }[]` 字段
   *   (Constitution 不冲突,SendMessageRequest 是 BFF 内部 DTO)。
   * - 方案 B(YAGNI 违反,暂不实现):BFF 本地维护 sessionId → messages 映射,需 Store + 清理策略。
   * - 方案 C(最简):不支持多轮,每次都是单轮对话。
   *
   * Phase A 采用方案 A,前端 chat-stream 路由调用 sendMessage 时从请求体解析 history 透传。
   * createSession/listSessions 等 stub 方法仅返回占位 Session,供 API 兼容性使用。
   */
  async sendMessage(ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable> {
    // 构造 messages:可选 history(方案 A) + 当前 user message
    const messages = [
      ...(req.history ?? []),
      { role: 'user' as const, content: req.content },
    ];
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(ctx),
      body: JSON.stringify({
        model: req.agentId,
        messages,
        stream: true,
      }),
      // M6 修正:SSRF 防护 — 不自动跟随重定向,设置超时
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      return errorStream(`OpenAI compatible sendMessage error ${response.status}: ${text}`);
    }
    return parseOpenAISSE(response.body);
  }

  async cancelMessage(_ctx: BackendContext, _sessionId: string): Promise<void> {
    // no-op,前端通过 AbortController 取消
  }

  async healthCheck(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
        // M6 修正:healthCheck 同样防 SSRF
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    return this.defaultCapabilities;
  }

  // 供子类和 KB 方法复用
  protected async request<T>(method: string, path: string, body?: unknown, ctx?: BackendContext): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(ctx),
      body: body != null ? JSON.stringify(body) : undefined,
      // M6 修正:透传请求同样防 SSRF
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`API error ${r.status} at ${path}: ${await r.text().catch(() => '')}`);
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }

  /**
   * 构造请求头(B3 修正:强制删除客户端注入头,统一注入可信值)。
   *
   * 注意:本方法构造的是 BFF 主动发起请求的头集,不直接接收客户端 headers。
   * 但若子类(如 KagAdapter)未来实现 proxy() 透传客户端请求,需在 proxy() 中
   * 显式删除 X-Intellect-* / Authorization 头,再调用此方法注入。
   */
  protected buildHeaders(_ctx?: BackendContext): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.adminToken) h['Authorization'] = `Bearer ${this.adminToken}`;
    return h;
  }
}

async function* errorStream(message: string): StreamIterable {
  yield { type: 'error' as const, message };
}
```

#### 5.1.1 SendMessageRequest 扩展(M7)

```typescript
// bff/src/types/domain.ts (扩展)
export interface SendMessageRequest {
  agentId: string;
  content: string;
  sessionId?: string;
  /** M7 新增:多轮对话历史(OpenAI 兼容后端方案 A) */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  // ... 其他现有字段
}
```

### 5.2 各 Adapter 实现(子类仅声明差异)

```typescript
// bff/src/services/adapters/intellect-community/intellect-community-adapter.ts
export class IntellectCommunityAdapter extends OpenAICompatibleBaseAdapter {
  readonly backendType = 'intellect-community' as const;
  protected readonly defaultCapabilities: HarnessCapabilities = {
    canvas: false, knowledgeBase: false, memory: false, mcp: false,
    multiTenant: false, modelManagement: false,
  };
}

// bff/src/services/adapters/hermes/hermes-adapter.ts
export class HermesAdapter extends OpenAICompatibleBaseAdapter {
  readonly backendType = 'hermes' as const;
  protected readonly defaultCapabilities: HarnessCapabilities = {
    canvas: false, knowledgeBase: false, memory: true, mcp: true,
    multiTenant: false, modelManagement: false,
  };
}

// bff/src/services/adapters/kag/kag-adapter.ts (Phase C P4 实现 IKnowledgeBaseAdapter)
export class KagAdapter extends OpenAICompatibleBaseAdapter implements IKnowledgeBaseAdapter {
  readonly backendType = 'kag' as const;
  protected readonly defaultCapabilities: HarnessCapabilities = {
    canvas: false, knowledgeBase: true, memory: false, mcp: false,
    multiTenant: false, modelManagement: false,
  };

  // IKnowledgeBaseAdapter 方法(Phase C P4 research 后实现)
  async listDatasets(_ctx: BackendContext): Promise<Dataset[]> { throw new Error('TODO'); }
  // ... 其他 KB 方法
}

// bff/src/services/adapters/agent-scope/agent-scope-adapter.ts
export class AgentScopeAdapter extends OpenAICompatibleBaseAdapter {
  readonly backendType = 'agent-scope' as const;
  protected readonly defaultCapabilities: HarnessCapabilities = {
    canvas: false, knowledgeBase: false, memory: true, mcp: true,
    multiTenant: false, modelManagement: false,
  };
}
```

### 5.3 工厂注册

```typescript
// bff/src/index.ts (扩展)
adapterRegistry.registerFactory('intellect-rag',         (b) => new IntellectRagAdapter(b));
adapterRegistry.registerFactory('intellect-enterprise',  (b) => new IntellectEnterpriseAdapter(b));
// M2 修正:intellect-llm 不注册工厂(legacy 类型,仅 JSON 配置,无 Adapter 实现)
// 若 HarnessBackendConfig.type === 'intellect-llm' 被加载,getAdapterForBackend() 抛
// AdapterFactoryNotRegisteredError,符合 YAGNI 原则。
// 新增 4 类
adapterRegistry.registerFactory('intellect-community',   (b) => new IntellectCommunityAdapter(b));
adapterRegistry.registerFactory('hermes',                (b) => new HermesAdapter(b));
adapterRegistry.registerFactory('kag',                   (b) => new KagAdapter(b));
adapterRegistry.registerFactory('agent-scope',           (b) => new AgentScopeAdapter(b));
```

一 type 一 Adapter,无隐式判断。

**M2 处置说明**:`intellect-llm` 保留为 BackendType 字面量(向后兼容现有 JSON 配置),但不注册工厂:
- 现有 `IntellectLlmAdapter` 类保留为 stub,**仅作为类型存在,不被工厂实例化**
- 若用户在 JSON 配置中含 `intellect-llm` 条目,加载时跳过(类似无凭据场景),日志警告
- 新部署建议不配置 `intellect-llm` 条目,其能力由 `intellect-enterprise` 的 `modelManagement: true` 表达

---

## 六、IntellectRagAdapter 扩展(B2 修正)

现有 [intellect-rag-adapter.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts) 已实现 `IHarnessAdapter`,新增 `ICanvasAdapter` + `IKnowledgeBaseAdapter` 接口声明 + 包装方法:

```typescript
// bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts (扩展)
export class IntellectRagAdapter
  implements IHarnessAdapter, ICanvasAdapter, IKnowledgeBaseAdapter {

  // ... 现有方法不变

  // ── ICanvasAdapter 包装方法(新增,调现有 request()) ──
  async listCanvas(ctx: BackendContext): Promise<CanvasAgent[]> {
    return this.request<CanvasAgent[]>('GET', '/api/v1/agents', undefined, ctx);
  }
  async getCanvas(ctx: BackendContext, id: string): Promise<CanvasAgent> {
    return this.request<CanvasAgent>('GET', `/api/v1/agents/${encodeURIComponent(id)}`, undefined, ctx);
  }
  async createCanvas(ctx: BackendContext, body: CreateCanvasBody): Promise<CanvasAgent> {
    return this.request<CanvasAgent>('POST', '/api/v1/agents', body, ctx);
  }
  async saveCanvas(ctx: BackendContext, id: string, body: SaveCanvasBody): Promise<CanvasAgent> {
    return this.request<CanvasAgent>('PUT', `/api/v1/agents/${encodeURIComponent(id)}`, body, ctx);
  }
  async deleteCanvas(ctx: BackendContext, id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`, undefined, ctx);
  }
  async resetCanvas(ctx: BackendContext, id: string): Promise<void> {
    return this.request<void>('POST', `/api/v1/agents/${encodeURIComponent(id)}/reset`, undefined, ctx);
  }

  // ── IKnowledgeBaseAdapter 包装方法(新增,基于现有 intellectRagClient 调用) ──
  async listDatasets(ctx: BackendContext): Promise<Dataset[]> {
    return this.request<Dataset[]>('GET', '/api/v1/datasets', undefined, ctx);
  }
  // ... 其他 KB 方法(基于现有 intellectRagClient 实现)
}
```

### 6.1 CanvasService 改造

**spec-008 兼容性说明(B2 修正)**:
- `IAdapterRegistry.getCanvasBackendForBackend(tenantId)` spec-008 已发布签名 **保留不变**(参数为 `tenantId`,非 `backendId`)
- spec-010 仅扩展 **返回类型**:`IntellectRagAdapter` → `ICanvasAdapter`(IntellectRagAdapter 是 ICanvasAdapter 的实现,二进制兼容)
- CanvasService 调用时传 `ctx.tenantId`,与 spec-008 一致

```typescript
// bff/src/services/canvas-service.ts (修订)
export class CanvasService {
  private resolveAdapter(ctx: BackendContext): ICanvasAdapter {
    // spec-008 契约:参数为 tenantId,非 backendId(B2 修正)
    const adapter = this.registry.getCanvasBackendForBackend(ctx.tenantId);
    // Constitution Principle III 双保险:运行时校验 Adapter 类型
    if (!isCanvasAdapter(adapter)) {
      throw new CanvasNotSupportedError(adapter.backendType);
    }
    return adapter;
  }

  async listCanvas(ctx: BackendContext): Promise<CanvasAgent[]> {
    // 优先调高层语义方法(若 Adapter 实现)
    return this.resolveAdapter(ctx).listCanvas(ctx);
  }

  // 高层语义方法已封装的场景:listCanvas/getCanvas/createCanvas/saveCanvas/
  // deleteCanvas/resetCanvas 走 listCanvas(ctx) 等。

  // 透传场景(模板/tags/版本/组件/trace/webhook/upload/download 等)
  // 通过 ICanvasAdapter.request<T>() / proxy() 调用(B1 修正)
  async listTemplates(ctx: BackendContext): Promise<CanvasTemplate[]> {
    return this.resolveAdapter(ctx).request<CanvasTemplate[]>(
      'GET', '/api/v1/agents/templates', undefined, ctx,
    );
  }
  // ... 其他透传方法同模式
}

export class CanvasNotSupportedError extends Error {
  constructor(backendType: BackendType) {
    super(`Canvas not supported by backend type: ${backendType} (Principle III: Canvas Hard-Bound to Intellect RAG)`);
    this.name = 'CanvasNotSupportedError';
  }
}
```

**adapterKind 落实**:现有 `IntellectRagAdapter` 需新增字段:
```typescript
export class IntellectRagAdapter implements IHarnessAdapter, ICanvasAdapter, IKnowledgeBaseAdapter {
  readonly adapterKind = 'canvas' as const;  // 主能力画布
  // ... 现有方法不变
}
```

---

## 七、parseOpenAISSE 实现

### 7.1 文件路径(M1 修正)

采用 [stream.ts:52](file:///Users/simon/project/agentui/bff/src/types/stream.ts#L52) 现有规划路径:

```
bff/src/services/adapters/shared/sse-parser.ts
```

### 7.2 完整实现

```typescript
// bff/src/services/adapters/shared/sse-parser.ts
import type { StreamChunk, StreamIterable } from '../../../types/stream';

/**
 * OpenAI 兼容 SSE 解析器。
 *
 * 解析 data: {choices:[{delta:{content}}]} + data: [DONE] 格式。
 * 产出 StreamDelta / StreamReasoning / StreamUsage / StreamDone / StreamError。
 *
 * Constitution Principle IV: StreamChunk 8 值枚举锁定,不扩展字段。
 *
 * M1 修正:usage 与 finish_reason 顺序处理
 * - OpenAI 官方协议保证:同一最终 chunk 同时包含 finish_reason 和 usage
 * - 但部分代理(如 Azure OpenAI、LiteLLM)可能分两个 chunk 发送:
 *   chunk N: {choices:[{finish_reason:"stop"}]}
 *   chunk N+1: {usage:{...}}
 * - 实现:遇到 finish_reason 时不立即 return,改为标记 donePending,
 *   继续读取直到遇到 [DONE] 或流结束。延迟发送 done chunk,确保 usage 不丢失。
 */
export async function* parseOpenAISSE(stream: ReadableStream<Uint8Array>): StreamIterable {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePending = false;  // M1:已收到 finish_reason,等待 [DONE] 或流结束

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { type: 'done' as const };  // M2 修正:无 finishReason 字段
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: 'delta' as const, content: delta.content };
          }
          if (delta?.reasoning_content) {
            yield { type: 'reasoning' as const, content: delta.reasoning_content };
          }
          // m3 修正:预留 reference 处理(KAG 等 KB 增强后端可能扩展)
          // 注:需 StreamDelta 接口补充可选 metadata?: Record<string, unknown> 字段
          // if (delta?.reference) { ... }
          if (parsed.usage) {
            yield {
              type: 'usage' as const,
              usage: {
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
              },
            };
          }
          if (parsed.choices?.[0]?.finish_reason) {
            // M1 修正:不立即 return,标记 donePending,等待 [DONE] 或流结束
            donePending = true;
          }
        } catch {
          // 非 JSON 行忽略
        }
      }
    }
    // M1:流自然结束且已收到 finish_reason,补发 done chunk
    if (donePending) {
      yield { type: 'done' as const };
    }
  } finally {
    reader.releaseLock();
  }
}
```

---

## 八、TokenVault 复合凭据存储(B3 修正)

### 8.1 接口定义

```typescript
// bff/src/services/token-vault.ts

/**
 * 后端凭据类型。
 * - bearer-token: 直接 token(OpenAI 兼容后端 / intellect-enterprise API_SERVER_KEY)
 * - email-password: email + password(JWT 登录,如 intellect-rag)
 */
export interface BackendCredentials {
  kind: 'bearer-token' | 'email-password';
  /** bearer-token 模式:token 字符串 */
  token?: string;
  /** email-password 模式:管理员邮箱 */
  email?: string;
  /** email-password 模式:管理员密码(加密存储) */
  password?: string;
}

/**
 * 后端凭据存储。
 *
 * M3 修正:所有方法返回 Promise,避免加密文件 I/O 阻塞事件循环。
 * - 读路径(getCredentials/has)保持同步返回,因 HarnessStore.load() 时序读取,
 *   且 EnvTokenVault 内存查询无 I/O;EncryptedFileTokenVault 在 load() 时一次性
 *   解密到内存,运行时 getCredentials() 从内存读取。
 * - 写路径(setCredentials)异步,因加密写入涉及 fs I/O + 加密计算。
 */
export interface TokenVault {
  getCredentials(backendId: string): BackendCredentials | undefined;
  setCredentials(backendId: string, creds: BackendCredentials): Promise<void>;
  has(backendId: string): boolean;
}
```

### 8.2 EnvTokenVault(模式 1,向后兼容)

```typescript
export class EnvTokenVault implements TokenVault {
  getCredentials(backendId: string): BackendCredentials | undefined {
    const prefix = backendId.toUpperCase().replace(/-/g, '_');
    const token = process.env[`${prefix}_TOKEN`];
    const email = process.env[`${prefix}_EMAIL`];
    const password = process.env[`${prefix}_PASSWORD`];

    if (email && password) {
      return { kind: 'email-password', email, password };
    }
    if (token) {
      return { kind: 'bearer-token', token };
    }
    return undefined;
  }
  async setCredentials(): Promise<void> {
    throw new Error('Env vault is read-only; use wizard runtime mode');
  }
  has(backendId: string): boolean {
    return this.getCredentials(backendId) !== undefined;
  }
}
```

### 8.3 EncryptedFileTokenVault(模式 2,向导即时生效)

```typescript
/**
 * 加密文件 TokenVault(Phase B 引入)。
 * 文件:bff/data/harness-credentials.enc.json(AES-256-GCM 加密)
 * 主密钥:HARNESS_TOKEN_ENCRYPTION_KEY(未设置则降级 EnvTokenVault)
 *
 * 加载策略(M3):
 * - 构造时一次性读取 + 解密文件到内存 Map<backendId, BackendCredentials>
 * - 运行时 getCredentials() 从内存 Map 查询,同步返回
 * - setCredentials() 异步:更新内存 Map + 加密写回文件
 */
export class EncryptedFileTokenVault implements TokenVault {
  private cache = new Map<string, BackendCredentials>();

  constructor(private masterKey: string) {
    this.loadIntoCache();  // 构造时同步加载
  }

  private loadIntoCache(): void { /* 同步读文件 + 解密 + 填充 cache */ }

  getCredentials(backendId: string): BackendCredentials | undefined {
    return this.cache.get(backendId);
  }
  async setCredentials(backendId: string, creds: BackendCredentials): Promise<void> {
    this.cache.set(backendId, creds);
    await this.persist();  // 异步加密 + 写文件
  }
  has(backendId: string): boolean {
    return this.cache.has(backendId);
  }

  private async persist(): Promise<void> { /* AES-256-GCM 加密 + fs.writeFile */ }
}

export function createTokenVault(): TokenVault {
  const key = process.env.HARNESS_TOKEN_ENCRYPTION_KEY;
  if (key) return new EncryptedFileTokenVault(key);
  return new EnvTokenVault();
}
```

### 8.4 HarnessStore 改造

```typescript
// bff/src/services/harness-store.ts (修订)
load(): Promise<void> {
  // ... 解析 JSON
  for (const config of configs) {
    const creds = this.tokenVault.getCredentials(config.id);
    let adminToken: string | undefined;

    if (creds?.kind === 'bearer-token') {
      adminToken = creds.token;
    } else if (creds?.kind === 'email-password') {
      // email-password 模式:由 RagTokenProvider 登录获取 JWT
      adminToken = '__EMAIL_PASSWORD_MODE__';  // 哨兵值,RagTokenProvider 接管
    } else {
      // 回退:从 adminTokenEnvVar 读取(现有逻辑,向后兼容)
      adminToken = process.env[config.adminTokenEnvVar];
    }

    if (!adminToken) {
      console.warn(`[harness-store] Backend "${config.id}" skipped: no credentials`);
      continue;
    }
    // ...
  }
}
```

---

## 九、接入向导设计

### 9.1 向导流程

```
Step 1: Welcome → 说明向导目的
Step 2: 选择后端类型(6 张卡片)
  └─ intellect-rag / intellect-enterprise / intellect-community / hermes / kag / agent-scope
  └─ 每卡片:图标 + 能力标签 + 协议说明 + 默认端口
Step 3: 填写连接信息
  └─ Name / Endpoint(按 BackendType 预填) / 凭据(按 credentialKind 切换表单)
     - bearer-token: 单个 token 输入框
     - email-password: email + password 输入框(intellect-rag 专用)
Step 4: 连接探测(POST /admin/wizard/probe)
  └─ 调 healthCheck() + discoverCapabilities()
  └─ 实时反馈:✅ 能力清单 / ❌ 错误详情
Step 5: 确认保存(两种 token 模式)
  └─ env 模式:展示 .env 片段 → 用户复制 → 重启 BFF
  └─ runtime 模式:加密写入 → 即时生效(需 HARNESS_TOKEN_ENCRYPTION_KEY)
  └─ 创建 HarnessBackendConfig + 默认 BffTenant
Step 6: 完成 → 跳转 /
```

### 9.2 默认 endpoint 预填

```typescript
const DEFAULT_ENDPOINT_BY_TYPE: Partial<Record<BackendType, string>> = {
  'intellect-rag':         'http://localhost:9380',
  'intellect-enterprise':  'http://localhost:8642',
  'intellect-community':   'http://localhost:8080',  // m1:待 Phase C P1 确认
  'hermes':                'http://localhost:8000',  // m5:示例值,实际端口待 research
  'kag':                   'http://localhost:8888',  // m5:示例值,实际端口待 research
  'agent-scope':           'http://localhost:7000',  // m5:示例值,实际端口待 research
};

// m5:对无默认值的类型,向导展示 placeholder + 文档链接
const ENDPOINT_PLACEHOLDER_BY_TYPE: Partial<Record<BackendType, string>> = {
  'hermes':      '如 http://your-hermes-host:8000,参考 https://...',
  'kag':         '如 http://your-kag-host:8888,参考 https://...',
  'agent-scope': '如 http://your-agent-scope-host:7000,参考 https://...',
};
```

### 9.3 向导 BFF 端点

**m1 路径前缀统一**:所有 wizard 端点路径前缀为 `/api/bff/admin/wizard/*`,下表为简写形式。

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/bff/admin/wizard/status` | 公开 | `{ needsWizard, backendCount, tenantCount }` |
| `GET /api/bff/admin/wizard/types` | 公开 | 支持的 BackendType 列表 + 默认配置 |
| `POST /api/bff/admin/wizard/probe` | **admin** | `{ type, endpoint, credentials }` → `{ healthy, capabilities }` |
| `POST /api/bff/admin/wizard/setup` | **admin OR bootstrap token** | `{ type, name, endpoint, credentials, tokenMode }` → 创建配置 + 默认 tenant |

### 9.4 首次安装 Bootstrap Token 机制(B4 修正)

**M4 多实例部署约束**:
- Bootstrap 模式 **仅适用于单实例 BFF 部署**(开发环境 / 小规模生产)
- 多实例 + 负载均衡场景下,实例 A 生成的 token 提交时可能路由到实例 B 导致鉴权失败
- 多实例部署应 **禁用 Bootstrap 模式**(`BOOTSTRAP_ENABLED=false`),强制要求 admin 鉴权
- 或通过共享文件系统(NFS)/ 外部存储共享 `.bootstrap-token`,但不推荐

**M5 安全约束**:
- 控制台不打印完整 token,仅打印前 8 位 + 文件路径,提示用户从文件读取
- token 设置 TTL(默认 1 小时,可通过 `BOOTSTRAP_TOKEN_TTL_SECONDS` 配置),超时自动失效
- TTL 内首个 backend 创建成功后立即失效

```typescript
// bff/src/services/bootstrap-token.ts (新增)
import crypto from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, unlinkSync, statSync } from 'node:fs';

const BOOTSTRAP_TOKEN_FILE = resolve(DATA_DIR, '.bootstrap-token');
const BOOTSTRAP_TTL_MS = (Number(process.env.BOOTSTRAP_TOKEN_TTL_SECONDS) || 3600) * 1000;

/**
 * 首次安装 Bootstrap Token 机制。
 *
 * 触发条件:BFF 启动时检测 needsWizard=true(无任何后端配置)且 BOOTSTRAP_ENABLED !== 'false'
 * 行为:
 * 1. 生成一次性 token(32 字节随机,base64url 编码)
 * 2. 写入 bff/data/.bootstrap-token 文件(权限 0600,记录生成时间戳)
 * 3. 控制台日志输出 token 前 8 位 + 文件路径(M5 脱敏)
 * 4. /wizard/setup 端点接受此 token 作为鉴权(跳过 admin 鉴权)
 * 5. 首个 backend 创建成功后,删除 .bootstrap-token 文件,token 失效
 * 6. TTL 超时(默认 1 小时)后,validate() 返回 false,token 自动失效
 *
 * M4 约束:仅单实例部署启用;多实例需 BOOTSTRAP_ENABLED=false 强制 admin 鉴权。
 */
export class BootstrapTokenManager {
  static maybeGenerate(backendCount: number): void {
    if (backendCount > 0) return;
    if (process.env.BOOTSTRAP_ENABLED === 'false') {
      console.log('[bootstrap] 多实例部署模式,Bootstrap 已禁用,需 admin 鉴权');
      return;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const payload = JSON.stringify({ token, createdAt: Date.now() });
    writeFileSync(BOOTSTRAP_TOKEN_FILE, payload, { mode: 0o600 });
    const masked = `${token.slice(0, 8)}...(${token.length} chars)`;
    console.log('════════════════════════════════════════════════════');
    console.log('  首次安装检测到无后端配置,已启用 Bootstrap 模式');
    console.log(`  Token(前 8 位):${masked}`);
    console.log(`  完整 token 请从文件读取:${BOOTSTRAP_TOKEN_FILE}`);
    console.log(`  TTL:${BOOTSTRAP_TTL_MS / 1000}s,超时自动失效`);
    console.log('  向导端点 /api/bff/admin/wizard/setup 接受此 token 鉴权');
    console.log('  首个后端配置完成后,此 token 自动失效');
    console.log('════════════════════════════════════════════════════');
  }

  static validate(token: string): boolean {
    if (!existsSync(BOOTSTRAP_TOKEN_FILE)) return false;
    try {
      const payload = JSON.parse(readFileSync(BOOTSTRAP_TOKEN_FILE, 'utf-8'));
      // M5:TTL 校验
      if (Date.now() - payload.createdAt > BOOTSTRAP_TTL_MS) {
        BootstrapTokenManager.invalidate();
        console.log('[bootstrap] Token expired (TTL exceeded), invalidated');
        return false;
      }
      return token === payload.token;
    } catch {
      return false;
    }
  }

  static invalidate(): void {
    if (existsSync(BOOTSTRAP_TOKEN_FILE)) {
      unlinkSync(BOOTSTRAP_TOKEN_FILE);
      console.log('[bootstrap] Token invalidated after first backend setup');
    }
  }
}
```

**向导鉴权中间件**:

```typescript
// bff/src/routes/wizard.ts
// probe 始终要求 admin(避免 SSRF)
wizardRoutes.post('/admin/wizard/probe', adminAuth, probeHandler);

// setup 接受 admin OR bootstrap token(B4 修正)
async function wizardSetupAuth(ctx: Koa.Context, next: Koa.Next) {
  const auth = ctx.headers.authorization;
  if (await isAdminAuthorized(ctx)) { await next(); return; }
  if (auth?.startsWith('Bearer ') && BootstrapTokenManager.validate(auth.slice(7))) {
    await next();
    return;
  }
  ctx.status = 401;
}
wizardRoutes.post('/admin/wizard/setup', wizardSetupAuth, setupHandler);

async function setupHandler(ctx: Koa.Context) {
  // ... 创建 backend + tenant
  BootstrapTokenManager.invalidate();  // 首个 backend 创建后失效
  ctx.body = { success: true };
}
```

### 9.5 前端组件

```
src/pages/wizard/
├── index.tsx                    # Stepper 主容器
├── step-welcome.tsx
├── step-select-type.tsx        # 6 张后端类型卡片
├── step-connection-form.tsx   # 按 credentialKind 切换 token / email+password 表单
├── step-probe-result.tsx
├── step-confirm.tsx
└── wizard-service.ts
```

**m7 向导状态机说明**:
- 向导状态全在前端(React state / URL query `?step=N`),后端无状态
- 刷新行为:
  - Step 1-2:刷新重置到 Step 1
  - Step 3-4:刷新后保留已填表单(localStorage 暂存 `wizard-draft`),跳到 Step 3
  - Step 5-6:刷新检测后端是否已有 backend(`GET /wizard/status`),有则跳 `/`,无则回 Step 3
- 回退(Back)策略:任意步骤可回退到上一步,表单数据保留
- Probe 失败后:停留在 Step 4 显示错误,允许修改后重试,不阻塞流程
- Setup 成功后:清空 `wizard-draft`,跳转 `/`

**路由守卫**:

```typescript
function WizardGuard({ children }) {
  const { data } = useQuery({ queryKey: ['wizard/status'], queryFn: wizardService.getStatus });
  if (data?.needsWizard) return <Navigate to="/wizard" />;
  return children;
}
```

### 9.6 Admin 页"切换/新增"入口

- 列表页新增"Add Backend (Wizard)"按钮 → 跳转 `/wizard?mode=add`
- 列表页每行新增"Switch as Primary"操作 → 更新 BffTenant.intellectBackendId
- 列表页每行新增"Switch as Canvas"操作(仅 intellect-rag 类型)→ 更新 BffTenant.canvasBackendId

---

## 十、Admin 表单扩展(M2/M4 修正)

### 10.1 VALIDATION_RULES 扩展

```typescript
// bff/src/types/harness-admin.ts (修订)
export const VALIDATION_RULES = {
  // ...
  type: {
    // intellect-llm 不进表单(legacy,仅 JSON 配置)
    values: [
      'intellect-rag', 'intellect-enterprise',
      'intellect-community', 'hermes', 'kag', 'agent-scope',
    ] as const,
    message: 'type 必须是支持的 BackendType',
  },
  // ...
} as const;
```

### 10.2 Zod schema 扩展(M3 修正)

```typescript
// bff/src/services/harness-store.ts (修订)
const backendConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'intellect-rag', 'intellect-enterprise', 'intellect-llm',  // legacy
    'intellect-community', 'hermes', 'kag', 'agent-scope',     // 新增
  ]),
  endpoint: z.string().url(),
  adminTokenEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  projectTokenEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  capabilities: z.union([ragEnterpriseCapabilitiesSchema, llmCapabilitiesSchema]),
  defaultForTenant: z.boolean().optional(),
  comment: z.string().optional(),
  credentialKind: z.enum(['bearer-token', 'email-password']).optional(),  // 新增
});
```

### 10.3 validateCapabilities 调用位置(M5 修正)

```typescript
// bff/src/services/harness-admin-validation.ts (修订)
export function validateForm(form: unknown): ValidationResult {
  // ... 现有字段校验

  // Constitution 约束交叉校验(M5 修正)
  if (f.type && f.capabilities && typeof f.capabilities === 'object') {
    const capsErrors = validateCapabilities(
      f.type as BackendType,
      f.capabilities as HarnessCapabilities,
    );
    if (capsErrors.length > 0) {
      errors.capabilities = capsErrors[0];
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateCapabilities(type: BackendType, caps: HarnessCapabilities): string[] {
  const errors: string[] = [];
  if (type !== 'intellect-rag' && caps.canvas) {
    errors.push('canvas=true 仅 intellect-rag 允许(Principle III)');
  }
  if (type !== 'intellect-enterprise' && caps.multiTenant) {
    errors.push('multiTenant=true 仅 intellect-enterprise 允许');
  }
  return errors;
}
```

### 10.4 Admin 表单默认值预设

```typescript
const BACKEND_TYPE_OPTIONS: { value: BackendType; label: string; description: string }[] = [
  { value: 'intellect-rag',         label: 'Intellect RAG',         description: '画布 + 知识库(:9380,Canvas Workflow SSE)' },
  { value: 'intellect-enterprise', label: 'Intellect Enterprise',  description: 'Team/Project + multiTenant(:8642,自定义事件 SSE)' },
  { value: 'intellect-community',   label: 'Intellect Community',   description: 'intellect-agent 社区版(OpenAI 兼容)' },
  { value: 'hermes',                label: 'HERMES',                description: 'OpenAI 兼容' },
  { value: 'kag',                   label: 'KAG',                   description: '知识库增强(OpenAI 兼容 + KB)' },
  { value: 'agent-scope',          label: 'AgentScope',            description: '阿里达摩院(OpenAI 兼容)' },
];

// 选择 type 后自动填入默认 capabilities
const DEFAULT_CAPABILITIES_BY_TYPE: Record<BackendType, HarnessCapabilities> = {
  /* §3.2 能力矩阵 */
};
```

---

## 十一、intellect-llm 处置(m5 修正)

`intellect-llm` 保留为 BackendType 字面量,但:
- **不进 Admin 表单** (VALIDATION_RULES.type.values 不含)
- **不进向导** (向导不展示此类型卡片)
- 仅经 JSON 配置 (harness-backends.json) 支持
- IntellectLlmAdapter 类保留为 stub,未来可作为 intellect-enterprise 的 LLM 能力扩展
- 新部署建议不配置 intellect-llm 条目,其能力由 intellect-enterprise 的 `modelManagement: true` 表达

---

## 十二、design.md 双绑定语义更新(m6 修正)

```diff
// docs/multi-harness-design.md §3.4 (修订)

- ### 3.4 Canvas Hard-Bound to Intellect RAG
+ ### 3.4 Canvas Hard-Bound to Intellect RAG(enterprise 内嵌 RAG 子系统)
+
+ **项目合并说明(D3)**:intellect-rag 项目已合并到 intellect-enterprise 仓库,
+ 但画布引擎仍以 RAG 子系统形态独立部署(:9380 端口)。
+ BackendType 'intellect-rag' 表示协议/Adapter 类型,不是项目归属。
+
+ **双绑定语义**:
+ - BffTenant.canvasBackendId → intellect-rag 子系统(:9380,画布+KB)
+ - BffTenant.intellectBackendId → intellect-enterprise 子系统(:8642,Team/Project)
+ - 两者同属 intellect-enterprise 项目的不同端口,非跨项目绑定
```

---

## 十三、安全设计

### 13.1 向导 Token 安全

| 风险 | 缓解 |
|------|------|
| Probe 请求 token 明文传输 | 仅 HTTPS 部署;probe 响应不回显 token;日志脱敏 |
| Runtime token 文件泄露 | AES-256-GCM 加密;主密钥从 env;`.gitignore` 加 `harness-credentials.enc.json` + `.bootstrap-token` |
| 向导端点未授权访问 | probe/setup 需 admin 鉴权;status/types 公开(无敏感);setup 首次安装接受 bootstrap token |
| 探测 SSRF | 见 §13.2 详细防护 |
| Bootstrap token 泄露 | 文件权限 0600;首个 backend 创建后自动失效;TTL 1 小时超时失效;控制台仅打印前 8 位(M5) |

### 13.2 SSRF 详细防护(M6 修正)

Probe 端点接受用户输入的 `endpoint` URL,BFF 主动发起请求,存在 SSRF 风险。防护措施:

```typescript
// bff/src/services/ssrf-guard.ts (新增)
const FORBIDDEN_HOSTS = [
  '169.254.169.254',  // AWS/GCP/Azure 元数据
  '169.254.169.253',  // GCP 元数据备用
  'metadata.google.internal',
];
const FORBIDDEN_CIDRS = [
  /^10\./,              // RFC1918 A
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC1918 B
  /^192\.168\./,        // RFC1918 C
  /^127\./,             // loopback
  /^169\.254\./,        // link-local
  /^0\./,               // 0.0.0.0/8
  /^::1$/,              // IPv6 loopback
  /^fe80:/,             // IPv6 link-local
  /^fc00:/,             // IPv6 unique-local
];

export function validateEndpoint(endpoint: string): { ok: boolean; reason?: string } {
  let url: URL;
  try { url = new URL(endpoint); } catch { return { ok: false, reason: 'invalid URL' }; }

  // 仅允许 http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `protocol ${url.protocol} not allowed` };
  }

  const host = url.hostname.toLowerCase();
  if (FORBIDDEN_HOSTS.includes(host)) {
    return { ok: false, reason: `host ${host} blocked (metadata service)` };
  }
  if (FORBIDDEN_CIDRS.some(re => re.test(host))) {
    // 生产环境严格禁止内网;开发环境允许 localhost(由 env 控制)
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: `private/loopback IP blocked in production` };
    }
  }
  return { ok: true };
}

// Probe 调用统一包装:不跟随重定向 + 超时 + SSRF 校验
export async function safeFetch(
  endpoint: string,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<Response> {
  const guard = validateEndpoint(endpoint);
  if (!guard.ok) throw new Error(`SSRF guard: ${guard.reason}`);

  // DNS rebinding 防护:解析后再次校验 IP(简化版,生产建议用 dns.resolve + IP 校验)
  const url = new URL(endpoint);
  const dns = await import('node:dns/promises');
  try {
    const addrs = await dns.resolve4(url.hostname);
    for (const ip of addrs) {
      if (FORBIDDEN_CIDRS.some(re => re.test(ip))) {
        throw new Error(`SSRF guard: resolved IP ${ip} blocked`);
      }
    }
  } catch (e) {
    // DNS 解析失败可能是域名不存在或本地解析,允许通过(后续 fetch 会失败)
  }

  return fetch(endpoint, {
    ...init,
    redirect: 'manual',  // 不跟随重定向(SSRF via 3xx)
    signal: AbortSignal.timeout(timeoutMs),
  });
}
```

**Probe 实现使用 `safeFetch`**:
```typescript
async function probeHandler(ctx: Koa.Context) {
  const { type, endpoint, credentials } = ctx.request.body;
  const adapter = createProbeAdapter(type, endpoint, credentials);
  const healthy = await adapter.healthCheck();  // 内部用 safeFetch
  const capabilities = healthy ? await adapter.discoverCapabilities() : null;
  ctx.body = { healthy, capabilities };
}
```

### 13.3 新增后端类型校验

```typescript
const ALLOWED_BACKEND_TYPES: BackendType[] = [
  'intellect-rag', 'intellect-enterprise',
  'intellect-community', 'hermes', 'kag', 'agent-scope',
];

function validateCapabilities(type: BackendType, caps: HarnessCapabilities): string[] {
  const errors: string[] = [];
  if (type !== 'intellect-rag' && caps.canvas) {
    errors.push('canvas=true 仅 intellect-rag 允许(Principle III)');
  }
  if (type !== 'intellect-enterprise' && caps.multiTenant) {
    errors.push('multiTenant=true 仅 intellect-enterprise 允许');
  }
  return errors;
}
```

### 13.4 密钥管理(新增)

`EncryptedFileTokenVault` 主密钥 `HARNESS_TOKEN_ENCRYPTION_KEY` 管理:

| 场景 | 处置 |
|------|------|
| 密钥来源 | 环境变量(开发)/ KMS / Vault(生产),禁止明文写入 JSON 配置 |
| 密钥轮换 | 新增 `HARNESS_TOKEN_ENCRYPTION_KEY_NEW` 环境变量,启动时检测到则用旧密钥解密 + 新密钥重新加密;轮换后清空 `_NEW` |
| 密钥丢失 | 凭据文件不可解密,需重新执行接入向导录入凭据;旧凭据作废 |
| 多实例一致性 | 多实例共享同一密钥(通过 env 注入),凭据文件需共享存储(NFS)或各实例独立录入 |
| 密钥长度 | AES-256-GCM 要求 32 字节,建议 base64 编码 44 字符 |

---

## 十四、实施路线

### Phase A1:契约对齐(spec-008 兼容,无新后端)

| 任务 | 文件 | 说明 |
|------|------|------|
| `IHarnessAdapter` 新增 `adapterKind` 字段 | `bff/src/types/adapter.ts` | m4 类型守卫基础 |
| `AdapterKind` 类型导出 | `bff/src/types/adapter.ts` | 'harness-core'/'canvas'/'knowledge-base'/'multi-tenant' |
| IntellectRagAdapter 声明 `adapterKind = 'canvas'` | `intellect-rag-adapter.ts` | 主能力画布 |
| IntellectEnterpriseAdapter 声明 `adapterKind = 'multi-tenant'` | `intellect-enterprise-adapter.ts` | 主能力 multi-tenant |
| 类型守卫改用 `adapterKind` 字段 | `bff/src/types/adapter.ts` | isCanvasAdapter/isKnowledgeBaseAdapter/isMultiTenantAdapter |
| 现有 isMultiTenantAdapter 测试更新 | `adapter.test.ts` 等 | 适配新类型守卫 |
| **验收**:现有测试 0 回归 | 全套 BFF 测试 | 369/369 通过 |

### Phase A2:ICanvasAdapter 接口扩展(B1 修正)

| 任务 | 文件 | 说明 |
|------|------|------|
| `ICanvasAdapter` 接口定义(含 request/proxy) | `bff/src/types/adapter.ts` | 高层语义方法 + 透传方法 |
| IntellectRagAdapter `implements ICanvasAdapter` + 声明 6 高层方法 | `intellect-rag-adapter.ts` | 现有 request/proxy 已是 public,仅需 implements 声明 + 6 包装方法 |
| IntellectRagAdapter `implements IKnowledgeBaseAdapter` + KB 方法 | `intellect-rag-adapter.ts` | KB 包装方法基于现有 intellectRagClient |
| CanvasService 改用 `ICanvasAdapter` 类型 + `isCanvasAdapter` 守卫 | `canvas-service.ts` | B2:调用传 `ctx.tenantId`,非 backendId |
| `CanvasNotSupportedError` 新增 | `canvas-service.ts` | Principle III 运行时双保险 |
| **验收**:CanvasService 测试不回归,新增 isCanvasAdapter 守卫测试 | `canvas-service.test.ts` | |

### Phase A3:BackendType 扩展 + OpenAI 兼容基类(基建,无新后端实例化)

| 任务 | 文件 | 说明 |
|------|------|------|
| Constitution 命名约束修订 | `.specify/memory/constitution.md` + `harness.ts` 注释 | 移除"禁用 intellect-community",澄清新语义 |
| BackendType 扩展(6+1 类) + `ProtocolFamily` 类型 | `bff/src/types/harness.ts` | 新增 intellect-community/hermes/kag/agent-scope;intellect-llm 标 legacy;m2 导出 ProtocolFamily |
| `OpenAICompatibleBaseAdapter` 基类 | `shared/openai-base-adapter.ts` | 4 个新后端复用;B3 安全约束;M6 SSRF 防护;M7 sendMessage history |
| `parseOpenAISSE` | `shared/sse-parser.ts` | OpenAI SSE 解析器;M1 finish_reason/usage 顺序处理 |
| `TokenVault` 接口 + `EnvTokenVault` | `token-vault.ts` | M3 异步 setCredentials;复合凭据存储(bearer-token + email-password) |
| HarnessStore 接入 TokenVault | `harness-store.ts` | 优先 vault 回退 env;Zod schema 扩展 |
| VALIDATION_RULES 扩展 | `harness-admin.ts` | type.values 扩展 6 类(intellect-llm 不进表单) |
| validateCapabilities 调用位置 | `harness-admin-validation.ts` | validateForm 内交叉校验 |
| intellect-llm 不注册工厂(M2) | `bff/src/index.ts` | HarnessStore 加载时跳过 + 日志警告 |
| `SendMessageRequest` 扩展 history 字段(M7) | `bff/src/types/domain.ts` | OpenAI 兼容后端多轮对话方案 A |
| Admin 页 type 下拉扩展 | `harness-backends.tsx` | 6 类选项 + 默认 capabilities 预填 |
| 回归测试 | 全套 BFF 测试 | 现有画布/KB/multiTenant 功能不回归 |

### Phase B:接入向导

| 任务 | 文件 |
|------|------|
| `BootstrapTokenManager`(M4/M5 TTL + 脱敏) | `bff/src/services/bootstrap-token.ts` |
| `ssrf-guard.ts`(M6 safeFetch + DNS rebinding) | `bff/src/services/ssrf-guard.ts` |
| Wizard 路由(4 端点,m1 路径前缀 `/api/bff/admin/wizard/*`) | `bff/src/routes/wizard.ts` |
| Wizard DTO | `bff/src/types/wizard.ts` |
| `EncryptedFileTokenVault`(M3 异步) | `bff/src/services/token-vault.ts` |
| 前端 Wizard 组件(6 步,m7 状态机) | `src/pages/wizard/` |
| 前端 Wizard Service | `src/services/wizard-service.ts` |
| 路由守卫 WizardGuard | `src/routes.tsx` |
| Admin 页切换/新增入口 | `src/pages/admin/harness-backends.tsx` |
| design.md 双绑定语义更新 | `docs/multi-harness-design.md` |
| 密钥管理 quickstart(§13.4) | `specs/010-multi-harness-wizard/quickstart.md` |

### Phase C:新后端 Adapter(可并行)

| 优先级 | 后端 | 复杂度 | 扩展接口 |
|--------|------|--------|---------|
| P1 | intellect-community | 低 | 仅 Layer 1 |
| P2 | hermes | 低 | 仅 Layer 1 |
| P3 | agent-scope | 低 | 仅 Layer 1 |
| P4 | kag | 中 | Layer 1 + IKnowledgeBaseAdapter |

每 Adapter 交付标准:实现 `IHarnessAdapter` + 单测覆盖率 ≥ 80% + 冒烟测试。
实施前需完成对应后端协议 research(R1/R2/R3),更新 §3.2 能力矩阵脚注。

### Phase D:Admin 页增强

- 协议族展示列
- 切换/新增入口跳转向导

---

## 十五、Constitution 兼容性

| Principle | v7 状态 |
|-----------|---------|
| I. BFF-Mediated | ✅ 新后端均经 BFF Adapter |
| II. Adapter Abstraction | ✅ 核心必选 + 扩展可选(类型守卫基于 adapterKind) |
| **III. Canvas Hard-Bound to Intellect RAG** | ✅ 保持(画布仍由 IntellectRagAdapter 处理,:9380 RAG 子系统) |
| IV. SSE Dual-Protocol | ✅ 三类协议并存,StreamChunk 8 值枚举不变(R6 不预设扩展) |
| V. Tenant Isolation | ✅ 双绑定保留 |
| VI. No ACP | ✅ |
| VII. YAGNI + Test-First | ✅ OpenAI 基类复用;每 Adapter 必有测试 |
| VIII. Access Contract | ✅ 非 enterprise 后端不触发 API_SERVER_KEY 契约 |

### 15.1 spec-008 兼容性(新增,B2 修正)

spec-010 对 spec-008 已发布契约的变更:

| spec-008 契约 | spec-010 变更 | 兼容性 |
|---------------|---------------|--------|
| `IAdapterRegistry.getCanvasBackendForBackend(tenantId): IntellectRagAdapter` | **签名不变**,返回类型扩展为 `ICanvasAdapter`(IntellectRagAdapter 实现 ICanvasAdapter) | ✅ 二进制兼容 |
| `CanvasService.resolveAdapter(ctx): IntellectRagAdapter` | 改为返回 `ICanvasAdapter`,新增 `isCanvasAdapter()` 运行时校验 | ⚠️ 源码兼容(类型收窄) |
| `IntellectRagAdapter implements IHarnessAdapter` | 扩展为 `implements IHarnessAdapter, ICanvasAdapter, IKnowledgeBaseAdapter`,新增 `adapterKind = 'canvas'` | ✅ 接口扩展,向后兼容 |
| CanvasService 20+ 方法依赖 `adapter.request()`/`adapter.proxy()` | 这两个方法纳入 `ICanvasAdapter` 接口 | ✅ 接口扩展,向后兼容 |

**迁移路径**:
1. Phase A1:扩展 `IHarnessAdapter` 增 `adapterKind` 字段,IntellectRagAdapter/IntellectEnterpriseAdapter 声明字段
2. Phase A2:扩展 `ICanvasAdapter` 接口(含 request/proxy),CanvasService 改用 `ICanvasAdapter` 类型 + `isCanvasAdapter` 守卫
3. Phase A3:新增 BackendType 字面量 + OpenAI 兼容基类 + 新 Adapter
4. 全程现有测试不回归

---

## 十六、风险项

| # | 风险 | 处置 |
|---|------|------|
| R1 | HERMES/KAG/AgentScope 特殊请求头未确认 | Phase C 各 Adapter 实现前 research 确认协议 |
| R2 | KAG KB API 端点格式未确认 | Phase C P4 research KAG KB API 文档 |
| R3 | intellect-community 默认端口未确认 | Phase C P1 确认 |
| R4 | OpenAI 兼容后端无 session 持久化 | Phase A 基类默认实现,多轮对话走前端 history 方案(M7) |
| R5 | EncryptedFileTokenVault 主密钥管理 | §13.4 密钥管理章节明确 |
| R6 | StreamDelta metadata 字段扩展(m3) | **不修改 Constitution Principle IV**(m8 联动):metadata 走 Layer 3 透传(KAG reference),StreamChunk 8 值枚举保持锁定。若 Phase C 确需在 StreamDelta 上加 metadata 字段,需独立 RFC 修订 Principle IV,本 spec 不预设 |

---

## 十七、评审历史

- **v1**: 初稿(7 类 BackendType,4 类协议族)
- **v2**: 修订(intellect-rag 合并到 intellect-enterprise,BackendType 瘦身)
- **v3**: 修订(Principle III 保持 "Hard-Bound Intellect RAG",预留 IKnowledgeBaseAdapter)
- **v3.1**: 修订(移除迁移期,直接重构)
- **v4**: 修订(代码分析后发现 IntellectRagAdapter/IntellectEnterpriseAdapter 已存在,保留双 Adapter)
- **v5**: 评审报告(发现 4 个 Blocker + 8 个 Major 问题)
- **v6**: 终稿(全部修正:Constitution 修订 / ICanvasAdapter 方案 B / TokenVault 复合凭据 / Bootstrap token)
- **v7**: 二次评审修订(基于 v6 评审 3B + 7M + 8m):
  - B1: ICanvasAdapter 扩展 request/proxy 透传方法,覆盖 CanvasService 20+ 方法
  - B2: getCanvasBackendForBackend(tenantId) 签名保留,新增 §15.1 spec-008 兼容性章节
  - B3: OpenAICompatibleBaseAdapter 落实 X-Intellect-* 头删除 + Authorization 覆盖
  - M1: parseOpenAISSE finish_reason 不立即 return,延迟 done chunk 确保 usage 不丢失
  - M2: intellect-llm 不注册工厂,YAGNI
  - M3: TokenVault.setCredentials 改为 Promise<void>
  - M4: Bootstrap Token 多实例约束(BOOTSTRAP_ENABLED=false)
  - M5: Bootstrap Token 控制台脱敏打印 + TTL
  - M6: SSRF 防护强化(safeFetch + DNS rebinding 校验 + redirect: manual + timeout)
  - M7: sendMessage 多轮对话走前端 history 方案
  - m1-m8: 路径前缀统一 / ProtocolFamily 类型 / mcp 能力脚注 / adapterKind 字段 / endpoint 示例 / KAG KB 路径 / 向导状态机 / R6-Principle IV 联动

---

## 十八、待办

- [ ] 细化 `tasks.md`(Phase A1/A2/A3 + B + C + D 任务分解,含验收用例)
- [ ] Phase C 各后端协议 research(HERMES/KAG/AgentScope/intellect-community)
- [ ] §13.4 密钥管理实施前确认 KMS/Vault 集成方案
- [ ] SSRF 防护的 DNS rebinding 实施细节(生产环境建议用 socket.connect 校验 IP)
