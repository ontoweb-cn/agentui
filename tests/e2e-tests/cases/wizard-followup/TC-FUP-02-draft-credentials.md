# TC-FUP-02 — 草稿凭据会话化(A5)

截图目录:`tests/e2e-tests/results/wizard-sso-followup/`
前置依赖:Vite 9391;向导 `/wizard?mode=add` Step 3(enterprise)。
隔离声明:只读写本地存储与表单,不提交(R3)。

## TC-FUP-02-01 刷新后凭据保留(会话内)

| 项 | 内容 |
|---|---|
| 步骤 | 1. 填 token `e2e-secret-x`;2. F5 刷新回 Step 3 |
| 预期 | token 仍在(来自 sessionStorage);localStorage `wizard-draft` 中**不含** token/email/password 字段值 |
| 证据 | 截图 + `localStorage.getItem('wizard-draft')` 内容快照(只读检查,诊断性) |

## TC-FUP-02-02 非敏感字段仍持久化

| 步骤 | 填 publicOrigin/白名单 → 刷新 |
|---|---|
| 预期 | localStorage `wizard-draft` 含 sso 配置;sessionStorage 凭据保留 |

## TC-FUP-02-03 清理时机

| 步骤 | 完成或离开向导后 |
|---|---|
| 预期 | clearDraft 同时清除 localStorage 草稿与 sessionStorage 凭据(代码级断言 + L2 单测覆盖) |
