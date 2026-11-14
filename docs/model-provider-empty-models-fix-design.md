# 模型提供商页空列表与静默假成功 — 修复设计

- 日期：2026-10-24
- 状态：P1-a 已实施（2026-10-24，含 §8.1/§8.2 单测）；P1-b §6（modelManagement 默认值改 true + 回归测试）已实施（2026-10-24）；P1-b 其余（§4.1/§4.4/§4.6）待 D2 定论
- 关联分析：《模型提供商页「可选模型」与「设置默认模型」为空的原因分析》（2026-10-22，微信传输副本，**该文档 §9.5 含真实凭据，勿入库勿外传**）
- 涉及代码：`bff/src/routes/proxy.ts`、`bff/src/services/intellect-rag-client.ts`、`bff/src/utils/feature-flags.ts`、`bff/src/services/rag-plugin-backend.ts`、`src/hooks/use-llm-request.tsx`、`src/hooks/use-user-setting-request.tsx`、`src/pages/user-setting/setting-model/`

## 1. 背景与现状修正（对分析文档的评审更新）

分析文档的三条原因链（能力开关门控、BFF 401 改写为空数据、成员令牌被 RAG 判为未认证）经代码复核全部成立。但有两点现状变化必须先修正：

1. **文档 §4/§6 描述的"未提交改动"已丢失。** 当前工作区是干净的，`git log -S "useServiceToken" --all` 无任何命中，stash 为空——服务令牌分支、占位租户过滤、401 诊断日志均未入库且已不存在。本文档按更完整的设计重建这部分能力，而不是"恢复"。
2. **本地环境已切换。** `bff/data/harness-backends.json` 现指向 `<harness-host>:9091` / `localhost:9380`，且伴生 RAG 项 `modelManagement: false`。今日在本机复现会先撞上原因 A（整页被门控），而非文档 §4 描述的状态。复现前需先手工把该项改为 `true`（运维步骤，文件不入 git）。

复核中另发现分析文档未覆盖的三个问题，本文档一并处理：

- **P0-1 写请求静默假成功**：`proxy.ts:188-193` 的 401 改写不区分 method。所有模型相关 mutation（`useAddProviderInstance`、`useAddInstanceModel`、`useSetDefaultModel`、`useDeleteProviderInstance` 等）以 `data?.code === 0` 判定成功并弹"修改成功"——在鉴权故障状态下，用户填 API Key 保存实例、设默认模型、删实例全部**假成功**。比空列表更严重。
- **P0-2 `useFetchTenantInfo` 崩溃**：`src/hooks/use-user-setting-request.tsx:72-84` 在收到改写信封 `{code:0, data:null}` 后执行 `data.chat_id = data.llm_id`，对 null 赋值抛 TypeError（被 react-query 吞掉，回落空对象）。
- **P0-3 401 改写的存在理由已失效**：改写注释称"避免触发前端 401 拦截器跳转登录页"，但 `src/utils/request.ts:140-150`（HTTP 401）与 `:189-202`（`code: 401`）在 `authMode === 'intellect-enterprise'` 时均已跳过登出跳转。企业模式下改写如今只掩盖故障；仅社区模式（无 imt_ 会话）仍依赖它避免登出循环，见 §4.2 的条件设计。

## 2. 目标与非目标

### 目标

1. 模型管理路径（`providers*`、`models*`）的上游失败**如实呈现**：读请求出现错误横幅，写请求报错而非假成功。
2. 提供受控的服务账号令牌通道，使成员令牌鉴权故障（原因 C）期间模型管理仍可用，默认关闭。
3. 对强制服务令牌的写操作增加管理员角色门控，避免普通成员借服务身份改租户级配置。
4. 修复 `useFetchTenantInfo` 的 null 崩溃；伴生 RAG 的 `modelManagement` 默认值改为 `true`。

### 非目标（明确不做，见 §7）

- 全局（非模型路径）的 401 改写收窄——影响面大，列为后续项。
- `/users/me/models` 的服务令牌化——该接口是身份绑定语义（"当前用户的租户信息"），换服务令牌会改变语义；本次只做 null 守卫。
- 生产 RAG 的 `INTELLECT_TEAM_API_URL` 配置——部署侧根治项（D1），不在 AgentUI 代码内。

## 3. 待业务决策项

