# 运行时插件中期任务评审与细化(2026-10-14)

> 对 [runtime-plugin-architecture.md](./runtime-plugin-architecture.md) §六 中期 15 项(#4–#18)逐项评审:
> **触发条件核验(以 2026-10-14 代码事实为准)→ 设计细化 → 结论(立即执行 / 维持门控)**。
> 评审原则:尊重总纲"触发条件驱动"纪律——**触发未成立的项不硬启动**,
> 但把每项细化到"触发成立即可开工"的设计就绪度;触发实质已成立(或存在当下
> 运维缺口)的项立即执行。
>
> 配套:chat/SSE SDK 化(原 wargame 方案 §九遗留第 6 项,经用户定级为高优先)
> 已独立成稿:[chat-sse-sdk-design.md](./chat-sse-sdk-design.md),纳入近期计划。

## 结论摘要

| # | 任务 | 触发核验结论 | 评审结论 |
|---|---|---|---|
| 4 | C 方案 zip 制品 + sha256 | 未触发(无独立发版需求) | 门控,设计就绪(§4.1) |
| 5 | hash 文件名 + immutable | 依赖 #4 | 门控(§4.2) |
| 6 | vite SSE 代理去硬编码 | 硬编码已产生维护税;dev-only 零风险 | ✅ **立即执行(已落地)** |
| 7 | SSE `?token=` → cookie | **任务范围经评审大幅缩小**(见 §4.7) | 改写为文档澄清项 |
| 8 | token localStorage(S1)收编 | GATEWAY-1 未启动 | 门控(§4.8) |
| 9 | 安装/卸载审计日志 | **已触发**:v0.4.0 后 entrypoint 每次容器启动自动 install | ✅ **立即执行(已落地)** |
| 10 | 插件列表后台刷新提示 | 实质已触发(#16 落地后 API 变更需要感知通路) | ✅ **立即执行(已落地)** |
| 11 | 卸载运行时失效 | 无卸载 UI | 门控(§4.11) |
| 12 | 进程内 Hono 后端档 | 第二个轻插件未出现 | 门控,契约就绪(§4.12) |
| 13 | iframe 隔离档 | 无第三方不可信代码 | 门控(§4.13) |
| 14 | `@agentui/ui` 共享包 | 插件数=1;**实测今日令牌 diff=0,无漂移** | 门控,建议 CI 加 diff 哨兵(§4.14) |
| 15 | 插件市场/远程索引 | 应用市场未成熟 | 门控(§4.15) |
| 16 | enable/disable 启停 API | **评审发现当下真实运维缺口**:内置插件当前无法停用(重启即复活) | ✅ **立即执行(已落地)** |
| 17 | config_fields 配置页 | P4 增强窗口未开 | 门控,契约就绪(§4.17) |
| 18 | release 机器人密钥轮换 | 日历触发(~2027-10) | 门控,建议 2027-06 预研 |

---

## 一、执行项的评审理由(为什么打破"触发条件"纪律)

### #16 enable/disable:当下存在真实运维缺口(不是未来需求)

核验发现的事实链:

1. `docker-entrypoint.sh:44-55`:容器**每次启动**对 `/opt/bundled-plugins/*`
   无条件 POST `/plugins/install`;
2. `plugins.ts:403`:install 无条件 `rm(dest)` 后覆盖(幂等=重装);
3. 因此:运维想临时停用某个内置插件,**删目录会在下次容器重启时复活**,
   当前不存在任何"停用但保留安装"的手段。

"插件管理 UI 出现"这个触发条件约束的是 **UI**,而缺口在 **API 与状态持久化**。
API-first 落地(enable/disable 路由 + 安装目录之外的状态文件)以半天级成本
解除缺口,UI 可继续等触发。这是执行而非硬启动的理由。

**设计(已按此落地)**:

- 状态文件 `bff/data/plugin-state.json`(env `BFF_PLUGIN_STATE_FILE` 覆盖),
  形态 `{ "schema": 1, "states": { "<id>": { "enabled": boolean, "updatedAt": iso } } }`;
  **必须置于安装目录之外**——entrypoint 重装只覆盖目录,状态存活;
- `POST /plugins/:id/enable` / `POST /plugins/:id/disable`:
  `X-Plugin-Admin-Token` 守卫(与 install/delete 同一 `isAdminRequest`),
  插件须已安装(404),操作幂等,返回 `{ id, enabled }`;
- `GET /plugins` 只返回 enabled 的插件(disabled 从卡片/路由/词条全家消失);
- 卸载(DELETE)同时清除状态条目(重装回默认 enabled);
- **install ≠ enable** 语义写入注释与文档:对 disabled 插件重装只刷新产物,
  不改变启停状态;
- 每请求读写状态文件(无内存缓存)→ 天然进程重启免疫。

### #9 审计日志:触发条件已实质成立

"生产 install 常态化"在 v0.4.0 发版后已是事实:每次容器启动都发生 install。
审计缺失意味着运维无法回答"何时装了什么/谁卸了什么/启停历史"。

**设计(已按此落地)**:

- JSONL 追加写 `bff/data/plugin-audit.jsonl`(env `BFF_PLUGIN_AUDIT_FILE` 覆盖);
- 事件形态 `{ ts, action: 'install'|'uninstall'|'enable'|'disable', pluginId, version?, source?, outcome: 'ok'|'error', error? }`;
- append 失败 `console.warn` 不阻塞主操作(审计是观测面,不是一致性面);
- 四路挂接:install / uninstall / enable / disable;
- 为 chat SDK P3 的 `chat_completion` 用量事件预留同通道。

### #10 后台刷新提示:#16 的配套一致性通路

#16 落地后,"启停/卸载经 API 发生、页面无感知"从运维事实变成用户可见问题
(卡片残留直到下次刷新)。原触发条件"热更新需求"实质成立。设计:

- `initRuntimePlugins` 完成后启动后台监测:60s 定时 + `window` focus
  (节流 ≥30s)时 refetch `/api/bff/plugins`;
- 指纹比对(规范化后的 id+version+entry+path+labelKey 列表),变化 →
  sonner toast「应用列表已更新,刷新页面后生效」,同一变更只提示一次;
- 失败静默(保持"宿主永不因插件故障打扰用户"原则);不热替换路由树
  (维持总纲 §2.1 的元数据先行决策);
- 词条:`plugins.updatedToast` 入 zh-Hans / zh-Hant / en 三语言。

### #6 vite SSE 代理去硬编码:低成本清偿

"第二个带后端插件"未发生,但硬编码条目已产生事实维护税:wargame 改事件
路径须同步 vite 配置,新插件 dev 装载后 SSE 必坏(无条目)。dev-only、零生产
风险、半天成本。设计:

- vite 启动时扫描 BFF 插件目录(默认 `bff/data/plugins`,env
  `BFF_PLUGINS_DIR` 覆盖),为每个已装插件生成
  `/api/bff/plugins/<id>/proxy` 前缀代理条目(SSE 友好参数对全前缀生效:
  timeout 0 + keep-alive——对非 SSE 请求无实害,与 nginx 通道同语义);
- 生成的条目置于通用 `/api/bff` 之前(键序即优先级,保持既有约束);
- 目录不存在 → 不生成条目(降级到通用代理,行为与今天的新插件一致);
- 消灭 `cognitive-wargame` 与 `api/v1/events` 两处字面量。

---

## 二、维持门控项的细化设计(触发成立即可开工)

### 4.1 #4 C 方案:zip 制品 + sha256(机器人已就绪)

**触发**:插件独立发版需求(当前 wargame 随镜像发,单插件无此需求)。

**细化设计**:

- 安装来源扩档:`BFF_PLUGIN_INSTALL_SOURCES=local,zip`;zip 档接受
  `{ "source": "<https URL>", "checksum": "sha256:<hex>" }`:
  1. URL 下载(限 https、限 hub.wust.edu.cn 域白名单 env、大小上限
     `BFF_PLUGIN_ZIP_MAX_BYTES` 默认 100MB、下载超时);
  2. sha256 校验(必填,不匹配 400)——制品由 release 机器人发布时同步
     产出 `.sha256`;
  3. 解压(防 Zip-Slip 三条:每条目 resolve 后必须落在解压根内;拒绝
     符号链接条目;entry 顶层目录白名单复用 `ENTRY_ROOT_ALLOWLIST`);
  4. 解压根 = staging 目录,后续复用现有 install 覆盖链。
- 发版侧:`scripts/package-plugin-bundle.sh` 扩 `--zip` 输出
  `<id>-<version>.zip + .sha256`,经既有 Harbor 机器人通道上传。

**工作量**:1–2 天(含发版脚本)。

### 4.2 #5 hash 文件名 + immutable 缓存(依赖 #4)

**细化**:插件 vite 构建产物改 `[name].[hash].js`;app.json entry 指向带
hash 的入口;BFF files 路由判定文件名含 `-[A-Za-z0-9_-]{8,}\.` 模式 →
`Cache-Control: public, max-age=31536000, immutable`,入口文件保持
`no-cache` + ETag。半天。

### 4.7 #7 SSE `?token=` → cookie(评审后任务改写)

**核验发现**:原任务表述基于一个误解。调研事实:

- 宿主自身所有 SSE 消费都是 `fetch`(header 可自由携带),**不用
  EventSource**——"EventSource 不能带 header"对宿主通道不成立;
- `?token=` 在插件体系的唯一实际用途是**插件后端自有 key 经 BFF 代理
  透传**(wargamesrv `?token=`),那是上游自身鉴权,不属于宿主鉴权面;
- 企业模式下宿主数据面已是验证型 cookie 会话(总纲 §2.3)。

**结论**:本项真正剩下的只有**文档澄清**(guide §5 已于 2026-10-13 重写,
基本完成)+ 观察项(BFF 鉴权面改造窗口开启时复查)。从"中期任务"降格为
文档事项,不再占任务位。

### 4.8 #8 token localStorage(S1)收编

**触发**:GATEWAY-1 启动。**目标态**:Authorization 改内存持有 + HttpOnly
cookie;`host.getApiToken()` 先标 deprecated(返回值语义收窄为社区模式),
1.x 内一个 minor 版本移除;依赖该 API 的插件改走 BFF 代理或 chat SDK
(凭证服务端化终态)。**与 chat SDK 互为方向佐证**:chat SDK 已把"插件
不持凭证"具体化。

### 4.11 #11 卸载运行时失效

**触发**:卸载/启停 UI 出现。**细化**:真运行时失效 = registry 移除 +
活跃 root dispose + 路由树重建;当前 `application-list.tsx:10` 的
`collectApps()` 模块级一次性求值是主要重构点(需改订阅式)。#10 的
"toast + 刷新"语义在 UI 出现前覆盖一致性需求,本项不急。

### 4.12 #12 进程内 Hono 后端档(`backend.type: 'inline'`)

**触发**:第二个轻插件(无独立后端服务的插件)。**契约细化**:

- app.json `backend: { type: 'inline', entry: 'backend/index.js' }`
  (entry 顶层目录白名单需加 `backend`);
- 产物形态:node ESM,默认导出 Hono app(插件自带 hono 依赖?否——
  宿主提供 peer hono,经宿主全局注入或 BFF import 镜像内共享依赖);
- BFF 装载:`import(路径)` → `route('/plugins/:id/inline/*', pluginApp)`,
  挂会话守卫(与 chat 路由同理由);
- 信任前提:与前端同源信任一致(同进程,只面向可信插件)。

### 4.13 #13 iframe 隔离档(不可信插件)

**触发**:第三方不可信代码接入。**细化方向**:`render: 'iframe'` +
`sandbox="allow-scripts"`(无 same-origin)+ `srcdoc`/files 路由引导页;
宿主↔iframe postMessage RPC(窄面:theme/locale 事件、经握手的 scoped
token broker、fetch 代理白名单);chat 能力经 RPC 桥接(本方案的
`AgentUIChatApi` 是现成蓝本)。设计量:周级,届时独立成文。

### 4.14 #14 `@agentui/ui` / Tailwind preset 共享包

**触发核验(2026-10-14 实测)**:插件数=1(<2);本机 cognitive-wargame
仓库 web 基线与宿主 tailwind 令牌 diff=**0**,无漂移。

**结论**:维持门控。**新增低成本哨兵建议**:在插件 CI 加一条令牌 diff
检查(插件 tailwind config 的 token 集合 vs 宿主 config,diff 非空即红)
——漂移一旦出现即刻可见,#14 的触发从"人肉发现"变为"CI 发现"。

### 4.15 #15 插件市场/远程索引

**细化**:索引 `index.json`(id/version/url/sha256/签名)+ ed25519 签名
验签 + 安装前审阅 UI(展示 capabilities/backend 声明)。依赖 #4(zip 制品)
先行。等应用市场成熟。

### 4.17 #17 config_fields 配置页

**契约细化**:app.json `configFields: [{ key, label, type: 'string'|'secret'|'bool', required? }]`
→ settings 页宿主声明式渲染 → BFF `data/plugin-config.json` 存取
(admin 守卫,secret 加密复用 token-vault)→ 消费形态(代理注入 header?
插件经宿主全局读取?)留实施时定。等 P4 增强窗口。

### 4.18 #18 release 机器人密钥轮换

日历触发(~2027-10 到期)。**细化**:轮换 runbook(Harbor 新建 robot →
Jenkins 凭据更新 → 冒烟 → 废旧);**建议 2027-06 立项预研**,留足窗口。

---

## 三、执行记录(2026-10-14)

| 任务 | 落地内容 | 验证 |
|---|---|---|
| #16 enable/disable | `bff/src/routes/plugins.ts`:enable/disable 路由 + `data/plugin-state.json` 状态存取 + 列表过滤 + 卸载清状态;install ≠ enable 语义 | vitest:启停幂等/鉴权 403/未装 404/重装不冲状态/卸载清状态 |
| #9 审计日志 | install/uninstall/enable/disable 四路 JSONL 审计(`data/plugin-audit.jsonl`) | vitest:断言 JSONL 事件序列(install→disable→enable→uninstall)与字段 |
| #10 后台刷新 | `src/plugins/runtime.tsx` 后台 refetch + 指纹比对 + toast(60s/focus,节流,单次);词条 zh-Hans/zh-Hant/en | jest:基线静默→变化提示一次→重复不提示;聚焦节流 |
| #6 vite 去硬编码 | `vite.config.ts` 动态生成 per-plugin SSE 代理条目(BFF 已装插件 ∪ dev entries) | `vite optimize` 冒烟:两数据源各生成条目;空目录降级 |

**回归基线**:BFF vitest 909/909(+5)、宿主 jest 564/564(+2)、双侧 tsc 与
eslint 全绿。文档同步:总纲 §六、[plugin-development-guide.md](./plugin-development-guide.md) §6。

## 四、评审整改记录(2026-10-14,质量/安全评审后同日)

> 评审发现 1×P1、1×P2、5×P3,处置如下;测试基线更新为 BFF vitest 912、宿主 jest 564。

| 发现 | 级别 | 处置 |
|---|---|---|
| disable 非完全断路:files/proxy 路由不检查启停状态,停用后产物仍可下载、后端代理通道仍敞开 | P1 | **已修**:两路由读取 plugin-state,disabled → 404(不泄露存在性)。kill switch 关闭数据面;用例:停用后 files/proxy 均 404,enable 恢复 |
| 状态文件非原子写 + 损坏静默 fail-open(截断 JSON → 按全 enabled 处理,kill switch 向打开方向静默失效) | P2 | **已修**:tmp+rename 原子写;读取/解析/schema 异常 `console.error` 大声告警(fail-open 行为保留但不静默);并发 read-modify-write 丢更新为已知限制(仅 admin 面,注释明示);用例:损坏文件 → 列表正常 + 告警触发 |
| 列表振荡(A↔B)导致 toast 反复 | P3 | **已修**:改与"启动注册基线"比对——翻回基线 = 页面本就一致,不提示;用例扩展翻回场景 |
| enable 对损坏安装返回 200 但插件不可见 | P3 | **已修**:enable 校验 app.json,非法 400;disable 保持宽松(遮蔽损坏安装是合法操作);用例补齐 |
| vite timeout 0 覆盖全前缀(慢 body 请求 vite 层永不超时) | P3 | **核实后不成立**:vite 内置 http-proxy 对 falsy 超时值不设超时,`0 ≡ 不设 ≡ 通用条目语义`;注释已澄清为显式 SSE 意图标记 |
| 审计日志无轮换、无身份归因 | P3 | **缓办**(仅 admin 共享 token,内部部署可接受;chat SDK P3 扩展用量事件时一并考虑) |
| 启停用例操纵共享 fixture 的顺序依赖 | P3 | **接受**(文件头已警示约定;新增用例遵循,均在 describe 末尾自恢复) |
