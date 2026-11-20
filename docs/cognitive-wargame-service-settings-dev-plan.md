# Cognitive Wargame 服务配置子菜单——AgentUI 侧开发计划（已批准）

> 日期：2026-11-03 ｜ 状态：**已批准（2026-11-03 用户评审通过）**，代码实施为后续按 §四 任务分解执行，当前尚未实施
> 上游总体方案：cognitive-wargame 仓库 `docs/20261103-AgentUI服务配置子菜单联动-设计方案.md`（需求细化 F1-F6、CW_AUTH_BYPASS_LAN 专项评估、架构决策点 D1-D5、Wargame 侧任务 W1-W6 均以该文档为权威，本文为 AgentUI 侧自含落地计划）
> 插件源码位置说明：`/cognitive-wargame` 为运行时插件，**源码在 cognitive-wargame 仓库 `web/agentui/src/features/cognitive-wargame/`**，本仓库仅承载宿主、BFF 与插件构建产物（`bff/data/plugins/cognitive-wargame/`）

---

## 一、背景与需求口径

### 1.1 背景与目标

认知推演插件目前的服务接入（wargamesrv 地址、API TOKEN、认证方式、Agent 后端网关指向）全部依赖部署侧环境变量与代理配置，无 UI 入口。本计划在设置页新增「服务配置」子菜单，提供连接配置＋一键检测＋Agent 后端网关设置的向导式界面；现有配置管理功能归入「环境配置」子菜单。

### 1.2 需求口径（F1-F6，自含；与上游方案 §2 一致）

| # | 功能 | 口径摘要 | 来源 |
|---|---|---|---|
| F1 | 认证模式状态（**只读**） | 检测成功后由 `healthz.auth_mode` 驱动徽标：`lan_bypass`→「可信内网免认证：开启」、`token`→「Token 认证」、`disabled`→「服务端未启用认证」；原需求「免认证开关」经上游 §1 专项评估**不可由 UI 设置**（服务端部署期决策），降级为状态展示 | 上游 §1/§2.2 |
| F2 | wargame 服务端 URL | `http(s)://host[:port]` 根地址；**空＝走现状代理路径（向后兼容）**，填写后浏览器直连 | 上游 §3.1 |
| F3 | API TOKEN | 掩码输入；置灰由实测 auth_mode 驱动（`lan_bypass/disabled`→置灰免填；`token`→必填可输）；不落日志 | 上游 §2.2 |
| F4 | 检测连接按钮 | 三步链：healthz（连通＋认证模式）→ version（版本＋后端类型）→ active-rounds（仅 token 模式校验 TOKEN）；失败按分类提示（不可达/CORS/401/超时/429） | 上游 §2.2 |
| F5 | 后端类型只读回显 | `version.agent_loop_backend` → QwenPaw / INTELLECT | 上游 §2.3 |
| F6 | 网关 URL 设置 | 检测成功后解锁；缺省 QwenPaw→`http://localhost:8088`、INTELLECT→`http://localhost:9091`；保存＝写 wargamesrv 配置项（复用现有 config API），UI 明示「重启后生效」 | 上游 §3.3 |

### 1.3 范围与非目标

- **不做** CW_AUTH_BYPASS_LAN 远程设置（上游 §1 评估：不可设置）。
- **不做** BFF 代理 target 动态化（决策点 D1 采用浏览器直连；BFF 中转为后续可选迭代）。
- 环境配置子菜单为现有功能的**整体迁移**，不改功能行为。

---

## 二、页面与交互设计

### 2.1 菜单与路由改造

| 项 | 现状 | 目标 |
|---|---|---|
| 左侧区块菜单 | 「设置」一级项无 children（`components/section-menu.tsx:107-112`） | 加两个 children（仿 agents 写法 L41-60）：`service-settings`（服务配置）、`environment-settings`（环境配置） |
| 路由常量 | 仅 `Settings: '/cognitive-wargame/settings'`（`routes.ts:16`） | 新增 `SettingsService: '/cognitive-wargame/settings/service'`、`SettingsEnvironment: '/cognitive-wargame/settings/environment'`；`/settings` 重定向 `/settings/service` |
| 遗留深链 | `?tab=audit` 深链（`settings-page.tsx:117-118,305-320`） | `/settings?tab=audit` → 重定向 `/settings/environment?tab=audit`（兼容已收藏链接） |
| 懒加载 | `routes.ts:71-73` 懒加载 `./pages/settings-page` | 新增两个懒加载入口：`./pages/service-settings-page`、`./pages/settings-environment-page` |

