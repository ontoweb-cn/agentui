# 调研笔记 — 向导企业双模式（module: wizard-ent-sso-mode）

日期:2026-11-23  
设计真源:`docs/wizard-enterprise-sso-mode-design.md` v1.1（含 §8 评审）  
关联现状:`docs/auth-intellect-auth-to-team-flow-status.md` W1/W2；旧交付 `wizard-sso` / `wizard-kag-to-sso-design.md`（D2 已废止）

## 1. 代码域定位

### 前端

| 文件 | 角色 | 与本模块关系 |
|---|---|---|
| `src/ee/pages/wizard/index.tsx` | 六步状态机；`selectedType` 作 Radio key；enterprise 时嵌套 `SsoSection`（可关） | **主改**：`optionId` 选型、双卡分支、草稿迁移 |
| `src/ee/pages/wizard/sso-section.tsx` | SSO 区块；启用开关默认可跳过 | **主改**：SSO 卡锁定启用、去「可跳过」主文案 |
| `src/services/wizard-service.ts` | `WizardBackendTypeOption` / setup 契约 | 增 `optionId`、`setupProfile` |
| `src/wrappers/wizard-guard.tsx` | `needsSetup` 守卫 | 不动（入口仍 `/wizard` / `?mode=add`） |
| ee/locales 或 `zh`/`en` `wizard.*` | 类型卡文案 | 按 `optionId` i18n（§8 R7） |

### BFF

| 文件 | 角色 | 与本模块关系 |
|---|---|---|
| `bff/src/routes/wizard.ts` | `BACKEND_TYPE_OPTIONS` 现 **4** 卡（单张 enterprise）；setup 仅 `type`+可选 `sso.enabled` | **主改**：5 卡、`optionId`、profile 校验、envSnippet |
| `bff/src/types/wizard.ts` | DTO | 增字段 |
| `bff/src/routes/wizard.test.ts` | 选项数/SSO 用例 | 改 5 卡 + profile 矩阵 |
| `bff/src/middleware/auth.ts` | wizard 公开前缀 | 无改；注意见 §2 路径 |

### 运行时（不动）

- `BackendType` / `authMode` 仍仅 `intellect-enterprise`；不新增 authMode。
- 登录页密码+渠道并存（§8 R10）；SSO 是否生效看 env。

## 2. 真实运行库（本机 2026-11-23）

| 项 | 值 |
|---|---|
| 前端 | Vite `http://127.0.0.1:9391`（`/wizard` 200） |
| BFF | `http://127.0.0.1:9390`；数据 `bff/data/` |
| 直连公开口 | `GET /admin/wizard/status` → 200 `needsSetup:false, backendCount:1` |
| 带前缀口 | `GET /api/bff/admin/wizard/*` → **401**（middleware 按无前缀 path 匹配；Vite 代理应剥 `/api/bff`） |
| `backend-types`（直连，步骤 5 基线） | 当时 4 options，无 `optionId` |
| `backend-types`（步骤 8 回归） | **5** options：`enterprise-sso` → `enterprise-password` → community → hermes → agent-scope（见 `results/.../TC-WED-03-01-after.json`） |
| 向导入口 | 已首装 → 用 `/wizard?mode=add`（只读浏览选型；破坏性 setup 须备份 json） |

## 3. 现状 vs 目标（缺陷预登记）

| ID | 现状 | 目标（设计） |
|---|---|---|
| F-WED-01 | 单张 Enterprise 卡 | 首卡「企业版（SSO模式）」+ 次卡「企业版（非SSO模式）」 |
| F-WED-02 | Radio/`key`/`find` 用 `type` | `optionId` 主键（§8 R1/R2） |
| F-WED-03 | SSO 内嵌可跳过 | SSO 卡强制配置面；非 SSO 卡不渲染 |
| F-WED-04 | setup 无 `setupProfile` | profile 校验 + 缺省兼容非 SSO+warning（R5） |
| F-WED-05 | TC-WIZSSO-01 期望 4 卡 | 5 卡顺序断言（R11） |

## 4. 上游与夹具

- 复用 `tests/e2e-tests/fixtures/wizard/mock-upstream.mjs`（tenant/info + oauth/providers）。
- 本模块新增夹具目录 `fixtures/wizard-ent-sso-mode/`（如需独立 mock 配置说明）；破坏性 setup 沿用 wizard-sso 备份约定。

## 5. 构建/回归口令

```bash
# BFF
cd bff && npx vitest run src/routes/wizard.test.ts && npx tsc --noEmit
# 前端
npx tsc --noEmit
# 手工/浏览器：http://127.0.0.1:9391/wizard?mode=add
```
