# 业务手册 — 执行三连闸门(t42-m1 / D1 / Phase B SSE)

> module: `exec-triad-20261123`;日期:2026-11-23

## 1. 本批用户可见变更

**无生产行为变更。** 三项闸门前置均未满足;交付探测客户端、SSE 映射预备模块与受限归档。

## 2. 能力口径

| 能力 | 入口 | 今日预期 | 闸门打开后 |
|---|---|---|---|
| 联网 Key 独立存储 | 设置页保存 | 仍整包明文进 PC | Gateway secrets + 设置页「已配置」 |
| 生产 D1 | 运维 kubectl | 本环境无法执行 | RAG 配 `INTELLECT_TEAM_API_URL` + 首装 + flag |
| Go 画布 SSE | 画布运行 | 仍走 Python/RAGFlow 事件 | BFF/前端映射 `waiting_for_user`/`done` |

## 3. 错误 / 受限路径

- Gateway secrets 404 → 保持 L-T42-01,禁止 PATCH prune
- 无 kubectl → L-09;未首装 → L-10
- Go StreamAgent 未作可探测上游 → L-PHASEB-01,映射器未接线 live 路径
