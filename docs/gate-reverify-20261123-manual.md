# 业务手册 — 执行三连闸门复证

> module: `gate-reverify-20261123`;日期:2026-11-23

## 1. 用户可见变更

**无。** 本批只复证闸门并提供探测脚本,不改变设置页/画布/生产集群行为。

## 2. 运维入口

| 操作 | 预期 |
|---|---|
| `npm run check:exec-gates` | 打印 L-T42-01 / L-09 / L-PHASEB-01;任一阻塞 → exit 1 |
| 可选设 `GATEWAY_BASE_URL` + `GATEWAY_AUTHORIZATION` | 额外 HTTP 探测 secrets 列表 |

## 3. 闸门打开后(本手册不实施)

见 [REPORT-gate-reverify-20261123.md](../tests/e2e-tests/reports/REPORT-gate-reverify-20261123.md) §5。
