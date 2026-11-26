# T4.2 M1 native/Python consumer 契约(待实施)

> 2026-11-25;Gateway 已 resolve `RuntimeSecret`,Python `web_search` 已支持请求级 `api_key/provider`;Tavily/Exa/Parallel/Firecrawl/Brave 走该通道;Python cache reset 防止跨会话复用;`web_extract` 已支持;其他 provider/真实端到端未接。

## 1. 目标

- Gateway 只把 key 交给**当次工具调用**,不写 env/PC/DB;
- Python `web_search`/`web_extract` 没有 key 时回退现有 env/portal;
- 日志/approval/tool args preview 不出现 key;
- 多 provider 只传当前 provider。

## 2. 已实现通道

Gateway `McpToolExecutor` 对 `web_search`/`web_extract` + 上述 5 个 provider 注入**仅内存参数**:

```json
{
  "query": "...",
  "limit": 5,
  "api_key": "<resolved>",
  "provider": "tavily"
}
```

Python `web_search_tool(query, limit, api_key=None, provider=None)`:

- `api_key` 优先,不读 env;
- 不写日志;
- 调用 provider 后尽快丢弃;
- 若参数缺失,回退现有 `TAVILY_API_KEY`/portal 逻辑。

## 3. 安全约束

- 参数只能由 Gateway runtime 注入,不接受 HTTP 客户端直接传;
- approval/preview 的 args 必须经过 `secret_redact::redact_text` 或显式剔除 `api_key`;
- 工具结果/异常不回显 key;
- 只对 `web_search`/`web_extract` 注入;其他工具不传;
- key 生命周期随请求,不进入 `AgentSessionState` 持久字段。

## 4. 实施步骤

1. Gateway tool-call 钩子:在 `execute` 前读取 `cfg.web_search_api_key/provider`,仅对目标工具追加参数;
2. approval 路径:构造 preview 前剔除 `api_key`(现有 redact 需覆盖字段名);
3. Python `web_tools.py`:新增可选参数,优先使用,不回显;
4. 测试:
   - 有 RuntimeSecret → Python 收到参数;
   - 无 key → env fallback;
   - approval/preview/日志无 key;
   - 非 owner/member legacy → 不注入(H1d/H1e)。

## 5. 未做

- `web_extract` 同口径参数
- 真实 provider 端到端(需外部凭证);
- provider-specific key 轮换。

## 6. 验收

- TC-M4-01:配置 secret 后 `web_search` 使用它;
- TC-M4-02:未配置 provider 不注入;
- TC-M4-03:approval args 无 key;
- TC-M4-04:member 对 legacy session 不注入;
- TC-M4-05:env fallback 仍可用。
