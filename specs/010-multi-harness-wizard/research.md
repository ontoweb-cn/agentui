# spec-010 Phase C 前置 Research

> **版本**: v1.0（2026-07-30 完成）
> **范围**: R1 HERMES/AgentScope 协议 + R2 KAG KB API + R3 intellect-community 默认端口
> **目的**: 为 Phase C（C-P1~C-P4）四类新后端 Adapter 实现提供协议契约依据
> **方法**: GitHub 仓库源码核对 + 官方文档 + 第三方部署指南交叉验证

---

## 一、R1: HERMES 与 AgentScope 协议

### 1.1 HERMES（Nous Research Hermes Agent）

| 字段 | 值 | 来源 |
|------|----|----|
| 项目 | github.com/NousResearch/hermes-agent | [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) |
| 协议 | OpenAI-compatible API Server | 项目 README + 多个第三方部署指南 |
| **默认端口** | **8642**（API Server） + 9119（监控/metrics） | Docker compose `ports: "8642:8642", "9119:9119"` |
| 鉴权 | Bearer token，`Authorization: Bearer <key>` | 与 spec §3.3 一致 |
| SSE 格式 | OpenAI Chat Completions 标准 `choices[0].delta.content` | OpenAI 兼容 |
| 工具调用 | OpenAI function calling（mcp=true 依据） | OpenAI 兼容 |
| 端点 | `POST /v1/chat/completions`、`GET /v1/models`、`GET /health` | OpenAI 兼容 |

**关键结论**：
- HERMES 默认端口 **8642 与 intellect-enterprise 冲突**（intellect-team `.plans/openai-api-server.md` L204 同样为 8642）。
- 两者协议完全相同（OpenAI 兼容 + Bearer），Adapter 实现可完全复用 `OpenAICompatibleBaseAdapter`。
- 端口冲突在实际部署中通过用户配置不同端口解决，spec §3.1 端口列写"任意"可保留，但建议在 quickstart 中提示"默认 8642 与 intellect-enterprise 冲突，部署时需修改"。

### 1.2 AgentScope

| 字段 | 值 | 来源 |
|------|----|----|
| 项目 | github.com/modelscope/agentscope | AgentScope 官方文档 |
| 协议 | OpenAI-compatible API Server | 默认开启 |
| **默认端口** | **5000** | AgentScope 默认 `http://127.0.0.1:5000` |
| 鉴权 | Bearer token（可选，本地开发默认无鉴权） | — |
| SSE 格式 | OpenAI 标准 | OpenAI 兼容 |
| 工具调用 | OpenAI function calling | OpenAI 兼容 |

**关键结论**：
- AgentScope 默认端口 5000 不与现有后端冲突。
- 协议完全 OpenAI 兼容，Adapter 可继承 `OpenAICompatibleBaseAdapter`。
- 注意：本地开发模式默认无鉴权，生产部署需用户主动配置 Bearer token。

### 1.3 R1 对 spec 的影响

- spec §3.1 表格 `hermes` / `agent-scope` 的"端口"列由"任意"明确为"任意（hermes 默认 8642，agent-scope 默认 5000）"。
- spec §3.2 能力矩阵 `hermes.mcp=true` / `agent-scope.mcp=true` 依据确认（基于 OpenAI function calling）。
- spec §3.3 鉴权表 Bearer token 确认。
- **无需修订接口设计**：C-P2/C-P3 直接继承 `OpenAICompatibleBaseAdapter` 即可。

---

## 二、R2: KAG KB API（重大设计偏差发现）

### 2.1 KAG 项目结构核对

通过 GitHub API + raw 源码核对 KAG v0.8.0（`KAG_VERSION` 文件确认）：

```
kag/
├── bin/commands/           # CLI 子命令
│   ├── benchmark.py
│   ├── builder.py
│   ├── info.py
│   └── mcp_server.py       # 仅 MCP server 启动命令
├── bridge/
│   └── spg_server_bridge.py # 内部桥接器（不暴露 HTTP）
├── solver/
│   └── server/
│       └── main_server.py  # FastAPI，仅 /process 端点（自有协议）
└── mcp/
    └── server/
        └── kag_mcp_server.py # MCP 协议入口
```

### 2.2 KAG 实际暴露的接口

| 入口 | 协议 | 端点/工具 | 用途 |
|------|------|-----------|------|
| `kag solver_server`（若启动） | HTTP（自有） | `POST /process` | 异步任务提交（cmd=submit/query） |
| `kag mcp_server --transport sse` | MCP SSE | tools: `qa_pipeline(query)`, `kb_retrieve(query)` | QA + KB 检索 |
| `kag mcp_server --transport stdio` | MCP stdio | 同上 | 本地集成 |

