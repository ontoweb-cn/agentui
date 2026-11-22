# 调研 — Chat 会话加载 404/502(module: chat-session-load)

> 日期:2026-11-22;九步步骤 1。详细证据见 [docs/chat-session-load-error-analysis.md](../../../docs/chat-session-load-error-analysis.md)。

## 现象

进入 `/chat/{sessionId}`(id 含子串 `404`)显示「新会话 / 暂无消息」;Network 404;BFF 日志上游实为 500。

## 根因

| ID | 层 | 说明 | 本 module |
|---|---|---|---|
| R1 | BFF | `handleAdapterError` 用裸 `/404/` 匹配 message,id 内 `404` 误伤 | **修复** |
| R2 | Gateway | list 有 session,detail/messages 500 | 受限 L-CSL-01 |
| R3 | 前端 | catch 吞错 → 空聊天伪装新建 | **修复** |
| R4 | UX | 全局 errorHandler 与页面 alert 双 toast | 受限 L-CSL-02(无 skipErrorHandler 基建) |

## 修复要点

- BFF:`status === 404` 优先 + `/\b404\b/`  
- 前端:`loadError` + 重试/返回列表;新建会话仍静默  
- 测试:GET session id 含 404 + status 500 → 502;结构化 404 仍 404
