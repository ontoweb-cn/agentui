# AgentUI 画布机制详细分析

AgentUI 的画布机制是基于 **React Flow** (`@xyflow/react`) 构建的复杂可视化 Agent 编排系统。以下是完整的架构分析。

## 一、整体架构

```
┌─────────────────────────────────────────────────────┐
│                  AgentCanvas (主容器)                 │
│  src/pages/agent/canvas/index.tsx                    │
├─────────────────────────────────────────────────────┤
│  ReactFlow Provider                                  │
│  ├── nodes / edges (Zustand store)                  │
│  ├── nodeTypes (20+ 节点类型)                        │
│  ├── edgeTypes (ButtonEdge)                          │
│  ├── Background + Spotlight + Controls              │
│  └── Context Providers (多层上下文)                   │
└─────────────────────────────────────────────────────┘
```

## 二、核心组件层次

### 1. 主画布组件 `src/pages/agent/canvas/index.tsx`

这是画布的入口，使用 ReactFlow 组件，关键配置：
- `ConnectionMode.Loose` - 松散连接模式，允许更灵活的连接
- `nodeOrigin={[0.5, 0]}` - 节点原点居中
- `deleteKeyCode={['Delete', 'Backspace']}` - 删除快捷键
- `panActivationKeyCode={null}` - 禁用平移激活键

### 2. 状态管理 `src/pages/agent/store.ts`

使用 **Zustand + Immer + Devtools** 中间件组合管理画布状态：

```typescript
RFState = {
  nodes: IntellectNodeType[];      // 所有节点
  edges: Edge[];                  // 所有连线
  selectedNodeIds: string[];      // 选中节点
  clickedNodeId: string;          // 当前点击节点
  clickedToolId: string;          // 当前选中工具
  // ... 操作方法
  onNodesChange / onEdgesChange / onConnect
  addNode / deleteNodeById / duplicateNode
  addEdge / deleteEdgeById
  updateNodeForm / updateNode
}
```

## 三、节点类型系统

### 节点类型注册表（`src/pages/agent/canvas/index.tsx:79-108`）

共注册 **20+ 种节点类型**，按功能分类：

| 类别 | 节点类型 | 说明 |
|------|---------|------|
| **基础** | `beginNode`, `ragNode`, `noteNode`, `placeholderNode` | 开始/通用/备注/占位 |
| **逻辑控制** | `categorizeNode`, `switchNode` | 分类/条件分支 |
| **循环** | `iterationNode`, `iterationStartNode`, `loopNode`, `loopStartNode`, `exitLoopNode` | 迭代/循环 |
| **Agent** | `agentNode`, `toolNode` | Agent 及其工具子节点 |
| **数据处理** | `retrievalNode`, `rewriteNode`, `keywordNode`, `messageNode` | 检索/重写/关键词/消息 |
| **文档处理** | `parserNode`, `tokenizerNode`, `chunkerNode`, `fileNode`, `extractorNode` | 解析/分词/切块 |
| **数据操作** | `dataOperationsNode`, `listOperationsNode`, `variableAssignerNode`, `variableAggregatorNode` | 数据/变量操作 |

### 节点基类结构 `src/pages/agent/canvas/node/index.tsx`

`RagNode` 是通用节点基类，结构为：
```
ToolBar (悬停工具栏: 运行/复制/删除)
└── NodeWrapper
    ├── LeftEndHandle (左侧输入)
    ├── CommonHandle (右侧输出)
    ├── NodeHeader (标题区)
    └── children (具体内容)
```

### Handle 类型 (`src/pages/agent/constant/index.tsx:801-808`)

```typescript
enum NodeHandleId {
  Start = 'start',         // 标准输出
  End = 'end',             // 标准输入
  Tool = 'tool',           // Agent→Tool 连接
  AgentTop = 'agentTop',   // 子Agent→父Agent
  AgentBottom = 'agentBottom', // 父Agent→子Agent
  AgentException = 'agentException', // 异常跳转
}
```

