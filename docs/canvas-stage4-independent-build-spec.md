# Canvas 阶段 4 独立构建与发版 — 技术方案(评审稿)

> **Status**: 设计定稿(2026-10-14,用户确认"canvas 阶段 4 独立构建与发版是明确的需求"后立项);**S1 已落地(2026-10-15)、S2 已实施(2026-10-16,收口待持凭证冒烟 §9.7)、E zip 通道已实施、S3/S4 细化待触发(§九)**。
> **Date**: 2026-10-14
> **Prerequisites**: 第三方生态准备批次已落地(apiVersion 协商 + @agentui/plugin-sdk,见 [plugin-thirdparty-readiness.md](./plugin-thirdparty-readiness.md))
> **Related**: [canvas-plugin-extraction-design.md](./canvas-plugin-extraction-design.md)(阶段 0-3 已完成)、[runtime-plugin-architecture.md](./runtime-plugin-architecture.md)(运行时插件总纲)

## 一、需求(用户原话的工程化转译)

1. **提供详细的文档和 SDK 包,可以由第三方团队独立构建**——插件工程的创建、构建、安装、调试全流程不依赖宿主仓库源码;
2. **提供版本管理与验证**——插件声明其依赖的宿主 API 版本;用较老 SDK 开发的插件在新宿主上**提供一定兼容能力**(同 major 内可装载);不能兼容时**有明确提示**(卡片标注 + 原因页,不静默)。

其中第 2 条的机制部分(apiVersion 协商、SDK 包、兼容策略)已随第三方生态准备批次先行落地并通用于所有插件;本方案解决剩余主体:**canvas 本体从编译期包迁移为可独立构建发版的运行时插件**。

## 二、现状与主矛盾

canvas 现为 monorepo 编译期包(`packages/canvas-plugin`,`main: src/index.ts`,经 vite alias 随宿主编译,ModuleDefinition 契约)。实测耦合(2026-10-14):

| 方向 | 规模 | 性质 |
|---|---|---|
| canvas → 宿主 | **316 处** `@/components/ui`、87 处 `interfaces/database`、40+ 处宿主 hooks(use-agent-request/common-hooks 等) | 消费宿主 React 单例、QueryClient、i18n 实例与组件库 |
| 宿主 → canvas | **7 个文件**反向消费包导出(`pages/agents/`×3、`floating-chat-widget`、`use-agent-request`、`use-send-message`、`features/canvas/manifest`) | 编译期反向依赖 |

运行时插件契约(wargame 档)是**自包含单文件 + 独立 React root + 只依赖 `window.AgentUI` 窄面**——canvas 的耦合形态在该契约下无法装载。**主矛盾:第三方独立构建要求"插件只依赖 SDK",而 canvas 依赖宿主一切。** 阶段 4 的原设计("4a 配 vite library mode、4b 发 npm 包")没有覆盖这条迁移路径,本方案补齐。

## 三、SDK 面架构决策(本方案核心)

**决策:两档 SDK 面(Tier),按插件信任级别选择,而非二选一。**

| | **Tier A:窄面自包含档**(现状,wargame 档) | **Tier B:共享面 SDK-shim 档**(新增,canvas 档) |
|---|---|---|
| 插件依赖 | 自带 React/UI/词条,只 import `@agentui/plugin-sdk`(类型+helper,零运行时) | 经 `@agentui/plugin-sdk/host` import **宿主提供的单例**:React、ReactDOM、`@tanstack/react-query`、i18next、ui 白名单组件、`cn` 等 |
| 宿主实现 | `window.AgentUI` 窄面(4 函数+chat) | `window.__AGENTUI_SHARED__` 宽面(宿主编译期注入,SDK 包 re-export 类型;插件产物经 externals 映射为零体积引用) |
| React 实例 | 独立(双 root) | **共享**(插件 root 挂在宿主 Provider 树内:QueryClientProvider/ThemeProvider 包裹挂载点,context 可跨) |
| 兼容面 | 极窄,HOST_API_VERSION 1.3.0 | 宽,按**白名单快照 + 独立版本号**管理(`SHARED_API_VERSION`,与窄面分开演进) |
| 适用 | 第三方/外部团队(信任低、自定义 UI) | 一方插件(canvas;信任高、要宿主一致的 UI 与状态) |
| 版本兼容机制 | `app.json apiVersion`(已落地) | `app.json apiVersion` + `sharedVersion` 双声明;Tier B 白名单**只加不改删**(破坏性 = bump SHARED_API_VERSION major,宿主对不满足的插件给 incompatible 提示,机制同 Tier A) |

