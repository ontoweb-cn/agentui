# TC-WED-03 — setup / backend-types 契约

口径:BFF 直连 `http://127.0.0.1:9390/admin/wizard/*` + `wizard.test.ts`  
破坏性 setup 前备份 `bff/data/*.json`

## TC-WED-03-01 backend-types 含 optionId 与双企业卡

| 项 | 内容 |
|---|---|
| 目的 | 设计 §8.3 |
| 优先级 | P0 |
| 步骤 | `GET /admin/wizard/backend-types` |
| 预期 | `options.length===5`；`[0].optionId==='enterprise-sso'`；`[1].optionId==='enterprise-password'`；二者 `type==='intellect-enterprise'` |

## TC-WED-03-02 SSO profile 强制 sso

| 项 | 内容 |
|---|---|
| 目的 | 设计 §3.4 / R4 |
| 优先级 | P0 |
| 步骤 | setup `type=intellect-enterprise, setupProfile=enterprise-sso` 且无 sso / enabled=false |
| 预期 | 400 |

## TC-WED-03-03 非 SSO 拒绝 sso.enabled

| 项 | 内容 |
|---|---|
| 目的 | 设计 §3.4 |
| 优先级 | P0 |
| 步骤 | setup `setupProfile=enterprise-password` + `sso.enabled=true` |
| 预期 | 400 |

## TC-WED-03-04 缺 profile 兼容

| 项 | 内容 |
|---|---|
| 目的 | §8 R5 |
| 优先级 | P1 |
| 步骤 | enterprise setup 不传 setupProfile、不传 sso |
| 预期 | 200 + warnings 提示应显式传 setupProfile（行为等同非 SSO） |
