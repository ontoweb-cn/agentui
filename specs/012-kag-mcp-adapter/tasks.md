# spec-012 KAG MCP Adapter 任务分解

> **版本**: v1.1(2026-07-30 评审修复后同步)
> **状态**: 设计完成,待实施
> **依赖**: spec-010 v8.3(C-P4 spec 修订完成) / spec-012 spec.md
> **执行顺序**: P1-1 → P1-2 → P1-3 → P1-4 → P1-5 → P1-6(回归)
> **验收原则**: 现有测试 0 回归,新增测试覆盖率 ≥ 80%
> **基线**: BFF 642 tests passed(评审修复后,2026-07-30)

---

## Phase 1:MCPBaseAdapter + KagAdapter

### P1-1:安装 MCP SDK 依赖

- [x] **任务**: 安装 `@modelcontextprotocol/sdk` TypeScript SDK
- [x] **文件**: `bff/package.json`
- [x] **实施细节**:
  - `cd bff && npm install @modelcontextprotocol/sdk`
  - 锁定主版本(`^1.30.0`,评审 D9 修复:已确认最新稳定版 1.30.0),避免 minor/patch 升级破坏 API
- [x] **验收**: `npm ls @modelcontextprotocol/sdk` 显示已安装,tsc 编译无错误

### P1-2:MCPBaseAdapter 抽象基类

- [x] **任务**: 实现 MCP 协议 Adapter 抽象基类
- [x] **文件**: `bff/src/services/adapters/shared/mcp-base-adapter.ts`
- [x] **实施细节**(对齐 spec-012 §2.2):
  - MCP Client 生命周期管理:惰性连接 + 缓存复用
  - listAgents:映射 MCP 工具为 AgentSummary
  - sendMessage:调用 MCP 工具,包装为 delta + done StreamChunk
  - healthCheck:listTools 探活,失败清理缓存
  - 会话管理:BFF 本地生成(MCP 无状态)
  - SSRF 防护:复用 `ssrf-guard.ts` 的 `isUrlSafe()` 预校验(评审 D3 修复:实际代码无 validateEndpoint)
  - 超时:30s(AbortSignal.timeout)
- [x] **验收**: 基类可被继承,抽象方法清晰

### P1-3:IMCPAdapter 接口 + MCPTool 类型

- [x] **任务**: 定义 MCP 扩展接口和工具描述类型
- [x] **文件**: `bff/src/types/adapter.ts`
- [x] **实施细节**(对齐 spec-012 §3.1):
  - `IMCPAdapter` 接口:listTools/callTool/qaPipeline/kbRetrieve
  - `MCPTool` 接口:name/description/inputSchema
  - `isMCPAdapter` 类型守卫(spec-010 v8.3 已声明,补全接口后生效)
  - `AdapterKind` 类型扩展 `'mcp'`(spec-010 v8.3 已声明)
- [x] **验收**: 接口编译通过,isMCPAdapter 守卫可用

### P1-4:KagAdapter 实现

- [x] **任务**: 实现 KAG 后端 Adapter
- [x] **文件**: `bff/src/services/adapters/kag/kag-adapter.ts`
- [x] **实施细节**(对齐 spec-012 §4.1):
  - 继承 `MCPBaseAdapter`,实现 `IMCPAdapter`
  - backendType = 'kag',adapterKind = 'mcp'
  - defaultCapabilities: { mcp: true, 其余 false }
  - qaPipeline:调用 MCP 工具 `qa-pipeline`
  - kbRetrieve:调用 MCP 工具 `kb-retrieve`
  - listTools:映射 listAgents 结果
  - callTool:复用基类 callMCPTool
- [x] **验收**: KagAdapter 实例可被 isMCPAdapter() 守卫通过

### P1-5:工厂注册 + 单元测试

- [x] **任务**: 注册 KAG 工厂 + 编写单测
- [x] **文件**:
  - `bff/src/index.ts`(工厂注册)
  - `bff/src/services/adapters/kag/kag-adapter.test.ts`(单测)
- [x] **实施细节**:
  - 工厂注册:`adapterRegistry.registerFactory('kag', (b) => new KagAdapter(b))`
  - Mock MCP Client(listTools/callTool 返回固定结果)
  - 测试覆盖:
    - constructor & backendId
    - listAgents 返回 qa-pipeline + kb-retrieve
    - sendMessage 调用工具返回 delta + done
    - qaPipeline / kbRetrieve 便捷方法
    - healthCheck 成功/失败场景(失败清理缓存)
    - isMCPAdapter 守卫
    - error 场景(工具调用失败 → error chunk)
- [x] **验收**: 单测覆盖率 ≥ 80%,全部通过

### P1-6:回归测试

- [x] **任务**: 全套 BFF 测试 0 回归
- [x] **命令**: `cd bff && npm test`
- [x] **验收**: 674/674 通过(基线 642 + 新增 32 KAG 测试),0 回归(2026-07-30)

---

## Phase 2:冒烟测试(可选,依赖 KAG 部署)

### P2-1:对接真实 KAG MCP Server

- [x] **任务**: 启动 KAG MCP Server,验证端到端
- [ ] **前置条件**: KAG v0.8.0 已部署,`kag mcp_server --transport sse` 可启动
- [ ] **验证项**:
  - healthCheck 返回 true
  - listAgents 返回 qa-pipeline + kb-retrieve
  - sendMessage(qa-pipeline) 返回 LLM 答案
  - sendMessage(kb-retrieve) 返回 JSON 检索结果
- [x] **验收**: 端到端流程通过

---

## 任务依赖关系

```
P1-1(SDK 安装)
    ↓
P1-2(MCPBaseAdapter) → P1-3(IMCPAdapter 接口)
                            ↓
                      P1-4(KagAdapter)
                            ↓
                      P1-5(工厂注册 + 单测)
                            ↓
                      P1-6(回归测试)
                            ↓
                 P2-1(冒烟测试,可选,依赖 KAG 部署)
```

---

## 风险项(对齐 spec-012 §十)

| # | 风险 | 影响 | 处置 |
|---|------|------|------|
| M1 | MCP SDK 版本变更破坏 API | P1-2/P1-4 | 锁定主版本,升级前跑回归 |
| M2 | KAG MCP Server 不稳定 | P2-1 | getClient 惰性连接 + healthCheck 清理重连 |
| M3 | MCP 工具调用超时 | P1-2 | 30s 超时 + 前端 AbortController 兜底 |
| M4 | MCP SSE 不支持 bearer token | P1-2 | SDK 支持 headers;不支持则降级无鉴权 |
