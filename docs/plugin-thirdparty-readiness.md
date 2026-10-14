# AgentUI 插件生态第三方就绪度 — 差距分析与实施记录(2026-10-14)

> **背景**:用户确认需求——"canvas 阶段 4 独立构建与发版:①提供详细文档和 SDK 包,可由第三方团队独立构建;②提供版本管理与验证,老 SDK 插件要有一定兼容能力,不能兼容要有明确提示。"
> 本文固化差距分析、批次评审结论与实施记录;canvas 迁移主体设计见 [canvas-stage4-independent-build-spec.md](./canvas-stage4-independent-build-spec.md)。

## 一、差距分析(以 2026-10-14 代码事实核验)

| # | 差距 | 证据 |
|---|---|---|
| G1 | **SDK 包不存在**:"SDK" 只是 `window.AgentUI` 运行时全局 + 宿主仓 `src/plugins/types.ts`;插件作者手抄接口定义(guide §3 即手写 interface),无可安装构件 | `packages/` 仅 canvas-plugin |
| G2 | **文档内部向**:guide 假设读者可读宿主源码;无脚手架、无 hello-world walkthrough、无产物验收清单 | guide 全文 |
| G3 | **canvas 与运行时契约结构性冲突**:canvas→宿主 316 处组件引用+60+ hooks;宿主→canvas 7 文件反向消费;运行时契约(自包含/双 root/窄面)无法承载 | 实测 grep(§二 of stage4 spec) |
| G4 | **独立发版通道未实现**:唯一通道=镜像烤入;C 方案(zip+sha256)设计就绪未实现 | 中期评审 §4.1 |
| G5 | **版本协商不存在**:设计有 `agentui_version` 双重校验,代码零实现;HOST_API_VERSION 只注入不比对;唯一护栏=peer.react | grep 全仓无 agentui_version |
| G6 | **无兼容承诺/废弃策略**:契约纪律仅快照测试;guide"feature-detect 即可"靠自觉 | chat-sse-sdk §九 |
| G7 | **无跨版本验证**:无"老 SDK 产物×新宿主"回归矩阵 | — |
| G8 | **不兼容提示链路不完整**:设计有 incompatible status+reason,未实现;失败=通用错误占位 | runtime.tsx(改动前) |
| G9 | **插件自身版本管理缺位**:app.json.version 仅展示,无宿主配套声明 | — |

## 二、批次评审结论

| 批次 | 内容 | 结论 | 理由 |
|---|---|---|---|
| A | apiVersion 协商 + 安装/装载双侧校验 + 不兼容显性提示 | ✅ 本批执行 | 直接命中需求②;纯宿主侧可完整测试 |
| B | `@agentui/plugin-sdk` 包化(类型单源化 + definePlugin/satisfiesApiVersion) | ✅ 本批执行 | A 的依赖前置;G1 核心清偿 |
| C | plugin-template 脚手架 + guide 第三方上手 | ✅ 本批执行 | G2 清偿;依赖 B |
| D | canvas 阶段 4 spec(SDK 面两档决策) | ✅ 本批只出设计 | G3 迁移涉及 300+ 引用与反向依赖清偿,无凭证真机验证窗口下硬迁码不可评审 |
| E | C 方案 zip 发版通道 | ⏸ 缓办 | G4:需 unzip 依赖选型(adm-zip/yauzl/容器内置)与制品库端点确认,独立批次;canvas S4 依赖它 |

## 三、实施记录(本批)

### A|版本协商最小闭环(需求②)

