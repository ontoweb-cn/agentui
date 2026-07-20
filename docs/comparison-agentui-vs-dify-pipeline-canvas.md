# AgentUI DSL Pipeline 画布 vs Dify 画布 — 对比分析

> 分析日期: 2026-07-20
> 分析范围: AgentUI `packages/canvas-plugin/` + `bff/` vs Dify `web/app/components/workflow/` + `web/app/components/rag-pipeline/`

---

## 一、总体概览

| 维度 | AgentUI | Dify |
|------|---------|------|
| **画布类型** | 双画布: Agent 画布 (对话) + Dataflow 画布 (ETL Pipeline) | 双画布: App Workflow (支持 Chat/Workflow 双运行模式) + RAG Pipeline (ETL)。另有 Snippet 用于代码片段复用 |
| **目标用户** | 企业级 RAG 知识库构建者 | 通用 AI 应用开发者 |
| **技术栈** | React 18 + TypeScript + Vite 7 | Next.js + TypeScript |
| **画布库** | `@xyflow/react` v12.3.6 (最新) | `reactflow` v11.11.4 (`@reactflow/core`) |
| **代码总量** | ~338 文件, ~35,000 行 (canvas-plugin) | ~1,502 文件, ~215,000 行 (workflow 目录) |
| **插件化** | 是 — 独立 npm 包 `@agentui/canvas-plugin` | 否 — 紧密耦合在 web app 中 |

> **画布库注**: `reactflow` v11 和 `@xyflow/react` v12 是同一项目的前后两个大版本，v12 进行了品牌更名 (React Flow → xyflow) 并引入了 breaking API changes。两个项目使用的本质是同一画布库的不同代际。

---

## 二、架构对比

### 2.1 AgentUI — 插件化模块架构

```
src/features/canvas/manifest.ts         ← ModuleDefinition 注册入口
packages/canvas-plugin/src/              ← 独立画布插件包
  ├── editor/                            ← 主编辑器
  │   ├── index.tsx                      ← 顶层编排 (ReactFlowProvider + Header + Canvas)
  │   ├── store.ts                       ← Zustand store (~40+ actions)
  │   ├── context.ts                     ← 4 个 React Context
  │   ├── canvas/                        ← 画布渲染 + 自定义节点/边
  │   ├── hooks/                         ← 连接拖拽、节点增删、保存、运行等
  │   └── utils/dsl-bridge.ts           ← 核心 DSL ↔ Graph 双向转换
  └── index.ts                           ← 插件入口 (懒加载路由)

bff/src/services/canvas-service.ts       ← BFF 层 (Hono → IntellectRagAdapter)
```

**架构特点:**
- 画布作为独立插件包 (`@agentui/canvas-plugin`)，通过 `ModuleDefinition` 注册到主应用
- 路由懒加载: `/agent/:id`, `/agent/:id/explore`, `/agent/:id/share`
- BFF 层 (Hono) 代理后端请求，隔离前端与 Python 后端

### 2.2 Dify — 深度集成的组件架构

```
web/app/components/workflow/             ← 共享画布核心 (被所有画布复用)
  ├── index.tsx                          ← WorkflowWithDefaultContext (默认导出)
  ├── store/workflow/                    ← Zustand store (14 个 slice)
  ├── hooks/                             ← ~63 hooks
  ├── nodes/                             ← 节点渲染组件
  ├── operator/                          ← 画布操作栏
  └── utils/                             ← 工具函数 (初始化、布局、剪贴板等)

web/app/components/rag-pipeline/         ← RAG Pipeline (复用 workflow 核心)
  ├── index.tsx                          ← 注入 RAG store slice → 共享画布
  ├── store/index.ts                     ← RAG 专用 Zustand slice
  └── hooks/                             ← RAG 专用 hooks

web/app/components/workflow-app/         ← App Workflow 包装层
```

**架构特点:**
- 共享画布核心 (`WorkflowWithDefaultContext`) 被多种画布类型复用
- 通过 Zustand store slice 注入实现差异化 (RAG pipeline 注入 `createRagPipelineSliceSlice`)
- `FlowType` 枚举区分画布类型 (`appFlow`、`ragPipeline`、`snippet`)。Chat 模式是 `appFlow` 下的运行模式而非独立画布
- 无独立 BFF 层; Next.js API routes 直接处理后端通信

### 2.3 架构差异总结