**MCP Server 关键参数**（`kag_mcp_server.py` L20-22）：
```python
_supported_tools = "qa-pipeline", "kb-retrieve"
_default_server_name = "kag"
_default_sse_port = 3000
```

**MCP 工具签名**：
```python
async def qa_pipeline(query: str) -> str
    # 返回 LLM 生成的答案

async def kb_retrieve(query: str) -> str
    # 返回 JSON：{"summary": ..., "references": ...}
    # 含 SPO 三元组 + 文档 chunks
```

### 2.3 KAG 不支持的接口（与 spec §3.1/§3.2/§4.1 假设冲突）

| spec 假设 | 实际状态 | 影响 |
|----------|---------|------|
| §3.1: KAG 协议族 `openai-compatible` + `parseOpenAISSE` | ❌ **不存在 OpenAI 兼容 `/v1/chat/completions`** | KAG solver_server 是自有 `/process` 协议 |
| §3.2: `kag.knowledgeBase=true` 走 `IKnowledgeBaseAdapter` | ❌ **无 REST KB CRUD API** | 仅有 `kb_retrieve(query)` 检索工具 |
| §4.1: `KagAdapter` 继承 `OpenAICompatibleBaseAdapter` + 实现 `IKnowledgeBaseAdapter` | ❌ **基类假设错误** | OpenAI 兼容基类不适用 |
| §4.2: `IKnowledgeBaseAdapter.listDatasets/createDataset/uploadDocument` | ❌ **全部不支持** | KAG 无 dataset CRUD 概念 |

### 2.4 KAG 真实能力矩阵（建议修订）

| 能力 | spec 当前 | 实际 | 修订建议 |
|------|----------|------|---------|
| canvas | false | false | ✓ |
| knowledgeBase | **true** | **false**（无 CRUD）/ **true**（仅检索，需 MCP 通道） | 改为 `false`，或新增 `retrievalOnly=true` 字段 |
| memory | false | false | ✓ |
| mcp | false | **true**（KAG 0.8.0 全面拥抱 MCP） | 改为 `true` |
| multiTenant | false | false | ✓ |
| modelManagement | false | false | ✓ |

### 2.5 R2 对 spec 的影响（需修订）

**修订点 1（§3.1 协议族表）**：KAG 行从 `openai-compatible` 改为 `mcp-protocol`（新增协议族），或暂不实现 KAG（C-P4 推迟）。

**修订点 2（§3.2 能力矩阵）**：
- 选项 A（推荐）：`kag.knowledgeBase=false`, `kag.mcp=true`；C-P4 仅实现 Layer 1 + IMCPAdapter（若新增），不实现 IKnowledgeBaseAdapter
- 选项 B：保持 `knowledgeBase=true` 但语义改为"仅检索"，IKnowledgeBaseAdapter 新增 `retrieve(query)` 方法，CRUD 方法返回 NotSupported
- 选项 C：C-P4 推迟到后续 Phase，等 KAG 提供 REST API 或 AgentUI 新增 IMCPAdapter 接口

**修订点 3（§4.1 Adapter 架构）**：KagAdapter 不应继承 `OpenAICompatibleBaseAdapter`。若选选项 A，需新增 `MCPBaseAdapter` 抽象基类（通过 MCP SDK 调用远程工具）。

**修订点 4（§4.2 IKnowledgeBaseAdapter）**：m6 注脚"KAG KB 走 IKnowledgeBaseAdapter"需删除或改为"KAG KB 检索走 MCP 通道，不实现 IKnowledgeBaseAdapter"。

---

## 三、R3: intellect-community 默认端口

### 3.1 intellect-agent 项目核对

| 字段 | 值 | 来源 |
|------|----|----|
| 项目 | `intellect-agent`（社区版） | `/Users/simon/project/intellect-team` 本地仓库 |
| 协议 | OpenAI-compatible API Server | `gateway/platforms/api_server.py` 实际实现 |
| **默认端口** | **8642** | `.plans/openai-api-server.md` L204 + `scripts/setup_open_webui.sh` L35 `intellect_API_PORT="${intellect_API_PORT:-8642}"` |
| 鉴权 | Bearer token，`API_SERVER_KEY` env var | 与 spec §3.3 一致 |
| SSE 格式 | OpenAI 标准 | OpenAI 兼容 |
| 端点 | `POST /v1/chat/completions`、`POST /v1/responses`、`GET /v1/models`、`GET /health` | `gateway/platforms/api_server.py` |
| macOS 特例 | macOS 不支持 setcap，gateway defaults to port 8080 | `scripts/install-release-macos.sh` L103 |

