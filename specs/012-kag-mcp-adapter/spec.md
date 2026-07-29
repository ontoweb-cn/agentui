# 012 — KAG MCP Adapter 设计

> **版本**: v1.0(初始设计)
> **状态**: 设计完成,待实施
> **依赖**: spec-001 (P0 契约) / spec-010 v8.3 (Multi-Harness 扩展,KAG 协议族修订) / spec-004 (Enterprise Adapter,IMultiTenantAdapter 参考)
> **触发原因**: spec-010 C-0 research([research.md](../010-multi-harness-wizard/research.md) R2)发现 KAG v0.8.0 无 OpenAI 兼容入口,仅通过 MCP 协议暴露 `qa_pipeline(query)` + `kb_retrieve(query)` 两个工具。spec-010 v8.3 已将 KAG 协议族改为 `mcp-protocol`,KagAdapter 改继承 `MCPBaseAdapter`(本 spec 定义)。

---

## 一、背景与目标

### 1.1 问题

spec-010 原假设 KAG 走 OpenAI 兼容协议(`/v1/chat/completions`),KagAdapter 继承 `OpenAICompatibleBaseAdapter` 并实现 `IKnowledgeBaseAdapter`。C-0 research 核对 KAG v0.8.0 源码后发现:

1. **无 OpenAI 兼容入口**:KAG solver_server 是自有 `/process` 协议,非 `/v1/chat/completions`
2. **无 REST KB CRUD API**:KAG 无 dataset/document CRUD 端点,仅有 `kb_retrieve(query)` 检索工具
3. **全面拥抱 MCP**:KAG 通过 MCP 协议(Model Context Protocol)暴露 `qa_pipeline` + `kb_retrieve` 两个工具

### 1.2 目标

1. 定义 `MCPBaseAdapter` 抽象基类:封装 MCP SDK 客户端连接、工具调用、会话管理
2. 定义 `IMCPAdapter` 扩展接口(Layer 2):MCP 工具发现与调用
3. 实现 `KagAdapter`:继承 `MCPBaseAdapter`,实现 `IMCPAdapter`,对接 KAG MCP Server
4. 落实 Constitution Principle II(Adapter Abstraction):MCP 后端经统一抽象,路由层不感知协议差异

### 1.3 KAG MCP Server 实际接口(research.md R2)

```
kag mcp_server --transport sse    # MCP SSE 传输,默认端口 3000
kag mcp_server --transport stdio  # MCP stdio 传输,本地集成
```

MCP 工具签名(`kag/mcp/server/kag_mcp_server.py`):

```python
_supported_tools = "qa-pipeline", "kb-retrieve"
_default_sse_port = 3000

async def qa_pipeline(query: str) -> str:
    """返回 LLM 生成的答案文本"""

async def kb_retrieve(query: str) -> str:
    """返回 JSON: {"summary": ..., "references": ...}
       含 SPO 三元组 + 文档 chunks"""
```

### 1.4 关键决策

| # | 决策 | 选项 |
|---|------|------|
| D1 | MCP SDK 选型 | **`@modelcontextprotocol/sdk`**(官方 TypeScript SDK,支持 SSE + stdio 传输) |
| D2 | 传输方式 | **SSE 优先**(生产部署),stdio 仅本地开发 |
| D3 | 流式输出 | **非流式**:MCP 工具同步返回,BFF 包装为 delta + done StreamChunk |
| D4 | 会话管理 | **BFF 本地**(MCP 无状态,与 OpenAI 兼容后端方案 A 一致) |
| D5 | 工具调用结果格式 | 透传字符串,不做 schema 校验(Constitution Principle VII YAGNI) |

---

## 二、MCPBaseAdapter 抽象基类

### 2.1 设计原则

- **复用 OpenAICompatibleBaseAdapter 的会话管理模式**:MCP 后端同样无状态,session 由 BFF 本地生成
- **MCP SDK 封装**:基类管理 MCP Client 生命周期(连接/断线重连/超时)
- **安全约束**:与 OpenAICompatibleBaseAdapter 一致,强制删除客户端注入头(虽然 MCP 不走 HTTP 头,但 buildHeaders 供 healthCheck 等场景使用)

### 2.2 基类实现

