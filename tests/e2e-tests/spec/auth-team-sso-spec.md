# Spec 批准门 — auth-team-sso（续跑：status 未完成可编码项）

> 日期:2026-11-23（续）  
> 模块:`auth-team-sso`  
> 真源:`docs/auth-intellect-auth-to-team-flow-status.md`；向导安全:`docs/wizard-enterprise-sso-mode-design.md` §9  
> **授权**:用户「调用九步交付技能实施 auth-intellect-auth-to-team-flow-status.md 未完成任务」→ **门后连续执行步骤 6–9**

## 1. 本轮范围（可编码）

| 纳入 | ID | 说明 |
|---|---|---|
| ✅ | **F-WED-SEC-01 / Q1** | `sso-section` 补 `Switch` import |
| ✅ | **F-WED-SEC-02 / W3·S1** | `sso-providers` 改 `safeFetch`（redirect:manual + 主机校验） |
| ✅ | **F-WED-SEC-03 / W4·S2** | wizard envSnippet 对 `providers[]` charset 消毒 |
| ✅ | **F-DOC-TEAM-01** | status/大纲：intellect-team **origin/main 已恢复** exchange + `client_id` + Python 对齐（源码复验），纠正「仍缺失」过时口径；**现网部署/探针**另记 |
| ❌ 本轮不做 | D1–D5 / I* / HIEDU P* / Portal 深链 / S2S | 运维与跨仓产品；记受限 |
| ❌ | 以 D2 `exchange-id-token` 作主 SSO | 禁止 |

## 2. 步骤 5 复验摘要（续）

| 用例 | 结果 | 说明 |
|---|---|---|
| TC-ATS-04/05/07（源码） | **源码 PASS** | intellect-team `origin/main`：`members_api` 有 exchange + `client_id`；Python `sso_exchange.py` + adapter 路由在 |
| TC-ATS-04（公网探针） | **受限 L-ATS-PROD** | 公网实例是否已滚到该 main 未在本环境证实；不以旧 404 否定源码 |
| TC-ATS-06 | 待步骤 8 重跑 | auth vitest |
| §9 Q1/S1/S2 | **FAIL→步骤 6** | Switch 未 import；裸 fetch；snippet 未 charset |

## 3. 缺陷 → 修复

| ID | 严重度 | 修复 |
|---|---|---|
| F-WED-SEC-01 | P0 | import Switch |
| F-WED-SEC-02 | P0（公网） | `fetchPublicProviders` → `safeFetch` |
| F-WED-SEC-03 | P0（公网） | `^[a-zA-Z0-9_-]+$` 过滤 + warning |
| F-DOC-TEAM-01 | P2 | 更新 status T1–T3 口径为「源码已齐 / 现网待滚」 |

## 4. 产物

- 报告:`tests/e2e-tests/reports/REPORT-auth-team-sso-2026-11-23.md`
- 证据:`tests/e2e-tests/results/auth-team-sso/`