## 四、连接机制（核心创新点）

### 1. 拖拽创建节点流程 `src/pages/agent/hooks/use-connection-drag.ts`

这是画布最精妙的设计——**拖拽连线时自动创建节点**：

```
用户从 Handle 拖出连线
    ↓
onConnectStart: 记录起始节点和鼠标位置
    ↓
onConnectEnd: 判断是点击还是拖拽（5px阈值）
    ↓
若是拖拽到空白处：
    ├── 创建 Placeholder 节点（占位）
    ├── 建立 source → placeholder 的临时连接
    ├── 计算下拉菜单位置
    └── 显示 NextStepDropdown 选择节点类型
    ↓
用户选择节点类型：
    ├── onNodeCreated 回调
    ├── 用新节点替换 placeholder（继承位置和连接）
    └── 删除 placeholder
```

### 2. Placeholder 管理 `src/pages/agent/hooks/use-placeholder-manager.ts`

确保画布上**同一时间只有一个 placeholder**：
- `checkAndRemoveExistingPlaceholder` - 创建新 placeholder 前清理已有的
- `removePlaceholderNode` - 用户取消时移除
- `onNodeCreated` - 用户选择后，将 placeholder 的位置和连接迁移到新节点

### 3. 下拉菜单管理 `src/pages/agent/canvas/context.tsx`

通过 `DropdownContext` 防止多个下拉菜单冲突：
```typescript
activeDropdownRef: 'handle' | 'drag' | null
canShowDropdown()  // 检查是否可显示
setActiveDropdown() // 设置当前类型
clearActiveDropdown() // 清除
```

### 4. Handle 点击行为 `src/pages/agent/canvas/node/handle.tsx`

点击 Handle（非拖拽）也会弹出 `NextStepDropdown`，支持两种触发方式：
- **点击 Handle** → `setActiveDropdown('handle')`
- **拖拽到空白** → `setActiveDropdown('drag')`

## 五、边（Edge）机制

### ButtonEdge `src/pages/agent/canvas/edge/index.tsx`

```typescript
// 边的高亮逻辑
1. selectedStyle - 选中时高亮（accent-primary 色）
2. placeholderHighlightStyle - 连接到 placeholder 时高亮
3. showHighlight - 根据 flowDetail.dsl.path 高亮执行路径
4. visible - hover 时显示删除按钮（×）
```

关键特性：
- 使用贝塞尔曲线 `getBezierPath`
- 根据 `flowDetail.dsl.path` 高亮实际执行路径
- Agent→Tool 的连接不显示删除按钮
- 连接到 Placeholder 的边会高亮提示

## 六、特殊节点机制

### 1. Agent 节点的层级结构 `src/pages/agent/canvas/node/agent-node.tsx`

```
Head Agent (顶层)
├── 左侧 End Handle (输入)
├── 右侧 Start Handle (输出到下游)
├── 底部 AgentBottom Handle (输出到子Agent)
│   └── Sub Agent (子Agent)
│       └── 顶部 AgentTop Handle (输入)
└── 底部 Tool Handle (输出到工具)
    └── Tool Node
```

`isHeadAgent` 通过 `isBottomSubAgent(edges, id)` 判断是否为顶层 Agent。

### 2. 分组节点（Iteration/Loop）`src/pages/agent/hooks/use-add-node.ts`

```typescript
addGroupNode(operatorType, newNode, nodeId) {
  newNode.width = 500;  // 固定初始尺寸
  newNode.height = 250;
  
  // 创建对应的 Start 节点
  startNode.parentId = newNode.id;
  startNode.extent = 'parent';  // 限制在父节点范围内
  
  addNode(newNode);
  addNode(startNode);
  // 建立 source → group 的连接
}
```

### 3. Categorize/Switch 动态 Handle

