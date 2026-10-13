# AgentUI 运行时插件开发指南

> 面向在独立仓库开发、经 AgentUI 动态装载的应用插件。
> 参考实现:`cognitive-wargame` 仓库 `web/agentui`(AgentUI 宿主)与
> `web/qwenpaw`(QwenPaw 宿主,同一源码基线的另一档)。
> 机制设计:见 [cognitive-wargame-plugin-migration-design.md](./cognitive-wargame-plugin-migration-design.md)(含实现纪要)。

## 1. 形态与信任模型

插件是**自包含单文件 ESM 产物**(自带 React/UI 依赖/Tailwind CSS/词条),
由宿主经 BFF 文件路由同源动态 `import()`。宿主在自己的 React 树里只渲染一个
挂载 `div`,插件用**独立 React root** 渲染内部全部 UI——两侧不共享 React
实例,天然规避 hooks 交叉。

**信任边界(必读)**:插件 JS 与宿主同源执行,可完整访问 DOM 与
localStorage(含宿主登录 token)。本机制只面向**内部可信仓库**的插件;
不可信第三方代码必须走 iframe 隔离档(未实现)。

## 2. app.json 清单(插件根目录)

```jsonc
{
  "id": "my-app",                    // 白名单 ^[A-Za-z0-9._-]+$,与目录名一致
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "path": "/my-app",                 // 挂载路径前缀;不得命中宿主保留路由
                                     // (/login /admin /wizard /applications /tasks
                                     //  /knowledge /memories /user-setting /document /)
  "label": "我的应用",                // 词条缺失时的卡片字面文案
  "labelKey": "myApp.common.title",  // 卡片词条 key(词条内联后优先于 label)
  "descriptionKey": "myApp.common.subtitle",
  "icon": "🚀",                       // emoji 字符串,宿主渲染
  "order": 60,                       // 应用卡片排序
  "entry": "ui/dist/index.js",       // 顶层目录必须 ∈ {ui, assets, dist},
                                     // 相对路径且不含 ".."
  "peer": { "react": "^18" },        // 宿主校验声明(React 主版本硬校验)
  "i18n": {                          // 词条产物 → BFF 列表接口内联 →
    "files": { "zh": "ui/locales/zh.json", "en": "ui/locales/en.json" }
  },                                 //   宿主 i18n 注入(单语言 200KB 上限)
  "backend": {                       // 可选:后端代理声明
    "type": "proxy",
    "target": "http://127.0.0.1:9385"  // 仅允许回环/RFC1918(严格白名单);
  }                                    // 容器/k8s 网络经宿主 env override 指向服务名
}
```

## 3. 入口模块契约

```tsx
// src/index.tsx —— 构建产物入口(自包含,零裸模块导入)
import { createRoot } from 'react-dom/client';

type Dispose = () => void;

interface AgentUIHostGlobal {
  HOST_API_VERSION: string;          // '1.1.0':含 on() 事件订阅
  registerApp(reg: { id: string; mount(el: HTMLElement): Dispose }): void;
  on?(event: 'localechange' | 'themechange',
      listener: (p: { lng?: string; theme?: string }) => void): () => void;
}

declare const window: Window & { AgentUI?: AgentUIHostGlobal };

window.AgentUI!.registerApp({
  id: 'my-app',
  mount(el) {
    // 1) 注入自带 CSS(<style>,卸载时移除)
    // 2) createRoot(el).render(<App/>)
    return () => { /* root.unmount(); style.remove(); 清理 store/连接 */ };
  },
});
```

要点:
- `mount` 返回 dispose 函数,必须对称清理(root、style、EventSource、query 缓存);
- 宿主事件订阅(`on`)用于同标签页即时跟随语言/主题,storage 事件兜底跨 tab;
- 宿主 React 不会传给插件——插件 bundle 必须自带全部依赖。

## 4. 构建要求

参考 `web/agentui` 的 vite 配置:

- **lib 模式单文件**:`formats: ['es']` + `inlineDynamicImports: true`
  (动态 import 内联,产物一个 JS;多 chunk 相对导入亦可,文件路由支持);
- **CSS**:`import styles from '../tailwind.css?inline'`,挂载时注入;
  Tailwind `content` 只扫插件源码,`corePlugins.preflight: false`
  (宿主已含 reset);
- **外部导入边界**:所有 bare import 必须在自身 `package.json dependencies`
  中声明(自包含前提);用导入扫描脚本守住
  (`web/agentui/scripts/check-external-imports.mjs`,白名单自动派生);
- **词条产物**:locales TS 编译为 JSON 落 `ui/locales/*.json`
  (`scripts/build-locales.mjs`);
- **peer 声明**:`app.json peer.react` 与宿主 React 主版本匹配
  (宿主侧硬校验,不满足拒绝装载)。

## 5. 后端与认证

- 插件前端调用自身后端:**REST 走宿主既有代理通道**(如同 `/api/v1/<app>`,
  由宿主 vite/nginx 配置);**SSE 走 BFF 插件代理**
  `/api/bff/plugins/<id>/proxy/...`(app.json 声明 backend 后自动可用,
  流式透传保留 `text/event-stream`);
- EventSource 不支持自定义 header:token 沿用 `?token=`(BFF 代理透传查询串);
- REST 的 token 与宿主同源共享(localStorage `Authorization`)。

## 6. 安装与分发

**开发**(本地路径):
```bash
curl -X POST http://localhost:9390/plugins/install \
  -H 'Content-Type: application/json' \
  -H 'X-Plugin-Admin-Token: <BFF_PLUGIN_INSTALL_TOKEN>' \
  -d '{"source": "/abs/path/to/plugin-repo"}'
```

**生产**(方案 B,镜像烤入):`scripts/package-plugin-bundle.sh` 打包 →
随 agentui 镜像分发,容器启动自动安装;`BFF_PLUGIN_BACKEND_OVERRIDES`
按插件 id 覆盖 backend.target(存在即生效,改 env 重启容器即生效)。

宿主侧安全约束(安装面):token fail-closed、entry/mount path 白名单、
backend.target 严格 IP 白名单(override 走部署者宽松级)——
详见 `bff/src/routes/plugins.ts` 头部注释与测试。

## 7. 调试

- 装载失败会在挂载页显示错误占位与**重试**按钮(宿主侧);
- 插件内建议自带 ErrorBoundary(渲染异常显性化,参考 web/agentui
  的 PluginErrorBoundary);
- 词条/卡片文案:词条随元数据注入(插件 JS 未装载也可本地化);
  顶层 key 与宿主已有词条冲突会被跳过并告警——**插件词条请使用
  自身命名空间前缀**(如 `myApp.*`)。
