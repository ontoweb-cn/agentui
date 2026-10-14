# Canvas 阶段 4 独立构建与发版 — 技术方案(评审稿)

> **Status**: 设计定稿(2026-10-14,用户确认"canvas 阶段 4 独立构建与发版是明确的需求"后立项);**迁移代码未实施**——按 §六 分期推进。
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
| R1 | Tier B 白名单膨胀 → 回到"宿主即 SDK 库"维护地狱 | 白名单快照 + SHARED_API_VERSION 独立版本号 + 只加不改删纪律;新 surface 必须评审 |
| R2 | 并存期双入口混淆 | S2 期间运行时注册的路由显式压制编译期(同 wargame P2 先例);回归清单含"不存在双入口"断言 |
| R3 | 跨版本兼容无验证 | **S1 出口新增兼容性回归**:用 v1.0 SDK 构建的 fixture 插件(仓库内 `packages/plugin-compat-fixture`,冻结依赖)在每次宿主发版 CI 装载断言——老插件×新宿主机制化 |
| R4 | 无凭证环境无法真机验证 canvas 全功能冒烟 | S2 出口依赖持凭证账号执行 canvas-smoke-checklist(与 SC-003 归档同窗口);无凭证前 S2 不收口 |

## 八、未决问题(开工 S1 前拍板)

1. ui 白名单清单:以 canvas 实际 import 的组件集合为准(316 处引用去重后约 40+ 组件),是否全量进 Tier B 白名单,还是借机收敛 canvas 的 UI 面倾向——建议**全量进**(S3 后再收敛,一次只动一个轴);
2. `interfaces/database` 87 处类型引用:类型不进运行时产物,随 SDK `host` 子入口导出类型即可(d.ts 层面),无 SHARED_API_VERSION 语义;
3. S4 的 C 方案实现批次(zip + sha256 + 制品库 URL)需先行:unzip 依赖选型(adm-zip/yauzl 或容器内置 unzip)与制品库端点确认。