### 3.2 与 intellect-enterprise 的关系

- `intellect-community` 与 `intellect-enterprise` **同源**于 intellect-agent 项目（同一仓库 `/Users/simon/project/intellect-team`）。
- `intellect-enterprise` 是企业版部署（启用 multiTenant + Team/Project + Rust Gateway），`intellect-community` 是社区版部署（纯 Agent 运行时，无 multiTenant）。
- 两者使用相同端口 8642 合理：实际部署中不会同时存在（同一 binary 不同配置）。

### 3.3 R3 对 spec 的影响

- spec §3.1 表格 `intellect-community` 端口列从"任意"改为"任意（默认 8642，与 intellect-enterprise 同源）"。
- spec §3.2 能力矩阵 `intellect-community` 全 false 确认（社区版无 canvas/KB/multiTenant）。
- **无需修订接口设计**：C-P1 直接继承 `OpenAICompatibleBaseAdapter`。

---

## 四、汇总：spec-010 修订建议

### 4.1 必须修订（Blocker，影响 C-P4 实现）

| # | 位置 | 当前 | 修订为 | 原因 |
|---|------|------|-------|------|
| M1 | §3.1 KAG 行 ProtocolFamily | `openai-compatible` | `mcp-protocol`（新增）或推迟 C-P4 | KAG 无 OpenAI 兼容入口 |
| M2 | §3.1 KAG 行 SSE 解析器 | `parseOpenAISSE` | `N/A`（MCP 协议无 SSE 解析） | 同上 |
| M3 | §3.2 KAG 行 knowledgeBase | `true` | `false`（推荐）或语义重定义 | KAG 无 KB CRUD API |
| M4 | §3.2 KAG 行 mcp | `false` | `true` | KAG 0.8.0 全面拥抱 MCP |
| M5 | §4.1 KagAdapter 继承 | `OpenAICompatibleBaseAdapter` | `MCPBaseAdapter`（新增）或推迟 | KAG 不走 OpenAI 协议 |
| M6 | §4.2 m6 注脚 | "KAG KB 走 IKnowledgeBaseAdapter" | 删除或改为"走 MCP 通道" | KAG 无 KB CRUD |

### 4.2 建议修订（非 Blocker，但影响用户体验）

| # | 位置 | 当前 | 修订为 | 原因 |
|---|------|------|-------|------|
| m1 | §3.1 intellect-community 端口 | 任意 | 任意（默认 8642，与 intellect-enterprise 同源） | R3 确认 |
| m2 | §3.1 hermes 端口 | 任意 | 任意（默认 8642，与 intellect-enterprise 冲突） | R1 确认 |
| m3 | §3.1 agent-scope 端口 | 任意 | 任意（默认 5000） | R1 确认 |
| m4 | §3.1 KAG 行 端口 | 任意 | 任意（MCP SSE 默认 3000；product UI 8887） | R2 确认 |

### 4.3 风险表更新（spec §16 / tasks.md 风险表）

| # | 风险 | 处置 |
|---|------|------|
| R1 | HERMES/KAG/AgentScope 特殊请求头未确认 | ✅ **已解决**：HERMES/AgentScope 用标准 Bearer；KAG 用 MCP（无 HTTP 头） |
| R2 | KAG KB API 端点格式未确认 | ✅ **已解决**：KAG 无 REST KB API，仅 MCP 工具 `kb_retrieve(query)`；需修订 spec §3.2/§4.1（见 4.1 M3-M6） |
| R3 | intellect-community 默认端口未确认 | ✅ **已解决**：默认 8642，与 intellect-enterprise 同源 |

### 4.4 新增风险

| # | 风险 | 影响 Phase | 处置 |
|---|------|-----------|------|
| R11 | KAG 协议族分类错误（spec §3.1 假设 OpenAI 兼容，实际 MCP） | C-P4 | **C-P4 实施前必须修订 spec**：选项 A（推荐）/B/C 见 §2.5 |
| R12 | HERMES 默认端口与 intellect-enterprise 冲突（均 8642） | C-P2 | quickstart 提示用户修改端口；spec §3.1 注明默认值 |
| R13 | intellect-community 与 intellect-enterprise 同源同端口 | C-P1 | spec §3.1 注明"同源，不会同时部署"；Admin 表单可加交叉校验 |

