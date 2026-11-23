# REPORT — auth-team-sso（2026-11-23 续跑）

真源:`docs/auth-intellect-auth-to-team-flow-status.md`  
Spec:`tests/e2e-tests/spec/auth-team-sso-spec.md`（用户授权连跑未完成可编码项）  
关联向导安全:`docs/wizard-enterprise-sso-mode-design.md` §9

## 1. 结论摘要

| 缺陷 | 修复 | 证据 |
|---|---|---|
| F-WED-SEC-01 / Q1 | `sso-section` import `Switch` | `src/ee/pages/wizard/sso-section.tsx` |
| F-WED-SEC-02 / W3·S1 | `sso-providers` → `safeFetch` | `bff/src/services/sso-providers.ts` + `sso-providers.test.ts` |
| F-WED-SEC-03 / W4·S2 | `sanitizeSsoProviderIds` + U-21 | `wizard.ts` / `wizard.test.ts` |
| F-DOC-TEAM-01 | status T1–T3 / §1.5 改为「源码已齐、现网待滚」 | `docs/auth-intellect-auth-to-team-flow-status.md` |
| F-TEAM-RUST/PY/PROV（源码） | intellect-team `origin/main` 已含 exchange+client_id+Python | 本地 `rg` / `git show origin/main` |

**本轮可编码项关闭。** 真网一键 SSO 仍依赖 D1–D5 滚版与 I*/HIEDU（受限，非本仓可关）。

## 2. 用例 / 回归

| 项 | 结果 |
|---|---|
| `wizard.test.ts` + `sso-providers.test.ts` + `auth.test.ts` | **131/131 PASS** |
| TC-ATS-04/05/07 源码复验 | PASS（team main） |
| TC-ATS-04 公网实例 | **受限 L-ATS-PROD**（未证实现网已滚版） |
| UI 截图 | **受限 L-BROWSER-LOCAL**（同既有） |

## 3. 交付物

- agentui 代码:wizard SSO 安全三项 + 单测  
- 文档:status / 设计 §9 状态位更新  
- Spec/本报告

## 4. 受限注记

| ID | 说明 |
|---|---|
| L-ATS-PROD | 公网/生产 team 是否已部署含 exchange 的 main：本环境未探针到「已滚」证据 |
| L-BROWSER-LOCAL | 浏览器 MCP 不可达宿主机 loopback |
| L-OPS-D | D1–D5 生产首装/IdP/渠道为运维项 |
| L-ID-I | I1–I5 / HIEDU 开通对账跨仓 |
| L-PROD-P | Portal 深链 / S2S 产品未做 |

## 5. 遗留（不阻塞本轮）

1. 现网滚 intellect-team + 贴 `BFF_SSO_*` + 真账号冒烟。  
2. §9 S3–S5 / Q2–Q4 backlog。  
3. 双栈契约 CI 常绿门禁（team 仓）。

## 6. 九步闭环声明

步骤 1–5 既有资产 + 续 Spec 范围；用户指令授权步骤 6–9。步骤 6 落地 Q1/S1/S2 与文档校正；步骤 7–8：vitest 131 绿；步骤 9：本报告。

### 复跑口令

```bash
cd bff && npx vitest run src/routes/wizard.test.ts src/services/sso-providers.test.ts src/routes/auth.test.ts
# team 源码
rg -n 'oauth/exchange' /workspace/intellect-team/intellect-gateway/src/platform/members_api.rs
```