| 方面 | AgentUI | Dify |
|------|---------|------|
| **模块化程度** | 高 — 独立插件包，通过 manifest 注册 | 中 — 共享核心，通过 store slice 扩展 |
| **前后端分层** | BFF (Hono) → IntellectRagAdapter → Python 后端 | Next.js API → Python 后端 |
| **画布复用方式** | 双画布共享同一 canvas-plugin，通过 `canvas_category` 区分 | 三种画布共享 Workflow 核心，通过 store slice 注入 |
| **代码耦合度** | 低 — 画布可独立开发/测试/版本管理 | 高 — 画布与 web app 在同一代码库中 |

---

## 三、状态管理对比

### 3.1 AgentUI

- **Store**: 单一 Zustand store (`useGraphStore`)，内置 immer + devtools
- **Action 数量**: ~40+ action (节点/边/表单/选择/工具)
- **状态持久化**: 无本地持久化; 通过 `graphToDsl` 转换后保存到后端
- **撤销/重做**: **不支持**
- **自动保存**: `useDebounceEffect` (20s) → `graphToDsl` → `setAgent` API

### 3.2 Dify

- **Store**: Zustand store 分为 **14 个 slice**，使用 **zundo** (temporal middleware) 实现撤销/重做
- **历史系统**: 独立的 `workflowHistoryStore`，支持 16 种历史事件类型 (NodeDragStop, NodeConnect, NodePaste, NodeDelete 等)
- **撤销/重做**: **完整支持** — `Ctrl+Z` / `Ctrl+Shift+Z`
- **自动保存**: `useNodesSyncDraft` 使用 debounce + beforeunload + visibility change 多种触发策略
- **实时协作**: **支持** — CRDT-based (loro-crdt) + WebSocket + 共享光标

### 3.3 状态管理差异总结

| 方面 | AgentUI | Dify |
|------|---------|------|
| Store 结构 | 单一 store (~40+ actions) | 14 slice 组合 store |
| 撤销/重做 | ❌ | ✅ zundo temporal middleware |
| 自动保存策略 | 20s debounce | debounce + beforeunload + visibility |
| 实时协作 | ❌ | ✅ loro-crdt + WebSocket |
| 草稿同步 | 手动保存为主 | 自动草稿同步 |

---

## 四、节点/算子类型对比

### 4.1 AgentUI — Operator 枚举 (40+ 算子)

```
Agent 画布核心:
  Begin, Retrieval, RewriteQuestion, Message, Generate
  Categorize (分类路由), Switch (条件分支)
  Code (Python/JS), Agent (子代理), Tool (工具调用)
  Iteration/IterationStart, Loop/LoopStart/ExitLoop
  Invoke (HTTP调用), Crawler, Browser
  搜索引擎: DuckDuckGo, Wikipedia, PubMed, ArXiv, Google, Bing, GoogleScholar, TavilySearch, SearXNG
  数据操作: DataOperations, ListOperations, VariableAssigner, VariableAggregator
  其他: WaitingDialogue, UserFillUp, Email, WenCai, YahooFinance, ExcelProcessor

Dataflow Pipeline (ETL):
  File (数据源输入), Parser (文档解析), Tokenizer (分词)
  TokenChunker (Token级分块), TitleChunker (标题级分块)
  Extractor (特征提取), Note (备注)
```

### 4.2 Dify — BlockEnum (~29 种节点)

```
通用 Workflow:
  Start, LLM, KnowledgeRetrieval, QuestionClassifier
  IfElse, Code, TemplateTransform, HttpRequest, Tool
  ParameterExtractor, DocExtractor, ListFilter
  VariableAssigner/VariableAggregator, Assigner
  Agent/AgentV2, HumanInput, End
  Iteration/IterationStart, Loop/LoopStart/LoopEnd

触发器节点:
  TriggerSchedule, TriggerWebhook, TriggerPlugin

RAG Pipeline 专用:
  DataSource (多数据源接入), DataSourceEmpty (占位)
  KnowledgeBase (知识库入库)
```

### 4.3 节点类型差异分析

| 维度 | AgentUI | Dify |
|------|---------|------|
| **搜索引擎集成** | 12 种内置搜索源 | 通过 Tool/HttpRequest 实现 |
| **ETL 数据管道** | 专用 DataflowOperator (File→Parser→Chunker→Extractor) | RAG Pipeline 复用通用节点 + DataSource/KnowledgeBase |
| **触发器** | ❌ 无独立触发器类型 | ✅ Schedule/Webhook/Plugin 三种触发器 |
| **LLM 调用** | 嵌入在 Retrieval/Generate 节点中 | 独立 LLM 节点 + 模型配置面板 |
| **人工干预** | WaitingDialogue, UserFillUp | HumanInput (审批/输入节点) |
| **变量系统** | 全局变量 + 对话变量 | 环境变量 + 对话变量 + 系统变量 + ValueSelector |
| **节点总数** | 40+ 算子 (含数据操作和搜索引擎) | ~29 节点类型 (含触发器和容器) |

