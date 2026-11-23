# 测试大纲 — module: ragflow-v7-batch

## 差异清单

| # | 口径 | 现状 | 处置 |
|---|---|---|---|
| D1 | applications 在 ee | 仍在 features/.../pages | 必修迁入 |
| D2 | total↔files 交叉校验 | 无 | 必修 T3.7 |
| D3 | --prune | 无 | 必修 |

## 用例

| ID | 层级 | 预期 |
|---|---|---|
| TC-V7-01 | 静态 | `@/features/applications/pages` 零引用;挂载 `@/ee/pages/applications` |
| TC-V7-02 | jest | feature-registry 测试绿 |
| TC-V7-03 | 脚本 | check-color-tokens 绿;篡改 total 可失败(逻辑测) |
| TC-V7-04 | 脚本 | --prune 去掉已 clean 条目并重算 total |
| TC-V7-05 | tsc | type-check 绿 |
| TC-V7-06 | E2E | /applications 冒烟 | **L-V7-01** |