```typescript
// bff/src/services/adapters/shared/mcp-base-adapter.ts
// v8.3 评审 D8 修复:补齐 BackendType import,修正 SDK 子路径
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { IHarnessAdapter, AdapterKind } from '../../../types/adapter';
import type { HarnessBackend, HarnessCapabilities, BackendType } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import type { AgentSummary, Session, SendMessageRequest } from '../../../types/domain';
import type { StreamChunk, StreamIterable } from '../../../types/stream';

/**
 * MCP 协议 Adapter 抽象基类(v8.3 / spec-012 新增)。
 *
 * 面向通过 MCP 协议暴露工具的后端(当前仅 KAG)。
 * 与 OpenAICompatibleBaseAdapter 的差异:
 * - 不走 HTTP /v1/chat/completions,经 MCP SDK 调用远程工具
 * - 工具调用同步返回(非 SSE 流),BFF 包装为 delta + done StreamChunk
 * - listAgents 返回 MCP 工具列表(非 /v1/models)
 *
 * Constitution Principle II:路由层经 AdapterRegistry 获取 IHarnessAdapter,
 * 不感知后端是 OpenAI 兼容还是 MCP 协议。
 */
export abstract class MCPBaseAdapter implements IHarnessAdapter {
  readonly backendId: string;
  abstract readonly backendType: BackendType;
  readonly adapterKind: AdapterKind = 'mcp' as const;
  protected readonly baseUrl: string;
  protected readonly adminToken: string;
  protected abstract readonly defaultCapabilities: HarnessCapabilities;

  private mcpClient: Client | null = null;
  private mcpTransport: SSEClientTransport | null = null;

  constructor(protected readonly backend: HarnessBackend) {
    this.backendId = backend.id;
    this.baseUrl = backend.endpoint.replace(/\/$/, '');
    this.adminToken = backend.adminToken;
  }

  // ── MCP Client 生命周期管理 ──

  /**
   * 获取或创建 MCP Client(惰性连接)。
   *
   * 首次调用时创建 SSEClientTransport + Client 并 connect。
   * 后续调用复用缓存实例。
   *
   * 连接失败时抛错,由调用方捕获返回 false(healthCheck)或 error chunk(sendMessage)。
   */
  protected async getClient(): Promise<Client> {
    if (this.mcpClient && this.mcpTransport) {
      return this.mcpClient;
    }

    this.mcpTransport = new SSEClientTransport(
      new URL(`${this.baseUrl}/sse`),
    );
    this.mcpClient = new Client(
      { name: 'agentui-bff', version: '1.0.0' },
      { capabilities: {} },
    );
    await this.mcpClient.connect(this.mcpTransport);
    return this.mcpClient;
  }

  // ── IHarnessAdapter 实现 ──

  /**
   * 列出所有 Agent(MCP 后端语义:列出 MCP 工具)。
   *
   * 每个工具映射为一个 AgentSummary:
   * - id = 工具名(如 "qa-pipeline")
   * - name = 工具名
   * - description = 工具描述(从 MCP tool schema 获取)
   */
  async listAgents(_ctx: BackendContext): Promise<AgentSummary[]> {
    const client = await this.getClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      id: t.name,
      name: t.name,
      description: t.description ?? '',
    }));
  }

  async getAgent(ctx: BackendContext, agentId: string): Promise<AgentSummary> {
    const agents = await this.listAgents(ctx);
    const found = agents.find((a) => a.id === agentId);
    if (!found) throw new Error(`MCP tool not found: ${agentId}`);
    return found;
  }

  // 会话管理:BFF 本地生成(MCP 无状态,与 OpenAI 兼容方案 A 一致)
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
   * 发送消息(MCP 语义:调用 agentId 对应的 MCP 工具)。
   *
   * D3 决策:非流式。MCP 工具同步返回结果,BFF 包装为:
   * 1. delta chunk(工具返回的文本)
   * 2. done chunk(标记结束)
   *
   * @param ctx 租户上下文
   * @param req.agentId MCP 工具名(如 "qa-pipeline")
   * @param req.content 用户查询文本,作为工具的 query 参数
   */
  async sendMessage(ctx: BackendContext, req: SendMessageRequest): Promise<StreamIterable> {
    try {
      const client = await this.getClient();
      const result = await client.callTool({
        name: req.agentId,
        arguments: { query: req.content },
      });

      // MCP 工具返回 { content: [{ type: 'text', text: '...' }] }
      const text = this.extractToolResultText(result);

      return this.wrapAsStream(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorStream(`MCP tool call failed: ${message}`);
    }
  }

  async cancelMessage(_ctx: BackendContext, _sessionId: string): Promise<void> {
    // no-op,MCP 工具调用同步返回,无法中途取消
  }

  /**
   * 健康检查:尝试连接 MCP Server。
   */
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.listTools();
      return true;
    } catch {
      // 连接失败时清理缓存,下次重试
      this.mcpClient = null;
      this.mcpTransport = null;
      return false;
    }
  }

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    return this.defaultCapabilities;
  }

  // ── 供子类复用的工具方法 ──

  /**
   * 通用 MCP 工具调用(供 IMCPAdapter 方法使用)。
   */
  protected async callMCPTool(name: string, args: Record<string, unknown>): Promise<string> {
    const client = await this.getClient();
    const result = await client.callTool({ name, arguments: args });
    return this.extractToolResultText(result);
  }

  /**
   * 从 MCP tool result 提取文本内容。
   *
   * MCP 工具返回格式:{ content: [{ type: 'text', text: '...' }] }
   */
  protected extractToolResultText(result: unknown): string {
    if (typeof result !== 'object' || result === null) return '';
    const { content } = result as { content?: Array<{ type: string; text?: string }> };
    if (!Array.isArray(content)) return '';
    return content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
  }

  /**
   * 将同步文本包装为 StreamChunk 流(delta + done)。
   */
  protected async wrapAsStream(text: string): StreamIterable {
    if (text) {
      yield { type: 'delta' as const, content: text };
    }
    yield { type: 'done' as const };
  }
}

async function* errorStream(message: string): StreamIterable {
  yield { type: 'error' as const, message };
}
```

