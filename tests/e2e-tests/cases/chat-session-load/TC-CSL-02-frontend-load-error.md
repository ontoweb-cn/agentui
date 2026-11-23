# TC-CSL-02 前端会话加载失败可见化

> 组:chat-session-load / 手工或后续组件测;`src/pages/next-chats/chat/index.tsx`

| # | 操作 | 预期 |
|---|---|---|
| 1 | 打开已有会话 URL;fetchSessionManually 抛错 | 标题/正文为 loadFailed*;`role=alert`;重试/返回按钮 |
| 2 | 点击重试 | 再次请求;成功则清除 loadError |
| 3 | 点击返回 | 进入聊天列表 |
| 4 | `isNew=true` 且非 gateway 同 id 路径 | 不进入加载分支,不设 loadError |
| 5 | Gateway(`conversationId===chatId`)且 `isNew=true` 加载失败 | **仍设 loadError**(残留 isNew 不得伪装空聊天) |
