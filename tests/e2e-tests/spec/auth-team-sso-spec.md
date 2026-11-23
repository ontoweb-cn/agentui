# Spec 批准门 — auth-team-sso

> 日期:2026-11-23  
> 九步:步骤 1–5 已完成;本文件提请**批准后进入步骤 6–9**  
> 依据:`docs/auth-intellect-auth-to-team-flow-status.md` §1.4–§1.5

## 1. 执行摘要

| 用例 | 结果 | 说明 |
|---|---|---|
| TC-ATS-01 登录页/渠道 | **部分通过** | BFF `channels` 返回 `intellect-auth`;SPA `/login` 200。浏览器 MCP **无法访问宿主机 127.0.0.1**(R6 L-BROWSER-LOCAL),未获 UI 截图 |
| TC-ATS-04 exchange 探针 | **FAIL** | 公网 POST exchange **404**;Rust `main` 无路由 → **F-TEAM-RUST-01** |
| TC-ATS-05 providers.client_id | **FAIL** | 公网 10 渠道均无 `client_id`;Rust struct 无字段 → **F-TEAM-PROV-01** |
| TC-ATS-06 BFF vitest | **PASS** | `auth.test.ts` **71/71** |
| TC-ATS-07 Python 静态 | **FAIL** | adapter 无 `members/oauth/exchange` → **F-TEAM-PY-01** |
| TC-ATS-02/03/08–10 | **未跑/受限** | 真 IdP 账号 L-01;未开通文案依赖上游 exchange;密码账号未备 |

结论:**agentui BFF 侧就绪;阻塞在 intellect-team 双栈契约(必修)。**

## 2. 缺陷清单

| ID | 严重度 | 描述 | 责任仓 | 建议修复 |
|---|---|---|---|---|
| **F-TEAM-RUST-01** | P0 | `POST /api/members/oauth/exchange` 从 main 丢失(D2 合并);公网 404 | intellect-team Rust | 自 `1c034c51`+`9a0143dd` **恢复** handler/路由/`client_id`/claim;加路由快照测试防再丢 |
| **F-TEAM-PY-01** | P0 | Python 从未实现同契约 exchange | intellect-team Python | 按 `contracts/sso-exchange.*` 实现同 path/错误码/`member_id_claim` |
| **F-TEAM-PROV-01** | P0 | 公开 providers 缺 `client_id` | intellect-team 双栈 | 与 exchange 同批补齐;BFF 已对缺字段渠道隐藏 |
| F-DOC-01 | P2 | spec-014 状态曾标 ✅ | agentui docs | **已修订**(现状文档+spec 头);步骤 9 归档确认 |
| — | — | HIEDU 开通深链/对账键口径 | HIEDU + 运维 | 本批准范围**不改 HIEDU 仓**;记后续/受限 |

## 3. 拟修复范围(步骤 6,待批准)

### 纳入本轮(必修)

1. **intellect-team Rust**:恢复 SSO exchange + providers.`client_id` + 回归测试(路由存在断言)。  
2. **intellect-team Python**:对齐实现 exchange(最小可用)+ providers.`client_id`(或公开 members providers 等价面)。  
3. **agentui**:契约/夹具/冒烟与文档对齐;必要时 BFF 单测补「上游 404→可读错误」;不改 `src/components/ui/`。  
4. 双栈最小矩阵 DV-01~DV-04 能在单测或集成级证明(Python 可用 mock/静态+单测)。

### 明确不纳入本轮

- HIEDU Portal 深链产品改动、生产 L-10 首装代操作、真 IdP 账号联调(L-01)、SLO、跨应用 token 直通、T4.2/Phase B。  
- 以 D2 `exchange-id-token` 冒充主 SSO 路径。

### 取舍

| 选项 | 说明 |
|---|---|
| A(推荐) | 双栈同批恢复/实现对齐契约后再回归 |
| B | 仅 Rust 恢复,Python 标「不支持 SSO」清单 | **违背**现状文档双栈强制约束,除非产品改口 |
| C | 仅改 agentui | **无效**(上游 404) |

**本 Spec 默认选项 A。**

## 4. 步骤 7–9 计划(批准后连续执行)

7. intellect-team:`cargo test` 相关 + Python pytest/静态门禁;agentui `vitest auth` + 守卫;代码审查 P0/P1。  
8. 重跑 TC-ATS-04/05/06/07;能通则补 TC-ATS-03 mock;UI 若浏览器仍不可达则 R6。  
9. `reports/REPORT-auth-team-sso-20261123.md` + 受限专节 + 记忆更新。

## 5. 产物路径

| 产物 | 路径 |
|---|---|
| 调研 | `tests/e2e-tests/outline/auth-team-sso-research.md` |
| 手册 | `docs/auth-team-sso-manual.md` |
| 大纲 | `tests/e2e-tests/outline/auth-team-sso.md` |
| 用例/夹具 | `tests/e2e-tests/cases|fixtures/auth-team-sso/` |
| 探针结果 | `tests/e2e-tests/results/auth-team-sso/` |
| 本批准门 | `tests/e2e-tests/spec/auth-team-sso-spec.md` |

## 6. 请用户批准

请回复是否批准 **选项 A**,进入步骤 6 在 intellect-team(Rust+Python)与 agentui 落地修复。  
若选 B/C 或缩范围,请明示。
