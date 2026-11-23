# 调研 — 剩余 backlog 九步批次(module 族: remaining-backlog-20261122)

> 用户指令预授权实施全部未完成清单。跨仓/生产项编号受限,不伪造。

## 本仓实施

| Module | 内容 |
|---|---|
| t2-5-apps-admin | applications→ee;BFF 专属 admin 页→ee |
| t2-10-f1-notes | F1 验证手册 + 发版说明;④ 仍等 T4.2 |
| t3-2-chunk-img | 引用图点击预览源文档 |
| t3-4-i18n | ee 私有词条 overlay(zh/en) |
| t3-5-font | 字体语义 token |
| t3-6-sync | sync-upstream-web 机制(archive 方案) |
| oxlint-tighten | 裁决=不替换 eslint;修可安全 warning 或基线文档 |
| csl-toast | 会话加载 skip 全局 toast(若基建允许) |

## 受限(不实施代码)

| ID | 原因 |
|---|---|
| L-T42-01 | T4.2 M1+ / 写侧 prune 等 Gateway secrets |
| L-T41B | Phase C |
| L-T33 | 上游 Go pipeline API |
| L-T5 | Go 化长期 |
| L-09/10 | 生产 kubeconfig/首装 |
| L-CSL-01/03/04 | Gateway 数据/契约 |
