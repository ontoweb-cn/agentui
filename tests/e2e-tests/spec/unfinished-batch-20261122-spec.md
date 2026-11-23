# Spec — 未完成任务链批次(批准门)

> 日期:2026-11-22;**批准门:用户指示「调用九步交付技能执行“本地 chat 加载修复提交 → T4.1a → T2.5 第二步 / T2.6 → 生产 D1 + 首装 → T3 / T4.2 / T5”」(预先授权)**,依据九步交付法「批准后连续执行至全部完成,不再中途确认」条款推进。  
> 调研:[unfinished-batch-20261122-research.md](../outline/unfinished-batch-20261122-research.md)

## 一、Module 与退出条件

| # | Module | 退出条件 |
|---|---|---|
| 1 | `chat-session-load` | 修复合入;`bff-agents` 404 误判用例绿;前端 type-check 绿;报告归档;上游 500/脏列表登记受限 |
| 2 | `t4-1a-web-search` | BFF/前端侧聚合或透传策略落地或明确 Gateway 缺口 + 用例;存储过滤本仓部分或设计落点 |
| 3 | `t2-ee-oxlint` | 至少再迁 1 个 ee 模块**或**记录选型跳过理由;oxlint 并行接入或基线化 |
| 4 | `prod-d1-setup` | 执行面清单复核;无 kubeconfig 则 L-09/L-10 受限,不伪造落地 |
| 5 | `t3-p2` / `t4-2-secrets` / `t5-go` | 按优先级启动可做项;长期项出设计/立项摘要 |

## 二、明确不伪造

- Gateway session detail 500 根因修复(属后端数据/契约)  
- 生产 Deployment env 变更与向导首装(需集群权限与现网凭据)  
- T5 Go 化全量移植  

## 三、产物索引

`tests/e2e-tests/{outline,cases,spec,reports}/<module>-*`；总报告可在各 module 报告末链回本 spec。