- **声明**:app.json 新增 `apiVersion`(区间;缺省=任意版本)。语义:`^`同 major≥声明、`~`同 minor、`>=`/裸版本不低于、`=`精确——**老 SDK 插件在新宿主上同 major 内天然兼容**(契约 major 内只做加法的纪律),跨 major 明确不兼容。
- **安装侧验证**(BFF `readPluginMeta` + `isValidApiVersionRange`):格式非法直接拒绝安装/不出列表(防落盘篡改形态);语义判定归装载侧,双端分工避免判定漂移。
- **装载侧验证**(runtime `compatibilityReason`,自 rejectReason 拆出兼容域):peer.react 与 apiVersion 不满足 → **插件仍注册**(卡片可见+「不兼容」徽标,深链可达),挂载页显示具体原因(声明区间 vs 宿主版本)+处理指引,**不装载插件 JS、无重试按钮**(重试无意义)。结构错误(id/path/entry)仍走 rejectReason 不注册。
- **文案**:plugins.incompatibleBadge/Title/Hint 三语言(zh-Hans/zh-Hant/en)。
- 与 SDK `satisfiesApiVersion` 同语义:宿主 runtime 与插件自检共用一套判定。
- **分层注记(评审补充)**:BFF 数据面**不做** apiVersion 断路(与停用断路不同层)——兼容性是前端呈现关切,BFF 只负责格式门禁;老版本插件的数据面路由照常服务,由宿主决定是否装载其 JS。

### B|@agentui/plugin-sdk 包化(需求①)

- `packages/plugin-sdk`(v1.3.0,零依赖零副作用):契约类型单源化(自宿主 types.ts 迁出,宿主 re-export 保持引用稳定)+ `definePlugin`(带类型注册)+ `satisfiesApiVersion`/`parseApiVersionRange`/`getHostApiVersion` + README(兼容策略表)。
- 宿主 `src/plugins/types.ts` 变为 re-export + 宿主内部类型(PluginAppMetadata 新增 apiVersion);**禁止再在宿主侧新增插件可见契约**(文件头纪律)。
- 接线:vite alias / tsconfig paths / jest moduleNameMapper 三处;`npm pack` 即第三方分发形态(registry 接入前)。
- `SDK_VERSION` 与 `HOST_API_VERSION` 同步演进以单测锁定(漂移=有契约变更未走 SDK 发版流程)。

### C|plugin-template 脚手架 + guide(需求①)

- `packages/plugin-template`:app.json(含 apiVersion/peer/labelKey/i18n)、definePlugin 入口(演示 mount/dispose 对称清理 + localechange 跟随)、vite lib 单文件构建、外部导入边界守卫脚本、README(复制改名即用)。
- `plugin-development-guide.md` 增补:§0.1 SDK 包与模板上手、§2 app.json apiVersion 字段、§10 兼容性策略。

### D|canvas 阶段 4 spec(设计,不迁码)

- 核心决策:**两档 SDK 面**——Tier A 窄面自包含(现状,第三方)+ Tier B 共享面 SDK-shim(canvas 等一方插件,宿主 Provider 树内挂载,白名单快照 + SHARED_API_VERSION 独立版本号);否决"canvas 全自包含"(context 割裂+反向依赖无解)与"全盘 shim"(推翻 wargame 形态)。
- 分期 S1(SDK-shim 注入面)→ S2(canvas 独立构建双轨并存)→ S3(反向依赖清偿+删编译期)→ S4(zip 发版,依赖批次 E)。
- 兼容回归要求:冻结依赖的 fixture 插件(`plugin-compat-fixture`)随宿主 CI 装载断言——"老插件×新宿主"机制化(G7 清偿路径)。

## 四、剩余差距与触发条件

| 差距 | 状态 | 解除条件 |
|---|---|---|
| G3 canvas 迁移 | spec 定稿,代码未动 | S1 开工前拍板 §八三问;S2 收口需持凭证真机冒烟 |
| G4 独立发版通道 | 设计就绪未实现 | 批次 E 立项(unzip 选型+制品库端点) |
| G6 兼容承诺文档化 | 兼容策略已写入 SDK README+guide;语义化 CHANGELOG 未建 | SDK 包首次对外发布时建 Plugin API CHANGELOG 小节 |
| G7 跨版本验证矩阵 | fixture 方案已入 spec R3 | S1 出口落地 |
| 制品库/registry | 未接 | C 方案批次 |