| 编号 | 决策 | 状态 | 对本设计的影响 |
|---|---|---|---|
| D1 | 生产 RAG 配置 `INTELLECT_TEAM_API_URL`（根治成员令牌 401） | 未决，需有生产权限者操作 | 落地后本设计的"透传 401"分支在生产自然不再触发；BFF 侧改动仍保留作为韧性 |
| D2 | 服务令牌覆盖范围：读+写（模型配置视为租户级共享资源，**推荐**）还是仅读 | 未决 | flag `BFF_MODEL_MGMT_SERVICE_TOKEN` 默认关，D2 定论后才在生产开启；关闭时本设计只带来"错误可见化"，无行为变化 |

D2 采用"读+写"时必须连同 §4.4 的角色门控一起开启；仅读方案下 §4.4 不生效（写请求走成员令牌，由上游鉴权）。

## 4. BFF 改动明细

### 4.1 路径识别与服务令牌强制

`bff/src/routes/proxy.ts` 顶部新增：

```ts
// 模型管理路径:providers 目录与实例 CRUD、models 列表与默认模型。
// 不含 users/me/models(身份绑定语义,见 §7)。
const MODEL_MANAGEMENT_PATH_RE = /^(providers|models)(\/|$)/;
```

`bff/src/services/intellect-rag-client.ts` 的 `ProxyRequest` 增加字段：

```ts
/** 强制以 ragAdminToken(服务账号)鉴权,跳过会话/动态令牌与 X-Intellect-* 身份注入 */
forceServiceToken?: boolean;
```

`proxy()` 函数在删除客户端 `Authorization` 之后：

```ts
if (req.forceServiceToken && req.ragAdminToken) {
  headers.set('Authorization', `Bearer ${req.ragAdminToken}`);
}
```

随后走 `fetchWithRagToken` 的既有 `explicit` 分支（调用方显式 Authorization，不覆盖、不重试）——**无需改动 `rag-fetch.ts`**。静态 API Key 过期重试无意义，与该分支既有语义一致。

强制条件（在 proxy.ts 路由内计算）：

```ts
const isModelMgmtPath = MODEL_MANAGEMENT_PATH_RE.test(relativePath);
const forceServiceToken =
  isModelMgmtPath && isModelMgmtServiceTokenEnabled() && !!ragAdminToken;
```

三个条件缺一不可：路径匹配、flag 开（§4.6）、后端配置了 `ragAdminToken`（缺失时自动退回成员令牌，不阻断）。

**身份头注入规则**：`forceServiceToken` 为 true 时跳过全部 `X-Intellect-*` 注入（User/Role/Team/Project/Tenant）。理由：服务令牌本身就是身份，成员身份头与令牌身份不一致会让 RAG 侧归属判断混乱；租户/团队隔离应由服务令牌自己的上下文决定。成员令牌请求（`forceServiceToken` 为 false）的注入逻辑不变。

### 4.2 上游 401 的处理：按路径与身份条件透传

现有 401 分支（`proxy.ts:188-193`）改为：

```ts
if (upstream.status === 401) {
  // 诊断日志:打印上游响应体(不含令牌),所有 401 一律记录
  const bodyText = await upstream.clone().text().catch(() => '');
  console.warn(`[proxy] upstream 401 ${method} ${fullPath}: ${bodyText.slice(0, 500)}`);

  const usedMemberIdentity = !!sessionToken; // 请求实际以成员身份发出
  if (usedMemberIdentity && isModelMgmtPath) {
    // 诚实透传:保留 401 状态与上游信封,前端模型页呈现错误
    return streamResponse(upstream);
  }
  // 其余场景维持现状改写(社区模式无会话/非模型路径)
  return c.json({ code: 0, data: null, message: 'success' });
}
```

透传条件为 **`sessionToken` 存在且路径匹配**，两点都是刻意的：

- `sessionToken` 存在意味着企业版成员会话有效（`isImtCanvasAgentsEnabled()` 且 cookie 可用）。此时前端拦截器对 HTTP 401 与 `code:401` 都静默（`request.ts:140-150, 189-202`），透传不会触发登出跳转，错误由模型页 hooks 呈现（§5）。
- `sessionToken` 不存在（社区模式、或企业版 cookie 已过期）时维持改写：社区模式下 `code:401` 会触发拦截器登出+跳转（`request.ts:193-201`），而 RAG 管理令牌失效不是重新登录能解决的，透传会造成登出循环——这正是改写逻辑最初要防的场景，予以保留。

