# 测试大纲 — t42-phaseb-closeout

> 手册:[docs/t42-phaseb-closeout-manual.md](../../../docs/t42-phaseb-closeout-manual.md)
> 调研:[t42-phaseb-closeout-research.md](./t42-phaseb-closeout-research.md)

## 差异(手册 ↔ 代码)

| 手册口径 | 代码 | 处置 |
|---|---|---|
| 新密钥随同一次保存入库 | PATCH 仍带非空 key,不另发 PUT | 评审后改为此口径 |
| 留空保存不提交空密钥 | `omitBlankWebSearchApiKeys` 去掉空白字段 | 评审后实现 |
| Go 填表 / 结束 / 取消 / 错误进入画布 | `adaptCanvasLiveSsePayload` | 本批实现 |
| 尾部 `done` 不第二次结束 | 已见 `workflow_finished` 时忽略 `done` | 评审后实现 |
| Python 节点事件不变 | 原事件名原样返回 | 本批测试锁住 |
| 停止后 5 秒内节点停 | 需要 Go 进程 | R6,不伪通过 |
| 生产回填 / 主密钥轮换 / 真实供应商 | 仓库或权限不在本机 | R6 |

## 覆盖

- 正常:Python 事件透传;Go message.answer;waiting_for_user;done;cancelled;PUT 后剥离
- 边界:空白 key;同一 provider 的 snake/camel 只 PUT 一次;未知事件名仍透传
- 错误:Go error 只走 toast;PUT 404 时 PATCH 仍带 key
- 联动:BFF 解析器与前端适配器对同一组事件名各自有输出,不把 `node_started` 变成聊天 delta
- 直达:无浏览器入口可打。真实 UI 标 R6

隔离:本批无新建业务数据,不写共享库。