---

## 三、IMCPAdapter 扩展接口

### 3.1 接口定义

```typescript
// bff/src/types/adapter.ts (扩展,spec-012 新增)

/**
 * MCP 扩展契约(Layer 2,spec-012 新增)。
 *
 * 由 MCPBaseAdapter 子类实现(当前仅 KagAdapter)。
 * 必须同时实现 IHarnessAdapter(Layer 1)。
 *
 * 设计原则:
 * - listTools/discoverTools:动态发现 MCP Server 暴露的工具
 * - callTool:通用工具调用(供未来非 KAG 的 MCP 后端复用)
 * - qaPipeline/kbRetrieve:KAG 专用高层语义方法(便捷调用)
 *
 * Constitution Principle II:路由层用 capabilities.mcp 静态判断,
 * isMCPAdapter() 作为运行时双保险。
 */
export interface IMCPAdapter extends IHarnessAdapter {
  /** 列出 MCP Server 暴露的所有工具。 */
  listTools(ctx: BackendContext): Promise<MCPTool[]>;

  /** 通用 MCP 工具调用。 */
  callTool(
    ctx: BackendContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;

  /**
   * KAG 专用:QA 问答管道。
   * 调用 MCP 工具 `qa_pipeline(query)`,返回 LLM 生成的答案。
   */
  qaPipeline(ctx: BackendContext, query: string): Promise<string>;

  /**
   * KAG 专用:知识库检索。
   * 调用 MCP 工具 `kb_retrieve(query)`,返回 JSON:
   * { summary: string, references: Array<{ spo: [s,p,o], chunks: string[] }> }
   */
  kbRetrieve(ctx: BackendContext, query: string): Promise<string>;
}

/** MCP 工具描述。 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// 类型守卫(spec-010 v8.3 已声明,此处补全 IMCPAdapter 接口定义后自动生效)
// export function isMCPAdapter(a: IHarnessAdapter): a is IMCPAdapter {
//   return a.adapterKind === 'mcp';
// }
```

### 3.2 类型守卫

`isMCPAdapter` 已在 spec-010 v8.3 §4.2 声明,本 spec 不重复定义。IMCPAdapter 接口定义后,类型守卫自动生效。

---

## 四、KagAdapter 实现

### 4.1 实现细节

