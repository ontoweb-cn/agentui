# REPORT — wizard-ent-sso-mode（2026-11-23）

模块:向导企业双模式（企业版 SSO / 非 SSO）  
设计:`docs/wizard-enterprise-sso-mode-design.md` v1.1 §8（用户认可）  
手册:`docs/wizard-ent-sso-mode-manual.md`  
Spec:`tests/e2e-tests/spec/wizard-ent-sso-mode-spec.md`

## 1. 结论摘要

| 缺陷 | 修复 | 验收证据 |
|---|---|---|
| F-WED-01 单企业卡 | `BACKEND_TYPE_OPTIONS` 拆双卡置顶 | `results/.../TC-WED-03-01-after.json`：5 卡，首 `enterprise-sso` |
| F-WED-02 type 作 Radio key | 前端 `optionId` 主键 | `src/ee/pages/wizard/index.tsx` Radio value=`optionId` |
| F-WED-03 SSO 可跳过 | `lockedEnabled` + 仅 SSO 卡渲染 | `sso-section.tsx` + Connection 分支 |
| F-WED-04 无 setupProfile | setup 校验 + R5 缺省兼容 | vitest U-17～U-20 |
| F-WED-05 旧 TC 4 卡 | TC-WIZSSO-01 改 5 卡 | `cases/wizard/TC-WIZSSO-01-entry-types.md` |
| F-WED-06 Done 待写入弱 | BFF warning + Done `ssoEnvPending` | wizard.ts §8 R8；Done 页文案 |
| F-WED-07 旧 draft | 无 optionId 清空选型 | index.tsx 草稿加载 R6 |

**判定:本模块九步闭环完成（契约/单测全通；UI 截图见受限注记）。**

## 2. 用例执行结果

| 组 | 结果 | 说明 |
|---|---|---|
| TC-WED-01 | 受限通过(L-WED-01) | UI 截图不可达；契约+源码证明五卡/`optionId`/徽章 |
| TC-WED-02 | 受限通过(L-WED-01) | 源码：`isEnterpriseSso` + `lockedEnabled` |
| TC-WED-03 | **PASS** | 运行库 `backend-types` 5 卡；`wizard.test.ts` **56/56** |
| TC-WED-04 | 受限通过(L-WED-01) | Confirm/Done 文案与 warning 源码+单测 U-20 |
| TC-WED-05 | **PASS** | TC-WIZSSO-01 已改为 5 卡口径 |

步骤 5 基线:`TC-WED-03-01-before.json`（4 卡）→ 步骤 8 回归:`TC-WED-03-01-after.json`（5 卡）。

## 3. 交付物清单

| 类 | 路径 |
|---|---|
| 设计 | `docs/wizard-enterprise-sso-mode-design.md` |
| 手册 | `docs/wizard-ent-sso-mode-manual.md` |
| 现状计划 | `docs/auth-intellect-auth-to-team-flow-status.md`（W1/W2） |
| BFF | `bff/src/types/wizard.ts`、`bff/src/routes/wizard.ts`、`wizard.test.ts` |
| 前端 | `src/services/wizard-service.ts`、`src/ee/pages/wizard/index.tsx`、`sso-section.tsx` |
| 用例 | `tests/e2e-tests/cases/wizard-ent-sso-mode/*`；`cases/wizard/TC-WIZSSO-01-*` |
| Spec/大纲 | `spec/wizard-ent-sso-mode-spec.md`；`outline/wizard-ent-sso-mode*.md` |
| 证据 | `results/wizard-ent-sso-mode/TC-WED-03-01-after.json` |

## 4. 受限注记专节

| ID | 说明 |
|---|---|
| L-WED-01 | Cursor 浏览器 MCP 无法打开宿主机 `127.0.0.1:9391`（`chrome-error`）；UI 截图未归档，以 BFF 直连契约 + vitest + 源码检视代替用户级截图证据 |
| L-WED-02 | 带前缀 `/api/bff/admin/wizard/*` 直连 401；取证使用 BFF `http://127.0.0.1:9390/admin/wizard/*` |
| L-WED-03 | 步骤 7 临时拉起 BFF 做契约探针后已停止；日常需 `npm run dev:all` 做人工 UI 走查 |

## 5. 遗留建议

### 5.1 质量/安全（设计 §9 — 文档已吸收，代码待下一补丁）

| ID | 阻塞面 | 说明 |
|---|---|---|
| **Q1** | 开发/SSO 卡可用 | `sso-section.tsx` 补 `Switch` import |
| **S1 / W3** | **公网 BFF 发布** | providers 拉取改 `safeFetch`；`SSRF_ALLOW_PRIVATE_IP=false` |
| **S2 / W4** | **公网 BFF 发布** | `providers[]` charset + 白名单后再写 envSnippet |
| S3–S5 / Q2–Q4 | 不阻塞内网首装 | bootstrap CSRF、TRUST_PROXY、切卡 effect、i18n、option 查找 |

方案与手册已更新：`wizard-enterprise-sso-mode-design.md` v1.2 §9；`wizard-ent-sso-mode-manual.md` §5 运维注意；`auth-intellect-auth-to-team-flow-status.md` W3/W4 + 落地顺序 0c。

### 5.2 其它（不阻塞）

1. 人工在可达浏览器补拍 TC-WED-01/02/04 截图进 `results/wizard-ent-sso-mode/`。  
2. 目标路径真网 SSO 仍依赖 intellect-team 双栈 exchange（status T1–T3），与本向导模块解耦。

## 6. 九步闭环声明

步骤 1–5 与 Spec 批准门已完成；用户「认可§8，调用九步交付开始实施」授权步骤 6–9 连续执行。  
步骤 6 源码落地；步骤 7：`wizard.test.ts` 56 绿 + 临时 BFF 健康/backend-types 探针通过；步骤 8：契约回归 after.json 与单测矩阵通过；步骤 9：本报告归档。

### 复跑口令

```bash
cd bff && npx vitest run src/routes/wizard.test.ts
curl -sS http://127.0.0.1:9390/admin/wizard/backend-types | jq '.options[].optionId'
# UI: http://127.0.0.1:9391/wizard?mode=add
```
