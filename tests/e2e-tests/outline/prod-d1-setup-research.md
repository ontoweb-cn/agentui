# 调研 — 生产 D1 + 首装(module: prod-d1-setup)

> 2026-11-22。依据 [model-mgmt-d1-d2-decision-brief.md](../../../docs/model-mgmt-d1-d2-decision-brief.md)。

## 执行面

| 步骤 | 内容 | 本环境 |
|---|---|---|
| 0 | 生产 BFF 向导首装(enterprise+RAG+租户) | **L-10**:needsSetup/community,需现网凭据 |
| 1 | D1:`INTELLECT_TEAM_API_URL` 配到 intellect-rag Deployment | **L-09**:无 kubeconfig/跨 ns RBAC |
| 2 | `BFF_MODEL_MGMT_SERVICE_TOKEN=true` | 依赖 0+1 |
| 3 | 验收四 GET / 非 admin 写 403 | 同上 |

**结论**:代码与运维手册已齐;本 agent 会话**无法执行**集群变更。不伪造落地。