**否决的备选**:canvas 整体自包含化(把 React/query/ui 全打进产物)——上下文割裂(FormSyncContext/ChatSheetContext 等 React context 无法跨 root,通用组件联动全断)、产物体积爆炸、且 7 处宿主反向消费无法编译;全盘 SDK-shim 化(废弃 Tier A)——推翻 wargame 已验证形态,第三方被迫接受宿主技术栈。两档并存成本可控:Tier B 的宿主注入面是一个新文件(`src/plugins/host-externals.ts`),对 Tier A 零影响。

## 四、canvas 迁移设计(Tier B)

- **入口契约**:canvas 包新增 `plugin-entry.ts`:`defineHostPlugin({ id: 'canvas', mount })`(Tier B 版 definePlugin,类型同 `@agentui/plugin-sdk/host`);内部保留现有 ModuleDefinition 的 routes/nav 表,由宿主装载器把 `/agent/*` 路由并到 runtime registry(路径不变,零深链回归)。
- **构建**:canvas 包新增独立 vite lib 构建(externals:react/react-dom/react-query/i18next/ui 白名单 → 映射到 `__AGENTUI_SHARED__`),产物 `packages/canvas-plugin/ui/dist/index.js` + app.json(`apiVersion`+`sharedVersion`+`capabilities`)。
- **宿主侧**:`features/canvas/manifest.ts` 从"指向包源码"改为 runtime registry 消费 BFF 元数据(与 wargame 同路径);挂载点包 Provider 树。
- **反向依赖清偿(7 文件)**:`pages/agents/*`、`floating-chat-widget`、`use-agent-request`、`use-send-message` 对 canvas 导出的引用改为**消费 canvas 提升到公共层的 API**(沿 FormSyncContext/ChatSheetContext 同款"通用接口+画布实现"模式;widget 的彻底解耦与 BFF 统一 widget API(方案 F)衔接)。
- **发版**:产物随镜像烤入(方案 B,builtin)起步;独立发版走 C 方案 zip 制品(机制已就绪设计,见中期评审 §4.1)。

## 五、版本管理与验证(映射需求 2,机制已于第三方生态批次落地)

| 需求 | 机制 | 状态 |
|---|---|---|
| 插件声明宿主 API 版本 | `app.json.apiVersion`(区间,`@agentui/plugin-sdk satisfiesApiVersion` 语义) | ✅ 已落地 |
| 安装侧验证 | BFF `readPluginMeta` 格式硬校验(非法拒绝安装) | ✅ 已落地 |
| 装载侧验证 + 明确提示 | runtime `compatibilityReason`:不满足 → 卡片"不兼容"徽标 + 挂载页原因(声明 vs 宿主),不装载 JS | ✅ 已落地 |
| 老 SDK 插件兼容 | 契约同 major 只做加法(HOST_API_VERSION 纪律)+ 缺省 apiVersion 宽容 | ✅ 机制;**验证矩阵待建**(§七) |
| SDK 包可独立获取 | `@agentui/plugin-sdk`(npm pack 产物;registry 接入后 install) | ✅ 包化;**制品库分发待 C 方案** |

## 六、实施分期(每期独立 PR,可独立回滚)

| 期 | 内容 | 出口条件 |
|---|---|---|
| **S1** | Tier B 注入面:`src/plugins/host-externals.ts`(React/query/i18n/ui 白名单经 `__AGENTUI_SHARED__` 暴露)+ SDK 包 `host` 子入口类型;快照测试锁定白名单 | 宿主测试绿;白名单变更必须 bump `SHARED_API_VERSION` |
| **S2** | canvas 插件入口 + 独立构建(externals 映射)+ app.json;**编译期与运行时两版并存**,BFF 安装 builtin 产物 | 装载版 canvas 全功能等价(列表→编辑→保存→执行→上传→trace→版本→重置→删除冒烟);深链 `/agent/:id` 回归 |
| **S3** | 反向依赖清偿(7 文件切公共 API)+ 删编译期路径(features/canvas 薄封装退役) | `grep -r "canvas-plugin" src/ | grep -v packages` 归零断言入 CI |
| **S4** | (可选,触发驱动)C 方案 zip 发版 → canvas 独立发版闭环 | 机器人产出制品 + sha256;安装通道验收 |

