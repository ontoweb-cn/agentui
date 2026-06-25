# AgentUI Vite 架构系统性分析

## 一、整体架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     Vite 构建系统                             │
│                                                             │
│  入口: index.html → src/main.tsx → src/app.tsx              │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │  插件层   │  │  代理层   │  │  样式层    │  │  构建层    │  │
│  │          │  │          │  │           │  │           │  │
│  │ React    │  │ /api/bff │  │ Tailwind  │  │ Terser    │  │
│  │ Inspector│  │ /api/v1  │  │ Less      │  │ Rollup    │  │
│  │ HTML     │  │ /api     │  │ PostCSS   │  │ Chunking  │  │
│  │ StaticCopy│ │ /v1     │  │ CSS Module│  │ TreeShake │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────┘  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                 │
│  │  解析层   │  │  优化层   │  │  环境层    │                 │
│  │          │  │          │  │           │                 │
│  │ Alias    │  │ Pre-bundle│  │ .env.dev  │                 │
│  │ TS Config│  │ HMR      │  │ .env.prod │                 │
│  │ ESBuild  │  │ Cache    │  │ loadEnv   │                 │
│  └──────────┘  └──────────┘  └───────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## 二、插件体系（6 个插件协同）

### 插件加载顺序

```javascript
plugins: [
  inspectorBabelPlugin(),  // 1. 自定义 Babel 插件（enforce: 'pre'）
  react(),                 // 2. React Fast Refresh + JSX
  viteStaticCopy(),        // 3. 静态资源拷贝
  createHtmlPlugin(),      // 4. HTML 模板注入
  inspectorServer(),       // 5. DevInspector 服务端
]
```

### 各插件职责

| 插件 | 作用 | 关键配置 |
|------|------|---------|
| **inspectorBabelPlugin** | 自定义插件，为 JSX 添加代码位置数据属性 | `enforce: 'pre'`，跳过 node_modules，仅处理 `.jsx/.tsx` |
| **@vitejs/plugin-react** | React 支持（Fast Refresh、JSX 转换） | 默认配置 |
| **vite-plugin-static-copy** | 拷贝静态资源到 dist | `conf.json` + `monaco-editor/vs` |
| **vite-plugin-html** | HTML 模板注入 | 注入 `title: appName` |
| **@react-dev-inspector/vite-plugin** | 开发时元素检查器 | Alt+C 激活，跳转 VS Code |

### Inspector Babel 插件详解

这是项目自定义的插件，用于支持 react-dev-inspector 的点击跳转功能：

```javascript
const inspectorBabelPlugin = () => ({
  name: 'inspector-babel',
  enforce: 'pre',  // 在所有其他插件之前执行
  async transform(code, id) {
    if (id.includes('node_modules')) return;  // 跳过依赖
    if (!/\.[jt]sx$/.test(id)) return;        // 仅处理 JSX/TSX

    const { transform } = await import('@react-dev-inspector/babel-plugin');
    return {
      code: transform({ filePath: id, sourceCode: code }),
      map: null,
    };
  },
});
```

## 三、代理层架构（四层路由）

### 代理路由表

```javascript
const proxy = {
  '/api/bff':     → http://localhost:${bffPort}        // BFF 层
  '/api/v1/admin': → http://${apiHost}:${pythonAdminPort}  // Intellect Admin
  '/api':         → http://${apiHost}:${pythonApiPort}     // Intellect API
  '/v1':          → http://${apiHost}:${pythonApiPort}     // Intellect Web API
};
```

### 请求路由决策树

```
前端请求
  ├── /api/bff/*        → BFF (:9390)        [rewrite: 去除 /api/bff 前缀]
  ├── /api/v1/admin/*   → Intellect Admin (:9381)  [透传]
  ├── /api/*            → Intellect API (:9380)    [透传]
  └── /v1/*             → Intellect API (:9380)    [透传]
```

### 环境变量驱动

```javascript
const apiHost = env.API_HOST || 'localhost';
const pythonApiPort = env.PYTHON_API_PORT || '9380';
const pythonAdminPort = env.PYTHON_ADMIN_PORT || '9381';
const bffPort = env.BFF_PORT || '3001';
```

所有代理目标都通过 `.env` 文件配置，支持不同环境灵活切换。

### BFF 代理的特殊处理

```javascript
'/api/bff': {
  target: `http://localhost:${bffPort}`,
  changeOrigin: true,
  ws: true,
  rewrite: (p) => p.replace(/^\/api\/bff/, ''),  // 重写路径
},
```

BFF 代理是唯一带 `rewrite` 的，将 `/api/bff/agent` 重写为 `/agent`，因为 BFF 内部路由不带 `/api/bff` 前缀。

## 四、样式架构（三层混合）

### 样式处理链

```
源码样式
  ├── Tailwind CSS (utility-first)     ← tailwind.config.js
  ├── Less (组件级样式)                  ← vite css.preprocessorOptions
  └── CSS Modules (局部样式)            ← css.modules.localsConvention
      ↓
  PostCSS (autoprefixer + tailwind)     ← postcss.config.cjs
      ↓
  最终 CSS
```

### Tailwind 配置特点

1. **CSS 变量驱动主题** - 大量使用 `var(--xxx)` 实现暗色模式切换
2. **自定义断点** - 扩展到 `3xl: 1780px` 和 `4xl: 1980px`
3. **设计系统色板** - 完整的 semantic colors（text-primary、bg-card、state-success 等）
4. **动画系统** - accordion、caret-blink、spin-reverse、bell-shake

### Less 全局注入

```javascript
preprocessorOptions: {
  less: {
    javascriptEnabled: true,
    additionalData: `
      @import "@/less/variable.less";
      @import "@/less/mixins.less";
    `,           // 每个 .less 文件自动注入变量和 mixins
    modifyVars: {
      hack: `true; @import "@/less/index.less";`,  // 全局覆盖 Ant Design 变量
    },
  },
},
```

### CSS Modules

```javascript
css: {
  modules: {
    localsConvention: 'camelCase',  // .my-class → styles.myClass
  },
},
```

## 五、构建优化策略

### 1. 依赖预构建（optimizeDeps）

```javascript
optimizeDeps: {
  include: ['react', 'react-dom', 'react-router', 'axios', 'lodash', 'dayjs'],
  force: false,
}
```

将核心依赖预构建为 ESM，减少开发启动时间。

### 2. 代码分割策略（manualChunks）

```javascript
manualChunks(id) {
  // 1. 语言包独立分包
  if (id.includes('src/locales/') && id.endsWith('.ts')) {
    return `locale-${match[1]}`;  // locale-zh, locale-en, ...
  }

  // 2. 第三方库按包名分包
  if (id.includes('node_modules')) {
    if (id.includes('node_modules/d3')) return 'd3';
    if (id.includes('node_modules/ajv')) return 'ajv';
    if (id.includes('node_modules/@antv')) return 'antv';
    
    // 工具类合并
    if (['lodash', 'dayjs', 'date-fns', 'axios'].includes(name)) {
      return 'utils';
    }
    return name;  // 其他按包名分包
  }
}
```

### 分包策略图

```
dist/
├── entry/js/          ← 入口 chunk
├── chunk/js/          ← 按需加载 chunk
│   ├── locale-zh-[hash].js
│   ├── locale-en-[hash].js
│   ├── d3-[hash].js
│   ├── antv-[hash].js
│   ├── utils-[hash].js
│   ├── react-[hash].js
│   ├── @xyflow-[hash].js
│   └── ...
└── assets/
    ├── css/[name]-[hash].css
    ├── png/[name]-[hash].png
    └── ...
```

### 3. 压缩配置

```javascript
minify: resolveMinify(env.VITE_MINIFY),  // 默认 terser，可切 esbuild

