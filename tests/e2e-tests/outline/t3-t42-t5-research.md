# 调研 — T3 / T4.2 / T5(module: t3-t42-t5)

> 2026-11-22。本批不启动长周期实现,只锁定状态与下一刀落点。

## T3 P2

| ID | 依赖 | 建议下一刀 |
|---|---|---|
| T3.1 虚拟滚动 | 新依赖 `@tanstack/react-virtual` | 可独立开工 |
| T3.2 chunk 预览 | 既有文件服务 | 可独立 |
| T3.3 builtin-pipeline | 上游 Go API | 阻塞 Phase C |
| T3.4 i18n overlay | T2.5 | wizard/tasks 已 ee,可启动 zh/en |
| T3.5 字体 token | 无 | 可独立 |
| T3.6 上游同步机制 | T2.5 | 选型试跑 |
| T3.7 color-tokens 增强 | 无 | 可独立(type-check 已提示 wizard 可 --update) |

## T4.2

密钥独立存储:设计任务,输入 Phase A/B 数据模型。本仓仅出评估提纲,不在 Python fork 一次性改造。

## T5 Go 化

Phase A–D 属 intellect-rag / 上游,人月级。agentui 侧前端对齐挂在 Phase B 事件契约之后。本批 **L-T5-01** 立项外置。
