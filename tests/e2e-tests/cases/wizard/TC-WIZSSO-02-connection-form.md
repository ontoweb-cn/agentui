# TC-WIZSSO-02 — 连接信息表单(通用 + 企业版)

截图目录:`tests/e2e-tests/results/wizard-sso/`
前置依赖:已进入 Step 3 且选中 Intellect Enterprise;mock-upstream 9399 运行(后续探测用)。
隔离声明:表单输入不提交(setup 提交在 TC-04,含备份/恢复)(R3);无原生弹窗。
R6 现状口径:P1/P3 未实施前,「RAG 字段不存在」「无 KAG」用例预期为 FAIL,登记 X-01/X-03。

## TC-WIZSSO-02-01 通用字段必填校验

| 项 | 内容 |
|---|---|
| 目的 | 名称/端点/凭据为空时不能下一步(手册 §3.1) |
| 前置 | Step 3(enterprise) |
| 数据 | 名称空/端点空/Token 空 |
| 优先级 | P0 |
| 关联手册 | §3.1 |
| 步骤 | 1. 清空各字段;2. 观察按钮 |
| 预期 | "探测连接"禁用;逐项填入后启用 |
| 截图 | `TC-WIZSSO-02-01.png` |

## TC-WIZSSO-02-02 企业版租户 ID 校验

| 项 | 内容 |
|---|---|
| 目的 | 32 位 hex 强校验(手册 §3.2) |
| 前置 | Step 3(enterprise) |
| 数据 | 依次:`空`、`xyz`、`e2e00000000000000000000000000001` |
| 优先级 | P0 |
| 关联手册 | §3.2 |
| 步骤 | 1. 分别输入三个值;2. 观察提示与按钮 |
| 预期 | 空/非法:红字"必须为 32 位 hex"且按钮禁用;合法:无红字、按钮可用 |
| 截图 | `TC-WIZSSO-02-02.png` |

## TC-WIZSSO-02-03 RAG 插件字段不再出现(X-03)

| 项 | 内容 |
|---|---|
| 目的 | 向导不再收集 ragEndpoint/ragApiKey |
| 前置 | Step 3(enterprise) |
| 数据 | 无 |
| 优先级 | P0 |
| 关联手册 | §3.2 |
| 步骤 | 1. 检查整个表单 |
| 预期 | 无「RAG plugin endpoint」「RAG API key」输入框;仅 名称/端点/Token/租户 ID/SSO 区块 |
| 截图 | `TC-WIZSSO-02-03.png` |

## TC-WIZSSO-02-04 非企业类型无 SSO 区块

| 项 | 内容 |
|---|---|
| 目的 | SSO 区块仅 enterprise 显示(手册 §3.3) |
| 前置 | 返回 Step 2 切换 HERMES 后再进 Step 3 |
| 数据 | 无 |
| 优先级 | P1 |
| 关联手册 | §3.3 |
| 步骤 | 1. 观察 Step 3 表单 |
| 预期 | 无 SSO 区块;凭据字段为 Bearer Token |
| 截图 | `TC-WIZSSO-02-04.png` |