## 七、风险与验证要求

| # | 风险 | 对策 |
|---|---|---|
| R1 | Tier B 白名单膨胀 → 回到"宿主即 SDK 库"维护地狱 | 白名单快照 + SHARED_API_VERSION 独立版本号 + 只加不改删纪律;新 surface 必须评审。**工程注记**:根 jest mapper 当前仅精确映射 `@agentui/plugin-sdk` 主入口,S1 落地 `host` 子入口时须同步 mapper/vite alias/tsconfig paths 三处 |
| R2 | 并存期双入口混淆 | S2 期间运行时注册的路由显式压制编译期(同 wargame P2 先例);回归清单含"不存在双入口"断言 |
| R3 | 跨版本兼容无验证 | **S1 出口新增兼容性回归**:用 v1.0 SDK 构建的 fixture 插件(仓库内 `packages/plugin-compat-fixture`,冻结依赖)在每次宿主发版 CI 装载断言——老插件×新宿主机制化 |
| R4 | 无凭证环境无法真机验证 canvas 全功能冒烟 | S2 出口依赖持凭证账号执行 canvas-smoke-checklist(与 SC-003 归档同窗口);无凭证前 S2 不收口 |

## 八、未决问题(2026-10-15 拍板,S1 已开工)

1. **ui 白名单:全量进 Tier B**——canvas 实际消费的 33 个 ui 模块已全部注入(`src/plugins/host-externals.ts`,模块命名空间形态),契约快照锁定模块清单与导出名;收敛 ui 面延后到 S3 之后(一次只动一个轴);
2. **`interfaces/database` 87 处类型引用:走 `@agentui/plugin-sdk/host` 类型层**(S2 落地 d.ts 导出)——纯类型、无运行时语义、不占 SHARED_API_VERSION 契约面;
3. **C 方案不阻塞 S1/S2**——仅 S4 依赖;unzip 依赖选型与制品库端点确认独立立项。

**S1 落地注记(2026-10-15)**:`host-externals.ts`(react/reactDom/reactDomClient/reactQuery/i18n/cn + 33 ui 模块)、SDK `host` 子入口(`SHARED_API_VERSION=1.0.0` + `getSharedHost`)、契约快照(`host-externals.test.ts`:模块清单 + 各模块导出名,删改即红)、**plugin-compat-fixture 兼容基线**(冻结的 v1.0 代产物 + 宿主发版纪律:compat-fixture.test.ts 不绿不发版,R3 落地)。jest mapper/vite alias/tsconfig paths 三处已同步 `host` 子入口(spec R1 工程注记兑现)。

## 九、S2/S3/S4 执行细化(2026-10-16,S2 实施)

### 9.1 S2 构建策略:单例外部化 + 非单例打包复制(S2 核心决策)

S1 时"canvas 消费面=316 处 ui + 87 处类型 + 40+ 处 hooks"的实测口径偏窄。全量审计
(2026-10-16):canvas 对宿主 `@/` 导入共 **893 处 / 260 文件 / ~130 个模块**,分类:

| 类别 | 规模 | 处置 |
|---|---|---|
| `components/ui/*`(S1 白名单) | 33 模块 | 外部化 → `shared.ui.*`(已有) |
| 框架单例 | react/react-dom/client/query/i18next/router/react-i18next | 外部化 → S2 增补面(下表) |
| 有状态宿主模块 | theme-provider(context)、locales/config(i18n 实例+命名导出) | 外部化 → S2 增补面 |
| 非 ui 宿主组件 | 58 模块(intellect-form、form-container、llm-select 等) | **打包进产物**(构建期读宿主源码,一方档 monorepo 构建) |
| 宿主 hooks | 14 模块(use-agent-request 34 处等) | 打包(经外部化 query 共享 QueryClient context,行为等价) |
| utils/constants | 16 模块(utils/api 为纯 URL 常量) | 打包(自洽副本,见评审 P2-2) |
| `interfaces/*`、`features/_types` | 纯类型,0 运行时导出 | 编译期擦除,零产物影响 |