`streamResponse`（`bff/src/utils/response.ts`）保留 status/statusText/body，透传实现无需新建 Response。401 响应体为小体量 JSON，`clone().text()` 无流式风险。

改写语义的边界说明：**非模型路径的写请求假成功问题本次不修**（影响知识库/画布等全域 mutation，需单独的全局设计与回归，见 §7），本设计只收敛模型管理域。

### 4.3 占位租户过滤

`proxy.ts` 解析出 `intellectTenantId` 后、构造 `ProxyRequest` 前：

```ts
const injectableTenantId =
  intellectTenantId && !/^0+$/.test(intellectTenantId) ? intellectTenantId : undefined;
```

全 0 是向导占位值（`00000000…`），注入 `X-Intellect-Tenant` 只会误导 RAG 的租户解析。全局生效（不限模型路径），对正常租户无副作用。与 `backend-context.ts` 已有的 `"0"` 过滤语义对齐。

### 4.4 写权限门控（仅强制服务令牌时生效）

```ts
const ADMIN_ROLES = new Set(['admin', 'owner']); // 与 llm-auth.ts:103、MemberRole(domain.ts:128) 一致

if (forceServiceToken && method !== 'GET' && isModelMgmtPath) {
  const role = intellectRole; // resolveMemberInfoFromContext 已解析(60s 缓存)
  if (!role || !ADMIN_ROLES.has(role)) {
    return c.json(
      { code: 403, message: 'Model management write requires admin role' },
      403,
    );
  }
}
```

设计要点：

- **fail-closed**：role 解析失败（TEAM 网关不可达、令牌无效）一律拒绝。放行未知角色等于允许无法确权者以服务身份改租户配置，不可接受。`member-id-resolver.ts:106` 对缺失 role 兜底为 `'member'`，同样被拒。
- 缓解误伤：解析结果有 60s 缓存；TEAM 短暂抖动时管理员重试即可。真正的 TEAM 长时间故障下成员令牌鉴权本身也是坏的，此时写操作本就不可用。
- HTTP 403 走 axios 拦截器通用提示（`hint : 403` + message），mutation hook 层不重复 toast（§5.3 只处理 401）。
- flag 关闭时该门控整体不生效，写请求由上游按成员令牌鉴权——与现状完全一致。

### 4.5 `models/default` 的 PATCH 归类

`PATCH /models/default`（设默认模型）命中"非 GET + 模型路径"，在 flag 开启时会要求管理员角色。默认模型是租户级共享配置，与实例管理同权限级别是自洽的；但这意味着普通成员在"设置默认模型"下拉框里选择会得到 403。**此项与 D2 同源，需业务确认**；flag 关闭期间无任何影响。若业务结论是"成员可设个人默认"，则后续需将默认模型改为用户级数据而非本次 BFF 门控所能表达。

### 4.6 feature flag

`bff/src/utils/feature-flags.ts` 新增（与现有 `isImtCanvasAgentsEnabled` 同文件同风格，但默认关——本 flag 是行为变更开关而非兼容开关）：

```ts
/**
 * 模型管理路径强制服务账号令牌(方案 2)。
 * 仅当生产 RAG 成员令牌鉴权故障(D1 未落地)且 D2 决策为"读+写"时开启。
 * 开启后写操作受管理员角色门控(见 docs/model-provider-empty-models-fix-design.md §4.4)。
 */
export function isModelMgmtServiceTokenEnabled(): boolean {
  return process.env.BFF_MODEL_MGMT_SERVICE_TOKEN === 'true';
}
```

## 5. 前端改动明细

### 5.1 模型查询 hooks 的错误态（`src/hooks/use-llm-request.tsx`）

文件内新增信封解包 helper（遵循 CLAUDE.md 分层约定：helper 与 hooks 同文件，不引入新的 utils 依赖）：

```ts
function unwrapEnvelope<T>(res: { code?: number; data?: T; message?: string }): T {
  if (res?.code !== 0) {
    throw new Error(res?.message || `request failed: ${res?.code}`);
  }
  return res.data as T;
}
```

应用到以下 query 的 `queryFn`（替换 `data?.data ?? []`）：

- `useFetchAvailableProviders`、`useFetchAddedProviders`、`useFetchAllAddedModels`
- `useFetchDefaultModels`、`useFetchProviderInstances`、`useFetchInstanceModels`、`useFetchProviderInstance`

