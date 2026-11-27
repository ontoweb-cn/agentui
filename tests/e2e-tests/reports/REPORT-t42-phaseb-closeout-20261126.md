# 报告 — t42-phaseb-closeout

> 日期:2026-11-26。模块:T4.2 密钥保存(agentui 侧)+ Phase B 画布事件接线。
> 手册:[docs/t42-phaseb-closeout-manual.md](../../../docs/t42-phaseb-closeout-manual.md)
> Spec:[../spec/t42-phaseb-closeout-spec.md](../spec/t42-phaseb-closeout-spec.md)

## 1. 结论摘要

| 缺陷 | 修复 | 验收 |
|---|---|---|
| D-01 画布 live 不认 Go 事件 | `adaptCanvasLiveSsePayload` 接到 `useSendMessageBySSE` | jest 16 通过,含 TC-TPB-01–05 |
| D-02 BFF 解析器丢掉 Go 事件 | `parseCanvasWorkflowSSE` 调用已有映射,`answer` 补进 `content` | vitest 解析器 14 通过 |
| D-03 留空保存仍提交空密钥字段 | PATCH 前 `omitBlankWebSearchApiKeys`;非空 key 仍一次 PATCH,不另 PUT | adapter 测试 TC-TPB-07/08 |
| D-04 尾部 `done` 会再结束一轮 | 已见 `workflow_finished` 时忽略 `done` | jest `ignores trailing done` |

T4.2 **没有整项关闭**。M2 生产回填、M4 主密钥、真实供应商、真实浏览器仍受限。

## 2. 用例结果

| 组 | 例 | 结果 | 说明 |
|---|---|---|---|
| 画布映射 | TC-TPB-01–05 | PASS | `npx jest src/utils/go-canvas-sse-adapter.test.ts` 16/16(含尾部 done) |
| BFF 解析 | TC-TPB-06 | PASS | `parse-canvas-workflow-sse.test.ts` 14/14 |
| 密钥 PATCH | TC-TPB-07/08 | PASS | enterprise adapter 50/50;校验纯函数 23/23。评审后复跑 |
| 真实 UI | — | 未执行 | 见 R6 |

另:BFF `tsc --noEmit` 通过;前端 `tsc --noEmit` 通过。保存回填函数的参数类型与画布 store 不一致,补了泛型断言,行为不变。

## 3. 交付物

| 类 | 路径 |
|---|---|
| 画布 live | `src/utils/go-canvas-sse-adapter.ts`、`src/hooks/use-send-message.ts`、`src/hooks/message-event-type.ts` |
| BFF 解析 | `bff/src/services/adapters/intellect-rag/parse-canvas-workflow-sse.ts`、`bff/src/utils/map-go-stream-agent-event.ts` |
| 密钥 | `bff/src/utils/web-search-validation.ts`、`bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts` |
| 手册 | `docs/t42-phaseb-closeout-manual.md` |
| 清单 | `docs/ragflow-ui-alignment-followup-tasks.md` v9.11 |

未部署到运行中的 BFF/前端进程。单测不经过 9390/9391。

## 4. 受限注记

| ID | 内容 |
|---|---|
| R6-1 | 本机没有 Go 画布进程,不能在浏览器里看填表、取消和「5 秒内节点停」 |
| R6-2 | 没有可登录的设置页回合,密钥保存的用户可见路径只做到 adapter 单测 |
| R6-3 | M2 生产回填需要集群权限(L-09),未执行 |
| R6-4 | M4 主密钥在 Gateway Rust(`secret_crypto.rs`),`D:\workspace` 无该仓库 |
| R6-5 | 其余 provider 的真实外网调用未做 |
| R6-6 | `npm run check:exec-gates` 仍会 BLOCK:旁边没有 `intellect-team` / `intellect-rag` 源码树。接线本身在 PUT 失败或 Python 事件上保持原行为 |
| R6-7 | 聊天取消与画布取消仍是两条路径,本批不合并 |

## 5. 遗留

- 持有 Gateway 与 Go 画布的环境补一轮真实浏览器
- M2 在生产窗口 dry-run → apply → verify
- M4 在 intellect-storage 实现 `enc:v3`

## 6. 九步闭环

调研、手册、双向检视、大纲/用例、执行(自动化)、修复、类型检查、回归(同一组单测)、本报告均已落盘。用户消息授权连续做到完成。截图目录为空,因为没有可截的运行中画布。

## 7. 项目记忆

- 画布运行 SSE 是 BFF 原样代理,事件改写在前端 `useSendMessageBySSE`,不在 `parseCanvasWorkflowSSE`。后者只服务 RAG adapter 的 StreamChunk。
- 密钥:BFF 只去掉空白 key 字段。非空 key 留在同一次 PATCH 里,由 Gateway 入库并剥离。不要在 BFF 再 PUT。
- 复跑:`npx jest src/utils/go-canvas-sse-adapter.test.ts --forceExit`;BFF 在 `bff/` 下 `npx vitest run` 上述四个测试文件。
- 闸门脚本看的是兄弟仓库是否存在,不代表本仓库接线是否安全。