**理由**:把 58 组件+hooks 全部进白名单 = R1"宿主即 SDK 库"地狱;整体自包含 = §三已否决
(context 割裂+双 React)。单例外部化使产物与宿主**同 module 实例**——React context、
QueryClient、i18next 实例、Router context 全部与编译期行为逐位一致,这是最小的正确面。

**S2 增补共享面(SHARED_API_VERSION 1.0.0 → 1.1.0,纯加法 minor;compat-fixture 未声明
sharedVersion 不受影响)**:

| 槽位 | 内容 | 外部化映射 |
|---|---|---|
| `jsxRuntime` | `react/jsx-runtime` 命名空间 | 插件 JSX 自动编译产物的导入目标 |
| `router` | `react-router` 命名空间 | useNavigate/useParams/Link 等 context 绑定面 |
| `reactI18next` | `react-i18next` 命名空间 | useTranslation(91 处);与宿主同 module → 同 context |
| `i18nModule` | `@/locales/config` 模块 namespace | default=实例(S1 `i18n` 同对象,宿主即 i18next 包默认单例)+ `changeLanguageAsync` 等命名导出 |
| `themeProvider` | `@/components/theme-provider` namespace | 宿主根 Provider 的 context 对象 |

bare `i18next` → `shared.i18n`(宿主 locales/config 即包默认实例,已核实)。
ui 白名单键清单单源化:SDK 导出 `SHARED_UI_MODULE_KEYS`,宿主快照测试断言与 host-externals
一致,canvas 构建配置消费同一清单生成映射。

### 9.2 S2 产物与装载契约

- **产物形态**:`packages/canvas-plugin` 新增独立 vite lib 构建(**多 chunk ESM**,不用
  inlineDynamicImports——保编辑器/xyflow 的路由级懒加载;Tier A 单文件契约不适用于
  host 档),入口 `plugin-entry.ts`,输出 `ui/dist/index.js` + `ui/dist/index.css`
  (cssCodeSplit 关闭,含 8 个 module.less 与被打包宿主组件样式)+ 懒 chunk。
- **externals 变换插件**:构建期把外部化模块的 import 声明重写为
  `window.__AGENTUI_SHARED__.<slot>` 解构(含多行 named/namespace/default 形态)——
  产物零 bare import。
- **app.json**(新增字段,BFF 校验):`type: "host"`;`routes`(声明式路由表,注册期只读
  元数据);`sharedVersion`(区间,语义同 apiVersion,对 `SHARED_API_VERSION` 判定);
  `style`(CSS 产物路径,entry 同规则校验)。
- **宿主装载(懒两段式)**:启动仅按 `meta.routes` 注册懒包装路由(不拉 bundle,登录页
  零开销);首访才 `loadHostPluginBundle`(loader.ts):动态 import entry → def 形状校验 →
  注入 CSS link(幂等)→ 按 path 匹配 def.routes 渲染。i18n 经复合 loader(先 bundle 后
  def.i18n.lazy)走既有 collectI18nLazy,词条单源 TS。
- **R2 压制**:`initRuntimePlugins` 把结构性合法 metas 的 id 写入
  `window.__AGENTUI_RUNTIME_PLUGIN_IDS__`(先于 `import('./app')`,时序由 main.tsx
  await 保证);`features/canvas/manifest.ts` `enabled()` 检测到 `canvas` 即 false。
  运行时插件卸载/停用 → 下次启动编译期版本自动回归(共存兜底)。
- **不兼容 Tier B**:peer.react/apiVersion/sharedVersion 任一不满足 → 单条 `path/*`
  包装路由 + 不兼容原因页(复用 Tier A 挂载页),不拉 bundle。
- **烤入**:frontend-builder 阶段产出 `deploy/plugin-bundles/canvas/`(app.json+ui/),
  production 阶段叠加 COPY 进 `/opt/bundled-plugins/`,entrypoint 既有幂等安装机制照用;
  产物不入 git(镜像构建时生成;本地 `npm run build:canvas-plugin` + 安装脚本)。

