# TC-WED-03 — setup / probe / status 契约（v1.4）

**v1.4 修订（2026-11-25，设计 §11.3/§12 R-1）**：选项表删 SSO 卡，但 deprecated enterprise-sso setup/probe 仍 200（R-1 回退）;`hasEnterpriseBackend` 字段保留。

## TC-WED-03-01 backend-types = 4 卡

| 项 | 内容 |
|---|---|
| 目的 | 设计 §11.3 |
| 优先级 | P0 |
| 步骤 | `GET /admin/wizard/backend-types` |
| 预期 | `options.length===4`；首卡 `enterprise-password`，label/description 无 SSO 字样；无 `enterprise-sso` |
| 单测 | 「v1.4: 返回 4 个选项…」 |

## TC-WED-03-02 R-1 兼容回归:deprecated enterprise-sso 仍可用

| 项 | 内容 |
|---|---|
| 目的 | §12 R-1 |
| 优先级 | P0 |
| 步骤 | (a) setup `setupProfile=enterprise-sso` 最小请求；(b) probe 同 profile |
| 预期 | (a) 200，backendId=intellect-enterprise-default，行为同 v1.3；(b) 返回 sso 四项明细——选项表删卡不致 400 |
| 单测 | W-01/W-R1、W-P01 |

## TC-WED-03-03 非 SSO 请求拒绝 sso 字段（延续）

| 项 | 内容 |
|---|---|
| 优先级 | P1 |
| 步骤 | setup 企业不带 profile 且带 `sso.enabled=true` |
| 预期 | 400 |
| 单测 | U-10 |