**关键差异**: AgentUI 的节点更偏向 **RAG 数据处理** (大量搜索引擎 + ETL pipeline)，Dify 的节点偏向 **通用 AI 应用构建** (触发器 + 人工干预 + 模块化 LLM 调用)。

### 4.4 ETL Pipeline 节点逐项对比

两种画布都提供了面向文档处理的 ETL Pipeline，但处理粒度不同:

| ETL 环节 | AgentUI (DataflowOperator) | Dify (RAG Pipeline) | 对比 |
|----------|---------------------------|---------------------|------|
| **数据接入** | `File` — 单文件上传 | `DataSource` — 多源插件体系 (本地文件、在线文档、网站爬取、云盘) | Dify 数据源更丰富 |
| **文档解析** | `Parser` — 内置 PDF/Office/图片/视频/音频/代码/Markdown/HTML | `DocExtractor` + DataSource 插件各自实现 | AgentUI 解析格式覆盖更全 |
| **文本分词** | `Tokenizer` — 独立分词节点，支持 Embedding/全文搜索方法 | 嵌入在 KnowledgeBase 节点配置中 | AgentUI 分词策略更灵活 |
| **文本分块** | `TokenChunker` (Token 级) + `TitleChunker` (标题/层级级) — 两种独立分块器 | KnowledgeBase 节点内通用分块参数 (chunk_size, chunk_overlap) | AgentUI 分块策略更专业 |
| **特征提取** | `Extractor` — 摘要/关键词/问题/元数据/TOC 等多维提取 | `LLM` / `ParameterExtractor` 通用节点 | AgentUI 提取维度更明确 |
| **入库** | Pipeline 终端隐式输出 | `KnowledgeBase` 节点 — 显式配置 top_k/score_threshold | Dify 入库配置更工程化 |
| **处理变量** | 全局变量 | RAG Pipeline Variables — 节点级/全局输入字段 (文本框/段落/下拉/数字/文件/复选框) | Dify 变量类型更丰富 |

> **结论**: 两者在 ETL 领域各有侧重 — AgentUI 在分块策略和文档格式解析上更专业，Dify 在数据源多样性和入库配置上更实用。不存在单方面领先。

---

## 五、数据模型与序列化对比

### 5.1 AgentUI — JSON DSL

**序列化方向**: Frontend → `graphToDsl()` → JSON → Backend

```typescript
interface DSL {
  components: Record<string, IOperator>;  // 执行拓扑 — Backend 读取此字段
  graph: IGraph;                          // 可视化布局 — 仅 Frontend 使用
  globals: Record<string, any>;           // 全局变量
  variables: Record<string, any>;         // 对话变量
  messages, history, path, reference, retrieval, answer; // 运行时字段
}
```

**关键机制:**
- `graphToDsl()`: 从 xyflow 状态重建 `components` (遍历节点边构建上下游关系)
- `dslToGraph()`: 从 `dsl.graph` 读取节点边用于渲染 (忽略 `components`)
- `importDsl()`/`exportDsl()`: JSON 文件导入导出
- **双向转换在客户端完成** — BFF 仅透传 JSON

### 5.2 Dify — YAML DSL + API 驱动的序列化

**序列化方向**: Frontend → `syncWorkflowDraft` API → Backend 保存 → Backend 生成 YAML

```typescript
// 前端只同步 graph 数据, DSL 导出由后端完成
interface FetchWorkflowDraftResponse {
  graph: { nodes: Node[], edges: Edge[], viewport?: Viewport };
  features, environment_variables, conversation_variables;
  hash: string;  // 版本 hash, 用于冲突检测
}
```

**关键机制:**
- DSL 导出: 前端调用 `exportAppConfig()` → **后端生成 YAML** → 下载 `.yml` 文件
- DSL 导入: 前端上传 YAML → `importDSL()` API → 后端解析 → 返回 graph 数据
- **序列化逻辑在后端** — 前端只负责 graph 的展示和编辑
- 支持版本检查和迁移 (`DSLImportStatus.PENDING` → Confirm)

### 5.3 序列化差异总结