### 9.3 S3 执行细化(门控:S2 冒烟收口后才执行)

| 反向依赖文件 | 消费面 | 提升方案 |
|---|---|---|
| `pages/agents/use-import-json.ts` | `dsl-bridge` 全量+`inferIsAgentFromImport` | dsl-bridge(纯函数,无模块态)整体提升宿主 `src/lib/agent-contract/dsl-bridge.ts`,canvas 改为源码级复用同模块 |
| `pages/agents/hooks/use-create-agent.ts` | `initialEmptyDsl` | 同上(随 dsl-bridge) |
| `hooks/use-send-message.ts` | `BeginQuery`(类型) | 类型提升宿主 `src/types/canvas-contract.ts`;canvas 侧 `import type`(构建期擦除,零运行时依赖) |
| `hooks/use-agent-request.ts` | `IInputs`(类型) | 同上 |
| `pages/agents/agent-log-page.tsx` | `useFetchDataOnMount` | 归属修正:提升宿主 hooks(该 hook 只服务宿主日志页) |
| `components/floating-chat-widget.tsx` | `useSendNextSharedMessage` 等 | 桥接 hooks 提升宿主桥接层(canvas 经共享面消费同一模块);彻底解耦衔接方案 F(F1-F3 已落档 §8.5) |
| `features/canvas/manifest.ts` | 包默认导出 | 整文件退役(S2 已做 R2 压制,S3 删除编译期注册) |

出口断言:`grep -r "canvas-plugin" src/ | grep -v packages` 归零入 CI;tailwind
content 的 `packages/canvas-plugin` glob **必须保留**(产物 className 依赖宿主样式表扫描)。

### 9.4 S4 执行细化(门控:制品库端点决策 + S3)

发版流水线契约(对齐 cognitive-wargame bundle CI 先例):canvas 仓构建 → 产物 zip
(app.json+ui/,单根目录)→ sha256 随行 → 制品库(Harbor/制品端点**待决策**,E 门控)
→ 安装侧 zip 通道验收(见 9.5)→ canvas-smoke-checklist 全量回归。

### 9.5 E 批次(zip 安装通道,S2 批次内已实施部分)

- `POST /plugins/install` 新增 multipart 上传形态(file 字段 `file`):
  **adm-zip**(纯 JS,bff 依赖最小化)+ 防护四件套——zip-slip(条目路径 `..`/绝对/
  反斜杠拒收)、炸弹封顶(条目 ≤4000、解压总量 ≤512MB)、符号链接条目拒收、
  单根目录自动探测(GitHub 式 `repo-*/` 前缀剥离)。
- sha256:响应与审计记录制品哈希;上传方可附期望值(字段 `expectedSha256`)做端到端校验。
- 来源开关:`BFF_PLUGIN_INSTALL_SOURCES` 增 `zip` 枚举,**默认仍 `local`**(不改变存量
  部署安全姿态,zip 为 opt-in);admin token 守卫不变。
- 未实施(维持门控):制品库端点(上传/下载/版本列举)、registry 分发。

### 9.6 S2 评审记录(对抗性自评,2026-10-16)

- **P1-1 react-i18next/Provider 一致性**:外部化策略使插件与宿主引用同一 react-i18next
  module → I18nextProvider context 与默认实例回退路径同编译期逐位一致(打包副本方案会
  产生双 context,已否决)。
- **P1-2 多 chunk 相对引用**:BFF files 路由按目录 serve,chunk 以相对路径互引,装载
  URL `/api/bff/plugins/canvas/files/ui/dist/index.js` 下自洽;`inlineDynamicImports`
  会让登录页拉全量编辑器(已否决)。
- **P2-1 打包宿主组件的模块级副作用副本**(llm-cache、request 拦截器等):自洽副本——
  读写都发生在产物内,行为正确但与宿主缓存不互通;冒烟清单补"画布内 LLM 下拉有数据"
  项验证。
- **P2-2 `utils/request` 的 `RetcodeMessage` 模块级 `i18n.t` 求值**:外部化 i18n 后
  实例一致,副本求值正确;语言切换晚于模块求值的场景与编译期一致(t 惰性绑定)。
- **P2-3 sharedVersion 增量兼容**:1.1.0 纯加法,声明 `^1.0.0` 的存量 Tier B 插件
  (现无)与 compat-fixture 均不受影响。