### 2.2 服务配置页布局（`pages/service-settings-page.tsx`，新页）

```
┌─ 服务配置 ────────────────────────────────────────────────┐
│ ┌─ 区一 · 服务连接 ──────────────────────────────────────┐ │
│ │ wargame 服务端 URL  [ http://192.168.1.100:9385      ] │ │
│ │   （留空＝使用当前部署代理路径）                          │ │
│ │ API TOKEN           [ •••••••••••• ]  （检测后按认证    │ │
│ │                        模式决定必填/置灰）               │ │
│ │ 认证模式             [ 待检测 ]        ← 只读徽标        │ │
│ │                     [ 检测连接 ]                        │ │
│ │ 检测结果：✓ 已连接 · v0.5.6 · 后端 QwenPaw · redis ok  │ │
│ │           生效网关 http://127.0.0.1:8088                │ │
│ │           （agent_gateway_url 字段，服务端 W3 落地后）   │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ 区三 · Agent 后端网关（检测成功前锁定 🔒）─────────────┐ │
│ │ 后端类型             [ QwenPaw ]       ← 只读回显       │ │
│ │ 网关 URL             [ http://localhost:8088          ] │ │
│ │                     [ 保存 ]                            │ │
│ │ ⚠ 保存并 verify 后需重启 wargamesrv 生效；重启后可重新  │ │
│ │   检测验证网关地址                                       │ │
│ └────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
（区二 · 环境配置＝独立子菜单页 settings-environment-page，非本页区块）
```

### 2.3 页面状态机

```
idle(未检测) ─点击检测→ testing(三步链) ─全过→ ok(结果展示·解锁区三·写本地连接配置)
                  │                      └任一步失败→ fail(错误分类·定位到步)
ok ─保存网关→ saving ─成功→ saved(重启提示) ─用户重测→ 回 testing
                  └409 冲突→ 提示刷新重试(回 ok)
修改 F2/F3 或重测 → 状态回 idle/testing；页面刷新 → 读本地连接配置回填 F2/F3，
                     认证模式徽标恢复「待检测」（安全默认，不缓存上次实测值）
```

错误分类文案（与上游 §2.2 F4 表一致）：网络不可达 / CORS 拦截（提示检查 `WARGAMESRV_CORS_ORIGINS`）/ 认证失败(401) / 超时(10s) / 限流(429)。

### 2.4 交互细节

- **置灰规则**：F3 TOKEN 输入在检测成功且 `auth_mode ∈ {lan_bypass, disabled}` 时 disabled，占位文案「免认证模式下无需 TOKEN」；`auth_mode=token` 时 enabled 且必填。携带口径（R1 简化）：拦截器**TOKEN 非空才携带** `Authorization: Bearer`，不依赖页面易失的 auth_mode 状态（免认证模式 TOKEN 置空即天然不带；带 TOKEN 访问免认证服务端亦无害——LAN bypass 在 token 提取前短路）。
- **掩码**：TOKEN 用 `type="password"`＋可见性切换；页面与日志不打印明文。
- **锁定**：区三在 `ok` 前整体 `disabled`＋锁定图标，避免未连通误写。
- **URL 校验**：仅接受 `http://`/`https://` 前缀且不含路径；`/api/v1` 由前端统一拼接。
- **INTELLECT 联动提示**：类型为 INTELLECT 时，保存处注明「将同时更新 GATEWAY_API_BASE_URL 与 INTELLECT_API_URL（自动追加 /v1）」。
- **部署模式注记（R1-1）**：直连模式附固定说明「企业版成员（imt_token cookie）写操作场景与直连互斥；如遇 cookie 相关失败请改用代理路径（URL 留空）」。
- **权限**：页面动作走 `useUserRole().canManage`（现设置页同口径，`settings-page.tsx:113`）；无权限者只读展示＋403 提示。
- **布局容器**：复用 `WargameSectionLayout` 与现有 shadcn/Radix 组件（Card/Input/Button/Badge），与现设置页视觉一致。