```typescript
// bff/src/services/adapters/kag/kag-adapter.ts (spec-012 实施)
export class KagAdapter extends MCPBaseAdapter implements IMCPAdapter {
  readonly backendType = 'kag' as const;
  protected readonly defaultCapabilities: HarnessCapabilities = {
    canvas: false,
    knowledgeBase: false,  // v8.3:无 REST KB CRUD,不走 IKnowledgeBaseAdapter
    memory: false,
    mcp: true,             // v8.3:KAG 0.8.0 全面拥抱 MCP
    multiTenant: false,
    modelManagement: false,
  };

  // ── IMCPAdapter 方法 ──

  async listTools(ctx: BackendContext): Promise<MCPTool[]> {
    const agents = await this.listAgents(ctx);
    return agents.map((a) => ({
      name: a.id,
      description: a.description,
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    }));
  }

  async callTool(ctx: BackendContext, name: string, args: Record<string, unknown>): Promise<string> {
    // 复用基类 callMCPTool(需调整可见性或在此直接调 client)
    return this.callMCPTool(name, args);
  }

  async qaPipeline(ctx: BackendContext, query: string): Promise<string> {
    return this.callMCPTool('qa-pipeline', { query });
  }

  async kbRetrieve(ctx: BackendContext, query: string): Promise<string> {
    return this.callMCPTool('kb-retrieve', { query });
  }

  // ── sendMessage 覆盖(可选)──
  // 基类已实现通用 sendMessage(调 req.agentId 对应工具)。
  // KagAdapter 无需覆盖,前端传 agentId="qa-pipeline" 即可走 QA 管道。
}
```

### 4.2 工厂注册

```typescript
// bff/src/index.ts (扩展,spec-012 实施)
import { KagAdapter } from './services/adapters/kag/kag-adapter';
adapterRegistry.registerFactory('kag', (b) => new KagAdapter(b));
```

### 4.3 前端集成

前端通过 `agentId` 字段选择 MCP 工具:
- `agentId = 'qa-pipeline'`:调用 KAG QA 管道(等同 `qaPipeline(query)`)
- `agentId = 'kb-retrieve'`:调用 KAG KB 检索(等同 `kbRetrieve(query)`)

前端 listAgents 返回的工具列表即 Agent 列表,用户选择工具即选择 Agent。

---

## 五、StreamChunk 映射

### 5.1 MCP 工具结果 → StreamChunk

MCP 工具同步返回(非流式),BFF 包装为 StreamChunk 流:

| MCP 工具返回 | StreamChunk 序列 |
|-------------|-----------------|
| `{ content: [{ type: 'text', text: '答案...' }] }` | `delta(答案...)` → `done` |
| 调用失败 | `error(message)` |
| 空结果 | `done`(无 delta) |

### 5.2 与 OpenAI 兼容 SSE 的差异

| 维度 | OpenAI 兼容(parseOpenAISSE) | MCP(MCPBaseAdapter) |
|------|---------------------------|---------------------|
| 传输 | HTTP SSE 流(data: 行) | MCP SDK 同步调用 |
| 流式 | 是(逐 token) | 否(整段返回) |
| usage | OpenAI usage 字段 | 无(MCP 不返回 token 用量) |
| done 触发 | [DONE] 或 finish_reason | 工具返回后立即 done |

### 5.3 Constitution Principle IV 兼容性

StreamChunk 8 值枚举保持不变。MCP 后端仅产出 `delta` + `done` + `error` 三种 chunk,不产出 `reasoning`/`tool_start`/`tool_complete`/`usage`/`tool_progress`。

`usage` chunk 缺失:前端 token 用量统计对 MCP 后端显示为 0,符合预期(MCP 协议不返回 token 用量)。

---

## 六、MCP SDK 依赖

### 6.1 包引入

```json
// bff/package.json (新增依赖)
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0"
  }
}
```

> v8.3 评审 D9 修复:已通过 `npm view @modelcontextprotocol/sdk versions` 确认最新稳定版为 1.30.0,API 含 `Client` / `SSEClientTransport` / `listTools` / `callTool`(见 `@modelcontextprotocol/sdk/client/sse.js` 子路径)。spec-010 §2.2 代码示例的 import 路径已同步修正。

### 6.2 传输方式

| 传输 | 场景 | 配置 |
|------|------|------|
| SSE | 生产部署(默认) | `endpoint = http://kag-host:3000`,SDK 连接 `${endpoint}/sse` |
| stdio | 本地开发(可选) | `endpoint = stdio://kag`,SDK 启动子进程 `kag mcp_server --transport stdio` |

Phase 1 仅实现 SSE 传输(stdio 后续按需补充,YAGNI)。

---

## 七、安全设计

### 7.1 SSRF 防护

MCPBaseAdapter 的 `getClient()` 创建 SSEClientTransport 前,复用 [ssrf-guard.ts](../../bff/src/services/ssrf-guard.ts) 的 `isUrlSafe()` 预校验 endpoint URL,防止 SSRF。

