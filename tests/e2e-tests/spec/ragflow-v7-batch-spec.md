# Spec — module: ragflow-v7-batch

> 用户预授权连续执行。

## 范围
纳入:T2.5 applications→ee;T3.7 color-tokens 一致性+`--prune`
不纳入:aihub、T4.2 M1、D1、T3.5

## 方案
1. git mv application-list + manifest import + ee 头注释
2. check-color-tokens: sum(files)===total 校验;`--prune` 清理已 clean 条目

## 报告
`tests/e2e-tests/reports/REPORT-ragflow-v7-batch-20261122.md`
