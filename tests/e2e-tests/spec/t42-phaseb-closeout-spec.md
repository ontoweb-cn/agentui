# Spec — t42-phaseb-closeout

> 2026-11-26。用户要求按九步交付实施 T4.2 与 L-PHASEB-01,视为批准本 spec 的可执行范围,不中途再确认。

## 缺陷

| ID | 现象 | 根因 |
|---|---|---|
| D-01 | 画布收不到 Go 的填表/结束/取消/错误 | `useSendMessageBySSE` 原样推进 JSON,适配器未调用 |
| D-02 | 走 RAG 解析器的流丢掉 Go 事件,`answer` 变空文本 | `parseCanvasWorkflowSSE` default 返回空 |
| D-03 | 留空保存仍把空密钥字段放进 PATCH | enterprise `updateSession` 原样转发 |

## 修复(本仓库)

1. `adaptCanvasLiveSsePayload` 接到 `useSendMessageBySSE`。Python 事件透传。
2. `parseCanvasWorkflowSSE` 对 `waiting_for_user` / `error` / `done` / `cancelled` 调用已有映射;`message` 在没有 `content` 时读 `answer`。
3. 空白 provider key 在 PATCH 前去掉。非空 key 留给 Gateway 同一次 PATCH 入库并剥离。BFF 不单独 PUT。
4. live SSE 在已经收到 `workflow_finished` 之后忽略尾部 `done`。

## 不做(R6,不标完成)

- M2 生产回填(L-09)
- M4 主密钥轮换(Rust 仓库不在本机)
- 真实搜索供应商
- 真实浏览器里跑 Go 画布,以及「停止后 ≤5 秒节点停」
- 把聊天取消和画布取消并成一个语义

## 归档

- 手册 `docs/t42-phaseb-closeout-manual.md`
- 报告 `tests/e2e-tests/reports/REPORT-t42-phaseb-closeout-20261126.md`
- 清单 `docs/ragflow-ui-alignment-followup-tasks.md` v9.12
