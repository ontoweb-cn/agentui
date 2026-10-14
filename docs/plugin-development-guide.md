# AgentUI 运行时插件开发指南

> 面向在独立仓库开发、经 AgentUI 动态装载的应用插件。
> 参考实现:`cognitive-wargame` 仓库 `web/agentui`(AgentUI 宿主)与
> `web/qwenpaw`(QwenPaw 宿主,同一源码基线的另一档)。
> 机制设计:见 [cognitive-wargame-plugin-migration-design.md](./cognitive-wargame-plugin-migration-design.md)(含实现纪要)。

## 0. 工程结构速览

| 位置 | 内容 |
|---|---|
| 插件仓库 `cognitive-wargame/web/agentui/` | app.json、src/(入口+页面+词条)、scripts/(构建/边界/CI)、ui/dist(产物) |
| 宿主内核 `agentui/src/plugins/` | host-global(window.AgentUI)、loader(装载)、runtime(bootstrap) |
| BFF `agentui/bff/src/routes/plugins.ts` | 列表/文件/安装/代理/卸载 |
| 部署 `agentui/deploy/` | 发版 runbook、compose/k8s、插件 bundle |

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
    "target": "http://127.0.0.1:9385"  // 严格回环/RFC1918 白名单(不受控输入);
  }                                    // 容器/k8s 网络经宿主 env
                                       // BFF_PLUGIN_BACKEND_OVERRIDES 覆盖(宽松级,允许服务名)
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
- **凭证形态(2026-10-13 认证审计后)**:
  - 优先依赖**同源 cookie 会话**(企业模式 `imt_token` HttpOnly,fetch 同源
    默认携带)——BFF 网关已升级为验证型会话校验,垃圾/过期凭证一律 401;
  - localStorage token(键 `Authorization`)**仅社区模式有效**;企业模式下
    `host.getApiToken()` 可能返回空或过期值,**勿作为唯一凭证来源**;
  - 插件后端自有的 API key(如 wargamesrv 的 `?token=`)由 BFF 代理原样
    透传,不参与宿主会话体系。

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

**启停(不删文件)**:`POST /api/bff/plugins/<id>/enable` 与
`POST /api/bff/plugins/<id>/disable`(需 admin token,幂等)。状态存
`bff/data/plugin-state.json`——位于安装目录**之外**,容器重启/重装不冲掉;
disabled 插件从插件列表消失(卡片/路由/词条随宿主下次加载整体消失),
产物保留,enable 即恢复。**停用即断路**:该插件的产物下载(files)与
后端代理(proxy)同步 404——kill switch 关闭数据面,而非仅隐藏 UI 入口。
**install ≠ enable**:对 disabled 插件重装只刷新产物,不改变启停状态
(entrypoint 每次容器启动重装同理,状态存活);卸载会清除启停状态,重装
回默认 enabled;enable 要求 app.json 合法(损坏安装 400,disable 宽松)。

**卸载**:`DELETE /api/bff/plugins/<id>`(需 admin token)删除安装目录;
已装载插件的前端实例**需刷新页面才失效**(宿主监测列表变化会 toast 提示
刷新,不做运行时卸载)。

**审计**:install/uninstall/enable/disable 成功操作逐行追加 JSONL
`bff/data/plugin-audit.jsonl`(env `BFF_PLUGIN_AUDIT_FILE` 覆盖)。

宿主侧安全约束(安装面):token fail-closed、entry/mount path 白名单、
backend.target 严格 IP 白名单(override 走部署者宽松级)——
详见 `bff/src/routes/plugins.ts` 头部注释与测试。

## 7. 开发热更、测试与调试

**本地热更(推荐,免 build+reinstall)**——三步(详见 web/agentui README):

```bash
# 1) 插件仓库起 dev server(9395)
npm run dev
# 2) agentui .env:VITE_PLUGIN_DEV_ENTRIES=<插件id>(dev only,生产忽略)
# 3) 重启 agentui vite(npm run dev)
```

之后改插件源码**刷新浏览器即生效**。注意 dev 直连绕过 BFF 文件路由的
校验面(仅限本机 dev server,生产构建编译期排除)。

**测试**:插件仓库 `npm test`(vitest+jsdom)覆盖入口契约——
registerApp 侧效果、语言归一化、mount/dispose 生命周期、宿主事件订阅;
`npm run lint:imports` 守住自包含边界。CI 集成见 `web/agentui/scripts/ci.sh`。

**调试**:
- 装载失败会在挂载页显示错误占位与**重试**按钮(宿主侧);
- 插件内建议自带 ErrorBoundary(渲染异常显性化,参考 web/agentui
  的 PluginErrorBoundary);
- 词条/卡片文案:词条随元数据注入(插件 JS 未装载也可本地化);
  顶层 key 与宿主已有词条冲突会被跳过并告警——**插件词条请使用
  自身命名空间前缀**(如 `myApp.*`)。

## 8. 宿主 chat 能力(1.2.0)

插件可经 `window.AgentUI.chat` 流式消费宿主的 gateway chat 通道
(设计契约与帧协议:**chat-sse-sdk-design.md**;机制参照 QwenPaw
pawapp-sdk 的 chatStream)。**插件代码零凭证、零 SSE 解析依赖**——
网关凭据(API_SERVER_KEY/X-Intellect-User)全程在 BFF 服务端注入。

**前置声明(必读)**:app.json 增加 `"capabilities": ["chat"]`。
BFF 逐请求校验,未声明一律 **403**——这是运维门控(额度消费者显式清单),
不是安全边界;停用的插件 chat 同样 404(启停断路,§6)。

```tsx
// feature-detect(1.1.0 宿主无 chat,向后兼容)
const chat = window.AgentUI.chat;
if (!chat) return;

// 1) 建 gateway 会话(标题自动加 plugin:<your-app>: 前缀,
//    宿主主聊天列表默认不展示;经 API/深链仍可访问)
const { id } = await chat.createSession('my-app', '推演会话');

// 2) 流式补全:for-await 逐帧消费;提前 break 即中断上游
for await (const frame of chat.completions('my-app', {
  sessionId: id,
  content: userInput,          // 必填
  modelId: undefined,          // 可选,不传用部署默认模型
})) {
  switch (frame.event) {
    case 'message':       /* {content, answer, start_to_think?...} 增量 */ break;
    case 'message_end':   /* {usage} */ break;
    case 'workflow_finished': /* 终止帧 */ break;
    case 'error':         /* {message,...} 协议内错误,流随之结束 */ break;
    default:              /* 未知帧必须忽略(前向兼容义务) */ break;
  }
}

// 3) 中止:传 AbortSignal
const controller = new AbortController();
chat.completions('my-app', { sessionId: id, content }, { signal: controller.signal });
// 组件卸载/路由离开时 controller.abort()
```

语义要点:
- `completions` 返回 **AsyncGenerator**;每帧 `{event, data}`,与宿主 chat
  帧协议**逐帧一致**(同一 BFF 重序列化通道);
- `error` 帧是协议内数据(yield 后流结束);HTTP/网络失败才 throw
  (消息含状态码,如 401 未登录 / 403 未声明能力 / 404 插件不存在或停用);
- 会话必须先经 `createSession` 创建,`sessionId` 必填,不做匿名一次性会话;
- 审批(approval_request)/澄清(clarify_request)帧 v1 只透传;需要响应时
  直调既有 `/agents/:agentId/runs/:runId/approval` 路由(同源 cookie 已鉴权);
- 企业 cookie 会话失效时请求 401——插件应引导用户重新登录,而非缓存凭证。