---

## 三、技术方案

### 3.1 连接架构：浏览器直连（上游决策点 D1）

- `api.ts:14` 的 `const WARGAME_BASE_URL = '/api/v1/wargame'` 改为 resolver：

```ts
// 伪代码
function resolveWargameBase(): string {
  const conn = getServiceConnection();               // §3.2
  return conn.baseUrl ? `${trimSlash(conn.baseUrl)}/api/v1` : '/api/v1/wargame';
}
```

- axios 实例 baseURL 与全部 URL 拼接点统一走 resolver；**URL 为空时行为与现状逐字节一致**（回归底线）。
- TOKEN 携带（R1 简化口径）：请求拦截器（`api.ts:63-74`）改为——服务连接 TOKEN **非空**→`Bearer <conn.token>`；否则维持 `localStorage.Authorization` 现状；**不依赖页面易失的 auth_mode 状态**（免认证模式 TOKEN 置空即天然不带；带 TOKEN 访问免认证服务端亦无害——LAN bypass 在 token 提取前短路，`auth.py:273-290`）。
- **【R1-1 必改】SSE 同链切换**：SSE 与 REST 是两条独立链——`SSE_BASE_URL = '/api/bff/plugins/cognitive-wargame/proxy/api/v1'`（`api.ts:22`，走 BFF 插件代理固定 target）。直连时若不同步切换，推演事件流仍指向代理旧目标；故 `SSE_BASE_URL` 纳入同一 resolver：直连 → `${baseUrl}/api/v1`，URL 留空 → 现状 BFF 代理路径不变；`?token=`（`buildSseUrl`，`api.ts:27-50`）取服务连接 TOKEN。
- **【R1-1 必改】直连关闭 credentials**：现例 `withCredentials: true`（`api.ts:60`，企业版 imt_token cookie 用）与服务端 CORS `*`（`allow_credentials=False`，`main.py:410-427`）互斥——跨域直连会被浏览器直接拒绝。直连模式必须置 `withCredentials=false`（社区版无 cookie 依赖）；**企业版 cookie 写操作场景与直连模式互斥**，该场景维持代理路径（URL 留空）并在服务配置页注记。
- dev 代理（`vite.config.ts:156-163`）与生产 nginx/BFF 插件代理保留，仅作为「URL 留空」兜底路径。

### 3.2 连接配置持久化

- 存储：`localStorage`，新 key **`wargameServiceConnection`**（插件内常量定义，不进宿主 `src/constants/authorization.ts`，保持插件自包含）。
- 结构：`{ baseUrl: string; token: string }`（**无认证开关字段**——认证模式只读，见 F1）。
- 读取时机：页面加载回填表单 + resolver 每次请求时读取；写入时机：检测成功与 URL/TOKEN 修改保存时。

### 3.3 `api.ts` 新增/改造清单

| 函数 | 说明 |
|---|---|
| `getServiceConnection(): {baseUrl, token}` / `saveServiceConnection(conn)` | 本地持久化读写（§3.2） |
| `resolveWargameBase()` | baseURL resolver（§3.1） |
| `testWargameConnection(target: {baseUrl?, token?})` | **三步链**：独立轻量 axios 实例（timeout 10s，不走全局拦截器、`withCredentials: false`），依次 healthz → version →（token 模式）active-rounds；返回 `{ ok, step, authMode, version, agentLoopBackend, redis, agentGatewayUrl, error?: {kind, message} }`（`agentGatewayUrl` 取 healthz 新字段，依赖服务端 W3；未落地前显示「—」） |
| 保存网关（复用现有写面 `api.ts:1892,1906`） | 流程（R1-3 补乐观锁前置）：`GET /config/items/{key}` 取 `revision` → `PUT .../value`（body 带 `expected_revision`；409 `CONFIG_REVISION_CONFLICT` 提示刷新重试）→ `POST .../verify`（幂等，已 verified 返回 already）。按 F5 类型映射键名（qwenpaw→`QWENPAW_BASE_URL`；intellect→`GATEWAY_API_BASE_URL`＋`INTELLECT_API_URL`＝根＋`/v1`）；**INTELLECT 双键写入非原子**——顺序执行，中途失败须提示「已成功键/未完成键」并允许续写 |