terserOptions: {
  compress: {
    drop_console: true,      // 移除 console.log
    drop_debugger: true,     // 移除 debugger
    pure_funcs: ['console.log'],
  },
  mangle: { properties: false },  // 不混淆属性名
  format: { comments: false },     // 移除注释
},
```

### 4. 其他构建选项

| 配置 | 值 | 说明 |
|------|-----|------|
| `assetsInlineLimit` | 4096 | 4KB 以下资源转 base64 |
| `experimentalMinChunkSize` | 30KB | 最小 chunk 大小 |
| `chunkSizeWarningLimit` | 1000KB | chunk 警告阈值 |
| `cssCodeSplit` | true | CSS 按需加载 |
| `target` | 'es2015' | 兼容 ES6 |
| `treeshake` | true | 树摇优化 |

## 六、路径解析与别名

### 别名配置

```javascript
resolve: {
  alias: {
    '@': path.resolve(import.meta.dirname, './src'),
    '@intellect-docs': path.resolve(import.meta.dirname, '../intellect/docs'),
  },
},
```

### 跨项目引用

```javascript
server: {
  fs: {
    allow: [
      path.resolve(import.meta.dirname),           // 当前项目
      path.resolve(import.meta.dirname, '../intellect'),  // Intellect 项目
    ],
  },
},
```

**特殊设计**：允许 Vite 直接访问 `../intellect/docs` 目录，实现跨项目文档引用。`@intellect-docs` 别名可以在前端代码中直接 import Intellect 的 Markdown 文档。

## 七、开发服务器配置

```javascript
server: {
  port: Number(env.PORT) || 9391,  // 默认 9222
  strictPort: false,                // 端口被占用则自动+1
  hmr: {
    overlay: false,                 // 关闭 HMR 错误遮罩
  },
  proxy,                            // 四层代理
  fs: {
    allow: [...],                   // 跨项目文件访问
  },
},
```

### HMR 配置

关闭了 HMR 错误遮罩（`overlay: false`），避免开发时错误弹窗干扰。HMR 仍然正常工作，只是不显示全屏错误提示。

## 八、环境变量体系

### 环境文件

| 文件 | 用途 |
|------|------|
| `.env.development` | 开发环境：`API_HOST=localhost`、端口配置 |
| `.env.production` | 生产环境：仅 `VITE_BASE_URL='/'` |

### 环境变量加载

```javascript
const env = loadEnv(mode, process.cwd(), '');
// 第三个参数 '' 表示加载所有环境变量（不只 VITE_ 前缀的）
```

### 运行时注入

```javascript
define: {
  'import.meta.env.API_PROXY_SCHEME': JSON.stringify('python'),
  __API_PROXY_SCHEME__: JSON.stringify('python'),
},
```

通过 `define` 在编译时注入常量，前端代码可读取 `import.meta.env.API_PROXY_SCHEME` 判断后端类型。

## 九、TypeScript 与 ESBuild 配置

### tsconfig.json 要点

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "moduleResolution": "bundler",    // Vite 模式解析
    "isolatedModules": true,           // 独立模块编译
    "strict": true,
    "jsx": "react-jsx",                // 自动导入 React
    "paths": { "@/*": ["src/*"] }      // 路径别名
  }
}
```

### Vite 中的 ESBuild 覆盖

```javascript
esbuild: {
  tsconfigRaw: {
    compilerOptions: {
      strict: false,           // ← 覆盖 tsconfig 的 strict: true
      noImplicitAny: false,    // ← 允许隐式 any
      skipLibCheck: true,
    },
  },
},
```

**注意**：Vite 使用 esbuild 转译 TS，这里放宽了严格性以提升开发速度。`tsc --noEmit`（type-check 脚本）仍使用严格模式做类型检查。

## 十、静态资源处理

### viteStaticCopy

```javascript
viteStaticCopy({
  targets: [
    { src: 'src/conf.json', dest: './' },              // 应用配置
    { src: 'node_modules/monaco-editor/min/vs/', dest: './' },  // Monaco Editor
  ],
}),
```

将 `conf.json` 和 Monaco Editor 的 `vs` 目录拷贝到 dist 根目录。Monaco Editor 需要这些文件作为 Web Worker。

### assetsInclude

```javascript
assetsInclude: ['**/*.md'],  // Markdown 文件作为资源处理
```

允许 import `.md` 文件作为资源 URL。

## 十一、缓存策略

```javascript
cacheDir: '/tmp/agentui-vite-cache',
```

将 Vite 缓存放在 `/tmp` 目录，避免项目目录膨胀，同时利用系统临时目录的快速清理特性。

## 十二、架构特点总结

### 设计亮点

1. **四层代理清晰分离** - BFF / Admin / API / Web API 各走各的通道
2. **跨项目文档引用** - `@intellect-docs` 别名直接引用 Intellect 文档
3. **语言包按需分包** - 每个语言独立 chunk，避免首屏加载所有翻译
4. **Inspector 开发体验** - Alt+C 点击元素直接跳转 VS Code 源码
5. **CSS 变量主题系统** - Tailwind + CSS 变量实现完整的暗色模式

### 潜在关注点

1. **esbuild vs tsc 严格性不一致** - 开发时宽松，类型检查时严格
2. **cacheDir 在 /tmp** - 系统重启后缓存丢失，首次启动较慢
3. **manualChunks 过细** - 每个 npm 包一个 chunk 可能导致过多 HTTP 请求
4. **Less modifyVars hack** - 使用 `hack: true` 注入全局变量，不够优雅

### 整体评价

AgentUI 的 Vite 配置是一个**中等复杂度**的生产级配置，在开发体验（HMR、Inspector、代理）、构建优化（分包、压缩、树摇）和样式系统（Tailwind + Less + CSS Modules 混合）之间取得了良好平衡。跨项目引用 Intellect 文档的设计体现了从单体仓库分离后的平滑过渡策略。

## 十三、前端模块新增/删除流程

### 模块的组成结构

AgentUI 中一个完整的"模块"由 **7 个部分**组成，以 `memories`（记忆）模块为例：

```
src/
├── pages/memories/           ← 1. 页面组件
├── hooks/use-memory-request.ts  ← 2. 数据请求 Hook
├── services/memory-service.ts   ← 3. HTTP 服务封装
├── utils/api.ts              ← 4. API 路径定义
├── interfaces/database/memory.ts ← 5. TypeScript 类型
├── locales/zh.ts             ← 6. 国际化翻译
└── routes.tsx                ← 7. 路由注册

layouts/components/global-navbar.tsx ← 8. 导航菜单
```

### 新增模块流程（8 步）

#### Step 1: 定义 API 路径

在 [src/utils/api.ts](../src/utils/api.ts) 中添加 API 端点：

```typescript
// memory
createMemory: `${restAPIv1}/memories`,
getMemoryList: `${restAPIv1}/memories`,
deleteMemory: (id: string) => `${restAPIv1}/memories/${id}`,
```

#### Step 2: 定义 TypeScript 类型

在 `src/interfaces/database/` 下创建类型文件，如 `memory.ts`：

```typescript
export interface IMemory {
  id: string;
  name: string;
  // ...
}
```

#### Step 3: 创建 Service 层

在 `src/services/` 下创建 `memory-service.ts`，封装 HTTP 调用：

```typescript
import api from '@/utils/api';
import request from '@/utils/request';

const methods = {
  getMemoryList: { url: api.getMemoryList, method: 'get' },
  // ...
};

const memoryService = registerNextServer(methods);
export default memoryService;
```

#### Step 4: 创建请求 Hook

在 `src/hooks/` 下创建 `use-memory-request.ts`，使用 TanStack Query：

```typescript
export const enum MemoryApiAction {
  FetchMemoryList = 'fetchMemoryList',
}

export const useFetchAllMemoryList = () => {
  const { data } = useQuery({
    queryKey: [MemoryApiAction.FetchMemoryList],
    queryFn: async () => {
      const { data } = await memoryService.getMemoryList({...});
      return data.data;
    },
  });
  return { data };
};
```

#### Step 5: 创建页面组件

在 `src/pages/` 下创建模块目录，如 `memories/index.tsx`：

```tsx
export default function MemoryList() {
  const { t } = useTranslate('memories');
  const { data } = useFetchAllMemoryList();
  return <CardContainer>...</CardContainer>;
}
```

#### Step 6: 注册路由

在 [src/routes.tsx](../src/routes.tsx) 中添加两处：

**6a. 添加路由枚举**（顶部 `Routes` enum）：

```typescript
export enum Routes {
  // ...
  Memories = '/memories',     // ← 新增
}
```

**6b. 添加路由配置**（`routeConfigOptions` 数组，在 `Root` 的 children 中）：

```typescript
{
  path: Routes.Root,
  Component: () => import('@/layouts/root-layout'),
  children: [
    // ...
    {
      path: Routes.Memories,                              // ← 新增
      Component: () => import('@/pages/memories'),        // ← 懒加载
    },
  ],
}
```

#### Step 7: 添加导航菜单

在 [src/layouts/components/global-navbar.tsx](../src/layouts/components/global-navbar.tsx) 中添加两处：

**7a. 添加 PathMap**（用于高亮判断）：

```typescript
const PathMap = {
  // ...
  [Routes.Memories]: [Routes.Memories, Routes.Memory, Routes.MemoryMessage],
} as const;
```

**7b. 添加 menuItems**：

```typescript
const menuItems = [
  // ...
  { path: Routes.Memories, name: 'header.memories' },  // ← 新增
];
```

#### Step 8: 添加国际化翻译

在 `src/locales/` 下的**所有语言文件**中添加翻译，至少包含 `zh.ts` 和 `en.ts`：

```typescript
// zh.ts
header: {
  memories: '记忆',       // ← 导航菜单文字
},
memories: {              // ← 页面内文案
  title: '记忆',
  // ...
},
```

