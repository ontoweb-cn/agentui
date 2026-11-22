# TC-CSL-01 BFF session 加载 404 误判

> 组:chat-session-load / BFF vitest;`bff/src/routes/bff-agents.test.ts`  
> 夹具:fake adapter `getSession` mock

| # | 操作 | 预期 |
|---|---|---|
| 1 | GET session;id=`...b40467`;adapter reject `{status:500, message含 id}` | HTTP 502;`code` 502;`Adapter error` |
| 2 | GET session;adapter reject `{status:404}` | HTTP 404 |
| 3 | GET session;message=`upstream responded (404) Not Found`(无 status) | HTTP 404 |
