# Spec — wizard-ent-sso-mode（步骤 5/6 批准门）

日期:2026-11-23  
模块:向导企业双模式（SSO / 非 SSO）  
设计真源:`docs/wizard-enterprise-sso-mode-design.md` v1.1 §8（**用户已认可**）  
手册:`docs/wizard-ent-sso-mode-manual.md`

## 1. 步骤 5 执行摘要

| 用例 | 结果 | 证据 |
|---|---|---|
| TC-WED-03-01 backend-types | **FAIL** | `results/wizard-ent-sso-mode/TC-WED-03-01-before.json`：4 卡、无 optionId/setupProfile、首卡 label=`Intellect Enterprise` |
| TC-WED-01/02/04 UI | **受限 L-WED-01** | 浏览器 MCP 打开 `127.0.0.1:9391` → `chrome-error://`（与既有 R6 一致）；以源码检视 + 契约 FAIL 代替 |
| TC-WED-03-02/03/04 | **FAIL（未实现）** | setup 尚无 setupProfile 分支 |
| TC-WED-05 | **FAIL** | `TC-WIZSSO-01` 仍写 4 卡 |

### 缺陷清单

| ID | 级别 | 描述 | 修复方案 |
|---|---|---|---|
| F-WED-01 | P0 | 单企业卡，非五卡双模式 | 实施设计 §3.1：拆两卡置顶 |
| F-WED-02 | P0 | 选型主键为 type | §8 R1：`optionId` |
| F-WED-03 | P0 | SSO 内嵌可跳过 | SSO 卡强制面；非 SSO 不渲染 |
| F-WED-04 | P0 | setup 无 profile 校验 | §3.4 + R5 缺省兼容 |
| F-WED-05 | P1 | 旧 TC 4 卡口径 | 修订 TC-WIZSSO-01 + WED-05 |
| F-WED-06 | P1 | Done「待写入 env」提示弱 | SSO 模式完成页强化文案（R8） |
| F-WED-07 | P1 | 旧 draft 无 profile | 加载时清空/回落（R6） |

### 受限注记

| ID | 说明 |
|---|---|
| L-WED-01 | 步骤 5 UI 截图：Cursor 浏览器无法访问宿主机 loopback；步骤 8 优先本机人工/可达环境补图 |
| L-WED-02 | `/api/bff/admin/wizard/*` 直连 401；契约取证用 BFF `http://127.0.0.1:9390/admin/wizard/*` |

## 2. 修复范围（步骤 6）

**仅本仓 agentui**：按 `wizard-enterprise-sso-mode-design.md` + §8 R1–R8、R11 落地。

- BFF:`types/wizard.ts`、`routes/wizard.ts`、`wizard.test.ts`
- 前端:`wizard-service.ts`、`ee/pages/wizard/index.tsx`、`sso-section.tsx`、zh/en（及 ee private 若有）
- 文档/用例:手册已齐；改 TC-WIZSSO-01；本模块 cases 保持

**不在本批**：intellect-team 双栈 exchange（T1–T3）、HIEDU 深链、SsoStore、隐藏密码登录。

## 3. 取舍

| 项 | 决定 |
|---|---|
| 缺 setupProfile | 兼容默认 `enterprise-password` + warning（R5），非硬 400 |
| 密码登录 | SSO 模式不隐藏（R10） |
| setupProfile 落盘 | 不落盘（R9） |

## 4. 批准

- 设计 §8：**用户已认可（2026-11-23）**
- 本 Spec 修复范围 = 该设计实施  
- **授权口径**:用户「认可§8，调用九步交付开始实施」→ **门后连续执行步骤 6–9，不再中途确认**

## 5. 报告与归档路径

- 报告:`tests/e2e-tests/reports/REPORT-wizard-ent-sso-mode-2026-11-23.md`
- 截图/契约:`tests/e2e-tests/results/wizard-ent-sso-mode/`

## 6. 步骤 6–9 执行注记（门后连跑）

| 步 | 状态 | 证据 |
|---|---|---|
| 6 修复 | **完成** | 双卡/`optionId`/profile/lockedEnabled/Done 待写入提示已落地 |
| 7 构建健康 | **完成** | `wizard.test.ts` 56/56；`bff tsc --noEmit` 0；临时 BFF `backend-types` 5 卡 |
| 8 回归 | **完成** | after.json 断言 PASS；U-17～U-20 矩阵绿 |
| 9 报告 | **完成** | 见上报告路径；受限 L-WED-01/02/03 |

## 7. 质量/安全跟进（设计 §9，未纳入步骤 6 关闭范围）

真源:`docs/wizard-enterprise-sso-mode-design.md` §9。本 Spec 步骤 6 **不**宣称下列项已修。

| ID | 级别 | 项 | 发布门禁 |
|---|---|---|---|
| S1 / W3 | High | providers/setup 白名单拉取改 `safeFetch`（对齐 probe） | **公网阻断** |
| S2 / W4 | Med | `providers[]` → envSnippet charset + 白名单 | **公网阻断**；内网强烈同批 |
| Q1 | P0 | `sso-section` 补 `Switch` import | **开发阻断**（SSO 卡可用性） |
| S3 | Med | bootstrap CSRF / 一次性 token | backlog |
| S4–S6 / Q2–Q5 | — | 运维日志、TRUST_PROXY、切卡 effect、i18n、`getOptionFor*` | 见设计 §9 |

下一补丁建议用例：注入换行的 `providers` 不得进 snippet；对私网/重定向 URL 的 providers 探测拒绝。