```typescript
// en.ts
header: {
  memories: 'Memory',
},
memories: {
  title: 'Memory',
  // ...
},
```

### 删除模块流程（反向 8 步）

删除模块按**反向顺序**操作，确保不留下悬空引用：

| 步骤 | 操作 | 文件 |
|------|------|------|
| 1 | 移除国际化翻译 | `src/locales/*.ts`（所有语言文件） |
| 2 | 移除导航菜单项 | `global-navbar.tsx` 的 `menuItems` 和 `PathMap` |
| 3 | 移除路由配置 | `routes.tsx` 的 `Routes` enum 和 `routeConfigOptions` |
| 4 | 删除页面组件目录 | `src/pages/memories/` |
| 5 | 删除请求 Hook | `src/hooks/use-memory-request.ts` |
| 6 | 删除 Service 文件 | `src/services/memory-service.ts` |
| 7 | 移除 API 路径定义 | `src/utils/api.ts` 中相关条目 |
| 8 | 删除类型定义 | `src/interfaces/database/memory.ts` |

### 流程图

```
新增模块:
  api.ts → types → service → hook → page → routes → navbar → locales
    1       2       3         4       5       6         7         8

删除模块:
  locales → navbar → routes → page → hook → service → api.ts → types
    1         2        3       4       5       6          7        8
```

### 注意事项

1. **路由懒加载** - 使用 `() => import('@/pages/xxx')` 而非直接 import，确保代码分割
2. **PathMap 必须同步** - 如果模块有子路由（如 `memories` → `memory/:id`），需在 `PathMap` 中列出所有相关路径，否则导航高亮不生效
3. **国际化全量更新** - 项目支持 17 种语言，至少更新 `zh.ts` 和 `en.ts`，其他语言可后续补充
4. **TanStack Query Key** - 使用 `enum` 定义 queryKey，避免字符串硬编码冲突
5. **registerNextServer** - Service 层使用 `registerNextServer` 统一注册方法，保持一致性
6. **layout 配置** - 无需布局的页面（如分享页、登录页）设置 `layout: false`；需要侧边栏的页面放在 `Root` 的 children 中

### 涉及文件清单

| 文件 | 作用 | 新增时操作 | 删除时操作 |
|------|------|-----------|-----------|
| `src/utils/api.ts` | API 路径 | 添加端点 | 移除端点 |
| `src/interfaces/database/xxx.ts` | 类型定义 | 新建文件 | 删除文件 |
| `src/services/xxx-service.ts` | HTTP 封装 | 新建文件 | 删除文件 |
| `src/hooks/use-xxx-request.ts` | 请求 Hook | 新建文件 | 删除文件 |
| `src/pages/xxx/index.tsx` | 页面组件 | 新建目录 | 删除目录 |
| `src/routes.tsx` | 路由 | 添加 enum + config | 移除 enum + config |
| `src/layouts/components/global-navbar.tsx` | 导航 | 添加 menuItems + PathMap | 移除 menuItems + PathMap |
| `src/locales/zh.ts` | 中文翻译 | 添加 key | 移除 key |
| `src/locales/en.ts` | 英文翻译 | 添加 key | 移除 key |

## 十四、微前端设计方案

### 现状约束分析

在设计前，需考虑以下现有架构约束：

| 约束 | 影响 |
|------|------|
| Vite 7.x + React 18 | 优先选择 Vite 原生支持的方案 |
| React Router v7 (BrowserRouter) | 需协调路由劫持/接管 |
| TanStack Query 全局缓存 | 跨应用状态隔离与共享 |
| Zustand store（画布状态） | 子应用间状态通信 |
| Tailwind + Less + CSS Variables | 样式隔离需求 |
| 已有 `@intellect-docs` 跨项目引用 | 未来可能深度集成 Intellect 模块 |
| 懒加载 + manualChunks | 现有代码分割策略需兼容 |

### 方案一：Vite Module Federation（推荐）

#### 原理

使用 `@originjs/vite-plugin-federation`，基于 Webpack Module Federation 理念，Vite 原生支持。

#### 架构

```
┌─────────────────────────────────────────────┐
│           Host App (AgentUI 主应用)           │
│  ┌───────────────────────────────────────┐  │
│  │  Shell: 导航 + 路由 + 布局              │  │
│  │  ┌─────────┐  ┌─────────┐            │  │
│  │  │ Remote  │  │ Remote  │  ...       │  │
│  │  │ Agent   │  │ Dataset │            │  │
│  │  │ Module  │  │ Module  │            │  │
│  │  └─────────┘  └─────────┘            │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         ↑ 运行时加载         ↑ 运行时加载
    Agent Module (独立部署)  Dataset Module (独立部署)
```

#### 配置示例

**主应用 (Host) - vite.config.js:**
```javascript
import federation from '@originjs/vite-plugin-federation';

plugins: [
  federation({
    name: 'agentui-host',
    remotes: {
      agentModule: 'http://cdn.example.com/agent-module/remoteEntry.js',
      datasetModule: 'http://cdn.example.com/dataset-module/remoteEntry.js',
    },
    shared: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
  }),
]
```

**子应用 (Remote) - vite.config.js:**
```javascript
federation({
  name: 'agent-module',
  filename: 'remoteEntry.js',
  exposes: {
    './AgentPage': './src/pages/agent/index.tsx',
    './AgentCanvas': './src/pages/agent/canvas/index.tsx',
  },
  shared: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
})
```

#### 优点
- Vite 原生插件，与现有构建无缝集成
- 共享依赖（react/react-dom），避免重复加载
- 运行时动态加载，支持独立部署
- 保持现有 Vite 配置大部分不变

#### 缺点
- 生产环境需构建为 SystemJS 格式（与现有 ES module 输出不同）
- `shared` 依赖版本需严格对齐
- SSR 不友好（当前项目不涉及）
- 调试体验略降（跨应用断点困难）

#### 改动范围
- `vite.config.js` 增加 federation 插件
- `routes.tsx` 中部分路由改为远程加载
- `package.json` 新增依赖
- 构建输出格式调整

### 方案二：qiankun

#### 原理

阿里开源的微前端框架，基于 single-spa，通过 JS 沙箱隔离子应用。

#### 架构

```
┌─────────────────────────────────────────────┐
│         qiankun 主应用 (AgentUI)              │
│  ├── 全局导航、布局                           │
│  ├── 子应用注册表                             │
│  └── 子应用生命周期管理                        │
└──────┬──────────────┬──────────────┬────────┘
       │              │              │
  ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
  │ Agent   │   │ Dataset │   │ Chat    │
  │ 子应用   │   │ 子应用   │   │ 子应用   │
  │ (独立   │   │ (独立   │   │ (独立   │
  │  Vite)  │   │  Vite)  │   │  Vite)  │
  └─────────┘   └─────────┘   └─────────┘
```

#### 接入方式

```typescript
// 主应用注册子应用
import { registerMicroApps, start } from 'qiankun';

registerMicroApps([
  {
    name: 'agent-app',
    entry: '//localhost:9223',  // 子应用独立 Vite 服务
    activeRule: '/agent',
    container: '#sub-app-viewport',
  },
  {
    name: 'dataset-app',
    entry: '//localhost:9224',
    activeRule: '/dataset',
    container: '#sub-app-viewport',
  },
]);

start({ prefetch: true });
```

#### 优点
- 成熟稳定，中文社区活跃
- JS 沙箱隔离（Proxy 沙箱）
- 样式隔离（shadow DOM 或 scoped css）
- 子应用技术栈无关（可混用 React/Vue）
- 丰富的生命周期钩子

#### 缺点
- Vite 开发模式需额外适配（`vite-plugin-qiankun`）
- 沙箱有性能开销
- 与 React Router v7 的 BrowserRouter 集成需特殊处理
- 全局变量污染风险（沙箱非 100% 隔离）
- 子应用需暴露 `mount`/`unmount` 生命周期

#### 改动范围
- 主应用增加 qiankun 注册逻辑
- 每个子应用增加 `lifecycle.ts` 导出
- 子应用 `vite.config.js` 增加 qiankun 插件
- 路由层需区分主子应用边界

### 方案三：wujie（无界）

#### 原理

腾讯开源，基于 Web Components + iframe 沙箱，利用 iframe 的天然隔离。

#### 架构

```
┌─────────────────────────────────────────────┐
│         wujie 主应用 (AgentUI)                │
│  ├── 导航、布局                               │
│  └── <wujie-app> Web Component               │
│       └── iframe (天然 JS 隔离)               │
│            └── 子应用 DOM 注入                │
└──────┬──────────────┬──────────────┬────────┘
       │              │              │
  ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
  │ Agent   │   │ Dataset │   │ Chat    │
  │ (iframe)│   │ (iframe)│   │ (iframe)│
  └─────────┘   └─────────┘   └─────────┘
```