> 服务端契约与权限矩阵见上游方案 §3.5/§2.5；`active-rounds` 为需认证端点（`system_api.py:266-287`）。

### 3.4 环境配置页迁移

- 现 `pages/settings-page.tsx`（621 行）整体内容迁至新页 `pages/settings-environment-page.tsx`；其子组件 `config-field-drawer.tsx`、`config-audit-panel.tsx` 及数据流（`getConfigSummary/getConfigDiagnostics/getConfigItems`＋请求序号竞态守卫）**原样复用**。
- 路由 `?tab=audit` 逻辑随迁；`/settings` 旧入口以重定向保兼容（§2.1）。
- 迁移为**行为不变重构**：验收以「环境配置页与迁移前逐功能等价」为准（配置浏览/体检 Banner/分类卡片/搜索过滤/编辑抽屉/审计/导出/Nacos 预览推送，`settings-page.tsx:224-266,305-360,423-591`）。

### 3.5 i18n 与构建产物链

- 词条：`locales/{zh,en}.ts` 新增 `sectionMenu.serviceSettings/environmentSettings` 与 `servicePage.*`（区一/区三字段、状态徽标、错误分类、重启提示等）；经 `scripts/build-locales.mjs` 产出 `ui/locales/{zh,en}.json`。
- 构建：`npm run build`（`lint:imports && tsc --noEmit && build:locales && vite build`，产物 `web/agentui/ui/dist/index.js` 单文件）。
- 同步宿主：手工拷贝 `ui/dist`＋`ui/locales` 至 `~/workspace/agentui/bff/data/plugins/cognitive-wargame/ui/`，并同步 `app.json` 版本号（**顺手修复现存 0.5.5/0.5.6 漂移**）；宿主经 `GET /api/bff/plugins/:id/files/*` 装载新产物。
- 开发调试：`VITE_PLUGIN_DEV_ENTRIES=cognitive-wargame` 直连 9395 热更。

---

## 四、任务分解（A1-A8）

| # | 任务 | 落点 | 说明 | 验收 | 依赖 |
|---|---|---|---|---|---|
| A1 | 菜单与路由 | `components/section-menu.tsx`、`routes.ts` | children×2＋路由常量＋懒加载＋重定向＋深链兼容 | `/settings` 落服务配置；`?tab=audit` 兼容跳转 | — |
| A2 | 服务配置页 | 新 `pages/service-settings-page.tsx` | 三区表单＋状态机 §2.3＋交互细节 §2.4 | §五 验收清单 A 组 | A1/A3 |
| A3 | API 层改造 | `api.ts` | REST+SSE 双链 resolver（R1-1）＋直连 `withCredentials=false`＋TOKEN 非空携带＋`testWargameConnection()`＋保存链路（GET revision→PUT→verify，INTELLECT 双键顺序） | URL 留空行为与现状逐字节一致（回归底线）；直连时 REST 与 SSE 指向同一目标 | — |
| A4 | 连接配置持久化 | 插件内新 constants＋storage util | `wargameServiceConnection` `{baseUrl, token}` | 刷新回填；不含开关字段 | — |
| A5 | 环境配置页迁移 | `pages/settings-page.tsx` → 新 `settings-environment-page.tsx` | 行为不变迁移＋路由/文案调整 | 与迁移前逐功能等价 | A1 |
| A6 | i18n | `locales/{zh,en}.ts`＋`scripts/build-locales.mjs` | 新词条 zh/en | 中英文案齐全，构建产出 locales json | A2 |
| A7 | 构建产物同步 | `web/agentui` build → 宿主 `bff/data/plugins/cognitive-wargame/ui/` | 拷贝 dist＋locales，同步 app.json 版本（修漂移） | `http://localhost:9391/cognitive-wargame/settings` 可见新子菜单 | A1-A6 |
| A8 | 测试资产与 E2E（九步法步骤4-8） | `~/workspace/agentui/tests/e2e-tests/` | outline/cases/fixtures：正常×边界（空 URL/非法 URL/错误 TOKEN/409/403）×跨页（深链）×联动（检测解锁/INTELLECT 双键/直连双链一致性）；执行→修复→回归至全通 | 全量回归通过＋报告归档 | A7＋服务端 W1-W3 |

