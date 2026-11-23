# 测试大纲 — module: ragflow-next-iter

> 日期:2026-11-22;步骤 3+4

## 步骤 3 差异清单

| # | 手册/清单口径 | 现状 | 处置 |
|---|---|---|---|
| D1 | lint 含 oxlint | 仅 eslint | **必修** T2.6 |
| D2 | tasks 在 ee overlay | 仍在 pages/tasks | **必修** T2.5 二步 |
| D3 | T4.2 设计文档存在 | 仅任务条目 | **必修** 设计文档 |
| D4 | `/tasks` 行为不变 | — | 回归 jest + import 零残留 |

## 用例矩阵

| 用例 | 层级 | 目的 |
|---|---|---|
| TC-NI-01 | 脚本 | `npx oxlint src` 退出 0 且耗时 < 5s |
| TC-NI-02 | 脚本 | `npm run lint` 同时跑 eslint+oxlint |
| TC-NI-03 | 静态 | `rg '@/pages/tasks'` 零命中(除历史 docs/报告可残留) |
| TC-NI-04 | jest | `src/ee/pages/tasks/__tests__` 全绿 |
| TC-NI-05 | tsc | type-check 三守卫绿 |
| TC-NI-06 | 文档 | T4.2 设计含:现状/方案对比/推荐/迁移阶段/承接 ④/验收 |
| TC-NI-07 | E2E | `/tasks` 真浏览器冒烟 | **受限 L-NI-01** |