#### 接入方式

```tsx
import WujieReact from 'wujie-react';

function AgentModule() {
  return (
    <WujieReact
      name="agent"
      url="//localhost:9223/agent"
      sync={true}                    // 路由同步
      props={{ token: getToken() }}  // 通信
    />
  );
}
```

#### 优点
- 最强的 JS 隔离（iframe 天然隔离）
- CSS 天然隔离（iframe 内部样式不影响外部）
- 子应用改造量最小（几乎零侵入）
- 预加载、保活模式支持
- Vite 原生兼容，无需特殊插件

#### 缺点
- iframe 通信有开销（postMessage）
- 弹窗/抽屉等 UI 受 iframe 边界限制（需 teleport）
- 路由同步需额外处理
- 内存占用较高（每个子应用一个 iframe）
- 全局快捷键、焦点管理跨 iframe 困难

#### 改动范围
- 主应用安装 `wujie-react`
- 路由层用 `<WujieReact>` 替换部分页面组件
- 子应用几乎无需改动
- 需处理弹窗 teleport 跨 iframe 问题

### 方案四：原生 ESM 动态导入

#### 原理

利用浏览器原生 ES Module 的 `import()` 动态加载，配合 SystemJS 或 Import Maps 实现依赖映射。无需框架。

#### 架构

```
┌─────────────────────────────────────────────┐
│           AgentUI 主应用                      │
│  ├── Import Maps (依赖映射)                   │
│  ├── 路由懒加载 → import()                   │
│  └── 动态注入 <script type="module">         │
└──────┬──────────────┬──────────────┬────────┘
       │              │              │
  ESM Module     ESM Module     ESM Module
  (CDN 独立部署)  (CDN 独立部署)  (CDN 独立部署)
```

#### 接入方式

```html
<!-- index.html -->
<script type="importmap">
{
  "imports": {
    "react": "https://cdn.example.com/react@18.2.0/react.js",
    "react-dom": "https://cdn.example.com/react-dom@18.2.0/react-dom.js",
    "agent-module": "https://cdn.example.com/agent-module@1.0.0/index.js"
  }
}
</script>
```

```typescript
// 路由中动态加载
const AgentPage = lazy(() => import('agent-module'));
```

#### 优点
- 零框架依赖，最轻量
- 浏览器原生支持，无运行时开销
- 完全的 ESM 标准，面向未来
- 共享依赖通过 Import Maps 自然解决

#### 缺点
- 开发体验差（Import Maps 在 Vite dev 模式下需 polyfill）
- 依赖 CDN 可靠性
- 无沙箱隔离（全局变量共享）
- 错误处理和回退机制需自建
- 生产环境需额外构建为 ESM 格式的独立包

#### 改动范围
- 构建配置需支持输出独立 ESM 包
- `index.html` 增加 Import Maps
- 路由改为通过 Import Maps 加载
- 需自建版本管理和回退机制

### 方案对比总结

| 维度 | Module Federation | qiankun | wujie | 原生 ESM |
|------|:-:|:-:|:-:|:-:|
| **Vite 兼容性** | 好（原生插件） | 中（需适配） | 好（无侵入） | 好（原生） |
| **隔离性** | 弱（共享全局） | 中（JS 沙箱） | 强（iframe） | 弱（无隔离） |
| **改造量** | 中 | 大 | 小 | 中 |
| **共享依赖** | 原生支持 | 手动处理 | 手动处理 | Import Maps |
| **独立部署** | 支持 | 支持 | 支持 | 支持 |
| **通信机制** | props/shared | 全局状态 | postMessage | 自定义 |
| **社区成熟度** | 中 | 高 | 中 | 低 |
| **性能** | 好 | 中 | 中（iframe） | 最好 |
| **调试体验** | 中 | 中 | 差（iframe） | 好 |
| **UI 一致性** | 好 | 好 | 差（iframe 边界） | 好 |

### 推荐建议

#### 场景 A：同团队、同技术栈、强 UI 一致性需求

**推荐方案一（Module Federation）**

理由：
- 与现有 Vite 架构最契合
- 共享 React/React-Dom，性能最优
- 弹窗、抽屉等 UI 组件天然无边界问题
- 适合 AgentUI 内部模块拆分（如 Agent 模块、Dataset 模块独立部署）

#### 场景 B：跨团队、跨技术栈、强隔离需求

**推荐方案二（qiankun）**

理由：
- 成熟度高，文档丰富
- 支持混用技术栈（未来可能集成非 React 模块）
- JS 沙箱满足安全隔离
- 适合与 Intellect 或第三方系统深度集成

#### 场景 C：快速接入、最小改造

**推荐方案三（wujie）**

理由：
- 子应用几乎零改造
- 天然隔离，无样式冲突
- 适合快速 POC 或渐进式迁移
- 但需评估 iframe 对画布等复杂交互的影响

### 下一步建议

1. **明确需求场景** - 是内部模块拆分还是外部系统集成？
2. **POC 验证** - 选定方案后，先用 Agent 模块做小范围验证
3. **重点验证项**：
   - 画布（React Flow）在微前端下的交互是否正常
   - TanStack Query 缓存是否需要跨应用共享
   - Tailwind 样式是否泄漏/冲突
   - 路由切换时的状态保持
4. **评估通信需求** - 主子应用间的状态共享方案（token、用户信息、主题等）

### POC 验证方案

基于之前的分析，推荐以 **方案一（Module Federation）** 为主进行 POC，因为它与现有 Vite 架构最契合。以下是完整的 POC 验证计划。

#### POC 目标与范围

##### 验证目标

| 目标 | 验证问题 |
|------|---------|
| **技术可行性** | Module Federation 能否在现有 Vite 7.x 架构上正常运行？ |
| **画布兼容性** | React Flow 画布在微前端下交互是否正常？ |
| **状态共享** | TanStack Query 缓存能否跨应用共享？ |
| **样式隔离** | Tailwind/Less 样式是否冲突泄漏？ |
| **路由协调** | React Router v7 能否与远程模块协同？ |
| **构建兼容** | 现有 manualChunks + 代码分割是否兼容？ |

##### POC 范围

选择 **Agent 模块** 作为 POC 对象，理由：
- 复杂度最高（含画布、SSE、Zustand store），验证充分
- 独立性强（相对完整的业务闭环）
- 如果最复杂的模块能跑通，其他模块风险可控

#### POC 实施步骤（5 个阶段）

##### 阶段 1：搭建 POC 工程（1-2 天）

**1.1 创建独立的 Remote 子应用**

```
agentui/                    # 主应用（Host）
agentui-agent-module/       # ← 新建 POC 子应用（Remote）
├── package.json
├── vite.config.js
├── src/
│   ├── index.tsx           # 导出入口
│   ├── pages/agent/        # 从主应用迁移
│   └── shared/
│       └── types.ts        # 共享类型
└── public/
```

**1.2 子应用 Vite 配置**

```javascript
// agentui-agent-module/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'agent-module',
      filename: 'remoteEntry.js',
      exposes: {
        './AgentPage': './src/pages/agent/index.tsx',
        './AgentCanvas': './src/pages/agent/canvas/index.tsx',
      },
      shared: {
        react: { requiredVersion: '^18.0.0' },
        'react-dom': { requiredVersion: '^18.0.0' },
        'react-router': { requiredVersion: '^7.0.0' },
        '@tanstack/react-query': { requiredVersion: '^5.0.0' },
        '@xyflow/react': { requiredVersion: '^12.0.0' },
        zustand: { requiredVersion: '^5.0.0' },
      },
    }),
  ],
  build: {
    target: 'esnext',
    minify: true,
    cssCodeSplit: false,
  },
  server: {
    port: 9223,
    cors: true,
  },
});
```

**1.3 主应用 Vite 配置修改**

```javascript
// agentui/vite.config.js 增加 federation 插件
import federation from '@originjs/vite-plugin-federation';

plugins: [
  // ... 现有插件
  federation({
    name: 'agentui-host',
    remotes: {
      agentModule: isDev
        ? 'http://localhost:9223/remoteEntry.js'
        : 'https://cdn.example.com/agent-module/remoteEntry.js',
    },
    shared: {
      react: { requiredVersion: '^18.0.0' },
      'react-dom': { requiredVersion: '^18.0.0' },
      'react-router': { requiredVersion: '^7.0.0' },
      '@tanstack/react-query': { requiredVersion: '^5.0.0' },
      '@xyflow/react': { requiredVersion: '^12.0.0' },
      zustand: { requiredVersion: '^5.0.0' },
    },
  }),
]
```

##### 阶段 2：模块迁移与接入（2-3 天）

