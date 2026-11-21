# TC-WIZSSO-01 — 向导入口与类型选择

截图目录:`tests/e2e-tests/results/wizard-sso/`
前置依赖:Vite 9391 运行;BFF 9390 运行(现有就绪后端,needsSetup=false)。
隔离声明:本组只读浏览(R3);URL 仅带查询参数(R5);无原生弹窗。
R6 现状口径:无。

## TC-WIZSSO-01-01 直达入口 mode=add

| 项 | 内容 |
|---|---|
| 目的 | 已有后端时仍可从管理端语境进入向导(手册 §1) |
| 前置 | BFF 就绪后端存在 |
| 数据 | URL `http://localhost:9391/wizard?mode=add` |
| 优先级 | P0 |
| 关联手册 | §1 |
| 步骤 | 1. 打开该 URL;2. 观察页面 |
| 预期 | 显示 6 步步骤条与欢迎页;不被重定向走 |
| 截图 | `TC-WIZSSO-01-01.png` |

## TC-WIZSSO-01-02 类型列表为 4 类(无 KAG)

| 项 | 内容 |
|---|---|
| 目的 | X-01:KAG 从类型选择中移除 |
| 前置 | 进入 Step 2 |
| 数据 | 无 |
| 优先级 | P0 |
| 关联手册 | §2 |
| 步骤 | 1. 欢迎页点"开始配置";2. 观察类型卡片列表 |
| 预期 | 恰好 4 张卡片:Intellect Enterprise / Intellect Community / HERMES / AgentScope;无 KAG;未选择时"下一步"禁用 |
| 截图 | `TC-WIZSSO-01-02.png` |

## TC-WIZSSO-01-03 选择类型联动默认端点与徽章

| 项 | 内容 |
|---|---|
| 目的 | 选择类型自动填默认端点(手册 §3.1) |
| 前置 | Step 2 |
| 数据 | 依次点选 4 类 |
| 优先级 | P1 |
| 关联手册 | §2、§3.1 |
| 步骤 | 1. 点选 Intellect Enterprise;2. 下一步 |
| 预期 | Enterprise 卡片带画布/知识库/多租户/模型管理徽章;进入 Step 3 端点预填 `http://localhost:9091` |
| 截图 | `TC-WIZSSO-01-03.png` |
