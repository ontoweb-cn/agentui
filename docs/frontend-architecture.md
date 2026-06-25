# AgentUI 前端框架总体设计文档

> 本文档在 BFF 接管"未实现/弱耦合"功能 + 多 Harness 后端支持方案落定后，对 AgentUI 整体前端框架进行系统性梳理。
> 配套文档：
> - [Vite 构建与代理层细节](file:///Users/simon/workspace/agentui/docs/vite-architecture.md)
> - [多 Harness 后端支持设计方案](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md)
> - [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)
> - [画布机制](file:///Users/simon/workspace/agentui/docs/canvas-mechanism.md)
> - [HTTP API 参考](file:///Users/simon/workspace/agentui/docs/references/http_api_reference.md)

---

## 一、整体定位

AgentUI 是一个 **Agent Harness 前端**，最初与 Intellect 强耦合，正在演进为可对接多种 Agent Harness 后端（Intellect / Intellect 企业版 / Intellect 社区版 / Hermes / OpenClaw）的统一前端。

- **前端**：单页应用（SPA），Vite + React 18 + TypeScript
- **BFF**：Hono 实现的 Node 服务（端口 3001），承载 Admin 接管逻辑、适配器层、路由聚合
- **后端**：Intellect Python API（9380）/ Intellect Admin（9381）/ Intellect 企业版 API（8642）

整体三层结构：

```
┌────────────────────────────────────────────────────────────┐
│  AgentUI SPA  (Vite dev :9222 / 静态产物)                  │
│  React + React Router 7 + TanStack Query + Zustand         │
└────────────────────────────────────────────────────────────┘
                          │ /api/bff/*  /api/v1/admin/*  /api/*  /v1/*
┌────────────────────────────────────────────────────────────┐
│  BFF  (Hono on Node :3001)                                 │
│  - admin-store (JSON 持久化)                               │
│  - 适配器层 (IHarnessAdapter)                              │
│  - 路由聚合 + 鉴权透传                                     │
└────────────────────────────────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│  后端集群                                                   │
│  - Intellect API  :9380  (业务核心 + 画布编排)               │
│  - Intellect Admin :9381 (强耦合管理：用户/服务/沙箱/版本)   │
│  - Intellect 企业版 :8642 (Team/Project + OpenAI SSE)      │
└────────────────────────────────────────────────────────────┘
```

---

## 二、技术栈

| 层面 | 选型 | 说明 |
|------|------|------|
| 构建 | Vite 7 + Rollup + Terser | dev :9222，产物 `dist/` |
| 框架 | React 18 + TypeScript 5 | StrictMode |
| 路由 | React Router 7 (`createBrowserRouter`) | 文件式 lazy import |
| 状态 | TanStack Query 5（服务端）+ Zustand（客户端）+ Context | 优先 Query，避免重复 |
| 表单 | React Hook Form + Zod | 配合 `@hookform/resolvers` |
| 样式 | Tailwind CSS + Less + CSS Module + Radix UI | 三层混合（见 §10） |
| 画布 | @xyflow/react 12 | Agent 编排画布 |
| Markdown | react-markdown + remark/rehype 插件链 | 含 KaTeX、GFM |
| 编辑器 | Monaco Editor | 代码节点、JSON 编辑 |
| HTTP | axios（新）+ umi-request（旧，标记 deprecated） | SSE 用 `eventsource-parser` |
| 国际化 | i18next + react-i18next | 17 种语言 |
| 主题 | `next-themes` 思路自实现 `ThemeProvider` | Light / Dark |
| BFF | Hono + tsx | JSON 文件持久化，无 DB 依赖 |
| 测试 | Jest + Testing Library | esbuild-jest |
| 故事书 | Storybook 9 | 组件独立开发 |
| 代码规范 | ESLint + Prettier + Husky + lint-staged | 提交前钩子 |

---

## 三、工程结构

```
agentui/
├── bff/                       # BFF 服务（独立 npm workspace）
│   ├── src/
│   │   ├── middleware/        # auth / error
│   │   ├── routes/            # admin / agent / session / health
│   │   ├── services/          # admin-store / intellect-client / (后续 adapters)
│   │   ├── types/
│   │   └── index.ts           # Hono 入口
│   ├── package.json
│   └── tsconfig.json
├── docs/                      # 设计文档
│   ├── vite-architecture.md
│   ├── multi-harness-design.md
│   ├── intellect-admin-api-guide.md
│   ├── canvas-mechanism.md
│   ├── orchestration-session-aggregation.md
│   ├── references/http_api_reference.md
│   └── frontend-architecture.md  ← 本文档
├── nginx/                     # 部署反代配置
├── public/                    # 静态资源（pdf.worker、iconfont、logo）
├── scripts/                   # 工具脚本（gen-api-types）
├── src/                       # 前端源码（主体）
│   ├── app.tsx                # 应用根组件（Provider 栈）
│   ├── main.tsx               # ReactDOM 入口
│   ├── assets/                # 字体、SVG 图标
│   ├── components/            # 通用组件
│   │   └── ui/                # Radix 封装的基础组件库
│   ├── conf.json              # 应用配置（appName 等）
│   ├── constants/             # 业务常量
│   ├── hooks/                 # 全局 hooks（按业务域分类）
│   ├── interfaces/            # TypeScript 类型定义
│   │   ├── database/          # 实体类型
│   │   └── request/           # 请求/响应类型
│   ├── layouts/               # 顶层布局
│   ├── less/                  # 全局 Less 变量与 mixins
│   ├── lib/                   # 工具函数（cn 等）
│   ├── locales/               # 多语言资源
│   ├── pages/                 # 路由页面（按业务模块组织）
│   ├── routes.tsx             # 路由表
│   ├── services/              # API 服务封装
│   ├── tailwind.css           # Tailwind 入口
│   ├── utils/                 # 工具函数
│   └── global.less
├── vite.config.ts             # Vite 配置（插件/代理/构建）
├── package.json               # workspaces: ["bff"]
└── tsconfig.json
```

### 关键约定

1. **`@/` 别名**：在 `vite.config.ts` 与 `tsconfig.json` 中均映射到 `src/`，所有内部模块用 `@/...` 导入。
2. **页面即模块**：每个业务页面在 `src/pages/<module>/` 下自成目录，包含 `index.tsx` + 局部 `hooks/`、`components/`、`forms/`。
3. **`bff/` 是 workspace 包**：`npm run dev:all` 并发起前端与 BFF。
4. **`docs/` 强制更新**：架构调整必须同步更新对应文档（本文档 + `vite-architecture.md` + `multi-harness-design.md`）。

---

## 四、应用入口与启动流程

### 4.1 入口链路

```
index.html
  └─ src/main.tsx          # ReactDOM.createRoot + StrictMode + Inspector
       └─ src/app.tsx      # RootProvider / RootProviderWrapper
            └─ RouterProvider router={routers}
                 └─ src/routes.tsx   # createBrowserRouter(routeConfig)
```

### 4.2 `main.tsx`

```tsx
initLanguage().then(() => {
  ReactDOM.createRoot(...).render(
    <React.StrictMode>
      <Inspector keys={['alt', 'c']} onInspectElement={gotoVSCode} />
      <App />
    </React.StrictMode>,
  );
});
```

- **`initLanguage`** 先于渲染，避免首屏闪烁。
- **`Inspector`** 仅开发环境生效，Alt+C 激活点击元素跳转 VS Code。

### 4.3 `app.tsx` Provider 栈

```tsx
<ThemeProvider>
  <TooltipProvider>
    <QueryClientProvider client={queryClient}>
      <RouterProviderWrapper router={routers} />
    </QueryClientProvider>
  </TooltipProvider>
  <Sonner /> <Toaster />  // 全局通知
</ThemeProvider>
```

- `QueryClient` 默认：`refetchOnWindowFocus: false, retry: 2`。
- 开发环境启用 `why-did-you-render`，但排除 `RouterProvider`。
- `dayjs` 全局插件一次性加载，按需 `dayjs/locale/*` 注册多语言。

---

## 五、路由系统

### 5.1 路由表

集中维护在 [src/routes.tsx](file:///Users/simon/workspace/agentui/src/routes.tsx)：

- `Routes` 枚举：所有路径常量集中定义（如 `Routes.Admin`、`Routes.Agent`、`Routes.Dataset`）。
- `routeConfigOptions`：扁平配置数组，每项可声明 `path / Component / layout / loader / children`。
- `withLazyRoute`：包装 `lazy(() => import(...))`，统一 `Suspense` fallback；开发环境不 memo，生产环境 memo。
- `wrapRoutes`：递归转换配置树为 `RouteObject[]`，统一挂载 `errorElement = <FallbackComponent />`。
- `routers = createBrowserRouter(routeConfig, { basename: import.meta.env.VITE_BASE_URL || '/' })`。

### 5.2 三类布局

| 布局 | 路径前缀 | 文件 | 用途 |
|------|---------|------|------|
| **无布局** | `/login`、`/login-next`、`/404`、`/share/*`、`/widget` | 直接渲染 | 登录/分享/嵌入 |
| **RootLayout** | `/`、`/home`、`/datasets`、`/dataset`、`/files`、`/agents`、`/chats`、`/memories`、`/searches`、`/user-setting/*` | [src/layouts/root-layout.tsx](file:///Users/simon/workspace/agentui/src/layouts/root-layout.tsx) | 主应用，顶部 Header + 内容区 |
| **Admin Layout** | `/admin` | [src/pages/admin/layouts/](file:///Users/simon/workspace/agentui/src/pages/admin/layouts) | 独立管理后台（独立登录态） |

### 5.3 RootLayout 加载器

`Routes.Root` 配置了 `loader`：从 URL 查询参数提取 `auth` token，写入 `authorizationUtil`，再 `redirect` 到无 `auth` 参数的干净 URL。这是分享/SSO 跳转进入应用的鉴权入口。

### 5.4 Admin 子路由树

```
/admin                              (AdminRootLayout)
├── /admin                          (login.tsx, 未登录)
└── /admin                          (AdminAuthorizedLayout, 已登录)
    ├── /admin/users/:id            (user-detail)
    └── <NavigationLayout>
        ├── /admin/services         (service-status)
        ├── /admin/users            (users)
        ├── /admin/sandbox-settings (sandbox-settings)
        ├── /admin/whitelist        (IS_ENTERPRISE 才挂载)
        ├── /admin/roles            (IS_ENTERPRISE 才挂载)
        └── /admin/monitoring       (IS_ENTERPRISE 才挂载)
```

`IS_ENTERPRISE = import.meta.env.VITE_INTELLECT_ENTERPRISE === 'INTELLECT_ENTERPRISE'`。

---

## 六、布局体系

### 6.1 主应用 RootLayout

```tsx
<div className="size-full grid grid-rows-[auto_1fr] grid-cols-1 grid-flow-col">
  <Header className="px-5 py-4" />
  <main className="size-full overflow-hidden">{children}</main>
</div>
```

- 单一 Header + 全屏内容区。
- Header 在 [src/layouts/components/header.tsx](file:///Users/simon/workspace/agentui/src/layouts/components/header.tsx)，包含 `GlobalNavbar`、`BellButton`、`ThemeButton`。

### 6.2 Admin Layout（独立子应用）

Admin 模块是 **独立的三层嵌套布局**：

1. **`AdminRootLayout`**：通过 `CurrentUserInfoContext` 在最外层提供登录态。
2. **`AdminAuthorizedLayout`**：未登录则 `<Navigate to={Routes.Admin} />`。
3. **`AdminNavigationLayout`**：左侧导航 + 顶部主题切换 + 登出按钮 + 右侧 `<Outlet />`。

Admin 使用独立的 axios 实例（`src/services/admin-service.ts`），**不走 TanStack Query**（直接 mutation），独立维护 401 跳转逻辑。

### 6.3 用户设置页 `UserSetting`

独立二级布局 `src/pages/user-setting/index.tsx`，左侧 sidebar + 右侧子路由（profile / model / team / api / mcp / data-source / chat-channel）。

---

## 七、页面与业务模块

### 7.1 模块清单

| 模块 | 路径 | 主要文件 | 说明 |
|------|------|---------|------|
| Home | `/home` | [src/pages/home](file:///Users/simon/workspace/agentui/src/pages/home) | 首页：Agents/Chats/Datasets/Searches/Memories 卡片汇总 |
| Agents 列表 | `/agents`、`/agent-list` | [src/pages/agents](file:///Users/simon/workspace/agentui/src/pages/agents) | Agent 卡片列表、模板、导入导出、日志 |
| Agent 编排 | `/agent/:id` | [src/pages/agent](file:///Users/simon/workspace/agentui/src/pages/agent) | 画布编排 + 节点表单 + 调试 + 探索 |
| Agent Explore | `/agent/:id/explore` | [src/pages/agent/explore](file:///Users/simon/workspace/agentui/src/pages/agent/explore) | 会话探索 |
| Datasets 列表 | `/datasets` | [src/pages/datasets](file:///Users/simon/workspace/agentui/src/pages/datasets) | 知识库卡片 |
| Dataset 详情 | `/dataset/files/:id` 等 | [src/pages/dataset](file:///Users/simon/workspace/agentui/src/pages/dataset) | 文档/配置/测试/知识图谱/概览 |
| Files | `/files` | [src/pages/files](file:///Users/simon/workspace/agentui/src/pages/files) | 文件管理（含文件夹、移动、链接到知识库） |
| Skills | `/files/skills` | [src/pages/skills](file:///Users/simon/workspace/agentui/src/pages/skills) | 技能空间 |
| Chats | `/chats`、`/chat/:id` | [src/pages/next-chats](file:///Users/simon/workspace/agentui/src/pages/next-chats) | 对话管理 + 多会话框 |
| Searches | `/searches`、`/search/:id` | [src/pages/next-searches](file:///Users/simon/workspace/agentui/src/pages/next-searches) | 搜索应用 |
| Memories | `/memories`、`/memory/*` | [src/pages/memories](file:///Users/simon/workspace/agentui/src/pages/memories) | 记忆空间 |
| Chunk | `/chunk/*` | [src/pages/chunk](file:///Users/simon/workspace/agentui/src/pages/chunk) | 切片结果查看 |
| Dataflow | `/dataflow-result` | [src/pages/dataflow-result](file:///Users/simon/workspace/agentui/src/pages/dataflow-result) | 数据流水线执行结果 |
| Document Viewer | `/document/:id` | [src/pages/document-viewer](file:///Users/simon/workspace/agentui/src/pages/document-viewer) | 独立文档预览 |
| Login | `/login`、`/login-next` | [src/pages/login-next](file:///Users/simon/workspace/agentui/src/pages/login-next) | 登录页 |
| User Setting | `/user-setting/*` | [src/pages/user-setting](file:///Users/simon/workspace/agentui/src/pages/user-setting) | 个人设置 |
| Admin | `/admin/*` | [src/pages/admin](file:///Users/simon/workspace/agentui/src/pages/admin) | 独立管理后台 |
| 404 | `/*` | [src/pages/404.tsx](file:///Users/simon/workspace/agentui/src/pages/404.tsx) | 兜底 |

### 7.2 Agent 编排模块（核心）

`src/pages/agent/` 是最复杂的模块，按职责划分：

- **`canvas/`**：基于 `@xyflow/react` 的画布实现
  - `node/`：30+ 节点类型（begin/agent/categorize/iteration/loop/code/message/retrieval/...）
  - `edge/`：自定义连线
  - `context-menu/`：右键菜单
  - `context.tsx`：画布上下文
- **`form/`**：每种节点对应的表单（20+ 表单类型），统一通过 `form-config-map.tsx` 注册
- **`form-sheet/`**：节点配置面板（Sheet 形式从右侧滑出）
- **`chat/`**：Agent 调试对话
- **`debug-content/`**：单节点调试
- **`explore/`**：会话探索
- **`constant/pipeline.tsx`**：节点常量与 DSL 映射
- **`empty-dsl.ts`**：空白画布的初始 DSL

### 7.3 Admin 模块（含本次 BFF 接管调整）

| 页面 | 数据来源 | 路径常量 |
|------|---------|---------|
| login | Intellect Admin `${restAPIv1}/admin/login` | `adminLogin` |
| users | Intellect Admin `/api/v1/admin/users/*` | `adminListUsers` 等 |
| user-detail | Intellect Admin | `adminGetUserDetails` |
| service-status | Intellect Admin `/admin/services` | `adminListServices` |
| sandbox-settings | Intellect Admin `/admin/sandbox/*` | `adminListSandboxProviders` 等 |
| **whitelist** | **BFF** `/api/bff/admin/whitelist/*` | `adminListWhitelist` 等 |
| **roles** | **BFF** `/api/bff/admin/roles/*` | `adminListRoles` 等 |
| monitoring | Intellect Admin（保留） | - |

**接管原则**：

- Intellect Admin 中未实现 / stub 的功能（`whitelist`、`roles`、`resources`）→ 迁移到 BFF
- 强耦合功能（`users`、`services`、`sandbox`、`version`）→ 保留在 Intellect Admin

---

## 八、状态管理与数据流

### 8.1 三层状态

| 层级 | 工具 | 适用场景 | 示例 |
|------|------|---------|------|
| 服务端状态 | TanStack Query 5 | 列表、详情、配置等可重新获取的数据 | `useQuery(['agents'], ...)` |
| 客户端 UI 状态 | React `useState/useReducer` + Context | 局部 UI、表单 | `CurrentUserInfoContext` |
| 跨页面共享状态 | Zustand | 需要跨组件持久化的客户端状态 | Agent 画布 store |

**约定**：

- 默认优先 Query，避免引入额外 Zustand。
- Query key 命名：`[domain, id?, action?]`，如 `['admin/version']`、`['agent', agentId]`。
- 同一份数据只允许有一个权威 Query key，其他地方用 `useQueryClient().getQueryData` 复用。

### 8.2 请求 hooks 按业务域拆分

[src/hooks/](file:///Users/simon/workspace/agentui/src/hooks) 下按域拆分：

| Hook 文件 | 域 |
|----------|----|
| `use-agent-request.ts` | Agent CRUD、模板 |
| `use-chat-request.ts` | 对话 |
| `use-knowledge-request.ts` | 知识库 |
| `use-document-request.ts` | 文档 |
| `use-chunk-request.ts` | 切片 |
| `use-llm-request.tsx` | 模型 |
| `use-mcp-request.ts` | MCP |
| `use-memory-request.ts` | 记忆 |
| `use-system-request.ts` | 系统 |
| `use-user-setting-request.tsx` | 个人设置 |
| `use-dataflow-request.ts` | 数据流水线 |
| `use-file-request.ts` | 文件 |
| `use-login-request.ts` | 登录 |
| `logic-hooks.ts` | 通用业务 hooks |
| `auth-hooks.ts` | 鉴权 |

### 8.3 SSE 流式

通过 `eventsource-parser` 的 `EventSourceParserStream` 解析，关键代码在 [src/hooks/logic-hooks.ts](file:///Users/simon/workspace/agentui/src/hooks/logic-hooks.ts) 与各 `use-send-*-message.ts`。

> 多 Harness 后端下，SSE 统一以 Intellect OpenAI 兼容格式为基础，详见 [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) §3.5。

---

## 九、网络层与 API 管理

### 9.1 API 路径常量

**唯一来源**：[src/utils/api.ts](file:///Users/simon/workspace/agentui/src/utils/api.ts)

```ts
const webAPI = `/v1`;
const restAPIv1 = `/api/v1`;
const bffAdmin = `/api/bff/admin`;

export default {
  login: `${restAPIv1}/auth/login`,
  // ...
  adminListRoles: `${bffAdmin}/roles`,         // BFF 接管
  adminListWhitelist: `${bffAdmin}/whitelist`, // BFF 接管
  adminListUsers: `${restAPIv1}/admin/users`,  // 仍在 Intellect Admin
  // ...
};
```

**约定**：

- 所有 URL 必须在此文件集中定义，禁止散落到 service。
- 路径前缀决定 Vite 代理目标（见 §9.4）。
- 改动 API 路径时只需改这里，service 层零改动。

### 9.2 请求客户端

| 客户端 | 文件 | 用途 |
|--------|------|------|
| `umi-request` | [src/utils/request.ts](file:///Users/simon/workspace/agentui/src/utils/request.ts) | **已标记 deprecated**，旧代码使用 |
| `axios`（主应用） | 散落在 service 文件中 | 新代码主推 |
| `axios`（Admin） | [src/services/admin-service.ts](file:///Users/simon/workspace/agentui/src/services/admin-service.ts) | 独立实例，独立 401 处理 |
| `axios`（BFF 内部） | [bff/src/services/intellect-client.ts](file:///Users/simon/workspace/agentui/bff/src/services/intellect-client.ts) | BFF 调用 Intellect |

**响应包络**：`{ code: 0, message: string, data: T }`，BFF admin 路由已对齐此格式（见 `ok()` / `fail()`）。

### 9.3 鉴权

| 维度 | 实现 |
|------|------|
| Token 存储 | `localStorage`，键见 `constants/authorization.ts`（`Authorization`、`Token`、`UserInfo`） |
| 工具 | [src/utils/authorization-util.ts](file:///Users/simon/workspace/agentui/src/utils/authorization-util.ts) |
| 注入 | 请求拦截器自动加 `Authorization` header（`Bearer xxx`） |
| URL 直登 | RootLayout loader 支持 `?auth=xxx` 自动写入并清洗 URL |
| 401 处理 | 清空存储 + 跳转 `/login` 或 `/admin`（Admin 独立） |

### 9.4 Vite 代理（开发期）

[vite.config.ts](file:///Users/simon/workspace/agentui/vite.config.ts) 中四层代理：

| 前缀 | 目标 | 用途 |
|------|------|------|
| `/api/bff` | `http://localhost:${bffPort}` (3001) | BFF 服务，rewrite 去掉前缀 |
| `/api/v1/admin` | `http://${apiHost}:${pythonAdminPort}` (9381) | Intellect Admin |
| `/api` | `http://${apiHost}:${pythonApiPort}` (9380) | Intellect 主 API |
| `/v1` | `http://${apiHost}:${pythonApiPort}` (9380) | Intellect Web API |

部署期由 `nginx/` 反代相同前缀。

> 详细代理层架构见 [vite-architecture.md 第三章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md)。

---

## 十、组件体系

### 10.1 三层组件

| 层 | 目录 | 说明 |
|----|------|------|
| **基础组件库** | [src/components/ui/](file:///Users/simon/workspace/agentui/src/components/ui) | 基于 Radix UI 的封装（50+ 组件），shadcn 风格 |
| **业务通用组件** | [src/components/](file:///Users/simon/workspace/agentui/src/components) | 跨业务复用：`api-service`、`avatar-upload`、`file-uploader`、`markdown-content`、`message-item`、`originui`、`jsonjoy-builder` 等 |
| **页面内组件** | `src/pages/<module>/components/` | 仅该模块使用 |

### 10.2 基础组件库（`ui/`）

- **风格来源**：shadcn/ui（基于 Radix UI 原语 + Tailwind + CVA）
- **关键组件**：`button`、`input`、`dialog`、`sheet`、`popover`、`dropdown-menu`、`table`、`tabs`、`form`、`select`、`tree-view`、`transfer-list`、`modal/modal.tsx`（命令式 API）
- **`lib/utils.ts`**：`cn` 工具（`clsx` + `tailwind-merge`）
- **主题对接**：通过 Tailwind CSS 变量（`--background`、`--foreground`...）实现 Light/Dark 切换

### 10.3 命令式弹窗

`ui/modal/modal-manage.tsx` 提供命令式调用入口，配合 `createPortalModal` 实现脱离 React 树的弹窗。

### 10.4 画布组件

- `src/pages/agent/canvas/`：基于 `@xyflow/react` 的完整画布实现
- `src/components/canvas/background.tsx`：画布背景
- `src/components/xyflow/`：自定义节点基类（`base-node`、`tooltip-node`）

> 画布机制详见 [canvas-mechanism.md](file:///Users/simon/workspace/agentui/docs/canvas-mechanism.md)。

---

## 十一、样式架构

三层混合，详见 [vite-architecture.md 第四章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md)：

| 层 | 用途 | 文件 |
|----|------|------|
| **Tailwind CSS 3** | 主样式系统，原子类 | `tailwind.css`、`tailwind.config` |
| **Less** | 兼容历史样式 + 全局变量/mixin | `src/less/variable.less`、`mixins.less`、各组件 `*.less` |
| **CSS Module** | 局部作用域（画布等） | `*.module.less` |

### 全局变量

- **Tailwind CSS 变量**：通过 `:root` 与 `.dark` 定义语义色（`--background`、`--foreground`、`--primary`...），组件用 `bg-background`、`text-foreground` 等。
- **Less 变量**：`@import "@/less/variable.less"` 通过 vite `css.preprocessorOptions.less.additionalData` 自动注入到每个 Less 文件。

### CSS Module 约定

- `localsConvention: 'camelCase'`：导入时用驼峰访问。
- 命名 `*.module.less`。

---

## 十二、国际化

- **库**：i18next + react-i18next + i18next-browser-languagedetector
- **资源**：[src/locales/](file:///Users/simon/workspace/agentui/src/locales) 下 17 个语言文件（ar / bg / de / en / es / fr / id / it / ja / ko / pt-br / ru / tr / vi / zh-traditional / zh / config.ts）
- **初始化**：`initLanguage()` 在 `main.tsx` 中先于 render 调用
- **切换**：`changeLanguageAsync` 在 `src/locales/config.ts`，写入 `localStorage.lng`
- **打包**：每个语言文件被 `manualChunks` 拆分为独立 chunk（`locale-<lang>`），按需加载

---

## 十三、主题系统

- **实现**：[src/components/theme-provider.tsx](file:///Users/simon/workspace/agentui/src/components/theme-provider.tsx) 自实现 `ThemeProvider`（思路同 `next-themes`）
- **存储**：`localStorage['vite-ui-theme']`，默认 `ThemeEnum.Dark`
- **切换**：写 `document.documentElement.classList`，Tailwind 的 `dark:` 变体响应
- **默认值**：`defaultTheme = ThemeEnum.Dark`
- **辅助 hooks**：`useTheme`、`useIsDarkTheme`、`useSwitchToDarkThemeOnMount`、`useSyncThemeFromParams`
- **切换组件**：`src/components/theme-switch.tsx`

---

## 十四、构建与部署

### 14.1 脚本

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动 Vite dev server（:9222） |
| `npm run dev:bff` | 启动 BFF（tsx watch，:3001） |
| `npm run dev:all` | 并行启动前端 + BFF |
| `npm run build` | `vite build --mode production` |
| `npm run preview` | 预览生产产物 |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Jest + coverage |
| `npm run storybook` | Storybook（:6006） |
| `npm run gen:api-types` | 从 OpenAPI 生成类型 |

### 14.2 构建优化

- **代码分割**：`manualChunks` 按 `node_modules` 拆分，`lodash/dayjs/axios/date-fns` 归 `utils`，`d3/ajv/@antv` 独立 chunk，每个 locale 独立 chunk
- **产物结构**：
  - `entry/js/`：入口 chunk
  - `chunk/js/`：业务分包
  - `assets/<ext>/`：静态资源按扩展名分目录
- **压缩**：默认 Terser，`drop_console: true`、`drop_debugger: true`、`pure_funcs: ['console.log']`
- **Tree shaking**：开启
- **Chunk 大小警告**：1000KB
- **目标**：`es2015`
- **Sourcemap**：默认开启，`VITE_BUILD_SOURCEMAP=false` 关闭

### 14.3 部署

- **镜像**：`Dockerfile` + `docker-compose.yml` + `docker-entrypoint.sh`
- **反代**：[nginx/](file:///Users/simon/workspace/agentui/nginx) 提供 `nginx.conf`、`default.conf`、`proxy.conf`，与开发期 Vite 代理保持一致的前缀规则
- **环境变量**：见 `.env`、`.env.development`、`.env.production`、`.env.example`

---

## 十五、Admin 模块（独立管理后台）

### 15.1 定位

Admin 是 **AgentUI 内嵌的独立子应用**，独立登录态、独立布局、独立路由树，用于运维管理。本期改造后部分功能由 BFF 接管。

### 15.2 数据来源分布

```
Admin Page
   │
   ├── admin-service.ts (axios 独立实例)
   │     │
   │     ├── /api/v1/admin/login        ──► Intellect Admin :9381  (鉴权)
   │     ├── /api/v1/admin/users/*      ──► Intellect Admin :9381  (强耦合)
   │     ├── /api/v1/admin/services/*   ──► Intellect Admin :9381  (强耦合)
   │     ├── /api/v1/admin/sandbox/*    ──► Intellect Admin :9381  (强耦合)
   │     ├── /api/v1/admin/version      ──► Intellect Admin :9381
   │     │
   │     ├── /api/bff/admin/whitelist/* ──► BFF :3001            (本次接管)
   │     ├── /api/bff/admin/roles/*     ──► BFF :3001            (本次接管)
   │     └── /api/bff/admin/roles/resource ─► BFF :3001          (本次接管)
   │
   └── forms/ + components/
         ├── user-form / change-password-form / email-form / import-excel-form
         ├── role-form  (本次新增，对接 BFF)
         └── enterprise-feature.tsx  (IS_ENTERPRISE 标记的占位)
```

### 15.3 BFF 接管实现

- **持久化**：[bff/src/services/admin-store.ts](file:///Users/simon/workspace/agentui/bff/src/services/admin-store.ts) 用 JSON 文件持久化（`whitelist.json`、`roles.json`、`resources.json`），避免引入 DB
- **默认数据**：首次启动自动初始化默认角色（admin / user）和资源清单
- **路由**：[bff/src/routes/admin.ts](file:///Users/simon/workspace/agentui/bff/src/routes/admin.ts) 提供：
  - Whitelist：`GET / POST /add / PUT /:id / DELETE /:email / POST /batch`
  - Roles：`GET / GET /roles_with_permission / GET /:name/permissions / POST|PUT|DELETE /:name / POST /:name/permission`
  - Resources：`GET /roles/resource`
  - User-Role 映射：`PUT /users/:name/role`、`GET /users/:name/permissions`
- **响应格式**：`{ code: 0, message, data }`，与 Intellect Admin 一致
- **鉴权**：通过 BFF 全局 `authMiddleware`（与 agent/session 路由共享）

> 详细迁移背景与实现见 [vite-architecture.md 第十五章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md)。

---

## 十六、BFF 层

### 16.1 定位

BFF 是 Node 端的薄层服务，承担三类职责：

1. **Admin 数据托管**：whitelist / roles / resources（JSON 持久化）
2. **Intellect 代理**：agent / session 路由当前是纯代理（`intellect-client.ts`）
3. **多 Harness 适配**（计划中）：`IHarnessAdapter` 抽象不同后端

### 16.2 目录结构

```
bff/src/
├── middleware/
│   ├── auth.ts             # 全局鉴权
│   └── error.ts            # 全局错误处理
├── routes/
│   ├── admin.ts            # BFF 接管的 admin 路由
│   ├── agent.ts            # Agent 代理（将重构为 Adapter）
│   ├── session.ts          # Session 代理（将重构为 Adapter）
│   └── health.ts           # 健康检查
├── services/
│   ├── admin-store.ts      # JSON 持久化层
│   └── intellect-client.ts   # Intellect HTTP 客户端
├── types/
│   └── index.ts
└── index.ts                # Hono 入口
```

### 16.3 中间件链

```ts
app.use('*', logger());
app.use('*', cors());
app.use('*', errorHandler);

app.route('/health', healthRoutes);          // 无鉴权

app.use('/api/*', authMiddleware);           // 鉴权闸门
app.route('/api/agent', agentRoutes);
app.route('/api/session', sessionRoutes);
app.route('/api/admin', adminRoutes);
```

### 16.4 多 Harness 演进

按 [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) 计划：

- 引入 `services/adapters/`（`types.ts` + `intellect-adapter.ts` + `intellect-enterprise-adapter.ts`）
- 引入 `services/adapter-registry.ts` 按 TenantContext 选择 Adapter
- 新增 `routes/harness-admin.ts`（后端配置）、`routes/tenant.ts`、`routes/team.ts`、`routes/project.ts`、`routes/canvas.ts`
- 前端仅改 `api.ts` 路径常量 + 新增 Admin 页面 + `useHarnessCapabilities()` Hook

---

## 十七、多 Harness 后端支持衔接

本节仅说明前端框架层面与多 Harness 方案的衔接点，详细设计见 [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md)。

### 17.1 前端零业务改动原则

- 业务页面（Agent / Session / Canvas / Datasets / Chats / Memories 等）**不改业务代码**
- 仅改 `src/utils/api.ts` 中的路径常量（指向 `/api/bff/*`）
- 新增 `src/hooks/use-harness-capabilities.ts`：调用 `/api/bff/capabilities` 获取后端能力，条件渲染

### 17.2 新增 Admin 页面（P1-P3）

| 页面 | 路径 | 数据来源 |
|------|------|---------|
| Harness 后端管理 | `/admin/harnesses` | BFF `harness-admin` 路由 |
| 租户管理 | `/admin/tenants` | BFF `tenant` 路由 |
| Team 管理 | `/admin/teams` | BFF `team` 路由透传 Intellect |
| Project 管理 | `/admin/projects` | BFF `project` 路由透传 Intellect |

### 17.3 Token 安全存储

按 [multi-harness-design.md §四](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md)：

- 敏感 admin token 通过环境变量注入 BFF，**不持久化**
- 普通配置存 JSON 文件
- 前端无感知

### 17.4 SSE 流式

- 以 Intellect OpenAI 兼容 SSE 为基础
- Intellect 通过其 `api_server` (port 8642) 暴露 OpenAI 兼容接口
- 前端 SSE 解析逻辑（`eventsource-parser`）不动

---

## 十八、关键文件清单

### 入口与路由

| 文件 | 职责 |
|------|------|
| [src/main.tsx](file:///Users/simon/workspace/agentui/src/main.tsx) | ReactDOM 渲染入口 |
| [src/app.tsx](file:///Users/simon/workspace/agentui/src/app.tsx) | Provider 栈 |
| [src/routes.tsx](file:///Users/simon/workspace/agentui/src/routes.tsx) | 路由表 + `Routes` 枚举 |
| [src/layouts/root-layout.tsx](file:///Users/simon/workspace/agentui/src/layouts/root-layout.tsx) | 主应用布局 |

### 网络与鉴权

| 文件 | 职责 |
|------|------|
| [src/utils/api.ts](file:///Users/simon/workspace/agentui/src/utils/api.ts) | **API 路径唯一来源** |
| [src/utils/request.ts](file:///Users/simon/workspace/agentui/src/utils/request.ts) | 旧 umi-request（deprecated） |
| [src/utils/next-request.ts](file:///Users/simon/workspace/agentui/src/utils/next-request.ts) | 新 axios 封装 |
| [src/utils/authorization-util.ts](file:///Users/simon/workspace/agentui/src/utils/authorization-util.ts) | Token 存取 |
| [src/services/admin-service.ts](file:///Users/simon/workspace/agentui/src/services/admin-service.ts) | Admin 独立 axios 实例 |

### Admin 模块

| 文件 | 职责 |
|------|------|
| [src/pages/admin/layouts/root-layout.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/layouts/root-layout.tsx) | Admin 顶层 + Context |
| [src/pages/admin/layouts/authorized-layout.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/layouts/authorized-layout.tsx) | 登录守卫 |
| [src/pages/admin/layouts/navigation-layout.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/layouts/navigation-layout.tsx) | 导航 + 登出 |
| [src/pages/admin/utils.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/utils.tsx) | `IS_ENTERPRISE` 等常量 |
| [src/pages/admin/whitelist.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/whitelist.tsx) | 白名单页（BFF 数据源） |
| [src/pages/admin/roles.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/roles.tsx) | 角色页（BFF 数据源） |
| [src/pages/admin/forms/role-form.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/forms/role-form.tsx) | 角色表单 |

### BFF 层

| 文件 | 职责 |
|------|------|
| [bff/src/index.ts](file:///Users/simon/workspace/agentui/bff/src/index.ts) | Hono 入口 |
| [bff/src/middleware/auth.ts](file:///Users/simon/workspace/agentui/bff/src/middleware/auth.ts) | 全局鉴权 |
| [bff/src/middleware/error.ts](file:///Users/simon/workspace/agentui/bff/src/middleware/error.ts) | 全局错误处理 |
| [bff/src/routes/admin.ts](file:///Users/simon/workspace/agentui/bff/src/routes/admin.ts) | BFF 接管的 admin 路由 |
| [bff/src/routes/agent.ts](file:///Users/simon/workspace/agentui/bff/src/routes/agent.ts) | Agent 代理 |
| [bff/src/routes/session.ts](file:///Users/simon/workspace/agentui/bff/src/routes/session.ts) | Session 代理 |
| [bff/src/services/admin-store.ts](file:///Users/simon/workspace/agentui/bff/src/services/admin-store.ts) | JSON 持久化 |
| [bff/src/services/intellect-client.ts](file:///Users/simon/workspace/agentui/bff/src/services/intellect-client.ts) | Intellect HTTP 客户端 |

### 构建配置

| 文件 | 职责 |
|------|------|
| [vite.config.ts](file:///Users/simon/workspace/agentui/vite.config.ts) | Vite 配置 |
| [package.json](file:///Users/simon/workspace/agentui/package.json) | npm workspaces |
| [tsconfig.json](file:///Users/simon/workspace/agentui/tsconfig.json) | TS 配置 |
| [postcss.config.cjs](file:///Users/simon/workspace/agentui/postcss.config.cjs) | PostCSS |
| [nginx/default.conf](file:///Users/simon/workspace/agentui/nginx/default.conf) | 部署反代 |

---

## 十九、约束与演进方向

### 19.1 当前约束

1. **API 路径集中管理**：所有 URL 必须在 `src/utils/api.ts` 定义。
2. **页面即模块**：每个业务模块在 `src/pages/<module>/` 自成目录。
3. **BFF 是唯一适配层**：前端不直接对接 Harness 后端，必须经 BFF。
4. **响应包络统一**：`{ code, message, data }`。
5. **文档同步**：架构调整必须同步更新 `docs/`。
6. **Admin 强耦合功能留在 Intellect Admin**：users / services / sandbox / version 不迁移。
7. **BFF 数据用 JSON 持久化**：避免引入 DB（直到多租户阶段再评估）。

### 19.2 演进方向

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | BFF 接管 whitelist / roles / resources | ✅ 已完成 |
| P1 | 引入 `IHarnessAdapter`，重构 agent/session 路由 | 计划中 |
| P2 | 接入 Intellect 企业版，新增 Team/Project/Harness 管理 | 计划中 |
| P3 | 多租户绑定模型、能力探测、Admin 后端配置页 | 计划中 |
| P4+ | ACP Adapter（社区版/Hermes/OpenClaw）、SSE 事件合集扩展 | 长期 |

### 19.3 待治理项

1. **`umi-request` 迁移**：`src/utils/request.ts` 已 deprecated，需逐步将旧 service 迁到 axios。
2. **接口类型自动生成**：`scripts/gen-api-types.ts` 已就位，需推动 Intellect / Intellect 暴露 OpenAPI schema。
3. **BFF 鉴权增强**：当前 `authMiddleware` 仅做透传，多租户阶段需引入 TenantContext。
4. **Storybook 覆盖**：基础组件库（`ui/`）需补齐 stories。
5. **测试覆盖**：当前 hooks 有少量测试，需扩大覆盖。

---

## 二十、相关文档索引

| 文档 | 范围 |
|------|------|
| [frontend-architecture.md](file:///Users/simon/workspace/agentui/docs/frontend-architecture.md) | 前端框架总体（本文档） |
| [vite-architecture.md](file:///Users/simon/workspace/agentui/docs/vite-architecture.md) | Vite 构建 / 代理 / 样式 / 部署细节 |
| [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) | 多 Harness 后端支持设计方案 |
| [intellect-admin-api-guide.md](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md) | Intellect 侧 Team/Project API 接口指南 |
| [canvas-mechanism.md](file:///Users/simon/workspace/agentui/docs/canvas-mechanism.md) | 画布机制 |
| [orchestration-session-aggregation.md](file:///Users/simon/workspace/agentui/docs/orchestration-session-aggregation.md) | 编排与会话聚合 |
| [references/http_api_reference.md](file:///Users/simon/workspace/agentui/docs/references/http_api_reference.md) | HTTP API 参考 |