| 方面 | AgentUI | Dify |
|------|---------|------|
| **DSL 格式** | JSON | YAML |
| **序列化位置** | 客户端 (`graphToDsl`) | 后端 API |
| **导入导出** | JSON 文件选择 → 客户端解析 | YAML 文件 → API 上传 → 服务端解析 |
| **版本迁移** | 无显式版本管理 | 版本 hash + 导入时版本兼容性检查 |
| **Graph 与 Components** | 分离: graph (UI) vs components (执行) | 统一: graph 直接对应执行拓扑 |

---

## 六、Pipeline 执行机制对比

### 6.1 AgentUI — Dataflow Pipeline 执行

```
触发: 用户点击 Run → 上传文件 → SSE 请求
流程: PUT /api/bff/canvas/:id (保存DSL)
     → POST /api/bff/agents/chat/completions (SSE流式执行)
     → GET /api/bff/canvas/:agentId/logs/:messageId (轮询日志)
     → 前端 Timeline 实时展示
```

**执行特点:**
- 以文件为输入，Pipeline 为 ETL 处理链
- SSE + 轮询双重机制获取状态
- `PipelineRunSheet` (文件上传) → `PipelineLogSheet` (实时日志) → `DataflowResult` (结果查看)
- 支持单组件重跑 (`useRerunDataflow`)
- 支持取消执行 (`POST /api/bff/canvas/tasks/:taskId/cancel`)

### 6.2 Dify — Workflow 执行

```
触发: 用户点击 Run → 输入变量 → SSE 请求
流程: POST /workflows/run (SSE流式执行)
     → SSE 事件流: workflow_started → node_started → ...
     → node_finished → workflow_finished
     → 前端节点状态实时变色/动画
```

**执行特点:**
- 支持多种输入: 变量输入 / 文件 / API 触发 / 定时 / Webhook
- 纯 SSE 事件流 (无轮询) — 20 种事件类型
- 节点级实时状态可视化 (边框颜色、进度动画、边颜色)
- 支持单节点调试运行 (`singleNodeRun` API)
- 支持 HumanInput 节点处暂停等待人工输入 (`workflow_paused`)
- 支持迭代内并行执行 (`iterParallelLogMap`)

### 6.3 执行机制差异总结

| 方面 | AgentUI | Dify |
|------|---------|------|
| **执行触发** | Run 按钮 (文件必选) | Run 按钮 / API / 定时 / Webhook |
| **流式协议** | SSE + 轮询 (双通道) | 纯 SSE (20 种事件类型) |
| **实时可视化** | Timeline 进度条 + 日志文本 | 节点边框动画 + 边着色 + 进度点 |
| **并行迭代** | ❌ (Iteration/Loop 容器存在，后端是否并行取决于实现) | ✅ `iterParallelLogMap` — 迭代内并行执行 |
| **人工干预暂停** | ✅ WaitingDialogue / UserFillUp (隐式等待) | ✅ HumanInput + SSE `workflow_paused` 事件 (显式暂停状态) |
| **用户主动暂停/恢复** | ❌ | ❌ |
| **单步调试** | ❌ (仅支持整组件重跑) | ✅ (Run This Step) |
| **触发模式** | 手动 + Webhook | 手动 + API + 定时 + Webhook + 插件 |
| **执行取消** | ✅ `cancelCurrentDataflow` | ✅ `stopWorkflowRun` |

---

## 七、交互体验对比

### 7.1 拖拽与连线

| 方面 | AgentUI | Dify |
|------|---------|------|
| **节点添加** | 连线拖拽到空白 → 弹出算子选择下拉菜单 | 连线拖拽到空白 → 弹出 + 按钮 → 节点选择面板 |
| **连线验证** | `useValidateConnection` (防自连、防循环、防非法上游) | `isValidConnection` (DFS 循环检测 + 节点规则) |
| **节点拖拽** | 标准 xyflow 拖拽 | 对齐辅助线 + 迭代/循环容器边界限制 |

### 7.2 节点编辑

| 方面 | AgentUI | Dify |
|------|---------|------|
| **编辑方式** | 右侧 `FormSheet` 抽屉 (按算子类型路由到对应表单) | 节点内联展开 + 底部 `Panel` 面板 |
| **节点复制** | `duplicateNode` + 剪贴板 (`agent:nodes` MIME) | 系统剪贴板 + 版本兼容性检查 |
| **节点删除** | 单独/级联 (迭代/Agent 子节点) + 确认对话框 | 级联删除 (迭代/Loop 子节点) + 确认对话框 |
| **节点切换** | ❌ | ✅ `handleNodeChange` (就地替换节点类型) |
| **备注** | NoteNode (画布自由文本) | 独立 Comment 系统 (线程+回复+解决) |

