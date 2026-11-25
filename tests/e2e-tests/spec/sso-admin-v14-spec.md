# Spec — sso-admin-v14（v1.4：向导 SSO 卡移除 + 管理页扩展）

日期:2026-11-25  
模块:`sso-admin-v14`  
设计真源:`docs/wizard-enterprise-sso-mode-design.md` **§11（设计）+ §12（评审:方向通过,R-1 吸收后定稿）**  
手册:`docs/wizard-ent-sso-mode-manual.md`（已改写为管理页口径）、`docs/wizard-manual.md`（4 卡）

## 1. 批准门（步骤 5）

- 用户指令链:「按这个方案执行，出 v1.4 设计草案（含决策反转记录、管理页扩展的交互稿、兼容策略、实施清单）」→ 草案交付 → 「对方案进行评审」→ §12 评审（方向通过，R-1 吸收）→ **「调用九步交付实施」**
- 授权口径:同 wizard-ent-sso-mode 先例——设计+评审已认可，调用九步交付 = 门后连续执行步骤 6–9，不再中途确认。

## 2. 修复范围（步骤 6）

| 层 | 文件 | 动作 |
|---|---|---|
| BFF | `services/enterprise-sso-check.ts` | 新增:SSO 前置检测抽离（R-2） |
| BFF | `routes/wizard.ts` | 选项表删 SSO 卡；`getWizardOption` R-1 回退；deprecated 分支标注；probe 兼容保留 |
| BFF | `routes/sso-admin.ts` | view 扩展（`stateSecretStatus` 三态/`boundBackend`/`?check=1`）；新增 `GET /admin/sso/providers`；PUT 启用守卫（R-3） |
| BFF | `types/wizard.ts` | `setupProfile` 标 deprecated（保留） |
| FE | `ee/pages/wizard/index.tsx` | 单卡重写（保留 memo/条件写回修复）；企业完成页指引；旧草稿剥离 sso/setupProfile |
| FE | `ee/pages/wizard/sso-section.tsx` | 删除（能力迁移管理页） |
| FE | `ee/pages/sso-settings/index.tsx` | 扩展:前置状态卡/渠道预览勾选/启用守卫/三态密钥/验证指引 |
| FE | `services/sso-admin-service.ts`、`utils/api.ts` | view 扩展 + `GET /admin/sso/providers` |
| FE | `ee/locales/{zh,en}-private.ts` | wizard 键收敛 + `admin.ssoSettings.*` 新增 |
| 兼容 | — | v0.4.9 旧 UI + 新 BFF:deprecated enterprise-sso setup/probe 仍 200（R-1 回退） |

## 3. 取舍

| 项 | 决定 |
|---|---|
| stateSecret | 仍部署级（管理页三态提示，永不回显/不落盘） |
| 租户口径 | 管理页面向默认租户 '0'（与登录页一致）；多后端不支持 |
| 老向导 locale 键 | 当版一次清理；管理页复用键迁 `admin.ssoSettings.*` |

## 4. 步骤 6–9 执行记录

| 步 | 状态 | 证据 |
|---|---|---|
| 6 实施 | 完成 | 见 §2；`git status` 变更面 |
| 7 构建健康 | 完成 | Node 20.20.2:宿主 type-check 0 错；BFF tsc 0 错 |
| 8 回归 | 完成 | 宿主 jest **66 套件/807 用例**全过（新增 sso-settings 4 例、wizard-modes 重写 4 例）；BFF vitest **71 文件/1268 用例**全过（wizard 81 + sso-admin 20，含 R-1 回归 W-R1、V-01~06、W-P01~10） |
| 9 报告 | 完成 | `tests/e2e-tests/reports/REPORT-sso-admin-v14-20261125.md` |

## 5. 受限与遗留

| ID | 说明 |
|---|---|
| L-V14-01 | 浏览器端 e2e（管理页真实网关启用 → 登录页渠道）未执行;用例 TC-SOA-03 为人工/后续联调项 |
| L-V14-02 | ArgoCD/Jenkins 集群→gitee 链路退化（同日另案）与本模块无关但影响发版,待平台侧修复 |
| L-V14-03 | `setupProfile` 兼容分支计划下一版删除 |

## 6. 用例

- TC-WED-01～04:已按 v1.4 重写（4 卡/单一企业流程/兼容契约/确认完成无 SSO 内容）
- TC-SOA-01～04（新增）:见 `cases/sso-admin-v14/`
