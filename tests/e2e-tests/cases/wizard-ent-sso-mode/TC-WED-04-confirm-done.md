# TC-WED-04 — 确认与完成页

## TC-WED-04-01 SSO 模式摘要与待写入提示

| 项 | 内容 |
|---|---|
| 目的 | 手册 §4 / §8 R8 |
| 优先级 | P0 |
| 步骤 | SSO 模式走完到确认/完成（可用 mock upstream；破坏性需备份） |
| 预期 | 确认有 SSO 摘要且无密钥明文；完成有 `BFF_SSO_*` snippet +「待写入环境变量/重启前无渠道」类提示 |

## TC-WED-04-02 非 SSO 无 SSO snippet

| 项 | 内容 |
|---|---|
| 目的 | 手册 §4 |
| 优先级 | P0 |
| 步骤 | 非 SSO 模式完成 |
| 预期 | envSnippet 无 `BFF_SSO_ENABLED` 行 |
