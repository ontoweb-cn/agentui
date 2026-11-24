# TC-WED-03 — setup / probe / status / backend-types 契约

口径:BFF 直连 `http://127.0.0.1:9390/admin/wizard/*` + `wizard.test.ts`  
破坏性 setup 前备份 `bff/data/*.json`  
**v1.3 修订（2026-11-24，设计 §10.6）**：03-02、03-03 按「启用状态由模式推定」「非 SSO 模式拒绝任何 sso」改写；新增 03-05～03-09。下列用例均有 `wizard.test.ts` 对应单测，已通过。

## TC-WED-03-01 backend-types 含 optionId 与双企业卡

| 项 | 内容 |
|---|---|
| 目的 | 设计 §8.3 / §10 D2 |
| 优先级 | P0 |
| 步骤 | `GET /admin/wizard/backend-types` |
| 预期 | `options.length===5`；`[0].optionId==='enterprise-sso'`；`[1].optionId==='enterprise-password'`；二者 `type==='intellect-enterprise'`；非 SSO 卡 `description` 不含 `SSO` |

## TC-WED-03-02 SSO profile 必须带 sso，启用状态由模式推定

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10.3 / §10.6 |
| 优先级 | P0 |
| 步骤 | setup `type=intellect-enterprise, setupProfile=enterprise-sso`：(a) 不带 `sso`；(b) 带 `sso` 但不传 `enabled`；(c) 带 `sso.enabled=false` |
| 预期 | (a) 400；(b)(c) 200，片段含 `BFF_SSO_ENABLED=true` |
| 单测 | U-17、U-17b |

## TC-WED-03-03 非 SSO 模式拒绝任何 sso

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10 D2 |
| 优先级 | P0 |
| 步骤 | setup `setupProfile=enterprise-password` + `sso.enabled=true`；再试 `sso.enabled=false` |
| 预期 | 两次均 400，不落盘 |
| 单测 | U-18、W-05 |

## TC-WED-03-04 缺 profile 兼容

| 项 | 内容 |
|---|---|
| 目的 | §8 R5 |
| 优先级 | P1 |
| 步骤 | enterprise setup 不传 setupProfile、不传 sso |
| 预期 | 200 + warnings 提示应显式传 setupProfile（行为等同非 SSO） |

## TC-WED-03-05 SSO 模式最小请求

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10.5 |
| 优先级 | P0 |
| 步骤 | setup 只带 `type / endpoint / token / setupProfile=enterprise-sso / sso{publicOrigin,stateSecret,...}`，不带 `name`、`credentialKind`、`intellectTenantId`；网关 `/api/tenant/info` 返回合法租户 ID |
| 预期 | 200；`backendId==='intellect-enterprise-default'`；落盘配置 `credentialKind==='bearer-token'`、`intellectTenantId` 等于网关返回值；服务密钥进 vault，落盘配置与响应都不含明文 |
| 单测 | W-01 |

## TC-WED-03-06 SSO 模式的两项 400

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10.2、§10.5 |
| 优先级 | P0 |
| 步骤 | (a) 最小请求去掉 `token`；(b) 网关 `/api/tenant/info` 不可达且未手填租户 ID |
| 预期 | (a) 400 且提示网关服务密钥；(b) 400 且提示无法自动识别企业租户 ID；均不落盘 |
| 单测 | W-02、W-03、W-04 |

## TC-WED-03-07 status 报告是否已有企业后端

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10 D5 |
| 优先级 | P1 |
| 步骤 | `GET /admin/wizard/status` |
| 预期 | 响应含 `hasEnterpriseBackend`；configs 里有企业后端（即使 token 未就绪）时为 `true` |
| 单测 | `hasEnterpriseBackend:*` |

## TC-WED-03-08 SSO 模式验证

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10.6 |
| 优先级 | P0 |
| 步骤 | probe `setupProfile=enterprise-sso`，分别构造：全部通过；密钥被拒（401）；两处受保护端点 404；网关未返回租户 ID；渠道端点不可达 |
| 预期 | 响应含 `sso{gatewayOk,tenantId,keyValid,providersOk,providerCount?}`；密钥 401 → `keyValid=false` 且 `healthy=false`；两处 404 → `keyValid=null` 且不阻断；租户 ID 缺失 → `tenantId=null`、`healthy=false`，其余结论照常 |
| 单测 | W-P01～W-P09 |

## TC-WED-03-09 片段不再输出 token 环境变量行

| 项 | 内容 |
|---|---|
| 目的 | 设计 §10 D4 |
| 优先级 | P1 |
| 步骤 | 有 vault 的环境完成任意类型的 setup；再在无 vault 的环境完成 |
| 预期 | 有 vault：非 SSO 模式响应没有 `envSnippet`，SSO 模式片段只含 `BFF_SSO_*` 等统一认证行；无 vault：片段保留 `HARNESS_<ID>_TOKEN=<your-token>` |
| 单测 | 「创建 backend 成功…」、W-07 |
