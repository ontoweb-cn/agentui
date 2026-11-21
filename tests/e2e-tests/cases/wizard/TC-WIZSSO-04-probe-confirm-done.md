# TC-WIZSSO-04 — 探测 / 确认 / 完成(破坏性:含 setup)

截图目录:`tests/e2e-tests/results/wizard-sso/`
前置依赖:mock-upstream 9399 运行;**执行前备份 `bff/data/harness-backends.json`、`bff-tenants.json`、`token-vault.json`(L-04)**。
隔离声明:setup 用例数据一律 `e2e-` 前缀(R5);执行后停 BFF → 恢复备份 → 启 BFF → 健康验证(R3 清理)。
R6 现状口径:P2/P3 未实施前,X-03/X-04/X-08/X-09 相关断言 FAIL。

## TC-WIZSSO-04-01 探测失败与重试

| 项 | 内容 |
|---|---|
| 目的 | 失败原因可见、可重试(手册 §4) |
| 前置 | Step 3 填端点 `http://localhost:9999`(无服务) |
| 数据 | enterprise + 合法租户 ID |
| 优先级 | P0 |
| 关联手册 | §4 |
| 步骤 | 1. 下一步探测;2. 观察失败信息;3. 改端点为 mock 后重试 |
| 预期 | 失败显示原因;改后重试成功显示"后端可达" |
| 截图 | `TC-WIZSSO-04-01.png` |

## TC-WIZSSO-04-02 全流程至完成(X-03/X-04/X-08)

| 项 | 内容 |
|---|---|
| 目的 | 无 RAG 字段的 enterprise 全流程;envSnippet 正确;Done 有 RAG 提示 |
| 前置 | Step 3:endpoint=`http://localhost:9399`,tenantId=`e2e00000000000000000000000000001`,SSO 开启+白名单勾选 |
| 数据 | 名称 `e2e-wizard-sso` |
| 优先级 | P0 |
| 关联手册 | §4、§5、§6 |
| 步骤 | 1. 探测通过继续;2. 确认页核对摘要(无 RAG 行、有 SSO 行、密钥不回显);3. 创建;4. 观察 .env 片段与提示;5. 进入首页 |
| 预期 | .env 片段含 `HARNESS_E2E_WIZARD_SSO_TOKEN` 与 `BFF_SSO_ENABLED/PUBLIC_ORIGIN/STATE_SECRET=<占位>/PROVIDERS/SILENT_RELOGIN`;**无 RAG key 行**;Done 页出现"RAG 插件未配置…"提示 |
| 截图 | `TC-WIZSSO-04-02-confirm.png`、`TC-WIZSSO-04-02-done.png` |

## TC-WIZSSO-04-03 setup 副作用核验与数据恢复(L-04)

| 项 | 内容 |
|---|---|
| 目的 | 验证后端创建真实生效 + 恢复隔离 |
| 前置 | TC-04-02 完成 |
| 数据 | 无 |
| 优先级 | P0 |
| 关联手册 | §7 |
| 步骤 | 1. 管理端列表应见 `e2e-wizard-sso`;2. 停 BFF → 还原 3 个 json → 启 BFF;3. 管理端列表与登录页冒烟 |
| 预期 | 恢复后仅剩原有两个后端,登录页正常 |
| 截图 | `TC-WIZSSO-04-03.png` |

## TC-WIZSSO-04-04 名称重复 409(手册 §8)

| 项 | 内容 |
|---|---|
| 目的 | 已就绪同 id 拒绝重复创建 |
| 前置 | TC-04-02 未恢复前(或以 API 单测替代) |
| 数据 | 名称再次 `e2e-wizard-sso` |
| 优先级 | P2 |
| 关联手册 | §8 |
| 步骤 | 重跑 Step 5 创建 |
| 预期 | 提示"已存在且已就绪"(409) |
| 截图 | `TC-WIZSSO-04-04.png` |

## TC-WIZSSO-04-05 直达 step=5/6 的刷新回退

| 项 | 内容 |
|---|---|
| 目的 | 刷新场景状态机稳定(既有行为回归) |
| 前置 | TC-04-02 过程中在 Step 5 刷新 |
| 数据 | URL `?step=5&mode=add` |
| 优先级 | P1 |
| 关联手册 | §1 |
| 步骤 | 1. 刷新;2. 观察回退 |
| 预期 | 后端未配置时回退 Step 3 保留草稿(SSO 区块开关/白名单保留,密钥为空) |
| 截图 | `TC-WIZSSO-04-05.png` |
