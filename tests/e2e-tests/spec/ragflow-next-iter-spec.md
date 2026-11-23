# Spec 批准门 — module: ragflow-next-iter

> 用户预授权连续执行至完成。

## 范围

| 纳入 | 不纳入 |
|---|---|
| T2.6 oxlint 并行接入 | 替换/移除 eslint |
| T2.5 二步:仅 `pages/tasks` → `ee/pages/tasks` | aihub / applications 全量迁入 |
| T4.2 设计文档 | 密钥迁移生产代码、写侧 prune 落地 |

## 修复方案

1. `npm i -D oxlint` + `.oxlintrc.json` + lint 脚本串行
2. `git mv` tasks + manifest 两处 import + 文件头注释
3. 新文档 `docs/web-search-secret-storage-design.md`

## 报告

`tests/e2e-tests/reports/REPORT-ragflow-next-iter-20261122.md`