### 7.3 画布辅助功能

| 方面 | AgentUI | Dify |
|------|---------|------|
| **自动布局** | ❌ | ✅ ELK.js 分层布局 |
| **对齐辅助线** | ❌ | ✅ 拖拽时水平/垂直对齐捕捉 |
| **撤销/重做** | ❌ | ✅ zundo (Ctrl+Z / Ctrl+Shift+Z) |
| **键盘快捷键** | Delete/Backspace 删除 | 完整快捷键系统 (tanstack/react-hotkeys) |
| **暗色/亮色主题** | ✅ `colorMode={theme}` | ✅ (通过 CSS 变量) |
| **聚焦效果** | ✅ Spotlight 组件 | ❌ |
| **实时协作** | ❌ | ✅ CRDT + 共享光标 |
| **画布评论** | ❌ (仅 NoteNode) | ✅ Comment 系统 (线程/回复/解决) |

---

## 八、功能矩阵总览

| 功能 | AgentUI | Dify | 差距分析 |
|------|---------|------|----------|
| **画布渲染** | ✅ @xyflow/react v12 | ✅ reactflow v11 | AgentUI 版本更新 |
| **节点类型** | ✅ 40+ 算子 | ✅ ~29 节点 | AgentUI 偏向搜索/ETL，Dify 偏向通用 |
| **撤销/重做** | ❌ | ✅ zundo | **显著差距** |
| **自动布局** | ❌ | ✅ ELK.js | **显著差距** |
| **对齐辅助线** | ❌ | ✅ | 体验差距 |
| **实时协作** | ❌ | ✅ loro-crdt | **显著差距** |
| **画布评论** | ❌ (NoteNode) | ✅ Comment | 功能差异 |
| **键盘快捷键** | 基本 | ✅ 完整 | 体验差距 |
| **DSL 导出** | ✅ JSON (客户端) | ✅ YAML (服务端) | 实现方式不同 |
| **DSL 导入** | ✅ JSON 文件 | ✅ YAML + 版本检查 | Dify 更工程化 |
| **版本管理** | ✅ VersionDialog | ✅ 版本历史 + 回滚 | 都支持 |
| **流式执行** | ✅ SSE + 轮询 | ✅ 纯 SSE (20 事件类型) | Dify 更实时 |
| **单步调试** | ❌ (仅整组件重跑) | ✅ Run This Step | Dify 更灵活 |
| **执行触发** | 手动 + Webhook | 手动 + API + 定时 + Webhook + 插件 | Dify 更多样 |
| **并行迭代** | ❌ | ✅ 迭代内并行 | Dify Iteration 更强 |
| **人工干预暂停** | ✅ WaitingDialogue/UserFillUp | ✅ HumanInput + workflow_paused | 实现方式不同 |
| **变量系统** | 全局 + 对话变量 | 环境 + 对话 + 系统 + ValueSelector | Dify 更丰富 |
| **人工干预节点** | ✅ WaitingDialogue/UserFillUp | ✅ HumanInput | 都支持 |
| **插件化架构** | ✅ 独立 npm 包 | ❌ 紧密耦合 | AgentUI 架构优势 |
| **BFF 层** | ✅ Hono (独立部署) | ❌ (Next.js 内置) | AgentUI 更清晰分层 |
| **测试覆盖** | 极少量 (dsl-bridge.test.ts) | ✅ ~50+ 测试文件 (hooks/组件/工具) | **显著差距** |
| **国际化 (i18n)** | ✅ 17 语言 (react-i18next) | ✅ 多语言 | 都支持 |

### 8.1 代码架构模式对比

两个系统在应对同一问题 (画布复杂度管理) 时采用了不同的架构策略，互有值得借鉴之处:

**自定义节点注册策略:**

| 方面 | AgentUI | Dify |
|------|---------|------|
| **xyflow nodeType 数量** | 29 个独立注册 (每种算子一个) | 6 个 (`CustomNode` 统一包装，内部分发) |
| **节点类型映射** | `NodeMap` 常量 (Operator → xyflow type) | `BlockEnum` → 组件映射 (`NodeComponentMap`) |
| **新增节点成本** | 需注册新 xyflow type + 更新 NodeMap | 只需添加 BlockEnum + 组件映射，不碰 xyflow 层 |

