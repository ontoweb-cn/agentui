# TC-WED-01 — 类型选择双企业卡

截图目录:`tests/e2e-tests/results/wizard-ent-sso-mode/`  
前置:Vite 9391 + BFF 9390；`/wizard?mode=add`  
隔离:只读浏览(R3)；R5 无写库  
R6:若 UI 自动化不可达，以 `GET /admin/wizard/backend-types` + 源码检视记受限

## TC-WED-01-01 五卡顺序

| 项 | 内容 |
|---|---|
| 目的 | 手册 §3.1：五卡且首卡企业版（SSO模式） |
| 优先级 | P0 |
| 步骤 | 1. 打开 `/wizard?mode=add` 到选择类型；2. 记录卡片文案顺序 |
| 预期 | 顺序：企业版（SSO模式）→ 企业版（非SSO模式）→ Community → HERMES → AgentScope |
| 截图 | `TC-WED-01-01.png` |

## TC-WED-01-02 双卡分别选中

| 项 | 内容 |
|---|---|
| 目的 | §8 R1：optionId 主键，点一张只亮一张 |
| 优先级 | P0 |
| 步骤 | 1. 点首卡；2. 点次卡；3. 观察选中态 |
| 预期 | 每次仅一张高亮；下一步可用 |
| 截图 | `TC-WED-01-02.png` |

## TC-WED-01-03 文案/徽章可区分

| 项 | 内容 |
|---|---|
| 目的 | 手册 §3.1 / §8 R3 |
| 优先级 | P1 |
| 步骤 | 对比两张企业卡标题与徽章 |
| 预期 | 可见 SSO vs 密码差异；不只显示相同 `intellect-enterprise` 代码而无区分 |
| 截图 | `TC-WED-01-03.png` |
