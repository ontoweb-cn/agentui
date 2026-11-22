# Chat 会话加载 404/502 分析

> **复现 URL**:`/chat/api_1788432157_7ba582f9d051bc3d6bed2fa599b40467`
> **现象**:页面进入后显示“新会话 / 此会话暂无消息”,Network 面板出现 404;控制台有 `Failed to load resource: 404`。
> **结论**:不是前端路由 404,而是 **BFF 把上游 500 误判成 404 + 前端吞掉加载错误**;上游 Gateway 的 session detail/messages 确实返回 500。

---

## 一、浏览器证据

在已登录会话下用 Headless Chrome 抓取:

```text
GET /api/bff/agents/chat/sessions/{id}          → 404 {"code":404,"message":"Not found"}
GET /api/bff/agents/chat/sessions/{id}/messages → 404 {"code":404,"message":"Not found"}
```

同时 BFF 日志显示上游真实响应:

```text
GET /api/sessions/{id}          → 500: {"error":{"message":"internal server error"}}
GET /api/sessions/{id}/messages → 500: {"error":{"message":"internal server error"}}
```

`GET /api/bff/agents/chat/sessions` 列表 **200**,且列表里包含该 session:

```json
{
  "id": "api_1788432157_7ba582f9d051bc3d6bed2fa599b40467",
  "title": "codex-direct-debug",
  "createdAt": "2026-09-03T10:42:37.000Z"
}
```

即:**列表能列出,但 detail/messages 打不开**。

---

## 二、根因

### R1 BFF 误判 404(已修复)

`bff/src/routes/bff-agents.ts` 的 `handleAdapterError` 原先用裸字符串匹配:

```ts
if (/404/.test(msg)) return 404;
```

这个 session id 本身包含 `404`:

```text
...7ba582f9d051bc3d6bed2fa599b40467
                              ^^^
```

因此上游 500 的 message 虽然含 `→ 500`,仍被 `/404/` 命中,返回 404。

**修复**:

- 优先用结构化 `err.status === 404`;
- 兼容旧文案时使用词边界 `/\b404\b/`,避免 id 内 `404` 误匹配;
- 新增回归测试:session id 含 404 + 上游 500 → 必须 502。

### R2 上游 Gateway 会话数据不一致(待后端排查)

- `GET /api/sessions` 返回该 session;
- `GET /api/sessions/{id}` 与 `/messages` 返回 500 `internal server error`;
- 其他 session(如 `c749a4680d0b`)在日志中也出现 502。

说明不是单个 URL 拼错,而是 **session list 与 session detail 的数据源/兼容性不一致**。需要后端检查:

- 该 session 是否属于当前 tenant/backend;
- 是否为旧版 RAG `api_...` session,而 detail 接口只支持新版 Gateway session;
- Gateway 数据库是否存在该 session 的完整记录;
- 是否 list 使用了缓存/索引,detail 走了另一条失败路径。

### R3 前端吞掉加载错误(已修复)

`src/pages/next-chats/chat/index.tsx` 原先:

```ts
catch (err) {
  console.debug('[chat] fetchSessionManually failed:', err);
}
```

页面继续渲染空 `SingleChatBox`,看起来像“新建的会话”,用户只能看到网络 404,无法判断会话已损坏。

**修复**:

- 增加 `loadError` 状态;
- 会话加载失败时显示“会话加载失败”与说明;
- 提供“重试 / 返回聊天列表”;
- 新建会话仍保留静默容错,不误报。

截图验证:页面显示 `role=alert` 的错误卡片,而不是空聊天框。

---

## 三、修复后状态

| 请求 | 修复前 | 修复后 |
|---|---|---|
| GET session | 404 `Not found` | **502 `Adapter error`** |
| GET messages | 404 `Not found` | **502 `Adapter error`** |
| 页面 | 新会话 + 空聊天 | **会话加载失败 + 重试/返回** |
| 控制台 | 404 resource error | 502 resource error(真实状态) |

BFF 回归测试:

```text
bff/src/routes/bff-agents.test.ts  45 passed
```

前端:

```text
Jest   670 passed / 44 suites
tsc    passed
build  passed
```

---

## 四、改动文件

| 文件 | 改动 |
|---|---|
| `bff/src/routes/bff-agents.ts` | 404 判定改为 status + `\b404\b` |
| `bff/src/routes/bff-agents.test.ts` | 新增 id 含 404/上游 500 回归测试 |
| `src/pages/next-chats/chat/index.tsx` | `loadError` 错误态 + 重试/返回 |
| `src/locales/en.ts` / `zh.ts` | `chat.loadFailed*` / `retryLoad` / `backToChats` |

---

## 五、仍待处理

1. **上游 500**:需要 Gateway/后端修复该 session 的 detail/messages;前端无法凭 URL 修复数据。
2. **重复 toast**:加载失败时全局 `errorHandler` 与页面错误态同时提示,当前会出现两条 502 toast;可后续给 session-load 请求加 `skipErrorHandler`。
3. **列表脏数据**:`GET /api/sessions` 返回了无法 detail 的 session;建议后端过滤或修复。
4. **会话不存在时**:长期看应返回 404 并跳转/提示,而不是 500;这属于后端契约。
