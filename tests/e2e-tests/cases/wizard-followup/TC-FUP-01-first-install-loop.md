# TC-FUP-01 — 首装模式全流程 E2E(A2,破坏性)

截图目录:`tests/e2e-tests/results/wizard-sso-followup/`
前置依赖:Vite 9391 + mock-upstream 9399 运行;**BFF 已停且 `bff/data/{harness-backends,token-vault,bff-tenants}.json` 已移走**(备份:`results/wizard-sso/data-backup/` 与 `fixtures/wizard/backup*/`)。
隔离声明(R3/L-04):全程数据变更限于移走的文件;结束后停 BFF → 还原 3 文件(+删除可能生成的 `.bootstrap-token`)→ 重启 → 健康验证 + 管理端/登录页冒烟。
R6 现状口径:无(该流程不依赖 admin 会话)。

## TC-FUP-01-01 首装重定向

| 项 | 内容 |
|---|---|
| 目的 | 无后端时访问 `/` 被 WizardGuard 引导入向导 |
| 步骤 | 1. 打开 `http://localhost:9391/` |
| 预期 | 落地 `/wizard`(无 mode),Step 1 欢迎页 |
| 截图 | `TC-FUP-01-01.png` |

## TC-FUP-01-02 六步全流程(hermes 快路径)

| 项 | 内容 |
|---|---|
| 目的 | 免鉴权完成 setup → Done(手册 §1-§6) |
| 数据 | 名称 `e2e-fup-hermes`;端点 `http://localhost:9399`;token `e2e-token` |
| 步骤 | 1. 开始→选 HERMES→填连接→探测(可达)→确认→创建 |
| 预期 | envSnippet 含 `HARNESS_E2E_FUP_HERMES_TOKEN`;Done 无 RAG/SSO 提示(非 enterprise);跳首页不被弹回 |
| 截图 | `TC-FUP-01-02-confirm.png`、`TC-FUP-01-02-done.png` |

## TC-FUP-01-03 enterprise + SSO 首装(核心新流程)

| 项 | 内容 |
|---|---|
| 目的 | 首装场景下 SSO 区块全链路(手册 §3.3/§5) |
| 数据 | 名称 `e2e-fup-ent`;端点 9399;租户 `e2e00000000000000000000000000001`;SSO 开启+白名单勾选 intellect-auth |
| 步骤 | 全流程至 Done |
| 预期 | envSnippet 追加 `BFF_SSO_*` 五行且 secret 占位;Done 出现「RAG 插件未配置」提示;`bff/data/.bootstrap-token` 已被消费删除 |
| 截图 | `TC-FUP-01-03-confirm.png`、`TC-FUP-01-03-done.png` |

## TC-FUP-01-04 恢复与原状验证

| 步骤 | 停 BFF → 还原 3 文件(含清理 `.bootstrap-token`)→ 启 BFF → `/` 登录页可达;`harness-backends.json` 与备份哈希一致 |
|---|---|
| 截图 | `TC-FUP-01-04.png` |