Categorize 节点根据表单 `items` 动态生成多个输出 Handle，每个分类条件对应一个输出端口，位置按索引计算：
```typescript
top: idx === 0 ? 86 : list[idx - 1].top + 8 + 24
```

## 七、节点添加策略 `src/pages/agent/hooks/use-add-node.ts`

`addCanvasNode` 是核心添加函数，处理多种场景：

| 场景 | 处理逻辑 |
|------|---------|
| **普通节点** | 计算位置 → addNode → addChildEdge |
| **Iteration/Loop** | 调用 `addGroupNode` 创建分组+Start节点 |
| **Agent (底部)** | 计算子Agent位置（避免重叠）→ 建立底部连接 |
| **Tool** | 调用 `addToolNode`（Agent 只能有一个 Tool） |
| **子节点** | 继承 parentId，调用 `resizeIterationNode` 调整父节点尺寸 |

位置计算策略：
- 从 Handle 添加：`calculateNewlyBackChildPosition` 避免与已有子节点重叠
- 拖拽到空白：`screenToFlowPosition` 转换屏幕坐标
- 子 Agent：按 X 轴排列，间距 262px

## 八、运行时机制

### 执行路径高亮

边组件通过 `useFetchAgent()` 获取 `flowDetail.dsl.path`，高亮实际经过的节点路径：
```typescript
const showHighlight = useMemo(() => {
  const path = flowDetail?.dsl?.path ?? [];
  // 在 path 中找到 target，向前查找 source
  // 若存在则高亮该边
}, [flowDetail?.dsl?.path, source, target]);
```

### 节点加载状态 `src/pages/agent/hooks/use-node-loading.ts`

通过 `AgentInstanceContext` 提供：
- `lastNode` - 最后执行的节点
- `startButNotFinishedNodeIds` - 已开始但未完成的节点

## 九、交互模式总结

```
┌──────────────────────────────────────────────────────┐
│                    交互方式                            │
├─────────────────┬────────────────────────────────────┤
│ 点击 Handle     │ 弹出 NextStepDropdown 选择节点类型   │
│ 拖拽到空白      │ 创建 Placeholder → 弹出 Dropdown     │
│ 拖拽到节点      │ 直接建立连接 (handleConnect)         │
│ 点击边 × 按钮   │ 删除该边                            │
│ 节点悬停        │ 显示工具栏 (运行/复制/删除)          │
│ 点击节点        │ 打开 FormSheet 配置面板              │
│ 画布点击空白    │ 关闭所有弹窗/移除 Placeholder         │
│ 画布移动/缩放   │ 清理 Placeholder 和 Dropdown         │
└─────────────────┴────────────────────────────────────┘
```

## 十、上下文层级

画布使用多层 Context Provider 传递状态：

```
AgentInstanceContext (addCanvasNode, showFormDrawer, loading状态)
├── HandleContext (连接起点信息)
│   └── NextStepDropdown
├── AgentChatContext (聊天相关)
│   └── AgentChatLogContext (日志缓存)
└── DropdownContext (下拉菜单管理)
```

## 总结

AgentUI 的画布机制是一个高度定制化的 React Flow 实现，核心创新在于：

1. **拖拽即创建** - 拖拽连线到空白处自动创建节点，通过 Placeholder 机制实现无缝过渡
2. **多层级 Agent** - 支持 Agent 嵌套（Head Agent → Sub Agent → Tool），通过不同的 Handle 类型区分
3. **动态 Handle** - Categorize/Switch 节点根据配置动态生成输出端口
4. **执行路径可视化** - 运行时根据 `dsl.path` 高亮实际执行路径
5. **分组节点** - Iteration/Loop 作为容器节点，子节点限制在父节点范围内
6. **Pipeline/Agent 双模式** - 通过 `useIsPipeline` 区分数据流水线和 Agent 编排两种场景

整体设计将复杂的 Agent 编排转化为直观的可视化操作，同时保持代码的可维护性和扩展性。
