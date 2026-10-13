# Cognitive Wargame 插件化迁移 — 技术方案(评审后)

> **Status**: 已实施(2026-10-13)——本文为方案原文与评审记录,现状以 [§十 实现纪要](#十实现纪要2026-10-13实施完成后补记) 为准;架构总纲见 [runtime-plugin-architecture.md](./runtime-plugin-architecture.md)
> **Date**: 2026-10-13
> **Prerequisites**: 无(不依赖 spec/008、009;与 canvas 插件化并行不冲突)
> **Related**: [vite-architecture.md](./vite-architecture.md) ch.16(方案 A→D 演进)、[canvas-plugin-extraction-design.md](./canvas-plugin-extraction-design.md)(方案 B 先例)
> **机制参照**: QwenPaw PawApp(`~/project/QwenPaw`, blobs/清单/blob 装载/宿主全局/安装时元数据落地)

---

## 一、背景与目标

### 1.1 问题陈述

cognitive-wargame 是当前唯一的应用插件(`features/_registry.ts` 编译期注册,`/applications` 单卡片),前端 39 文件 / 约 11,000 行内聚在主仓库 `src/features/cognitive-wargame/`:

1. **发版耦合**:wargame 是最活跃的功能,任何迭代都要随宿主一起发版;
2. **机制缺位**:`ModuleDefinition` 只有编译期发现(`import.meta.glob`),没有运行时装载能力,外部仓库代码无法进入宿主;
3. **两处技术债**:dev 环境 SSE 绕过代理直连 9385(`api.ts:22-25`);token 从 localStorage 读取注入(`api.ts:39-44`,S1 TODO)。

后端 wargamesrv 已是独立服务(:9385),**本次只改造前端与接入层**。

### 1.2 目标

- wargame 前端成为**独立构建产物**(`index.js + index.css + app.json`),宿主运行时动态装载,24 条路由与深链**完全不变**;
- 建立可复用的**运行时插件内核**(装载器/元数据/代理/安装),为后续插件铺路;
- SSE 直连 hack 与 token 读取两债收编到宿主侧;
- 宿主编译期代码净删 ~11k 行。

### 1.3 非目标(YAGNI)

- ❌ 不改造 wargamesrv 后端;
- ❌ 不做插件市场/远程分发(安装来源:内置 | 本地路径 | git URL,按环境开关);
- ❌ 不做不可信沙箱(内部可信插件前提,结构性隔离);
- ❌ 不做进程内 Hono 后端挂载(清单 `backend.type` 预留,本期只实现 `proxy` 型);
- ❌ 不引入 Module Federation;
- ❌ **物理拆分仓库不做**(见 2.1,延后至触发条件)。

---

## 二、评审记录与方案修订

> 初版方案(对话评审,2026-10-12)共产生 10 项风险(R1-R10)、3 项 P0 前置、1 项裁剪建议、2 项纪律要求。本节为修订对照,后续章节为落实设计。

| # | 评审意见 | 修订结果 | 落实章节 |
|---|---|---|---|
| 1 | 3.3 裁剪:近期仅一个插件,双仓协作成本宜延后 | **采纳**:改为 monorepo `packages/wargame-plugin`(方案 B 形态 + 方案 D 内核),物理拆仓延后并定义触发条件 | §3.1 |
| 2 | P0-1:卡片/路由/词条不得依赖插件 JS 装载 | 落实为 plugins.json 安装时元数据落地 + bootstrap 合并 + 三级降级 | §4.1 |
| 3 | P0-2:Tailwind 插件 CSS 编译为 QwenPaw 未覆盖空白,须原型验证 | 落实为 `packages/tailwind-preset` + 构建约束 + 注入机制 + 验收标准 | §4.2 |
| 4 | P0-3:BFF SSE 透传须真实事件流验证 | 落实为测试矩阵(23 种事件/重连/并发/双通道)+ nginx/vite 配置规格 + 降级预案 | §4.3 |
| 5 | 纪律:React 版本校验必须硬失败 | 落实为装载前置校验,失败置 `incompatible` 状态 | §5.4 |
| 6 | 纪律:宿主 ui 白名单是事实公共 API | 落实为契约快照测试 + HOST_API_VERSION + 插件侧 ESLint 边界规则 | §5.2 |
| 7 | R4:bootstrap 串行 fetch 拖慢首屏/阻塞启动 | 落实为 1s 超时 + localStorage 陈旧缓存 + 后台刷新提示 | §4.1 |
| 8 | R8:供应链 | 落实为安装来源 env 开关 + 校验和 + admin 鉴权 + 镜像内置分发 | §5.4 |
| 9 | **评审新发现**:blob-URL 动态 import 无法解析裸模块导入(`'react'`)与分包相对导入,初版装载设计不可行 | **更正**:改为**同源 HTTP 动态 import**(经 BFF 文件路由)+ **SDK-shim** 消灭裸导入 | §3.2 |
| 10 | R10:双仓开发摩擦(已随修订 1 消解) | monorepo 内天然共享 CI/preset;插件 dev server 经宿主 vite proxy 热更 | §3.4 |

---

## 三、总体架构(修订后)

### 3.1 形态决策:monorepo 内独立构建包(方案 B 形态 + 方案 D 内核)

```
agentui/
├── packages/
│   ├── tailwind-preset/      # 共享 Tailwind 预设(§4.2)
│   ├── plugin-sdk/           # 插件契约:类型 + window.AgentUI 的 SDK-shim(§5.2)
│   └── wargame-plugin/       # 迁移目标:独立 vite lib 构建,产出 dist/(不进宿主 bundle)
├── src/plugins/              # 宿主内核:host-externals、装载器、运行时 registry
└── bff/src/routes/plugins.ts # BFF:列表/文件/代理/安装
```

关键约束:**宿主不再以 alias 方式编译期引用 wargame-plugin 源码**(区别于 canvas-plugin 的 `vite.config.ts:147` 做法——canvas 走编译期合并,wargame 走运行时装载,两者是机制上的两个档位,并存不冲突)。wargame-plugin 有独立 vite 配置与构建产物,宿主只消费其 `dist/`。

**物理拆仓触发条件**(满足其一才启动,届时只改 CI 与 preset 引用方式,契约不变):
1. 出现第二个运行时插件;
2. wargame 由独立团队/独立节奏维护;
3. 需要插件独立发版(不随宿主镜像)。

### 3.2 装载机制:同源 HTTP 动态 import + SDK-shim(更正初版 blob 方案)

初版照搬 QwenPaw 的 blob-URL import,评审发现两个致命问题:ESM 模块内的裸导入(`'react'`)在 blob 上下文无法解析;vite 分包后的相对 chunk 导入也无法从 blob 基址解析。QwenPaw 实际靠"单文件 IIFE 产物 + 全局变量"绕开,不适用于我们要保留的按 chunk 懒加载。更正为:

1. **BFF 文件路由静态服务插件产物**:`GET /api/bff/plugins/:id/files/*`(穿越防护、content-type、hash 资源 immutable 缓存);
2. **装载即同源动态 import**:`import(/* @vite-ignore */ '/api/bff/plugins/wargame/files/ui/dist/index.js')` —— 同源 URL 下分包 chunk 的相对导入自然解析回文件路由,**代码分割保留**;无 blob,无 CSP 特批;
3. **SDK-shim 消灭裸导入**:插件源码**只允许** `import ... from '@agentui/plugin-sdk'`,SDK 包内部从 `window.AgentUI` 读取宿主注入的单例(React、ui 组件等)。插件产物因此不含任何裸模块导入,宿主单例约束由 SDK 单点保证;插件自带依赖(recharts 等)正常打包;
4. **CSS 独立产物**:vite lib 模式不注入 CSS,`index.css` 由宿主装载时注入 `<style data-plugin="wargame">`,禁用/卸载时移除(§4.2)。

### 3.3 共享依赖分级

| 级别 | 依赖 | 理由 |
|---|---|---|
| **MUST-share**(经 SDK) | react、react-dom、react-router-dom、@tanstack/react-query、i18next + react-i18next | 单例不变量:React 实例、Router/QueryClient context、i18n 实例必须与宿主同源 |
| **MUST-share**(经 SDK) | `@/components/ui/*` 白名单 18 组件、`cn`、empty、theme、`getApiToken` | 宿主 UI/主题/鉴权一致性 |
| **bundle-own**(插件自带) | recharts、lucide-react、zustand、axios | 无跨边界单例约束;tree-shaking 后体积可控;避免宿主升级绑架插件 |

### 3.4 开发体验

- `packages/wargame-plugin` 起独立 vite dev server(:9395);宿主 dev 模式下 vite proxy 增配 `/plugins-dev/wargame/*` → :9395,装载器在 `import.meta.env.DEV` 时改从该前缀导入——**同源、免 CORS、热更快**;
- SDK-shim 在 dev/prod 行为一致(都读 `window.AgentUI`),插件源码零差异。

---

## 四、P0 前置项设计(开工 P1 前必须全部通过)

### 4.1 前置项 A:元数据先于代码装载

**原则**:卡片、路由、词条来自**安装时落地的 BFF 数据**,不依赖插件 JS 执行(QwenPaw `GET /api/pawapps` 来自 registry 的同款思路)。

**plugins.json schema**(BFF `data/plugins.json`,安装时写入):

```jsonc
{
  "schema": 1,
  "plugins": [{
    "id": "cognitive-wargame",
    "version": "1.0.0",
    "status": "enabled",            // enabled | disabled | incompatible
    "reason": null,                 // 非 enabled 时给用户看的文案 key
    "source": { "type": "builtin", "ref": "packages/wargame-plugin@<commit>", "checksum": "sha256:..." },
    "entry": { "js": "ui/dist/index.js", "css": "ui/dist/index.css" },
    "app": { "path": "/cognitive-wargame", "labelKey": "cognitiveWargame.common.title",
             "labelFallback": "Cognitive Wargame", "icon": "swords", "order": 50 },
    "routes": [ { "path": "/cognitive-wargame/scenarios/:id", "page": "ScenarioDetailPage" }, /* 共 24 条 */ ],
    "i18n": { "cognitiveWargame": { "zh": { "...": "..." }, "en": { "...": "..." } } },
    "peer": { "react": "^18.2.0", "tailwind-preset": "^1" },
    "agentui_version": { "min": "0.9.0" }
  }]
}
```

- `icon` 用 lucide 图标名字符串,宿主解析渲染(插件不传组件);
- `i18n` 随元数据整体下发(wargame 全量词条约 30KB);**上限守卫 200KB**,超限安装时拒绝并要求拆分词条文件;
- `routes[].page` 是插件入口模块 `activate()` 返回的 pages 键名,宿主据此构造懒组件。

**Bootstrap 时序**:

```
main.tsx 启动
  ├─ fetch GET /api/bff/plugins (AbortController 1s 超时)
  │    ├─ 成功 → 写 localStorage 缓存 → 进入正常合并
  │    ├─ 超时/失败 → 读 localStorage 上次成功缓存(SWR 式降级)
  │    └─ 均无 → 空插件列表,宿主照常起
  ├─ i18n init 时同步 addResourceBundle(插件词条)   ← 卡片/导航永不裸 key
  ├─ collectRoutes() 合并运行时路由: Component = loadPluginPage('cognitive-wargame', 'ScenarioDetailPage')
  └─ render
后台: refetch 列表,有变化 → toast「应用已更新,刷新后生效」(不热替换路由树)
```

**验收标准**:断网/杀 BFF 启动宿主 ≤ 正常启动 +1s 且无报错;插件词条在卡片渲染前已就绪;刷新深链直达。

### 4.2 前置项 B:Tailwind 共享 preset 原型

**`packages/tailwind-preset`**(宿主与插件同一来源,单一事实):

- `darkMode: ['selector']`(与宿主 `tailwind.config.js:6` 一致,`dark` class 由 theme-provider 切换);
- theme tokens 全量(colors 映射 css vars、borderRadius、fontFamily、keyframes 等)——由宿主现 config 抽取,**宿主 config 改为消费 preset**,双向锁死;
- `peerDependencies.tailwindcss` 锁定与宿主相同的版本区间,插件构建前置检查。

**插件构建约束**(`packages/wargame-plugin/tailwind.config.ts`):

```ts
export default {
  presets: [agentuiPreset],
  content: ['./src/**/*.{ts,tsx}'],   // 只扫插件源码
  corePlugins: { preflight: false },  // 宿主已含 preflight,禁止重复 reset
};
```

- 无 prefix(前缀需重写 11k 行类名,放弃;同源 preset 下同名工具类规则一致,冲突无害);
- 产物 `index.css` 只含插件源码出现的工具类 + 宿主 preset 令牌引用(css vars 在宿主文档根,天然生效);
- 暗色:`dark:` 变体依赖宿主文档的 class 切换,inline + 全局 style 注入下天然工作。

**宿主注入**:装载时 fetch CSS 文本 → `<style data-plugin="wargame">` 注入;禁用/卸载/版本不兼容时移除该节点。

**验收标准**(hello-world 插件执行):
1. 代表性类样(间距/颜色/`dark:` 变体/动画)在亮、暗两主题下,与宿主内相同标记渲染**逐像素一致**(截图对比);
2. 插件 CSS 注入后,宿主全站无任何样式回归(跑现有视觉冒烟);
3. 宿主与插件 tailwind 版本不一致时,插件构建 CI 直接失败。

### 4.3 前置项 C:BFF SSE 透传专项验证

wargame 23 种事件全走 BFF 代理后,须在**双通道**(vite dev proxy、nginx)各过一遍:

**配置规格**:
- BFF `/api/bff/plugins/:id/proxy/*`:复用 `bff/src/routes/proxy.ts` 的无缓冲透传,禁用压缩与缓冲;
- nginx 增配(复刻现 `/api/v1/wargame/` 模式,`nginx/default.conf:31-39`):

```nginx
location ~ ^/api/bff/plugins/[^/]+/proxy/ {
    include /etc/nginx/proxy.conf;
    proxy_buffering off;  proxy_cache off;
    proxy_read_timeout 0; proxy_send_timeout 0;
    proxy_set_header Connection "keep-alive";
}
```

- vite dev proxy 增配该前缀(对照现 wargame events 条目 `timeout: 0` + keep-alive 头,`vite.config.ts:71-84`)。

**测试矩阵**:

| 用例 | 通过标准 |
|---|---|
| 23 种事件类型逐一流经代理 | 事件体、顺序、id 与直连完全一致 |
| 1000 条事件脚本压测 | 零丢失、零重复 |
| 流中途杀 wargamesrv → 重启 | EventSource 自动重连成功(代理不缓存死连接) |
| 长连接空闲 5 分钟 | 不断流(超时配置生效) |
| ≥3 个并发流(多想定同演) | 相互隔离无串流 |
| 首字节延迟 | 代理 vs 直连开销 < 100ms |

**降级预案**:任一用例不过 → 清单支持 `backend.sse.mode: "direct"`,宿主按 9385 直连兜底(等价现状 SDK 化),SSE 专项转独立任务跟踪,不阻塞 P1/P2 的其余部分。

---

## 五、契约规格

### 5.1 app.json(插件根目录,wargame 实例)

```jsonc
{
  "id": "cognitive-wargame", "name": "Cognitive Wargame", "version": "1.0.0", "type": "app",
  "render": "inline",
  "entry": { "frontend": "ui/dist/index.js", "css": "ui/dist/index.css" },
  "backend": { "type": "proxy", "target": "http://127.0.0.1:9385",
               "stripPrefix": "/api/v1/wargame", "sse": { "enabled": true, "mode": "proxy" } },
  "agentui_version": { "min": "0.9.0" },
  "peer": { "react": "^18.2.0", "tailwind-preset": "^1" },
  "meta": { "app": { "labelKey": "cognitiveWargame.common.title",
                     "descriptionKey": "cognitiveWargame.common.subtitle",
                     "icon": "swords", "order": 50 },
            "routes_prefix": "/cognitive-wargame" }
}
```

安装时 BFF 读取 app.json → 展开 routes/i18n(取插件 locales 产物)→ 写 plugins.json。

### 5.2 插件前端契约与 SDK

```ts
// packages/wargame-plugin/src/plugin-entry.ts(产物入口,默认导出 activate)
import { apiFetch } from '@agentui/plugin-sdk';   // 插件唯一允许的宿主依赖入口
export function activate(ctx: PluginContext) {
  return {
    pages: {
      DashboardPage: () => import('./pages/DashboardPage'),
      /* 共 24 个懒组件,键名与 plugins.json routes[].page 对应 */
    },
    onDeactivate?: () => void,   // 卸载清理(store 重置、EventSource 关闭)
  };
}
```

**SDK 面(`window.AgentUI`,宿主 `src/plugins/host-externals.ts` 单文件导出)**:
- `host`:React、ReactDOM、ui 白名单 18 组件、`cn`、empty、theme hooks、`useTranslation`、`i18n`、`getApiToken`、`getApiUrl`;
- `HOST_API_VERSION`(语义化,导出即契约);
- `apiFetch(path, init)`:插件后端专用,自动拼 `/api/bff/plugins/:id/proxy/` 前缀、注入 Authorization 与 credentials。

**契约纪律**:
- 宿主侧:jest 快照测试锁定导出面——增删改任一导出未 bump `HOST_API_VERSION` 则 CI 红;CHANGELOG 固定「Plugin API」小节;
- 插件侧:ESLint `no-restricted-imports` 只放行 `@agentui/plugin-sdk` 与相对导入,违规即红——裸导入在 CI 层面绝迹,装载器无需运行时兜底。

### 5.3 BFF 路由面

| 路由 | 用途 |
|---|---|
| `GET /api/bff/plugins` | 元数据列表(bootstrap 消费) |
| `GET /api/bff/plugins/:id/files/*` | 静态产物服务(穿越防护、immutable 缓存) |
| `ALL /api/bff/plugins/:id/proxy/*` | 插件后端代理(stripPrefix、token 注入、SSE) |
| `POST /api/bff/plugins/install` | 安装/更新(来源见 §5.4;Zip-Slip 防护;重装=force) |
| `DELETE /api/bff/plugins/:id` | 卸载(onDeactivate → 移 CSS/运行时状态 → 删目录与记录) |
| `POST /api/bff/plugins/:id/{enable,disable}` | 启停(不动文件) |

### 5.4 安全与安装面

- **React 版本硬失败**(评审纪律 5):装载器在 import 前校验 `host.React.version` 满足 `peer.react`(semver),不满足 → status 置 `incompatible`、卡片显示原因、**不渲染、仅 console.error 记录**;无 warning-only 路径;
- **版本兼容**:`agentui_version` 安装时与启动时双重校验,不兼容 → disabled 记录,不崩宿主;
- **安装来源开关**:env `AGENTUI_PLUGIN_INSTALL_SOURCES`(默认生产 `builtin,local`,开发 `builtin,local,git,zip`);git 安装 `--depth 1` 锁 commit;
- **完整性**:安装记录 `source.checksum`(zip/git 均落 sha256),内置插件随镜像分发;
- **权限**:install/delete 仅 admin 会话。

---

## 六、wargame 专项

### 6.1 耦合面清理清单(P1 执行)

| 项 | 处置 |
|---|---|
| `@/components/ui/*` 18 组件(~120 处引用) | 改 import `@agentui/plugin-sdk`(SDK 重导出,源码仅改导入路径,批量 codemod) |
| `@/lib/utils`、`@/components/empty`、`theme-provider` | SDK 重导出 |
| `@/utils/authorization-util` + `@/constants/authorization`(4 处) | 删,换 `apiFetch`(token 注入宿主化,**S1 TODO 前端侧清偿**) |
| `@/locales/config`(i18n 实例) | SDK `useTranslation`/`i18n` |
| `@/pages/skills/components/{markdown,code}-viewer`(2 处,265 行) | **复制**进插件 `components/`(低耦合,不值得 SDK 化) |
| `SSE_BASE_URL` localhost hack(`api.ts:22-25`) | 删,统一 `apiFetch` 走 BFF 代理(前置项 C 通过后) |
| axios 实例 | 保留(bundle-own),baseURL 改代理前缀 |

### 6.2 鉴权与 SSE 收编

- 插件不再自行读 token:REST 走 `apiFetch`(BFF 代理统一注入 Authorization);cookie `withCredentials` 由 `apiFetch` 默认携带;
- SSE:改用 `apiFetch` 返回的流式 URL + 现有 `use-sse-events.ts` 重连逻辑不变(仅换 URL 来源);23 种事件类型与 store 分发零改动。

### 6.3 测试迁移

- wargame 自有单测随包迁移(复用根 jest 配置,monorepo 内零成本);
- 宿主 `feature-registry.test.ts`:删除 wargame 编译期断言与 locales 直引,**新增**「BFF 元数据 mock → 运行时卡片/路由/词条」断言(collectApps 合并后仍是唯一应用,防裸 key 传统延续);
- 新增装载器单测:版本不兼容、BFF 故障降级、重复装载去重、卸载清理。

---

## 七、实施计划(每阶段独立 PR,可独立回滚)

| 阶段 | 内容 | 出口条件 | 回滚 |
|---|---|---|---|
| **P0** 内核+验证 | host-externals/装载器/运行时 registry/bootstrap 合并;hello-world 示例插件;**前置项 A/B/C 三份验证报告** | 4.1/4.2/4.3 验收标准全绿;无插件时宿主零行为变化 | 删内核,编译期行为不变 |
| **P1** 包内提取 | `packages/wargame-plugin` 建立,git mv 迁移源码与历史;vite lib 构建改造(externals 分级/preset/single-entry);§6.1 清理;app.json | 独立构建产物经装载器全功能可用(接 9385) | 主仓库编译期代码未动,废弃包即可 |
| **P2** 并行运行 | BFF 安装(builtin:镜像构建时从包 dist 安装);编译期与运行时两版并存,深链回归(**24 路由 × {未登录重定向, 登录直达, 刷新深链, 模块内往返}**)+ SSE 真实事件对照 | 回归清单全绿;SSE 专项双通道通过 | 卸载插件即回编译期版 |
| **P3** 收编删除 | **独立 PR**:删 `src/features/cognitive-wargame`、vite/nginx 旧 wargame 特判、`api.ts` hack;更新 feature-registry 测试与文档 | P2 并行运行 ≥1 个完整迭代后执行 | git revert |
| **P4** 可选增强 | settings-page 服务地址等改 `config_fields` 宿主渲染;插件独立发版流程;进程内 Hono 后端档;物理拆仓(按 §3.1 触发条件) | — | — |

---

## 八、风险登记册(更新版)

| # | 风险 | 等级 | 状态/对策 |
|---|---|---|---|
| R1 | React 双实例 | 高 | **已消解**:SDK-shim 单点 + ESLint 边界(CI 红)+ 装载时 semver 硬校验(§5.4) |
| R2 | Tailwind 漂移 | 高 | **已消解**:preset 双向消费 + 版本锁定 + P0 像素级验收(§4.2) |
| R3 | BFF SSE 兼容 | 高 | **P0 专项**(§4.3),带 direct 降级预案,不阻塞主线 |
| R4 | bootstrap 阻塞/拖慢 | 中 | **已消解**:1s 超时 + SWR 缓存 + 后台刷新(§4.1) |
| R5 | 词条裸 key | 中 | **已消解**:词条随元数据同步注入 + 200KB 守卫(§4.1) |
| R6 | 路由树异步化改造面 | 中 | 运行时路由与编译期同构(懒组件包装);24×4 回归矩阵列为 P2 出口 |
| R7 | ui 白名单 API 漂移 | 中 | 契约快照测试 + HOST_API_VERSION + CHANGELOG 纪律(§5.2) |
| R8 | 供应链 | 中 | 来源 env 开关 + checksum + admin 鉴权 + 镜像内置(§5.4) |
| R9 | cookie 域依赖 | 低 | inline 档 + BFF 同源代理,不受影响 |
| R10 | 双仓摩擦 | 低 | **已消解**:monorepo 形态(§3.1);dev server 热更(§3.4) |
| R11(新) | 同源 HTTP import 的 CSP | 低 | 无 blob/eval,`script-src 'self'` 即可;镜像 nginx 现配置满足 |
| R12(新) | 并存期两版 wargame 状态混淆(编译期/运行时同时可达) | 低 | P2 用路由优先级显式压制(运行时注册的 `/cognitive-wargame/*` 优先于编译期),回归清单含"不存在双入口"断言 |

---

## 九、遗留与延后项

1. **物理拆仓**(§3.1 触发条件驱动);
2. **插件市场/远程索引**(对齐 QwenPaw `market/` + OSS index.json 模式,届时再设计);
3. **iframe 隔离档**(不可信插件场景,机制占位 `render: "iframe"`,实现延后);
4. **进程内 Hono 后端档**(`backend.type: "inline"`,无独立服务的轻插件用);
5. **@agentui/ui 独立包**(白名单组件从宿主全局迁移为 npm 共享,方案 B 终态);
6. **宿主 chat/SSE 能力 SDK 化**(QwenPaw `ctx.chat` 对应物,wargame 暂不需要)。

---

## 十、实现纪要(2026-10-13,实施完成后补记)

> 本节记录实际落地与本方案的偏差,阅读前文设计时以本节为准。

### 10.1 与方案的主要偏差(均为实施中验证后的演进)

| 设计(前文) | 实际实现 | 原因 |
|---|---|---|
| §3.1 monorepo `packages/wargame-plugin` 先行,物理拆仓按触发条件延后 | **直接物理拆仓**:`cognitive-wargame` 仓库 `web/agentui/`(用户决策) | 用户明确要求"迁回 wargame 仓库 web 目录";仓库天然有 `web/qwenpaw`(QwenPaw 宿主档)可参照 |
| §3.2 SDK-shim(插件只准 `import '@agentui/plugin-sdk'`,宿主共享 React/react-query 等) | **自包含单文件 + 双 React root**:插件自带全部依赖(React/UI/词条/Tailwind),宿主只渲染挂载 div,插件用独立 `createRoot` | 沿用 `web/qwenpaw` 已验证的 PawAPP 模式,彻底规避 React 单实例/共享面维护问题;代价是 bundle 5.2MB(gzip 1.27MB,首载可接受) |
| §4.2 Tailwind 共享 preset 包(`@agentui/tailwind-preset`) | 插件自带完整 tailwind 编译,CSS 以 `?inline` 编入 JS,挂载时注入 `<style>` | 自包含形态下无需 preset 共享;主题令牌靠拷贝同步(漂移风险列入触发条件项) |
| §5.2 ui 白名单 18 组件挂宿主全局 | 不适用(自包含形态);宿主全局仅 `registerApp`/`on`/`getApiToken`/`HOST_API_VERSION` | 同上 |
| 词条随元数据(§4.1)+ 卡片 labelKey | **双轨落地**:BFF 内联词条(`ui/locales/*.json`,插件简码→宿主 BCP-47 映射)+ 卡片"词条优先、app.json label 字面兜底" | 完整实现词条先行;字面兜底保证极端降级无裸 key |
| EventSource 认证 cookie 化(§4.3 备选) | 沿袭 `?token=` 查询串(BFF 代理透传) | cookie 方案动 BFF 鉴权面,列为后续项 |

### 10.2 部署形态(§七 之外的增量)

实际采用 **方案 B(镜像烤入)+ 预留 C(hub.wust.edu.cn 制品)**:
`scripts/package-plugin-bundle.sh` 打包 → Dockerfile COPY → entrypoint 幂等安装;
`BFF_PLUGIN_BACKEND_OVERRIDES` 运行时叠加 backend.target(部署者 env 走宽松校验
允许服务名,插件 app.json 声明走严格 IP 白名单——两级信任防 SSRF)。
详见 `deploy/README.md` 与 `deploy/k8s/`。

### 10.3 实施中发现并修复的存量问题(与本方案无关但同批修复)

1. nginx `proxy_buffering` 与 `proxy.conf` 重复声明——容器内 nginx 从未启动成功;
2. catch-all regex location 抢占 `/api/bff/`、`/api/v1/wargame/` 前缀——BFF/wargame
   通道在容器内从未生效(`^~` 修复);
3. 无尾斜杠 `/api/bff/plugins` 触发目录 301 且丢端口(精确 location +
   `absolute_redirect off`);
4. entrypoint envsubst 缺 `WARGAME_HOST/PORT` 替换。

### 10.3 路由表(§7)与实现的差异注记

§7 表格为设计稿,实际以 `bff/src/routes/plugins.ts` 为准:

| §7 设计 | 实际 |
|---|---|
| `POST /plugins/:id/{enable,disable}` 启停 | **未实现**(留任务清单;当前启停=删除/重装) |
| files 路由 "immutable 缓存" | ETag/304 协商 + `no-cache`(hash 文件名随 C 方案落地后切 immutable) |
| install "Zip-Slip 防护" | 当前仅本地路径来源(无 zip);防护在 C 方案实现时落地 |
| proxy "token 注入" | **透传**非注入:Authorization/查询串由调用方携带,BFF 只复制安全头 |
| DELETE "onDeactivate → 移 CSS/运行时状态" | 服务端删目录 ✓;前端运行时失效(免刷新)留任务清单 |

### 10.4 分期落地对照

P0(内核)✅ / P1(插件工程)✅ / P2(联调,含 wargamesrv 真实数据 86 想定 + SSE)✅ /
P3(删除编译期 wargame)✅ / P4 部分:词条+卡片本地化 ✅、SSE 代理收编 ✅、
语言/主题跟随 ✅、契约固化(HOST_API_VERSION+快照)✅、发版部署(compose+k8s)✅;
未做:config_fields 配置页、独立发版(C 方案)、进程内后端档、iframe 档。