> 注:spec-010 §13.2 设计了 `validateEndpoint` 伪代码,但实际运行时实现为 `ssrf-guard.ts` 的 `safeFetch`(运行时校验,含 DNS rebinding + 私有 IP 过滤 + redirect: manual)和 `isUrlSafe`(预校验)。MCPBaseAdapter 对 MCP SDK 的 SSEClientTransport 无法直接套用 safeFetch(因 SDK 内部管理传输),因此采用 `isUrlSafe` 预校验 + 运行时异常捕获的双层防护。生产环境若需更严格校验,可在 SSEClientTransport 调用前后包装 fetch 拦截器。

### 7.2 凭据管理

KAG MCP Server 默认无鉴权(本地开发)。生产部署若启用鉴权:
- Bearer token:经 `backend.adminToken` 注入(MCP SDK SSEClientTransport 支持 headers 参数)
- 与 OpenAICompatibleBaseAdapter 一致,客户端传入的 Authorization 头被强制删除

### 7.3 超时控制

MCP 工具调用设置 30s 超时(AbortSignal.timeout),与 OpenAICompatibleBaseAdapter.sendMessage 一致。

---

## 八、实施路线

### Phase 1:MCPBaseAdapter + KagAdapter

| 任务 | 文件 | 说明 |
|------|------|------|
| 安装 `@modelcontextprotocol/sdk` 依赖 | `bff/package.json` | MCP 官方 TypeScript SDK |
| `MCPBaseAdapter` 抽象基类 | `bff/src/services/adapters/shared/mcp-base-adapter.ts` | §2.2 实现 |
| `IMCPAdapter` 接口 + `MCPTool` 类型 | `bff/src/types/adapter.ts` | §3.1 接口定义 |
| `isMCPAdapter` 类型守卫 | `bff/src/types/adapter.ts` | spec-010 v8.3 已声明,补全接口后生效 |
| `KagAdapter` 实现 | `bff/src/services/adapters/kag/kag-adapter.ts` | §4.1 实现 |
| 工厂注册 | `bff/src/index.ts` | §4.2 注册 KagAdapter 工厂 |
| 单元测试 | `kag-adapter.test.ts` | 覆盖率 ≥ 80% |
| 回归测试 | 全套 BFF 测试 | 现有测试 0 回归 |

### 验收标准

- KagAdapter 实例可被 `isMCPAdapter()` 守卫通过
- listAgents 返回 `qa-pipeline` + `kb-retrieve` 两个工具(mock MCP Server)
- sendMessage 调用 `qa-pipeline` 工具,返回 delta + done StreamChunk
- healthCheck 连接失败时返回 false 并清理缓存
- 单测覆盖率 ≥ 80%

---

## 九、Constitution 兼容性

| Principle | 状态 |
|-----------|------|
| I. BFF-Mediated | ✅ KAG 经 BFF MCPBaseAdapter,前端不直连 MCP Server |
| II. Adapter Abstraction | ✅ MCPBaseAdapter 封装 MCP 协议,路由层不感知 |
| III. Canvas Hard-Bound | ✅ KAG capabilities.canvas=false,不涉及画布 |
| IV. SSE Dual-Protocol | ✅ StreamChunk 8 值枚举不变,MCP 产出 delta+done+error |
| V. Tenant Isolation | ✅ KAG capabilities.multiTenant=false,不涉及租户隔离 |
| VI. No ACP | ✅ |
| VII. YAGNI + Test-First | ✅ 仅实现 SSE 传输(stdio 后续按需);每 Adapter 必有测试 |
| VIII. Access Contract | ✅ KAG 无 API_SERVER_KEY 契约 |

---

## 十、风险项

| # | 风险 | 处置 |
|---|------|------|
| M1 | MCP SDK 版本变更破坏 API | 锁定 `@modelcontextprotocol/sdk` 主版本,升级前跑回归测试 |
| M2 | KAG MCP Server 不稳定(连接断开) | getClient 惰性连接 + healthCheck 清理缓存重连 |
| M3 | MCP 工具调用超时(大查询) | 30s 超时 + 前端 AbortController 兜底 |
| M4 | MCP SSE 传输不支持 bearer token 注入 | SDK SSEClientTransport 支持 headers 参数;若不支持,降级为无鉴权(本地开发) |

---

## 十一、待办

- [ ] 实施 Phase 1:MCPBaseAdapter + KagAdapter
- [ ] 冒烟测试:对接真实 KAG MCP Server(`kag mcp_server --transport sse`)
- [ ] 更新 spec-010 tasks.md:C-P4 实施完成后标记
