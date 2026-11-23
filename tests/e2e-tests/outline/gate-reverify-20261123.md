# 测试大纲 — gate-reverify-20261123

| # | 场景 | 预期 |
|---|---|---|
| 1 | `npm run check:exec-gates` | exit 1;含 L-T42-01、L-09、L-PHASEB-01 |
| 2 | grep sanitize 于 PATCH | 未调用 |
| 3 | grep mapGo 于 parse-canvas | 无引用 |
| 4 | 清单 v9.3 声明闸门未关 | 是 |