---

## 五、C-P1~C-P4 实施路径建议

### 5.1 C-P1: IntellectCommunityAdapter（无 Blocker）

- 直接继承 `OpenAICompatibleBaseAdapter`
- 默认 endpoint: `http://127.0.0.1:8642`
- 鉴权: Bearer token via `API_SERVER_KEY`
- 协议族: `openai-compatible`
- 工时: ~0.5 人日

### 5.2 C-P2: HermesAdapter（无 Blocker）

- 直接继承 `OpenAICompatibleBaseAdapter`
- 默认 endpoint: `http://127.0.0.1:8642`（quickstart 提示冲突）
- 鉴权: Bearer token
- 协议族: `openai-compatible`
- 工时: ~0.5 人日

### 5.3 C-P3: AgentScopeAdapter（无 Blocker）

- 直接继承 `OpenAICompatibleBaseAdapter`
- 默认 endpoint: `http://127.0.0.1:5000`
- 鉴权: Bearer token（可选，本地开发可无鉴权）
- 协议族: `openai-compatible`
- 工时: ~0.5 人日

### 5.4 C-P4: KagAdapter（**Blocker：需先修订 spec**）

**推荐方案：选项 A（C-P4 暂缓 + spec 修订）**

理由：
1. KAG 协议与 spec 假设偏差大（MCP vs OpenAI 兼容）
2. 新增 `MCPBaseAdapter` 抽象基类 + `IMCPAdapter` 接口属于跨 Phase 设计变更，应单独 spec
3. C-P1/C-P2/C-P3 可独立交付，不阻塞

**若选选项 A 的执行路径**：
1. 先修订 spec-010 §3.1/§3.2/§4.1/§4.2（M1-M6）
2. 新建 spec-012（KAG MCP Adapter 设计）
3. C-P4 推迟到 spec-012 完成后

**若选选项 B（保留 IKnowledgeBaseAdapter 语义扩展）**：
1. 修订 IKnowledgeBaseAdapter 接口新增 `retrieve(query): Promise<RetrieveResult>` 方法
2. KagAdapter 继承 `OpenAICompatibleBaseAdapter`（占位）+ 实现 `IKnowledgeBaseAdapter.retrieve`（通过 MCP SDK 调用 `kb_retrieve`）
3. CRUD 方法返回 `NotSupportedError`
4. 工时: ~2 人日

**若选选项 C（C-P4 完全推迟）**：
1. spec §3.2 KAG 行 `knowledgeBase=false`, `mcp=false`
2. C-P4 不在 Phase C 范围
3. 后续单独立项

---

## 六、执行顺序建议

按 tasks.md 依赖图 `C-P1, C-P2, C-P3, C-P4（可并行）`，但根据 R2 发现建议：

```
C-P1, C-P2, C-P3（并行，无 Blocker）
       ↓
    C-P4 spec 修订评审
       ↓
    C-P4 实施或推迟
```

**C-P1/C-P2/C-P3 可立即执行**：协议确认无偏差，直接继承 `OpenAICompatibleBaseAdapter`。
**C-P4 需先评审 spec 修订方案**（选项 A/B/C）后再实施。

---

## 七、引用

### R1 HERMES
- [NousResearch/hermes-agent GitHub](https://github.com/NousResearch/hermes-agent)
- 第三方部署指南（Docker compose ports: 8642, 9119）

### R1 AgentScope
- AgentScope 官方文档（默认端口 5000，OpenAI 兼容）

### R2 KAG
- [OpenSPG/KAG GitHub](https://github.com/OpenSPG/KAG) v0.8.0
- `kag/mcp/server/kag_mcp_server.py`（MCP 入口，默认 SSE 端口 3000）
- `kag/solver/server/main_server.py`（FastAPI `/process` 自有协议）
- `kag/bin/commands/`（CLI 子命令：benchmark/builder/info/mcp_server，无 api-server）
- `KAG_VERSION` = 0.8.0

### R3 intellect-community
- `/Users/simon/project/intellect-team`（intellect-agent 社区版本地仓库）
- `.plans/openai-api-server.md` L204 `port: 8642`
- `scripts/setup_open_webui.sh` L35 `intellect_API_PORT="${intellect_API_PORT:-8642}"`
- `gateway/platforms/api_server.py`（实际实现）
- `CLAUDE.md` L30 `OpenAI-compatible /v1/chat/completions`
