# TC-WED-01 — 类型选择（v1.4:单张企业卡）

截图目录:`tests/e2e-tests/results/wizard-ent-sso-mode/`  
前置:Vite 9391 + BFF 9390；`/wizard`（或 `/wizard?mode=add`）  
**v1.4 修订（2026-11-25，设计 §11）**：4 卡单企业卡；SSO 卡移除（SSO 配置移交管理页）

## TC-WED-01-01 四卡顺序

| 项 | 内容 |
|---|---|
| 目的 | 设计 §11.2 |
| 优先级 | P0 |
| 步骤 | 打开向导到选择类型；记录卡片顺序 |
| 预期 | Intellect Enterprise → Community → HERMES → AgentScope；无 SSO 卡；全部展示默认端点 |
| 自动化 | BFF backend-types 4 卡断言；前端 wizard-modes「选型页」 |

## TC-WED-01-02 企业卡说明不含 SSO

| 项 | 内容 |
|---|---|
| 目的 | 设计 §11.1（D2 延续） |
| 优先级 | P1 |
| 步骤 | 检视企业卡说明文案与 BFF description |
| 预期 | 只讲"团队/项目 + 多租户;成员账号密码登录"，无 SSO 字样 |
| 自动化 | wizard.test.ts「v1.4: 单一企业卡说明…」 |
