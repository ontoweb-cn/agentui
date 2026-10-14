# AgentUI 运行时插件体系 — 架构总纲(实现总结)

> 本文档回答初始问题:"如何利用 QwenPaw PawAPP 机制改进 AgentUI 应用插件,使插件在另外的仓库开发、在 AgentUI 动态加载"——**该目标已完整实现**。本文固化最终设计,是插件体系的总纲视角。
>
> 配套文档:
> - 方案与实现纪要:[cognitive-wargame-plugin-migration-design.md](./cognitive-wargame-plugin-migration-design.md)
> - 插件作者指南:[plugin-development-guide.md](./plugin-development-guide.md)
> - 部署与发版:[../deploy/README.md](../deploy/README.md)
>
> Status: 已实现(2026-10-13);首个插件 cognitive-wargame 已在独立仓库运行;**首个正式版 v0.4.0 已发**(git tag v0.4.0,镜像 hub.wust.edu.cn/intellect/agentui:0.4.0,插件 pin cognitive-wargame@998c6af)
> 机制参照:QwenPaw PawApp(`~/project/QwenPaw`)

## 一、从 QwenPaw PawApp 借鉴的机制与本地化改造

对 QwenPaw 机制分析(`src/qwenpaw/plugins/`、`pawapp/`、console 装载链)提炼出六项核心设计,AgentUI 全部借鉴并按自身约束改造:

| PawApp 机制 | AgentUI 实现 | 改造原因 |
|---|---|---|
| `plugin.json` 清单(`type:"app"`、entry 双入口、版本区间、声明式配置) | `app.json`(path/label/entry/peer/i18n/backend),安装时 BFF 校验落盘 | 增加挂载路径黑名单(防路由劫持)、backend 代理声明(SSRF 两级白名单) |
| Python importlib 进程内加载 + FastAPI 子路由 | **前端自包含单文件 ESM + 同源 HTTP 动态 import**;后端不做进程内(仅 proxy 型) | JS 无 Python 式命名空间隔离;Tailwind 需自编译;AgentUI 是 React 非共享组件库形态 |
| blob-URL import 单文件 IIFE | 同源 URL `import(/* @vite-ignore */)` | 保留按需装载且兼容分包 |
| 宿主注入 `window.QwenPaw`(React/antd 全量) | `window.AgentUI`(窄面:`registerApp`/`on`/`getApiToken`/`HOST_API_VERSION`,快照测试锁定) | 双 React root 替代共享 React,规避单实例维护 |
| 应用中心内嵌 + `/apps/:id` 深链 | 路由并入 feature registry,深链完整保留(`/cognitive-wargame/*`) | AgentUI 路由式体验 |
| zip/URL 安装 + `pack_exclude` | 本地路径安装(token 鉴权)→ 镜像烤入(方案 B)→ 预留制品库 URL(C) | 分阶段 |

## 二、最终架构(三层)

```
┌─ 插件仓库(独立开发:cognitive-wargame/web/agentui)─────────────┐
│ app.json + ui/dist/index.js(自包含 React/Tailwind/词条)        │
│ + ui/locales/*.json + lint:imports/tsc/vitest/CI               │
│ 契约:window.AgentUI.registerApp({id, mount→dispose})          │
└──────────────┬─────────────────────────────────────────────────┘
               │ 安装(本地路径→镜像烤入→预留URL)/ 装载(同源 import)
┌─ AgentUI 宿主 ─┴────────────────────────────────────────────────┐
│ 前端内核 src/plugins/:host-global(1.1.0)/loader(同源 import,   │
│   dev 热更直连)/runtime(bootstrap 元数据→注册表并入)            │
│ BFF bff/routes/plugins.ts:列表(词条内联)/文件(流式+ETag)/      │
│   安装(token+白名单)/代理(SSE 流式,TTFB 30s)/卸载              │
└──────────────┬─────────────────────────────────────────────────┘
               │ REST/SSE(既有通道)
        后端服务(本例:wargamesrv,插件仓库自有)──────────────────┘
```

### 2.1 装载生命周期

1. **启动引导**:`main.tsx` 先 `await initRuntimePlugins()` 再动态 import App——拉取 `GET /api/bff/plugins`(1.5s 超时 → localStorage 缓存 → 空列表降级,宿主永不因插件故障白屏);元数据经逐条校验(entry/path/peer/保留路由)后并入 feature registry,词条同步注入 i18n(插件简码 zh/en → 宿主 zh-Hans/zh-Hant/en);
2. **卡片即元数据**:应用页卡片、路由(单 splat `path/*`)来自 BFF 落地的 app.json,插件 JS 未装载时文案用字面兜底,无裸 key;
3. **按需装载**:首次导航到插件路由才同源 import 入口 JS → 入口模块调 `window.AgentUI.registerApp` 注册 → 宿主渲染挂载 div,插件独立 React root 接管 → 卸载时 dispose 对称清理(root/style/缓存/连接);
4. **失败可见**:装载失败显示错误占位 + 重试按钮;插件内自带 ErrorBoundary。