行为说明（兼容性关键）：

- 各 hook 均有 `initialData: []`，queryFn throw 后 react-query 进入 `isError`，`data` 仍为 `[]`——**未消费 isError 的组件（聊天页模型选择器 `use-set-default-model.ts`、chat settings 等）渲染结果与今天完全一致**，无回归。
- 全局 `retry: 2`（`src/app.tsx:69`）意味着失败查询最多 3 次请求，可接受，不改。
- error message 保留上游原始 message（企业 401 时形如 `<Unauthorized '401: Unauthorized'>`），横幅上原样展示以保证可诊断；如需友好文案，属 i18n 映射，后续优化。

### 5.2 模型提供商页错误横幅（`src/pages/user-setting/setting-model/index.tsx`）

页面顶部（header 下方）新增条件渲染的 Alert：

- 聚合三个主查询（availableProviders / allModels / defaultModels）的 `isError` 状态，任一失败即显示。
- 文案：新增 i18n key（仅 `src/locales/zh.ts` 与 `en.ts`，遵守 CLAUDE.md i18n 约定）：
  - `setting.modelManagementLoadFailed`："模型管理数据加载失败，请检查 BFF 与 RAG 后端的认证配置" / "Failed to load model management data. Check BFF and RAG backend authentication."
  - 重试按钮复用现有通用 `retry` 文案（如无则一并新增 `setting.retry`）。
- 点击重试：对失败的 query 调用 `refetch()`。
- 展示 `error.message` 作为次要信息（等宽小字号），方便直接看到上游 401/403 详情。

### 5.3 mutation 的 401 诚实化（同一文件）

现有 mutation 模式是 `if (data?.code === 0) { message.success(...) }`，401 时静默。在各 mutation（`useAddProvider`、`useAddProviderInstance`、`useAddInstanceModel`、`useEditInstanceModel`、`useDeleteProviderInstance`、`useUpdateModelStatus`、`useSetDefaultModel`）的 `mutationFn` 内，服务调用返回后补充：

```ts
if (data?.code === 401) {
  message.error(data?.message || RetcodeMessage[401]);
}
```

要点：

- **只补 401**。其他非零码（100、业务错误码）axios 拦截器已有统一提示（`request.ts:187-218`），hook 层再提示会双重弹窗；HTTP 403（角色门控）也由拦截器提示。401 在企业模式被拦截器刻意静默（`request.ts:189-202`），是唯一缺口。
- 不 throw。调用点（`system-setting.tsx:78,87`、`provider-modal/index.tsx:139`）多数无 try/catch，throw 会变成未处理的 promise rejection 且无 UI 反馈；`message.error` 与文件内既有 `message.success` 模式对称，改动最小。
- `verify-button` 自带 try/catch（`modal/verify-button/index.tsx:40-49`），不受影响。

### 5.4 `useFetchTenantInfo` null 守卫（`src/hooks/use-user-setting-request.tsx:74-82`）

```ts
if (res.code === 0 && res.data) {   // 补 res.data 判空
  const { data } = res;
  data.chat_id = data.llm_id;
  data.speech2text_id = data.asr_id;
  return data;
}
return res;
```

`/users/me/models` 仍走成员令牌与改写分支（身份绑定语义），鉴权故障时表现为租户信息为空——与今天一致；本项只消除 TypeError。

### 5.5 前端改动兼容性矩阵

| 消费方 | 改动影响 |
|---|---|
| 模型提供商页 | 错误可见化：横幅 + mutation toast（目标行为） |
| 聊天页模型选择器 / chat settings / `useFindLlmByUuid` | queryFn throw 后 data 仍 `[]`（initialData），渲染不变；未消费 isError |
| datasets / next-search 等用 `useFetchTenantInfo` 的页面 | 崩溃消除，空数据表现不变 |
| axios 拦截器 | 企业模式 HTTP 401 静默路径不变；社区模式改写分支不变 |

## 6. 配置默认值与向导

