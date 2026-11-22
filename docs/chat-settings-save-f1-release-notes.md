# Chat 设置保存 — F1 验证与发版说明(T2.10 遗留)

> 日期:2026-11-22。对应 [ragflow-ui-alignment-followup-tasks.md](./ragflow-ui-alignment-followup-tasks.md) T2.10 遗留与 [p0-port-transition-impact-review.md](./p0-port-transition-impact-review.md) §七 F1。

## 行为变化(存量会话)

BFF PATCH 已透传 `prompt_config` / `kb_ids`(不再 title-only)。**存量对话首次在设置页点保存会真正写入 Gateway**,此前可能表现为「保存成功但刷新后 system prompt / 知识库绑定未变」。

影响面:

- 修改 system prompt → 刷新后应保留;
- 清空知识库绑定(`kb_ids: []`)→ 可持久化;
- 多 web-search key 整包仍写入(写侧 prune 等 T4.2 / L-T42-01,不在本发版接线)。

## F1 端到端验证步骤

前置:已登录、至少一条存量 Gateway chat、浏览器网络面板可看 BFF。

1. 打开存量会话 → 右侧设置 → 修改 system prompt 为可识别字符串(如 `F1-verify-YYYYMMDD`);
2. 保存,确认无错误 toast;
3. 网络面板核对 `PATCH /api/bff/agents/.../sessions/:id`(或等价路径)请求体含 `prompt_config` / `system`;
4. 硬刷新页面,设置页应回显新 prompt;
5. (可选)对同一 session 调 `GET` 会话详情,观察 `prompt_config` 已变。

结果登记:本仓 CI/本地以 BFF 单测覆盖透传;生产实网 F1 需持 kubeconfig/生产 token 的同学在 D1 窗口执行(受限 **L-09**)。

## T2.4 / T4.1a④

`sanitizePromptConfigWebSearchKeys` 已就绪,**PATCH 写侧 prune 不接线**,等 T4.2 Gateway secrets API(**L-T42-01**)。短期整包保存以保留「换回 provider 不丢 key」。