**与服务端（W1-W3）的依赖关系**：A2/A8 的「保存网关 URL→重启→重测验证」链路依赖服务端 W1（materialize 种子修正，R1-2 收窄；写/verify 通道现网已放行）与 W2（端到端实测）；检测回显 `agent_gateway_url` 依赖 W3（未落地前显示「—」，不阻断检测链）。服务端未就绪时，检测链（F1-F5）可先行联调（全部消费现成端点）。

---

## 五、验收标准

**A 组·服务配置页（F1-F6）**

| # | 场景 | 预期 |
|---|---|---|
| 1 | URL 留空＋现状服务端检测 | 走代理路径连通，行为与改造前一致 |
| 2 | 免认证服务端（`lan_bypass`）检测 | 徽标「免认证：开启」；TOKEN 置灰；区三解锁 |
| 3 | token 模式缺 TOKEN / 错 TOKEN | 检测在三步链第 3 步 401，文案区分「缺 TOKEN」与「TOKEN 无效」 |
| 4 | 保存网关 URL（qwenpaw/intellect） | 对应配置键写入＋verify；INTELLECT 双键联动（根＋`/v1`）；409 有重试引导 |
| 5 | 刷新页面 | F2/F3 回填本地配置；认证徽标恢复「待检测」 |
| 6 | TOKEN 不落日志 | 检测与保存过程无明文 TOKEN 出现在 console/网络日志 query |
| 7 | 直连模式双链一致性（R1-1） | 填 URL 直连后，REST 与 SSE 事件流指向同一目标（浏览器网络面板确认 events 请求直达该地址）；请求以 `withCredentials=false` 发出且无 CORS 报错 |

**B 组·环境配置迁移等价性**：配置浏览/体检/编辑/审计/导出/Nacos 六能力逐项与迁移前一致；`?tab=audit` 深链在新路由生效。

**C 组·E2E 回归（九步法步骤8）**：A8 全量用例回归至全通；每个修复项附用户级验收截图（归档 `tests/e2e-tests/results/`）。

---

## 六、评审记录

| # | 意见（2026-11-03） | 处置 | 状态 |
|---|---|---|---|
| R0-1 | CW_AUTH_BYPASS_LAN 评估 AgentUI 端可设置性；不可设置则只显示状态 | 上游 §1 评估结论：不可设置；F1 改状态只读回显，TOKEN 置灰由实测 auth_mode 驱动（§1.2/§2.4） | ✅ 已落 |
| R0-2 | 连接架构 / 开关语义 / 默认子菜单决策确认 | D1 浏览器直连（§3.1）/ D2 状态只读 / D5 默认服务配置（§2.1），按推荐项批准 | ✅ 已落 |
| R1 | 两方案复审（2026-11-03）：**P0-1** SSE 直连未同链切换（`api.ts:22` BFF 代理固定 target）＋`withCredentials:true` 与 CORS `*` 互斥；**P1-1** 检测回显改用 healthz 新字段 `agent_gateway_url`（上游 W3 调整）；**P1-3** 保存链路补乐观锁前置与 INTELLECT 双键非原子提示（P1-2 服务端 W1/W2 收窄见上游方案 §4） | P0-1 已落 §3.1；P1-1 已落 §2.2/§3.3；P1-3 已落 §3.3/§四 A3。升版与上游 v1.2 同步 | ✅ 已落 |