**2.1 迁移 Agent 页面到子应用**

将以下文件从主应用复制到子应用：

```
src/pages/agent/           → 整个画布模块
src/hooks/use-agent-request.ts
src/hooks/use-send-agent-message.ts
src/services/agent-service.ts
src/interfaces/database/agent.ts
```

**2.2 主应用路由改为远程加载**

```typescript
// routes.tsx 修改前
{
  path: Routes.Agent,
  Component: () => import('@/pages/agent'),
}

// routes.tsx 修改后
const AgentPage = lazy(() => import('agentModule/AgentPage'));

{
  path: Routes.Agent,
  Component: AgentPage,
}
```

**2.3 处理共享依赖**

确保以下依赖在主子应用间共享：

| 依赖 | 共享策略 | 说明 |
|------|---------|------|
| react / react-dom | singleton | 必须单例 |
| react-router | singleton | 路由统一管理 |
| @tanstack/react-query | singleton | QueryClient 共享 |
| @xyflow/react | singleton | 画布库统一 |
| zustand | singleton | 状态管理统一 |
| antd | singleton | UI 组件库统一 |
| Tailwind 配置 | 复制 | 子应用需相同配置 |

##### 阶段 3：重点功能验证（2-3 天）

**验证清单**

| # | 验证项 | 验证方法 | 预期结果 | 实际结果 |
|---|--------|---------|---------|---------|
| 1 | **页面加载** | 访问 `/agent` | 远程模块正常加载，无白屏 | |
| 2 | **画布渲染** | 打开 Agent 编辑器 | 节点、边、Handle 正常显示 | |
| 3 | **拖拽创建节点** | 从 Handle 拖拽到空白 | Placeholder + Dropdown 正常 | |
| 4 | **节点配置** | 点击节点打开 FormSheet | 表单正常加载和提交 | |
| 5 | **SSE 聊天** | 发送消息测试 | 流式响应正常，执行路径高亮 | |
| 6 | **TanStack Query** | 检查 DevTools | 缓存正常共享，无重复请求 | |
| 7 | **Zustand Store** | 操作画布节点 | 状态更新正常，无丢失 | |
| 8 | **Tailwind 样式** | 检查暗色模式 | 样式一致，无泄漏 | |
| 9 | **Antd 组件** | 弹窗/抽屉/通知 | 正常渲染，层级正确 | |
| 10 | **路由跳转** | 从 Agent 跳到其他模块 | 路由正常，状态保持 | |
| 11 | **HMR 热更新** | 修改子应用代码 | 热更新生效 | |
| 12 | **构建产物** | `npm run build` | 产物正常，无报错 | |
| 13 | **首屏性能** | Lighthouse 检测 | LCP < 2.5s | |
| 14 | **包体积** | 分析 remoteEntry.js | < 500KB（不含 shared） | |

**关键验证脚本**

```typescript
// 验证 TanStack Query 共享
// 在主应用和子应用分别打印 QueryClient 实例
console.log('Host QueryClient:', queryClient);
// 子应用中
console.log('Remote QueryClient:', queryClient);
// 预期：同一实例引用

// 验证 React 单例
// 在子应用中检查
console.log('React version:', React.version);
console.log('Same React?', window.React === React);
```

##### 阶段 4：问题修复与调优（1-2 天）

**预期问题及解决方案**

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| **React 多实例** | shared 未生效 | 确保 `singleton: true`，检查版本对齐 |
| **样式丢失** | Tailwind 未编译子应用类名 | 子应用需配置相同 Tailwind + content 路径 |
| **路由 404** | BrowserRouter 未共享 | 主应用管理路由，子应用不注册 Router |
| **QueryClient 重复** | 未共享 QueryClientProvider | 主应用提供 Provider，子应用通过 props 获取 |
| **Antd 主题不一致** | ConfigProvider 未共享 | 主应用包裹 ConfigProvider |
| **画布状态丢失** | Zustand store 未共享 | store 定义在 shared 包中 |
| **HMR 不生效** | Federation 不支持 HMR | 开发时用本地 import，生产用 remote |

##### 阶段 5：评估与决策（1 天）

**评估报告模板**

```markdown
## POC 评估报告

### 1. 技术可行性
- [ ] Module Federation 在 Vite 7.x 下正常运行
- [ ] 生产构建产物符合预期
- [ ] 开发体验可接受

### 2. 功能完整性
- [ ] 画布全部交互正常
- [ ] SSE 流式聊天正常
- [ ] 状态管理无异常
- [ ] 样式无冲突

### 3. 性能指标
| 指标 | 主应用内 | 微前端 | 差异 |
|------|---------|--------|------|
| 首屏加载 | ___ms | ___ms | |
| 画布渲染 | ___ms | ___ms | |
| 内存占用 | ___MB | ___MB | |

### 4. 改造成本评估
- 需迁移文件数：___
- 新增配置代码：___ 行
- 涉及修改文件：___ 个

### 5. 结论
- [ ] 通过，可推进全量改造
- [ ] 有条件通过，需解决以下问题：___
- [ ] 不通过，建议换方案：___
```

#### POC 执行时间线

```
Day 1-2:  ████████░░░░  阶段1 - 搭建 POC 工程
Day 3-5:  ░░░░████████  阶段2 - 模块迁移与接入
Day 6-8:  ░░░░████████  阶段3 - 重点功能验证
Day 9-10: ░░░░████░░░░  阶段4 - 问题修复与调优
Day 11:   ░░░░░░░░██░░  阶段5 - 评估与决策
```

#### POC 前置准备

**环境准备**

```bash
# 1. 创建子应用目录
mkdir agentui-agent-module && cd agentui-agent-module

# 2. 初始化项目
npm init -y

# 3. 安装依赖
npm install vite @vitejs/plugin-react @originjs/vite-plugin-federation
npm install react react-dom react-router @tanstack/react-query @xyflow/react zustand
```

**回滚预案**

POC 过程中保持主应用原有代码可用：

```bash
# 使用 git 分支隔离
git checkout -b feature/microfrontend-poc

# POC 失败时
git checkout main
git branch -D feature/microfrontend-poc
```

#### 备选方案 POC

如果 Module Federation POC 遇到不可解决的问题，可快速切换验证 wujie：

```bash
# wujie POC 改动最小，只需在主应用安装
npm install wujie-react

# 路由中替换
<WujieReact name="agent" url="http://localhost:9223/agent" />
```

wujie 的 POC 可以在 **1 天内** 完成初步验证，作为备选参考。

## 十五、Admin 路由迁移到 BFF（未实现/弱耦合功能接管）

### 迁移背景

Intellect Admin 后端（:9381）的部分功能存在以下问题：

| 功能 | Intellect Admin 状态 | 问题 |
|------|-------------------|------|
| whitelist (CRUD + batch) | **无路由** | 前端调用 404 |
| roles (CRUD) | **stub**（`raise AdminException("not implement")`） | 前端调用报错 |
| roles_with_permission | **无路由** | 前端调用 404 |
| roles/resource | **无路由** | 前端调用 404 |

而强耦合功能（用户管理、服务监控、沙箱配置、系统变量）直接操作 Intellect 数据库与进程内对象，迁移会破坏边界。因此采用**分层解耦**策略：BFF 接管"未实现/弱耦合"功能，强耦合功能保留在 Intellect Admin。

### 迁移范围

```
┌──────────────────────────────────────────────────────────┐
│  AgentUI 前端 (:9391)                                    │
│  └── src/pages/admin/*  (前端代码不变)                   │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  BFF (:9390)                                             │
│  └── /api/admin/*  ← 新增                                │
│      ├── /whitelist          (CRUD + batch import)       │
│      ├── /roles              (CRUD)                      │
│      ├── /roles_with_permission (聚合查询)               │
│      ├── /roles/:name/permission (权限授予/撤销)         │
│      └── /roles/resource     (资源类型枚举)              │
└──────────────────────────────────────────────────────────┘
                          ↓ (强耦合功能保留)
┌──────────────────────────────────────────────────────────┐
│  Intellect Admin (:9381)                                   │
│  └── /api/v1/admin/*                                     │
│      ├── /users/*            (用户管理)                  │
│      ├── /services/*         (服务监控)                  │
│      ├── /sandbox/*          (沙箱配置)                  │
│      ├── /variables, /configs, /environments             │
│      └── /version            (版本信息)                  │
└──────────────────────────────────────────────────────────┘
```

### 实现细节

#### BFF 新增文件

| 文件 | 作用 |
|------|------|
| [bff/src/services/admin-store.ts](../bff/src/services/admin-store.ts) | JSON 文件持久化存储层（`bff/data/admin-state.json`） |
| [bff/src/routes/admin.ts](../bff/src/routes/admin.ts) | Admin 路由实现（whitelist + roles + resources） |

#### 存储设计

