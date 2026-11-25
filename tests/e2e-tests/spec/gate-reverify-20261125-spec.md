# Spec — gate-reverify-20261125

批准门:用户「调用九步交付继续实施」(预授权)。范围=闸门复验 + 本仓非接线增量。

| 约束 | 口径 |
|---|---|
| W1 | gates BLOCK → 禁止 prune / live SSE |
| W2 | 交付复验报告;oxlint 可修非 ui 项 |
| W3 | 清单注明复验日;不伪造 OPEN |

门禁:`check:exec-gates` exit 1(期望 BLOCK);相关 jest 绿;`tsc` 不因本批变红。