- **P3-1 jest 解析**:根 jest moduleNameMapper 补 `@agentui/canvas-plugin/(.*)` 映射
  (反向依赖文件的测试链可达)。
- **P3-2 canvas tsc**:canvas 包 tsconfig 保持源码态检查;构建产物不入根 tsc 面。

### 9.7 S2 出口清单(冒烟窗口执行,持凭证)

canvas-smoke-checklist 全量(列表→编辑→保存→执行→上传→trace→版本→重置→删除)+
深链 `/agent/:id` 与 `/agent/:id/explore`、分享页 `/agent/share`、未装插件时编译期
回退、双语词条、暗色主题、画布内 LLM 下拉(P2-1)。**无凭证前 S2 不收口**(R4 不变)。

**2026-10-17 真机冒烟执行记录(intellect-team 生产租户,自建测试画布全流程后删除,
零存量数据损伤)**:

| 项 | 结果 | 备注 |
|---|---|---|
| 运行时装载(bundle 拉取/CSS 注入/深链 /agent/:id) | ✅ | R2 接管生效,登录页零 bundle 拉取 |
| 列表/编辑(节点渲染+表单面板)/保存(服务端 update_time 前进) | ✅ | |
| 执行(Run→reset→测试对话面板→消息→completions 200) | ✅ | 仅 Begin 节点无 LLM,空回复符合画布拓扑 |
| trace(Log 面板,节点 Online)/版本(6 版本列表)/重置(Run 流程内 reset 200) | ✅ | |
| 删除(自建测试画布 code 0,17 个存量画布零损伤) | ✅ | |
| explore/share 深链 | ✅ | share 需 `from`+`shared_id` 查询参数(既有契约) |
| 双语词条(zh-Hans bundle 存活 + flow 键注入)/暗色主题 | ✅ | 见下方修复 ④ |
| **卸载回退(编译期接管)** | ✅ | 卸载后 runtimeIds 清空、无 CSS 注入、编辑器照常 |
| 画布内 LLM 下拉 | ⛔ 环境阻塞 | `/proxy/v1/users/me/models` 401:本地 .env 缺 `INTELLECT_RAG_ADMIN_EMAIL/PASSWORD`(rag-token 动态登录失败回退 env 亦空)——环境配置项,非 S2 代码问题 |

**冒烟发现并当场修复的缺陷(全部收敛进本批)**:

1. **R2 双注册(P0)**:`_registry` 被 `locales/config` 等启动链静态引入,急求职值
   早于压制标记写入,编译期 enabled() 必然读到空标记 → 编译期/运行时同路径双注册,
   编译期胜出、bundle 永不装载。修复:注册侧 `registerRuntimeModules` 按「路由 path
   精确重合」移除编译期同路径模块(不依赖求值顺序的确定性压制),manifest 标记检查
   降为纵深防御;`main.tsx`/`locales/config` 改动态引入打断静态链(顺带收敛启动期
   急求图)。
2. **radix 原语打包副本(P0)**:宿主组件存在直接 import `@radix-ui/react-tooltip`
   的形态,打包副本产生第二个 Provider context → `Tooltip must be used within
   TooltipProvider` 编辑器白屏。修复:共享面增补 `radixTooltip` 槽位(1.1.0 同批次
   增量)+ 外部化映射。
3. **vite:alias 预解析逃逸(P1)**:alias 在本插件 resolveId 之前把 `@/xxx` 解析为
   无扩展名绝对路径,精确别名匹配全部漏网 → `@/locales/config` 打包副本在 artifact
   装载时对共享 i18next 实例执行**二次 init**(en-only resources)→ 运行 ~1.4s 后
   zh-Hans 束整体被清(词条丢失+宿主中文回退英文)。修复:resolveId 增加「解析路径
   候选扩展名匹配」,覆盖被预解析的绝对路径与相对导入两类形态。
4. **i18nModule 默认导入绑定(P1)**:模块 namespace 槽位的 default 导入需取
   `.default`(config.default = i18next 实例),否则 `R.t is not a function`。修复:
   重写器 default 绑定改为 `tmp.default ?? tmp`(与 ESM interop 语义一致)。
