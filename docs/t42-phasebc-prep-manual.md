# 业务手册 — T4.2 契约准备 / Phase B·C 前端对齐 / 清单 v9

> module: `t42-phasebc-prep`;日期:2026-11-23
> 读者:对接 Gateway / Go 画布 / 运维的研发与测试

## 1. 本批用户可见变更

**无。** 本批不改变设置页、分享页、画布运行、生产集群行为。交付为文档与清单对齐。

## 2. 能力说明(文档面)

### 2.1 联网搜索密钥(T4.2)

| 入口 | 操作 | 预期 |
|---|---|---|
| 设置页保存联网 Key | 与今日相同(明文进 `prompt_config`) | **不变**;待 Gateway secrets 上线后改为「已配置/重新输入」 |
| 分享页 | 打开分享对话 | 仍只见是否联网,不见 Key |
| Gateway 评审 | 阅读契约草案 | 可按 PUT/GET/DELETE secrets 实现 |

错误路径(落地后才适用):缺 Key 保存 → 仍 400;无 secrets 时禁用写侧剥 Key(防丢数据)。

### 2.2 画布 Go 化准备(Phase B)

| 入口 | 操作 | 预期(准备口径) |
|---|---|---|
| 画布运行 | 发消息 / 停任务 / 用户填表 | 今日 Python/SSE 行为不变 |
| 对接 Go 后 | 收到 `waiting_for_user` | 应对齐填表 UI(见准备文档差距表) |

### 2.3 生产 D1

| 入口 | 操作 | 预期 |
|---|---|---|
| 运维按决策简报改 Deployment | 配 `INTELLECT_TEAM_API_URL` + 首装 + flag | 本环境**无法执行**;手册已有 |

## 3. 相关文档

- [web-search-secrets-gateway-api-contract.md](./web-search-secrets-gateway-api-contract.md)
- [phase-bc-frontend-alignment-prep.md](./phase-bc-frontend-alignment-prep.md)
- [web-search-secret-storage-design.md](./web-search-secret-storage-design.md)
- [model-mgmt-d1-d2-decision-brief.md](./model-mgmt-d1-d2-decision-brief.md)
- [ragflow-ui-alignment-followup-tasks.md](./ragflow-ui-alignment-followup-tasks.md)(v9)