1. `bff/src/services/rag-plugin-backend.ts:15`：`RAG_PLUGIN_CAPABILITIES.modelManagement` 由 `false` 改为 `true`。模型管理是 RAG 自生能力，向导默认关闭只会复现原因 A（整页静默空白，用户无从得知要改 JSON）。已部署后端不受影响（读的是存量配置）；目标 RAG 版本过旧缺该 API 时，开启后表现为 §5.2 的错误横幅——诚实且可诊断。
2. 同步更新 fixture：`bff/src/routes/wizard.test.ts:45`。`capabilities.test.ts` 的场景断言不受影响（它测的是合并逻辑而非默认值）。
3. 运维步骤（不入 git）：本机 `bff/data/harness-backends.json` 的伴生 RAG 项手工改 `"modelManagement": true` 后重启 BFF。

## 7. 明确不做 / 后续项

| 项 | 不做的理由 | 后续条件 |
|---|---|---|
| 全局 401 透传（非模型路径） | 影响知识库/画布/文件全域 mutation 与列表页，需独立回归；且社区模式登出循环风险需按 §4.2 同样的条件设计逐域评估 | 模型域方案稳定后另立设计 |
| 非模型路径 mutation 假成功 | 同上 | 同上 |
| `/users/me/models` 服务令牌化 | "当前用户的租户信息"是身份绑定语义，换服务令牌改变语义且受益方不明确 | 若 D1 长期无法落地再议 |
| `modelManagement: false` 的空态提示 | 能力关闭时整页隐藏是既有产品行为，提示属增强 | P2 |
| 401 文案的 i18n 友好化 | 先保证真实信息透出，再谈美化 | P2 |

## 8. 测试计划

### 8.1 BFF 单测（新增 `bff/src/routes/proxy.test.ts`，fixture 参照 `capabilities.test.ts` 模式）

1. `MODEL_MANAGEMENT_PATH_RE`：匹配 `providers`、`providers/X/instances`、`models`、`models/default`；不匹配 `users/me/models`、`datasets`、`chats`。
2. flag 开 + 配置 `ragAdminToken` + `GET /models`：上游收到 `Authorization: Bearer <服务令牌>`，且不含 `X-Intellect-User/Role/Tenant`。
3. flag 开 + 非管理员 role + `POST /providers`：403，不触达上游。
4. flag 开 + role 解析失败（undefined）+ 非 GET：403（fail-closed）。
5. flag 开 + 管理员 + 非 GET：放行且带服务令牌。
6. flag 关：任何路径均不强制服务令牌、无角色门控（现状行为）。
7. 上游 401 + `sessionToken` + 模型路径：响应为 401 + 原始信封；同样条件下非模型路径：改写 `{code:0,data:null}`。
8. 无 `sessionToken`（社区模式）+ 模型路径 + 上游 401：改写（防登出循环）。
9. `intellectTenantId` 全 0：不注入 `X-Intellect-Tenant`；正常值：注入。
10. 上游 401 时诊断日志包含上游 message、不含任何 Authorization 值。

### 8.2 前端单测（Jest）

1. `use-llm-request` 各 query：信封 `code !== 0` 时 `isError` 为真、`data` 保持 `[]`。
2. mutation hook：`code === 401` 时触发 `message.error` 且不抛异常；`code === 0` 行为不变。
3. `useFetchTenantInfo`：`{code:0, data:null}` 不抛异常，返回原信封。

### 8.3 手工验证清单（替代分析文档 §9.6）

| # | 场景 | 预期 |
|---|---|---|
| 1 | flag 关 + 成员令牌 401 环境（原因 C 未修复） | 模型页出现错误横幅（含上游 message）；BFF 日志打印 `[proxy] upstream 401 ...` |
| 2 | 同上，保存实例 / 设默认模型 / 删除实例 | `message.error` 弹出上游错误，**无成功提示** |
| 3 | flag 开 + 服务令牌配置正确 | 四个 GET 200；右侧目录与默认模型下拉框有数据 |
| 4 | flag 开 + admin 成员写操作 | 成功且数据落在服务租户视角 |
| 5 | flag 开 + 普通成员写操作 | `hint : 403` 提示 |
| 6 | D1 落地后的正常环境 | flag 开/关行为一致（无 401） |
| 7 | 回归 | 知识库页、聊天页模型选择器、租户信息依赖页表现不变 |
| 8 | `useFetchTenantInfo` | 鉴权故障时无 console TypeError |

## 9. 实施顺序与回滚