- **持久化方式**：JSON 文件（`bff/data/admin-state.json`），避免引入数据库依赖
- **初始化**：首次启动自动创建默认状态（admin 角色 + user 角色 + 4 种资源类型）
- **资源类型**：`agent` / `dataset` / `session` / `memory`（与前端 `PERMISSION_TYPES` 对齐）
- **并发**：单进程同步读写，适合 BFF 轻量场景；后续可演进为 SQLite

#### 路由清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/whitelist` | 列出白名单 |
| POST | `/api/admin/whitelist/add` | 添加白名单条目 |
| PUT | `/api/admin/whitelist/:id` | 更新白名单条目 |
| DELETE | `/api/admin/whitelist/:email` | 删除白名单条目 |
| POST | `/api/admin/whitelist/batch` | 批量导入（Excel/CSV） |
| GET | `/api/admin/roles` | 列出角色 |
| GET | `/api/admin/roles_with_permission` | 列出角色（含权限） |
| GET | `/api/admin/roles/resource` | 列出资源类型 |
| POST | `/api/admin/roles` | 创建角色 |
| PUT | `/api/admin/roles/:roleName` | 更新角色描述 |
| DELETE | `/api/admin/roles/:roleName` | 删除角色（内置 admin 不可删） |
| GET | `/api/admin/roles/:roleName/permissions` | 获取角色权限 |
| POST | `/api/admin/roles/:roleName/permission` | 授予权限 |
| DELETE | `/api/admin/roles/:roleName/permission` | 撤销权限 |

所有响应遵循 Intellect Admin 格式：`{ code: 0, message: string, data: T }`

#### 前端改动

仅 [src/utils/api.ts](../src/utils/api.ts) 一处：新增 `bffAdmin = '/api/bff/admin'` 常量，将 whitelist/roles/resources 相关路径从 `${restAPIv1}/admin/*` 改为 `${bffAdmin}/*`。

- `admin-service.ts` **无需改动**（接口签名不变）
- 页面组件 **无需改动**（仍调用 admin-service 导出的函数）
- Vite proxy **无需改动**（`/api/bff` 已配置）

### 鉴权说明

BFF admin 路由复用现有 `authMiddleware`（仅检查 Authorization header 存在），与 agent/session 路由一致。前端 `admin-service.ts` 已有 401 处理逻辑。后续如需增强 admin 鉴权，可单独引入 admin 鉴权中间件。

### 演进路径

| 阶段 | 内容 |
|------|------|
| 当前 | BFF 接管 whitelist + roles + resources（JSON 存储） |
| 中期 | 推动 Intellect 暴露用户/服务/配置管理 API，BFF 改为聚合层 |
| 长期 | Intellect Admin 进程下线，全部管理功能由 BFF + Intellect API 提供 |

### 涉及文件清单

| 文件 | 操作 |
|------|------|
| `bff/src/services/admin-store.ts` | 新建 |
| `bff/src/routes/admin.ts` | 新建 |
| `bff/src/index.ts` | 注册 admin 路由 |
| `src/utils/api.ts` | 路径迁移（`/api/v1/admin/*` → `/api/bff/admin/*`） |
| `bff/data/admin-state.json` | 运行时自动生成（已加入 .gitignore） |

---

## 十六、多 Harness 后端支持（BFF 适配器层）

### 背景

AgentUI 需要支持不同的 Agent Harness 后端：

| 后端 | 协议 | 项目地址 | 说明 |
|------|------|---------|------|
| Intellect | OpenAI 兼容 REST + SSE | `~/workspace/intellect` | 画布编排 + 知识库 |
| Intellect 企业版 | OpenAI 兼容 REST + SSE | `~/workspace/intellect-team` | 多租户 Team/Project + 编码 Agent |
| Intellect 社区版 | ACP（stdio JSON-RPC） | `~/workspace/intellect-agent` | 单用户，未来扩展 OpenAPI |
| Hermes | ACP | `~/workspace/hermes-agent` | 同 Intellect 同源 |
| OpenClaw | 待确认 | - | - |

**本期范围**：先对接 **Intellect + Intellect 企业版**，社区版/Hermes/OpenClaw 延后。

### 方案选择：BFF 适配器层（方案 A）

```
┌──────────────────────────────────────────────────────────────────┐
│  AgentUI 前端（最小改动）                                         │
│  ├── 业务页面（Agent/Session/Canvas，不变）                       │
│  ├── Admin: Harness 后端管理（新增）                              │
│  ├── Admin: 租户/Team/Project 管理（新增）                        │
│  └── useHarnessCapabilities()（新增，条件渲染）                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓ /api/bff/*
┌──────────────────────────────────────────────────────────────────┐
│  BFF (:9390)                                                     │
│  ├── routes/admin.ts（已有：whitelist/roles/resources）           │
│  ├── routes/harness-admin.ts（新增：后端配置管理）                │
│  ├── routes/tenant.ts（新增：租户管理，轻量）                     │
│  ├── routes/team.ts（新增：透传 Intellect Team CRUD）             │
│  ├── routes/project.ts（新增：透传 Intellect Project CRUD）       │
│  ├── routes/agent.ts（重构：调用 Adapter）                        │
│  ├── routes/session.ts（重构：调用 Adapter）                      │
│  ├── routes/canvas.ts（新增：硬绑定 Intellect）                     │
│  │                                                                │
│  ├── services/adapters/                                          │
│  │   ├── types.ts（IHarnessAdapter 接口）                        │
│  │   ├── registry.ts                                             │
│  │   ├── intellect/（IntellectCommunityAdapter）                              │
│  │   └── intellect/（IntellectEnterpriseAdapter）                │
│  │                                                                │
│  ├── services/harness-store.ts（后端配置 + token 存储）           │
│  └── services/tenant-store.ts（BFF 多租户模型）                  │
└──────────────────────────────────────────────────────────────────┘
              ↓                              ↓
┌─────────────────────────┐    ┌─────────────────────────────────┐
│  Intellect (:9380)        │    │  Intellect 企业版 (:8642)       │
│  ├── Agent/Canvas/Dataset│   │  ├── /v1/chat/completions       │
│  └── 画布引擎（唯一）   │    │  ├── /v1/capabilities           │
│                         │    │  ├── /api/sessions              │
│                         │    │  └── /api/teams（需新增）       │
│                         │    │  └── /api/projects（需新增）    │
└─────────────────────────┘    └─────────────────────────────────┘
```

**方案要点**：
1. **BFF 定义 `IHarnessAdapter` 接口**，每个后端实现一个 Adapter
2. **前端零业务改动**，只改 API 路径常量 + 新增 Admin 页面
3. **SSE 流式格式统一**：Intellect 和 Intellect 企业版都是 OpenAI 兼容格式，共用解析器
4. **画布硬绑定 Intellect**：画布是 Intellect 专属能力，不经过 Adapter Registry 选择
5. **多租户通过 BFF 独立模型**：BFF 维护 Tenant 实体，绑定到 Intellect 实例

### 多租户数据模型

Intellect 企业版的数据模型为 **Member → Team → Project** 三层（无 Tenant 实体）。BFF 侧的 Tenant 是逻辑概念，对应一个 Intellect 实例部署：

```
BFF Tenant（BFF 维护，轻量）
  │  └─ 绑定到一个 Intellect 实例（通过 HarnessBackend 配置）
  │
  ├─ Team（Intellect 侧管理，通过 BFF 透传 CRUD）
  │   └─ Project（Intellect 侧管理，属于 Team）
  │
  └─ Member（Intellect 侧管理）
```

**核心设计**：
- BFF Tenant 只存储绑定关系（`tenantId → backendId`）
- Team/Project/Member 数据不复制到 BFF，通过 Intellect HTTP API 透传管理
- 一个 BFF Tenant 可绑定多个后端（Intellect + Intellect），画布走 Intellect，Team/Project 走 Intellect

### Token 安全存储策略

#### 设计原则

1. **P0-P3 先行**：本期不引入加密存储复杂度，使用环境变量 + JSON 文件存储
2. **环境变量优先**：敏感的 admin token 通过环境变量注入，不落盘到 JSON
3. **JSON 文件存储非敏感配置**：后端端点、类型、能力声明等存 JSON
4. **未来演进**：预留加密存储接口，P4+ 可平滑升级