### 2.2 信任模型与防御纵深

插件同源全权限(可信仓库前提,不可信代码须走未实现的 iframe 档)。防御纵深五层:

1. 安装鉴权:`X-Plugin-Admin-Token` 常量时间比对,env 未设 fail-closed;
2. 产物白名单:entry 顶层目录 ∈ {ui, assets, dist},相对路径禁 `..`;
3. 路由防护:mount path 形态校验 + 宿主保留路由黑名单(BFF/前端双侧);
4. SSRF 两级:插件声明的 backend.target 严格回环/RFC1918 白名单;部署者 env override(存在即生效)宽松级仅限结构校验;
5. 前端注册前复验 + 逐插件异常隔离。

### 2.3 认证边界(2026-10-13 审计后)

宿主企业模式认证为**验证型**:`requireValidImtSession` 中间件调 gateway `/api/members/me` 真实验证 imt_token(60s TTL 缓存),挂载于全部数据/管理路由;插件后端代理要求插件先声明 backend,部署者 env override 可覆盖 target(改 env 重启即生效)。

## 三、关键经验(踩坑即资产)

1. **装载机制要为分包与裸导入设计**——blob 方案被评审推翻,同源 HTTP import 是正解;
2. **校验器与执行器必须同源**——probe(`/v1/models`)与 adapter(`/api/v1/*`)前缀矛盾直接导致子路径部署配置错误,已修复并对齐;
3. **env 追加用 upsert 语义**——`grep -q || append` 守卫遇到同名旧行静默跳过,旧 token 残留;本地回显服务抓包(把进程行为变成可测量数据)是破案关键;
4. **元数据先行 + 字面兜底**——卡片/路由/词条不依赖插件 JS,永不裸 key、不因坏数据白屏;
5. **存在性检查 ≠ 认证**(cookie 旁路),**公开端点探测通过 ≠ 凭证有效**(tenant-info 匿名可达)——两个误导信号都曾拖长排查;
6. **冒烟在容器里做**——proxy_buffering 重复声明、regex location 抢占、目录 301 丢端口、envsubst 缺变量,四个 bug 只存在于容器环境。

## 四、验证基线

- 宿主 jest 570 / BFF vitest 919 / 插件 vitest 5,双侧 tsc 全绿
  (2026-10-14 起含后台刷新提示 2 例、启停/审计 8 例、chat SDK 6+7 例);
- E2E:卡片装载、24 条深链、插件内导航 + pushState/popstate 双向桥、真实登录态下 gateway 会话数据 + wargame 86 想定 + SSE 事件流;
- 容器冒烟:entrypoint 自动安装、nginx 全链路(列表/JS/REST/SSE/深链)、垃圾 cookie 回归矩阵全 401。

**后续修复归档**(总纲正文之外,经评审发现并修复):
- wizard 双逻辑 bug(`dae20e4`):setup 未授权 500(中间件缺 return)、RAG 探测前缀与 adapter 矛盾(子路径部署无解,已对齐 + 401 不回退语义);
- 认证审计四项(`f515dde`):详见 §2.2——除验证型中间件外,含 proxy flag 语义统一(缺陷 B)、teams/projects 改 store 解析消除双事实源(缺陷 C)、上游 401 透传与网关错误区分(缺陷 D)。

## 五、当前运行态(本机开发环境)

| 服务 | 端口 | 说明 |
|---|---|---|
| agentui vite dev | 9391 | 含 wargame 热更(`VITE_PLUGIN_DEV_ENTRIES` 已启用) |
| BFF | 9390 | 绑定 127.0.0.1;对接 ai.wust.edu.cn gateway/kb |
| wargamesrv | 9385 | 插件后端(PG 86 想定 + Redis 事件桥) |
| 插件 dev server | 9395 | web/agentui `npm run dev` |
| 冒烟容器 agentui-smoke | 8080 | 发版验证用,看完可 `docker rm -f` |

## 六、未完成任务清单