| 批次 | 内容 | 依赖 | 回滚方式 |
|---|---|---|---|
| P1-a | §4.2 透传与诊断日志、§4.3 占位租户过滤、§5.1-5.4 前端韧性、§8 对应单测 | 无 flag 依赖，可直接合入 | revert 提交 |
| P1-b | §4.1 服务令牌强制、§4.4 角色门控、§4.6 flag（默认关）、§6 默认值 | D2 有初步倾向即可开发，生产开启等 D2 定论 | flag 置 `false` 即回滚令牌行为 |
| P2 | §7 后续项 | 另立设计 | — |

批次 P1-a 单独交付时即已消除假成功与静默空列表（错误可见化），P1-b 解决"故障期间可用性"。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 透传后"静默空"变"可见错误"，用户感知为页面变差 | 横幅文案说明是后端认证配置问题；这是故障本来就该有的样子 |
| 服务令牌视角合并导致成员看到非本人租户的模型 | flag 默认关；D2 明确"租户级共享"语义后再开 |
| TEAM 网关故障时管理员写操作被 fail-closed 拒绝 | 60s 解析缓存；TEAM 长时间故障时成员令牌链路本身不可用，写操作本就不可达 |
| 上游 401 message 文案不友好（`<Unauthorized ...>`） | 原样展示保证可诊断；i18n 映射列 P2 |
| 诊断日志泄露敏感信息 | 只打印上游响应体（信封不含令牌）；日志语句不含任何 Authorization 值，单测 #10 断言 |
| 本设计文档自身含敏感信息 | 本文档无凭据；关联分析文档的凭据轮换列为行动项（§11） |

## 11. 文档与安全行动项

1. 2026-10-22 分析文档：标注 §4/§6 已失效（改动丢失、环境已切换），或以本文档替代并归档；该文档经微信渠道传输且含网关令牌、RAG API Key、测试账号密码——**建议轮换这批凭据**。
2. 本文档与实施提交放入仓库 `docs/`，不含任何凭据。

## 12. 评审记录（自查发现与修正）

初稿到定稿之间的实质修正，留档备查：

1. **401 透传条件从"模型路径"收窄为"`sessionToken` 存在且模型路径"**。初稿无条件透传，复审发现社区模式下 `code:401` 触发拦截器登出+跳转（`request.ts:193-201`），而 RAG 管理令牌失效无法靠重新登录解决，会形成登出循环——正是旧改写逻辑要防的场景。现按"成员身份发出的请求才诚实透传"收敛。
2. **mutation 错误提示从"所有非零码"收窄为仅 `code === 401`**。拦截器对 code 100/其他非零码已有统一 toast，hook 层全覆盖会双重弹窗；HTTP 403（门控）同理由拦截器提示。
3. **mutation 选择 `message.error` 而非 throw**。多数调用点（`system-setting.tsx:78`、`provider-modal/index.tsx:139`）无 try/catch，throw 只会产生未处理 rejection 且无 UI 反馈；与文件内既有 `message.success` 模式对称。
4. **写门控从"未知角色放行"改为 fail-closed**。初稿为避免 TEAM 抖动误伤管理员而放行未知角色，安全复审认定"无法确权者以服务身份写租户配置"不可接受；60s 缓存与重试已足够缓解抖动。
5. **确认 `PATCH /models/default` 落入管理员门控**并单独成节（§4.5）——这是读+写方案下普通成员唯一会被 403 的既有操作，必须交业务确认（与 D2 同源），不能埋在实现里。
6. **占位租户过滤从"仅模型路径"扩大为全局**：全 0 是无歧义的占位值，全局过滤无副作用，且与 `backend-context.ts` 既有语义对齐。
7. **确认无需改 `rag-fetch.ts`**：服务令牌经 `ProxyRequest.forceServiceToken` 在 `intellect-rag-client.proxy()` 内显式设置 Authorization，天然走 `explicit` 分支（不覆盖、不重试），复用既有语义。
8. **确认 `streamResponse` 保留 status**（`bff/src/utils/response.ts`），透传实现零新增工具。
9. **方案 2 单独不闭环的修正**：分析文档 §5 方案 2 只恢复下拉框读数据，但页面后续动作（保存实例、设默认）全是写请求，仍会假成功。本设计将"写诚实化"（P1-a）与"写可用化"（P1-b）拆为两批，各自可独立验收。
10. **核实"未提交改动已丢失"**：`git log -S "useServiceToken" --all` 无命中、stash 为空、工作区干净——本文档按重建设计，避免实施者误以为存在可恢复的基线。