#### 存储分层

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: 环境变量（.env，不入库）                       │
│  ├── HARNESS_INTELLECT_COMMUNITY_ADMIN_TOKEN=intellect-xxx            │
│  ├── HARNESS_INTELLECT_ADMIN_TOKEN=imt_xxx              │
│  └── HARNESS_TOKEN_ENCRYPTION_KEY=（P4+ 启用）          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: JSON 文件（bff/data/harness-backends.json）    │
│  ├── 后端 ID、名称、类型、端点                           │
│  ├── 能力声明（capabilities）                            │
│  ├── 状态（active/disabled）                             │
│  └── token 引用（envVarName，不存明文）                  │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 运行时内存（启动时加载）                       │
│  ├── 从环境变量读取 token 明文                           │
│  ├── 与 JSON 配置合并为完整 HarnessBackend 对象          │
│  └── 仅存在于进程内存，不写回磁盘                        │
└─────────────────────────────────────────────────────────┘
```

#### 数据模型

```typescript
// bff/src/services/harness-store.ts

// JSON 文件中存储的配置（不含 token 明文）
interface HarnessBackendConfig {
  id: string;
  name: string;
  type: 'intellect-community' | 'intellect-enterprise';
  endpoint: string;
  capabilities: HarnessCapabilities;
  status: 'active' | 'disabled';
  // token 通过环境变量引用，不存明文
  adminTokenEnvVar: string;        // 如 'HARNESS_INTELLECT_ADMIN_TOKEN'
  projectTokenEnvVar?: string;     // 可选，项目级 token 环境变量名
  createdAt: string;
  updatedAt: string;
}

// 运行时内存中的完整对象（含 token 明文，不落盘）
interface HarnessBackend extends HarnessBackendConfig {
  adminToken: string;              // 从环境变量读取的明文
  projectToken?: string;
}
```

#### 加载流程

```typescript
// bff/src/services/harness-store.ts

class HarnessStore {
  private backends: Map<string, HarnessBackend> = new Map();

  load(): void {
    const configs = this.loadConfigs();  // 读 JSON 文件
    for (const config of configs) {
      const adminToken = process.env[config.adminTokenEnvVar];
      if (!adminToken) {
        console.warn(`[harness-store] 环境变量 ${config.adminTokenEnvVar} 未设置，跳过后端 ${config.name}`);
        continue;
      }
      const projectToken = config.projectTokenEnvVar
        ? process.env[config.projectTokenEnvVar]
        : undefined;
      this.backends.set(config.id, {
        ...config,
        adminToken,
        projectToken,
      });
    }
  }

  get(id: string): HarnessBackend | undefined {
    return this.backends.get(id);
  }

  list(): HarnessBackend[] {
    return Array.from(this.backends.values());
  }

  private loadConfigs(): HarnessBackendConfig[] {
    // 读 bff/data/harness-backends.json
    if (!existsSync(CONFIG_FILE)) return [];
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  }

  // Admin 页面通过此方法增删后端配置（不含 token 明文）
  saveConfig(config: HarnessBackendConfig): void {
    const configs = this.loadConfigs().filter(c => c.id !== config.id);
    configs.push(config);
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
    // 重新加载到内存
    this.load();
  }
}
```

#### 环境变量示例

```bash
# .env（已加入 .gitignore）
HARNESS_INTELLECT_COMMUNITY_ADMIN_TOKEN=intellect-xxxxxxxxxxxxxxxx
HARNESS_INTELLECT_ADMIN_TOKEN=imt_xxxxxxxxxxxxxxxxxx
HARNESS_INTELLECT_PROJECT_TOKEN=imt_p_xxxxxxxxxxxxxxx
```

#### Admin 页面交互

Admin 页面新增后端时：
1. 用户填写名称、类型、端点
2. 系统生成环境变量名（如 `HARNESS_INTELLECT_ADMIN_TOKEN`）
3. JSON 文件存储配置（含 `adminTokenEnvVar` 字段，不含 token 明文）
4. 页面提示用户将 token 添加到 `.env` 文件
5. 重启 BFF 后生效

#### 未来演进（P4+）

```typescript
// 预留接口，未来切换到加密存储
interface TokenVault {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

// 实现 1：环境变量（P0-P3）
class EnvTokenVault implements TokenVault {
  get(key: string) { return process.env[key]; }
  set(key: string, value: string) { throw new Error('Env vault is read-only'); }
}

// 实现 2：加密文件（P4+，使用 AES-256-GCM）
class EncryptedFileTokenVault implements TokenVault {
  constructor(private encryptionKey: string) {}
  get(key: string) { /* 解密读取 */ }
  set(key: string, value: string) { /* 加密写入 */ }
}
```

### Adapter 接口定义

```typescript
// bff/src/services/adapters/types.ts

// ── 核心层接口（Layer 1，所有后端必选）──
export interface IHarnessAdapter {
  readonly backendId: string;
  readonly backendType: 'intellect-community' | 'intellect-enterprise';
  readonly capabilities: HarnessCapabilities;

  // Agent
  listAgents(ctx: TenantContext): Promise<AgentSummary[]>;
  getAgent(ctx: TenantContext, agentId: string): Promise<AgentDetail>;

  // Session
  createSession(ctx: TenantContext, agentId: string, opts?: SessionOptions): Promise<Session>;
  listSessions(ctx: TenantContext, agentId?: string): Promise<Session[]>;
  getSession(ctx: TenantContext, sessionId: string): Promise<Session>;
  deleteSession(ctx: TenantContext, sessionId: string): Promise<void>;

  // Message streaming（OpenAI 兼容 SSE，Intellect 和 Intellect 共用）
  sendMessage(ctx: TenantContext, sessionId: string, message: string, opts?: SendOptions): AsyncIterable<StreamChunk>;
  cancelMessage(ctx: TenantContext, sessionId: string): Promise<void>;

  // Health & capability
  healthCheck(): Promise<boolean>;
  discoverCapabilities(): Promise<HarnessCapabilities>;
}

// ── 扩展层：多租户管理（Intellect 企业版独有）──
export interface IMultiTenantAdapter {
  // Team CRUD（透传 Intellect）
  listTeams(ctx: TenantContext): Promise<Team[]>;
  createTeam(ctx: TenantContext, slug: string, displayName: string): Promise<Team>;
  getTeam(ctx: TenantContext, teamSlug: string): Promise<Team>;
  updateTeam(ctx: TenantContext, teamSlug: string, updates: Partial<Team>): Promise<Team>;
  archiveTeam(ctx: TenantContext, teamSlug: string): Promise<void>;

  // Team 成员管理
  listTeamMembers(ctx: TenantContext, teamSlug: string): Promise<TeamMember[]>;
  addTeamMember(ctx: TenantContext, teamSlug: string, memberId: string, role: string): Promise<TeamMember>;
  removeTeamMember(ctx: TenantContext, teamSlug: string, memberId: string): Promise<void>;
  setTeamMemberRole(ctx: TenantContext, teamSlug: string, memberId: string, role: string): Promise<void>;

  // Project CRUD（透传 Intellect，Project 属于 Team）
  listProjects(ctx: TenantContext, teamSlug: string): Promise<Project[]>;
  createProject(ctx: TenantContext, teamSlug: string, data: CreateProjectInput): Promise<Project>;
  getProject(ctx: TenantContext, teamSlug: string, projectSlug: string): Promise<Project>;
  updateProject(ctx: TenantContext, projectSlug: string, updates: Partial<Project>): Promise<Project>;
  archiveProject(ctx: TenantContext, projectSlug: string): Promise<void>;

  // Project 成员管理
  listProjectMembers(ctx: TenantContext, projectSlug: string): Promise<ProjectMember[]>;
  addProjectMember(ctx: TenantContext, projectSlug: string, memberId: string, role: string): Promise<void>;
  removeProjectMember(ctx: TenantContext, projectSlug: string, memberId: string): Promise<void>;
}

// ── 租户上下文 ──
export interface TenantContext {
  tenantId: string;                    // BFF 租户 ID
  userId: string;                      // BFF 用户 ID
  // Intellect 侧的上下文（BFF 根据 tenant 绑定关系填充）
  intellectTeamSlug?: string;          // X-Intellect-Team 头
  intellectProjectSlug?: string;       // X-Intellect-Project 头
}

// ── 能力声明 ──
export interface HarnessCapabilities {
  canvas: boolean;        // Intellect only（画布永远走 Intellect）
  knowledgeBase: boolean; // Intellect only
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;   // Intellect 企业版（Team/Project）
  modelManagement: boolean;
}

// ── 流式 chunk（OpenAI 兼容，两个后端共用）──
export interface StreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  role?: 'assistant';
  finishReason?: 'stop' | 'length' | 'cancelled';
  error?: { code: string; message: string };
}
```

### BFF 目录结构

```
bff/src/
├── index.ts
├── middleware/
│   └── auth.ts
├── routes/
│   ├── admin.ts              # 已有：whitelist/roles/resources
│   ├── harness-admin.ts      # 新增：Harness 后端管理
│   ├── tenant.ts             # 新增：租户管理（轻量）
│   ├── team.ts               # 新增：透传 Intellect Team CRUD
│   ├── project.ts            # 新增：透传 Intellect Project CRUD
│   ├── agent.ts              # 重构：调用 Adapter
│   ├── session.ts            # 重构：调用 Adapter
│   └── canvas.ts             # 新增：硬绑定 Intellect
├── services/
│   ├── admin-store.ts        # 已有
│   ├── harness-store.ts      # 新增：后端配置 + token 存储
│   ├── tenant-store.ts       # 新增：BFF 多租户模型
│   ├── canvas-service.ts     # 新增：画布路由到 Intellect
│   └── adapters/             # 新增：适配器层
│       ├── types.ts          # IHarnessAdapter 接口定义
│       ├── registry.ts       # Adapter 注册与选择
│       ├── shared/
│       │   └── openai-sse.ts # OpenAI 兼容 SSE 解析器（共用）
│       ├── intellect/
│       │   ├── adapter.ts    # IntellectCommunityAdapter
│       │   ├── client.ts     # Intellect HTTP 客户端
│       │   └── stream.ts     # SSE 流式转换
│       └── intellect/
│           ├── adapter.ts    # IntellectEnterpriseAdapter
│           ├── client.ts     # Intellect HTTP 客户端
│           ├── stream.ts     # SSE 流式转换
│           └── admin.ts      # Team/Project 透传
└── utils/
    └── sse.ts                # SSE 流式工具