> **Dify 的 `CustomNode` 统一包装模式值得 AgentUI 借鉴**: 用单一 xyflow nodeType 承载所有业务节点类型，通过 `BlockEnum` 在渲染层分发，可显著减少 ReactFlow 内部注册开销和类型维护成本。

**单文件复杂度:**

| 文件 | AgentUI | Dify |
|------|---------|------|
| 最大 hook 文件 | `store.ts` (Zustand, 估计 500-800 行) | `use-nodes-interactions.ts` (**2,471 行**) |
| 最大工具文件 | `dsl-bridge.ts` (DSL 双向转换) | `workflow-init.ts` (初始化+迁移+循环检测) |

> Dify 的 `use-nodes-interactions.ts` 达到 2,471 行，是所有交互逻辑的集中入口 (拖拽/增删/复制/粘贴/连线/类型切换)，虽然功能完整但面临可维护性挑战。AgentUI 将交互逻辑拆分为独立 hooks (`use-add-node`, `use-connection-drag`, `use-copy-paste`)，模块化更好。

---

## 九、目标领域与适用场景

### AgentUI 适用场景

1. **RAG 知识库构建** — Dataflow Pipeline 提供完整的 ETL 链 (File→Parser→Chunker→Extractor)
2. **企业搜索 Agent** — 内置 12 种搜索引擎，开箱即用的搜索型 Agent
3. **文档处理 Pipeline** — 支持 PDF/Office/图片/视频/音频等多种格式解析
4. **插件化集成** — 独立 canvas-plugin 包，适合嵌入其他系统

### Dify 适用场景

1. **通用 AI 应用构建** — Workflow 支持对话、工具链、条件分支、循环等完整控制流
2. **多触发模式** — API/定时/Webhook/插件触发，适合生产级自动化
3. **团队协作** — CRDT 实时协作、评论系统、版本管理
4. **RAG Pipeline** — DataSource→Transform→KnowledgeBase ETL 链，但节点数量少于 AgentUI
5. **低代码 AI 应用** — 配合 Chatflow 可构建完整的对话式 AI 应用

---

## 十、总结与建议

### AgentUI 的优势

1. **架构先进** — 插件化模块设计，画布独立于主应用，便于维护和集成 (当前为 monorepo workspace package)
2. **节点丰富** — 40+ 算子，尤其在搜索和数据源接入方面更专业；分块策略 (双 Chunker) 更精细
3. **代码模块化更好** — 交互逻辑拆分为独立小 hooks (`use-add-node`, `use-connection-drag`, `use-copy-paste`)，单文件复杂度远低于 Dify
4. **BFF 分层清晰** — Hono 中间层使前后端职责分离明确
5. **画布库版本新** — `@xyflow/react` v12 是最新版本，享受性能改进和新 API

### Dify 的优势

1. **交互体验更成熟** — 撤销/重做、自动布局、对齐辅助线、完整快捷键
2. **执行引擎更强** — 纯 SSE、迭代内并行、单步调试、多触发模式
3. **协作能力** — CRDT 实时协作、评论系统，适合团队使用
4. **DSL 工程化** — 服务端 YAML 序列化 + 版本迁移 + hash 冲突检测
5. **节点架构更灵活** — `CustomNode` 统一包装模式使新增节点类型无需触碰 xyflow 注册层
6. **测试覆盖率高** — ~50+ 测试文件覆盖 hooks、组件和工具函数

### AgentUI 可优先追赶的能力 (按价值排序)

1. **撤销/重做** — 实现成本低 (zundo temporal middleware 即插即用)，用户感知价值极高
2. **自动布局 (ELK.js)** — 实现成本中等，大幅提升复杂 Pipeline 的可维护性
3. **单步调试 (Run This Step)** — 结合已有的 SSE + 轮询基础设施，可独立运行单个组件
4. **节点级实时状态可视化** — 在执行时对节点边框/边着色，替代当前的纯 Timeline 模式
5. **键盘快捷键系统** — 引入 `@tanstack/react-hotkeys` 或等效方案，提升专业用户的操作效率
6. **对齐辅助线** — 实现成本低，提升拖拽体验
7. **自定义节点统一包装** — 参照 Dify 的 `CustomNode` 模式，将 29 个独立 xyflow nodeType 收敛为少数几个通用类型 + 内部分发，降低维护成本
8. **测试覆盖** — 至少对 DSL 桥接、store actions、核心交互 hooks 建立测试基线

---

*本文档基于对两个代码库的深度源码分析生成，涵盖架构、数据模型、序列化、执行引擎、交互体验等多个维度。*