> **2026-10-13 首轮收口**:版本序列统一 **v0.4.0**(旧 tag v0.26.2 已删除,本地 + gitee 远程);
> 首个正式镜像 **0.4.0** 从 main(tag v0.4.0)构建发布,冒烟全绿;CI 接入华为集群 Jenkins
> (两仓 Jenkinsfile + [deploy/ci-jenkins.md](../deploy/ci-jenkins.md),任务创建待管理员);
> wizard setup 重复调用 500 经核实即 dae20e4(Bug1)已修症状,清单条目过期删除。
> 发版通道两处坑已修:Harbor 机器人 env 用户名必须带项目前缀**且加引号**
> (`HARBOR_USER='robot$intellect+agentui-release'`,否则 source 时 `$intellect` 被
> shell 展开吞掉 → push 401);docker daemon EOF 走 skopeo 通道(runbook 既有预案)。
>
> **2026-10-14 中期评审**:中期 15 项(#4–#18)逐项评审(触发核验 + 设计细化),
> 详见 [plugin-midterm-review.md](./plugin-midterm-review.md)——#6/#9/#10/#16 触发实质
> 成立已执行(✅ 标注);#7 经核验范围大幅缩小降格为文档事项;其余维持门控但设计
> 就绪(触发成立即可开工)。**chat/SSE 能力 SDK 化**(原 wargame 方案 §九遗留第 6 项)
> 经用户定级为高优先,方案定稿 [chat-sse-sdk-design.md](./chat-sse-sdk-design.md),
> 纳入近期 #1。

### 近期(待决策/环境)

| # | 任务 | 所需 |
|---|---|---|
| 1 | **chat/SSE 能力 SDK 化** | ✅ **P1/P2 已实施(2026-10-14)**:app.json `capabilities` 声明制 + `POST /plugins/:id/chat/*` 五路由(与宿主 chat 同守卫链同帧协议;审批/澄清/历史为 P2)+ `window.AgentUI.chat`(AsyncGenerator,HOST_API_VERSION 1.3.0)+ 主聊天列表过滤 plugin: 会话;**P3 数据面已实施**:chat_completion 用量审计 + `BFF_PLUGIN_CHAT_ALLOWED_MODELS` 模型白名单(R2 缓解;visibilitychange 自动 abort 评审否决);配额/限流与插件仓库同步维持门控,见 [chat-sse-sdk-design.md](./chat-sse-sdk-design.md) |
| 2 | k8s 部署 | 拓扑已定(2026-10-14:三后端经 ai.wust.edu.cn 网关,wargamesrv 网关化 /wargame);manifest/nginx 模板已支持全 URL 上游;**待执行**——kubeconfig/namespace + egress 核验 + 暴露方式,执行手册 [deploy/cluster-rollout.md](../deploy/cluster-rollout.md) §2 |
| 3 | ~~Harbor admin 密码修改~~ | ✅ 已完成(2026-10-14;机器人账号独立不受影响) |
| 4 | Jenkins 任务创建(两仓 Jenkinsfile 已就绪) | **待执行**——管理员凭证已获取,逐步手册 [deploy/cluster-rollout.md](../deploy/cluster-rollout.md) §1(环境核验→凭据→建任务→三步首跑) |

### 中期(触发条件驱动;✅ = 2026-10-14 评审后已执行)

| # | 任务 | 触发条件 / 状态 |
|---|---|---|
| 5 | C 方案:zip 制品 + sha256(机器人已就绪;设计就绪见评审文档 §4.1) | 插件独立发版需求 |
| 6 | hash 文件名 + immutable 缓存 | C 方案落地后 |
| 7 | vite SSE 代理条目去硬编码 | ✅ 已执行(动态扫描已装插件 + dev entries 生成 per-plugin 条目) |
| 8 | SSE `?token=` → cookie 认证 | **已改写**:核验后仅剩文档澄清(guide §5 已澄清),原"鉴权面改造"范围不成立 |
| 9 | token localStorage(S1)收编 | GATEWAY-1 启动 |
| 10 | 安装/卸载审计日志 | ✅ 已执行(JSONL `data/plugin-audit.jsonl`,install/uninstall/enable/disable 四路) |
| 11 | 插件列表后台刷新提示 | ✅ 已执行(60s/聚焦 refetch + 指纹比对 + toast) |
| 12 | 卸载运行时失效(免刷新) | 卸载 UI 出现 |
| 13 | 进程内 Hono 后端档(`backend.type: inline`;契约就绪见评审文档 §4.12) | 第二个轻插件 |
| 14 | iframe 隔离档(不可信插件) | 第三方不可信代码接入 |
| 15 | `@agentui/ui` / Tailwind preset 共享包(实测 2026-10-14 令牌零漂移;建议插件 CI 加 diff 哨兵) | 插件 ≥2 且 CI 哨兵报漂移 |
| 16 | 插件市场/远程索引 | 应用市场成熟 |
| 17 | enable/disable 启停 API | ✅ 已执行(API-first:`POST /plugins/:id/{enable,disable}` + `data/plugin-state.json`,停用即断路:files/proxy 数据面同步 404;管理 UI 后置) |
| 18 | config_fields 配置页(settings 宿主声明式渲染;契约就绪见评审文档 §4.17) | P4 增强窗口 |
| 19 | release 机器人密钥轮换(建议 2027-06 预研) | ~2027-10 到期前 |