```

### 实施路线（P0-P3 细化）

#### P0：接口定义 + 存储层

**目标**：建立 Adapter 抽象层骨架，不改变现有功能。

**任务清单**：

| 任务 | 文件 | 说明 |
|------|------|------|
| 定义 Adapter 接口 | `bff/src/services/adapters/types.ts` | `IHarnessAdapter`、`IMultiTenantAdapter`、`TenantContext`、`HarnessCapabilities`、`StreamChunk` |
| 定义数据模型 | `bff/src/services/adapters/types.ts` | `AgentSummary`、`Session`、`Team`、`Project`、`TeamMember`、`ProjectMember` |
| 实现 HarnessStore | `bff/src/services/harness-store.ts` | JSON 配置 + 环境变量 token 加载 |
| 实现 TenantStore | `bff/src/services/tenant-store.ts` | BFF 租户模型（轻量，只存绑定关系） |
| 创建默认配置 | `bff/data/harness-backends.json` | 默认 Intellect 后端配置 |
| 更新 .env.example | `.env.example` | 新增 `HARNESS_*_ADMIN_TOKEN` 变量 |

**验收标准**：
- BFF 启动时能从 JSON + 环境变量加载后端配置
- TypeScript 编译通过
- 不影响现有功能（现有路由行为不变）

#### P1：Intellect Adapter + 重构现有 BFF

**目标**：将现有 BFF 对 Intellect 的直连逻辑重构为通过 IntellectCommunityAdapter，前端无感知。

**任务清单**：

| 任务 | 文件 | 说明 |
|------|------|------|
| 实现 OpenAI SSE 解析器 | `bff/src/services/adapters/shared/openai-sse.ts` | 共用的 SSE 流式解析 |
| 实现 Intellect HTTP 客户端 | `bff/src/services/adapters/intellect/client.ts` | 封装 Intellect REST 调用 |
| 实现 IntellectCommunityAdapter | `bff/src/services/adapters/intellect/adapter.ts` | 实现 `IHarnessAdapter` 接口 |
| 实现 Adapter Registry | `bff/src/services/adapters/registry.ts` | Adapter 注册与按租户选择 |
| 重构 agent 路由 | `bff/src/routes/agent.ts` | 改为调用 `registry.getAdapterForTenant()` |
| 重构 session 路由 | `bff/src/routes/session.ts` | 改为调用 adapter |

**验收标准**：
- 现有 Agent/Session CRUD 行为不变
- SSE 流式行为不变
- 前端无任何改动
- 现有 BFF 测试通过

#### P2：Harness Admin + 前端能力探测

**目标**：Admin 管理端可配置后端，前端可探测能力条件渲染。

**任务清单**：

| 任务 | 文件 | 说明 |
|------|------|------|
| 实现 harness-admin 路由 | `bff/src/routes/harness-admin.ts` | 后端配置 CRUD（不含 token 明文） |
| 实现能力探测端点 | `bff/src/routes/capabilities.ts` | `GET /api/bff/capabilities` 返回当前后端能力 |
| 注册新路由 | `bff/src/index.ts` | 挂载 harness-admin + capabilities 路由 |
| 新增前端 API 路径 | `src/utils/api.ts` | harness 管理相关路径 |
| 实现 useHarnessCapabilities | `src/hooks/useHarnessCapabilities.ts` | 启动时查询能力，条件渲染 |
| 新增 Admin 页面 | `src/pages/admin/harness-backends.tsx` | 后端列表/新增/编辑/删除 |

**验收标准**：
- Admin 页面可 CRUD 后端配置
- 新增后端时提示用户设置环境变量
- 前端可通过 `useHarnessCapabilities` 获取能力
- 页面按能力条件渲染（如无画布的后端隐藏画布入口）

#### P3：Intellect 企业版 Adapter（核心层）

**目标**：BFF 可对接 Intellect 企业版，基础对话功能可用。

**任务清单**：

| 任务 | 文件 | 说明 |
|------|------|------|
| 实现 Intellect HTTP 客户端 | `bff/src/services/adapters/intellect/client.ts` | 封装 Intellect REST 调用（含多租户头注入） |
| 实现 IntellectEnterpriseAdapter | `bff/src/services/adapters/intellect/adapter.ts` | 实现核心层 `IHarnessAdapter` |
| 对接 `/v1/models` | `intellect/adapter.ts` | `listAgents()` 调用 `/v1/models` |
| 对接 `/api/sessions` | `intellect/adapter.ts` | 会话 CRUD |
| 对接 `/v1/chat/completions` | `intellect/adapter.ts` | SSE 流式对话（复用 openai-sse 解析器） |
| 对接 `/v1/capabilities` | `intellect/adapter.ts` | `discoverCapabilities()` |
| 注册 Intellect Adapter | `bff/src/services/adapters/registry.ts` | 支持 `intellect-enterprise` 类型 |
| 集成测试 | 手动 curl | 验证 Agent 列表、会话创建、流式对话 |

**外部依赖**：无（核心层只用到 Intellect 已有的 `/v1/*` 和 `/api/sessions/*`）

**验收标准**：
- BFF 可连接 Intellect 企业版 :8642
- `listAgents()` 返回 Intellect 模型列表
- `createSession()` 创建会话成功
- `sendMessage()` 流式返回正常
- `healthCheck()` 和 `discoverCapabilities()` 正常
- 多租户头 `X-Intellect-Team`/`X-Intellect-Project` 正确注入

### 后续阶段（P4-P7，依赖外部条件）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P4** | Intellect 侧新增 Team/Project CRUD HTTP API | Intellect 团队（参考 [intellect-admin-api-guide.md](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)） |
| **P5** | BFF 多租户层（Team/Project 透传）+ 前端 Admin 页面 | P3 + P4 |
| **P6** | 画布服务（硬绑定 Intellect） | P1 |
| **P7** | SSE 事件扩展（runs/skills，可选） | P3 |

### 涉及文件清单

| 文件 | 阶段 | 操作 |
|------|------|------|
| `bff/src/services/adapters/types.ts` | P0 | 新建 |
| `bff/src/services/harness-store.ts` | P0 | 新建 |
| `bff/src/services/tenant-store.ts` | P0 | 新建 |
| `bff/data/harness-backends.json` | P0 | 新建（默认配置） |
| `.env.example` | P0 | 修改 |
| `bff/src/services/adapters/shared/openai-sse.ts` | P1 | 新建 |
| `bff/src/services/adapters/intellect/client.ts` | P1 | 新建 |
| `bff/src/services/adapters/intellect/adapter.ts` | P1 | 新建 |
| `bff/src/services/adapters/registry.ts` | P1 | 新建 |
| `bff/src/routes/agent.ts` | P1 | 重构 |
| `bff/src/routes/session.ts` | P1 | 重构 |
| `bff/src/routes/harness-admin.ts` | P2 | 新建 |
| `bff/src/routes/capabilities.ts` | P2 | 新建 |
| `bff/src/index.ts` | P2 | 修改（注册路由） |
| `src/utils/api.ts` | P2 | 修改（新增路径） |
| `src/hooks/useHarnessCapabilities.ts` | P2 | 新建 |
| `src/pages/admin/harness-backends.tsx` | P2 | 新建 |
| `bff/src/services/adapters/intellect/client.ts` | P3 | 新建 |
| `bff/src/services/adapters/intellect/adapter.ts` | P3 | 新建 |
| `docs/intellect-admin-api-guide.md` | 已完成 | 新建（Intellect 侧 API 指南） |
