# AgentUI Chat 对 Intellect Gateway 的支持差距 & Composer UI 改进方案

> 2026-10-16 浏览器实测 + 代码取证(第一轮分析;同日第二轮完成双网关适配落地,见文末 §五)。
> 对象:本机 intellect-agent 社区版(WebUI :9119 / api_server **:8642**,`../intellect-agent`)与 agentui(BFF :9390 / 前端 :9391)。
> 实测方法:9119 当日已取消密码,直接对真实实例测试(第一轮为隔离实例 :9120);社区网关 api_server 在本机 8642 端口常驻运行(`~/.intellect/.env` 的 `API_SERVER_KEY` 鉴权),第一轮误记为 9091——9091 是文档默认值,本机实际以 8642 运行。
> 所有临时配置(harness-backends/bff-tenants/.env)已还原。

## 一、Gateway chat 支持能力差距

### 0. 双路径架构回顾

- **Gateway 路径**(纯 agent 对话):前端 → BFF `/api/bff/agents/*` → `IntellectEnterpriseAdapter` → 网关 `POST /v1/runs` + `GET /v1/runs/{run_id}/events` SSE。
- **RAG 路径**(kb_ids 非空):前端 → BFF 透明代理 → intellect-rag `/api/v1/chat/completions`。
- 另有 **`IntellectCommunityAdapter`**(`bff/src/services/adapters/intellect-community/`):面向社区版 9091,仅 `POST /v1/chat/completions`。

### 1. 企业版 /v1/runs 路径(当前生产配置)——已支持清单

流式文本、reasoning(流式+持久化)、工具卡片(start/complete/progress + 失败态)、工具审批(once/session/always/deny,runId 归属校验)、澄清交互、usage(input/output tokens → ContextRing)、会话 CRUD + 首轮自动标题(实测生效)、停止(客户端 abort)、INFLIGHT 跨刷新恢复、多租户头注入。

### 2. 企业版路径差距(按优先级)

| # | 差距 | 证据 | 说明 |
|---|------|------|------|
| P0-1 | ~~**停止生成只断客户端,网关侧 run 继续跑完**~~ **已修复(第二轮,见 §五)** | 原 `cancelMessage` 为 no-op stub;社区版 adapter.py:4674 有 `POST /v1/runs/{run_id}/stop` | 已实现 session→run 映射 + BFF stop 路由 + 前端接线,sleep-60 实测第 10s 取消成功 |
| P0-2 | **流终态后 composer 偶发卡 disabled**(实测复现:回复完成后输入框/附件钮禁用,刷新恢复) | 浏览器实测 2026-10-16 | 疑似 SSE 终态事件未全部到达时 isSending 未复位;与 P0-1 相关(等不到 run.completed) |
| P0-3 | **模型选择不可用**:`/model` 斜杠命令发 `patchChat` 只传 `{name,title}` → BFF 400;UI 无模型芯片 | `src/pages/next-chats/hooks/use-send-chat-message.ts:560-592`、`bff-agents.ts:249-257` | BFF→网关 body 已有 `model` 字段通道(adapter :271-282),只差前端 UI 与 PATCH 契约 |
| P1-1 | 采样参数/system prompt 未暴露:/v1/runs 支持 `model` + `instructions`(ephemeral_system_prompt),agentui 无 temperature/top_p/max_tokens/instructions 入口 | adapter sendMessage body | — |
| P1-2 | **多模态未接线**:BFF/插件 SDK 有 `attachments` 透传,宿主聊天 UI 上传走 RAG `documentInfoUpload`,gateway 对话发不了图;社区版 9091 仅 chat/completions 支持 data-URL 图片,/v1/runs 不收附件 | `use-chat-request.ts:811-866`、plugins-chat.ts | — |
| P1-3 | **刷新丢流**:run 事件无法重新订阅。BFF 不消费 events 的 `seq`,无 `GET /v1/runs?session_id=` 反查(adapter 注释自认);INFLIGHT 只是本地缓存合并 | parse-intellect-enterprise-run-events-sse.ts | 对照:webui 9119 有 journal cursor + `Last-Event-ID` 续传 + `session_snapshot` |
| P1-4 | contextLength 未透传(前端默认 128000),usage 的 `context_length/threshold_tokens/last_prompt_tokens` 丢失 → 上下文环做不准 | `use-send-chat-message.ts:642-646` | — |
| P2-1 | 会话级能力:服务端搜索(现客户端过滤)、pin/archive/branch/export/fork 未接;重命名靠 localStorage `chat_app_name_<id>` 兜底 | `use-chat-request.ts:241-250` | 社区 9091 有 fork;webui 9119 有 search/branch/export/pin 全套 |
| P2-2 | 消息级:删除/编辑/反馈 gateway 无 API(UI 已隐藏,合理);`/undo` 本地删+toast 失败数,体验差 | `use-chat-request.ts:764-781` | — |
| P2-3 | 历史分页:webui 9119 支持尾窗口+`msg_before` 向上翻页;agentui 全量拉 | — | 长会话性能 |

### 3. 隐藏最深的坑:社区版 9091 与企业版 /v1/runs 事件词汇表不一致

若用 enterprise 适配器指向前本机社区版 api_server,解析器(`parse-intellect-enterprise-run-events-sse.ts`)会"半盲":

| 事件 | 社区版 9091 实发(adapter.py 实证) | 企业解析器期望 | 后果 |
|------|------|------|------|
| 文本增量 | `message.delta` `{delta}`(无内层 type) | `message.delta` + 内层 `type` | `delta` 字段兜底 ✓ 文本流可用 |
| 工具 | `tool.started` / `tool.completed` / `tool.failed` **独立事件** `{tool, preview, args, duration, error}` | `tool.progress` + 内层 type | **工具卡片全丢** |
| 思维链 | `reasoning.available` `{text}` 独立事件 | `message.delta` + type:"reasoning.delta" | **思维链全丢** |
| 澄清 | `clarify.request` `{clarify_id, question, choices}` | `clarify` | **事件被丢 + agent 线程阻塞等 600s 超时** |
| 审批 | `approval.request`(载荷 `{command, pattern_key, description}`,**无 tool_name/arguments**) | 同名事件,读 tool_name/arguments | 卡片渲出空字段 |
| 子代理 | `subagent_progress` `{text}` | 无 | 丢失 |
| 终态 | `run.completed` `{output, usage{input_tokens,output_tokens,total_tokens}}` | 同名 + output 兜底 ✓ | 可用 |
| 停止 | `POST /v1/runs/{run_id}/stop` 存在 | cancelMessage no-op | 未接 |

**建议**:BFF 解析器加一层事件名归一化(社区词汇→企业词汇,约 60 行),或把 `IntellectCommunityAdapter` 升级为 /v1/runs 协议。现 community 适配器(OpenAI 薄封装)问题更大,见 §4。

### 4. IntellectCommunityAdapter(现社区版路径)差距

`openai-base-adapter.ts`:
1. **单轮对话**:doChat 只发当前 user message(:163-166),多轮历史不合并;且 buildHeaders 主动删除 `X-Intellect-Session-Id`(:330-341)——社区版网关明明支持该头续会话。实测含义:每条消息都是全新会话。
2. **会话全假**:listSessions/getSession 是 BFF 进程内内存 Map,重启即失;社区版 9091 有完整 `/api/sessions` REST(list/create/get/patch/delete/fork/messages,adapter.py:4646-4654)。
3. **事件面**:parseOpenAISSE 只认标准 OpenAI chunk;社区版自定义 `event: intellect.tool.progress` 工具进度帧、`[DONE]`、usage 尾帧不解析(丢工具进度)。
4. 审批/澄清/stop 全不可用(v1/chat/completions 通道不吐审批事件;stop 未接)。

## 二、intellect webui chat/composer UI 实测 → agentui 改进方案

### 1. intellect webui 亮点(截图实证)

1. **Composer chips 行**:`📎 附件 · 🎤 听写 · ⚡default(profile) · ▣ Home(workspace) · ◉ Deepseek Flash(模型) · ◐ Default(推理力度)`,右侧**上下文用量环形指示器**(实测 2%)。发送中:发送键→红色停止键 + 排队徽标。
2. **斜杠面板**:裸 `/` 即弹全命令列表(名称+描述+参数占位,如 `/compress [focus topic]`),键盘导航。
3. **流式状态三件套**:右侧状态行(`Searching workspace · Working for 00:34`)+ `Activity: N tools` 折叠行 + `Done in 59s`;展开后=思维链卡(💡 Thinking,可复制/展开)与工具行(图标+名称+参数预览;点击**内联展开** command+输出)。
4. **消息操作**:用户消息 hover → 时间戳 / Edit message / Fork from here / Copy;assistant → Regenerate / Copy。
5. **队列**:流式中继续发送 → 自动入 `Queued messages` 区域,流结束依次发出(409 自动入队)。
6. **三栏布局**:图标导航轨 + 会话列表(TODAY 时间分组、All/Unassigned 过滤 chips、时长徽标、自动标题)| 会话 | **WORKSPACE 面板**(Files/Artifacts 文件树)。
7. 空态:居中 logo + 三张建议卡;标题自动生成 + header 消息数徽标。

### 2. agentui 现状(截图实证)

- 入口:Tasks → Chat apps 卡片列表 → 会话页(会话列表 | 聊天,无右侧面板)。
- Composer:大圆角框、聚焦绿描边;仅 `Thinking` 开关 + 附件 + 语音 + 发送。**无模型芯片、无上下文环、无 profile/workspace**。
- 斜杠:裸 `/` 不弹面板,必须键入命令前缀;单条提示样式(如 `/model — Switch model <model_name>`),无可浏览列表。
- 流式:纯文本增量;工具卡片组件存在但无活动树聚合、无运行状态行/计时。
- 消息:markdown ✓、悬停 4 按钮;**无时间戳**;完成后 composer 卡 disabled(见 P0-2)。
- 会话列表:搜索+新建+复制;无分组/过滤/时长。

### 3. 改进方案(按优先级)

**P0 可用性**
1. Composer 增加模型选择芯片(数据通道已在:BFF `model_id`→`/v1/runs body.model`),同步修复 `/model`(patchChat 契约打通或改为本地 state+发送时携带)。
2. 停止生成接 `POST /v1/runs/{run_id}/stop`(BFF 记 run_id→session 映射已有);修复流终态后 composer disabled。
3. usage 的 context_length/threshold_tokens 透传 + composer 上下文环形指示器(intellect 同款)。

**P1 信息密度**
4. 活动树:把现有 ToolCallCard 流聚合为 `Activity: N tools` 可折叠行 + 运行中状态行(当前工具名 · 计时);数据已够,纯前端重组。
5. 消息加时间戳;hover 操作与 intellect 对齐(用户消息 Edit/Fork 受 gateway API 限制,可先做"重新生成从此处" reroll)。
6. 斜杠面板升级:裸 `/` 出全命令浏览列表(名称+描述),涵盖 /model /usage /status /retry /undo。

**P2 空间结构**
7. 会话列表时间分组 + 过滤 chips;标题自动同步已有,补时长/消息数徽标。
8. 队列机制:流式中发送→入队,流结束自动发出(企业网关可映射 steer)。
9. 右侧 Artifacts/canvas 面板:canvas S1 共享面注入已在推进,聊天页右侧是天然挂载点(intellect 的 WORKSPACE 面板即此形态)。

**P3 观感**
10. 空态建议卡;聚焦描边/发送键形态(↑ ↔ ■)与主题色统一。

## 附:本次实测痕迹与清理

- `codex-direct-debug` 会话新增一轮"你好"问答(标题已还原为原值);删除测试产生的消息对需网关消息级删除 API,当前无。
- 隔离 webui 实例产生的测试会话已从 `~/.intellect/sessions` 删除;消耗数次 Deepseek 调用(双网关 e2e)。
- `bff/data/harness-backends.json`、`bff/data/bff-tenants.json`、`bff/.env` 已还原;临时服务已全部停止。

## 五、第二轮(2026-10-16 下午):双网关适配落地 + 实测

### 1. 实测确认的社区网关事实(本机 8642 抓包)

1. **事件词汇表**与 §3 表格完全一致(`tool.started`/`tool.completed`/`reasoning.available`/`message.delta{delta}`/`run.completed{output,usage}`)。
2. **`run.failed` 错误文本在 `error` 字段**(非 `message`);不传 model 时以空模型名调上游,直接 400。
3. **工具事件无 tool_id、completed 无结果内容**(`{tool, preview}` / `{tool, duration, error}`)。
4. **中间答案伪影**:模型先答后用工具时,`/v1/runs` 通道把中间答案与最终答案都作为 `message.delta` 下发(9119 webui 靠 `interim_assistant{already_streamed}` 去重,/v1/runs 通道无此机制)→ 客户端会看到重复段落。属网关侧协议缺口,影响所有 /v1/runs 客户端;agentui 后续可在 `run.completed.output` 与已累积 delta 高度重叠时做尾段替换(待做)。
5. 本机部署形态:社区版 api_server 常驻 8642(非文档默认 9091),鉴权 key 在 `~/.intellect/.env`;企业版向导默认 endpoint 仍是 9091,社区用户配置后端时需按实际端口填。

### 2. 已落地的适配(本轮代码改动,均未提交)

| 改动 | 文件 | 说明 |
|------|------|------|
| 社区词汇归一化 | `bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-run-events-sse.ts` | 新增 `tool.started`/`tool.completed`/`tool.failed`/`reasoning.available`/`subagent_progress`/`clarify.request` 六个独立事件名的归一化 case;合成 toolCallId 按工具名关联 start/complete;approval 载荷回退 `command`/`description`;`run.failed` 错误消息回退 `error` 字段 |
| 停止生成全链路 | 同上 adapter(`sessionRuns` 映射 + `cancelMessage`→`POST /v1/runs/{run_id}/stop`)、`bff/src/routes/bff-agents.ts`(新路由 `POST /agents/:agentId/sessions/:sessionId/stop`,204 幂等)、`src/utils/api.ts` + `single-chat-box.tsx`(前端停止时 fire-and-forget 调用后本地 abort) | 兼容双网关(端点同名);BFF 重启丢映射时退化为仅断流 |
| clarify 路径自适应 | adapter(`clarifyRuns` 映射 + `submitClarify` 分支) | 流内 `clarify_request` 拦截记录 clarifyId→runId;社区版走 `POST /v1/runs/{run_id}/clarify`(body `{response, clarify_id}`),企业版维持原路径(body `{clarify_id, answer}`) |
| 单测 | `fixtures/sse-streams.ts`(4 组社区夹具,含 8642 实测抓包形状)+ parser 测试 4 例 | BFF 全量 964/964 绿;前端聊天相关 98/98 绿;tsc 干净 |

### 3. BFF 级端到端实测(社区网关 8642,临时配置已还原)

- **对话**:tenant 指向 `http://localhost:8642`(enterprise 类型后端 + 社区 key)→ `POST /agents/chat/completions` 带显式 `model_id: deepseek-flash` → 标准帧全链路产出:`tool_start`(合成 id + preview 作为 args)→ `tool_complete`(同 id 关联)→ 36×`message` → `message_end`(usage 29191/134)→ `workflow_finished`。
- **停止**:`sleep 60` 任务第 10s 调 stop 路由 → 204,SSE 流立即终止,错误帧 `run cancelled`(run 真正被网关取消,未等满 60s)。
- **错误透传**:`run.failed{error}` 正确转成前端 error 帧并携带完整上游错误文本。

### 4. 社区版部署的推荐接入形态(方案定稿)

1. **不要用 `intellect-community` 适配器**(OpenAI 薄封装:单轮对话、会话为内存假实现、无工具/审批/停止,见 §四)。
2. **用 `intellect-enterprise` 类型后端指向社区 api_server**(如 `http://localhost:8642`)——社区版 api_server 实现了同构的 `/v1/runs` + `/api/sessions` + approval/clarify/stop 契约,经本轮词汇归一化后 BFF 双网关透明。
3. 已知残余差距(社区网关侧缺真实现,agentui 无法单侧补齐):`/api/sessions` 列表无服务端搜索;社区 `/v1/runs` 不收 attachments(多模态仅企业版);中间答案伪影(§五.1.4);首条消息必须带有效 `model_id`(或网关配 `API_SERVER_MODEL_NAME` 默认模型),否则 400。
4. 剩余 P0(企业/社区通用):composer 卡 disabled 修复(P0-2)、模型选择芯片 UI(P0-3,数据通道已验证可用)、context_length 透传(P1-4)。

## 六、第三轮(2026-10-16 下午):方案评审 + P0 批次执行

### 1. 评审结论(对原方案的三处修正)

| 项 | 原方案 | 评审后修正 | 依据 |
|----|--------|-----------|------|
| P0-2 composer 卡死 | 直接修 | 先复现定位,不盲改 | 静态评审:`useSendAgentMessageWithSse.send` 正常/异常路径均 `setDoneValue(true)`,无必然卡死路径。实测复现成功:**点停止按钮后 composer 卡 disabled**(taDisabled=true 且 stop 键残留);但经 DOM 直击验证,停止链路(含本轮新增的 BFF stop)工作正常后 composer 即恢复——即卡死与"终态事件未到达"强相关,stop 全链路本身就是主要修复 |
| P0-3 模型选择 | 修复 patchChat 契约 | 放弃 server 持久化,改**会话级 localStorage + 发送时 model_id** | 网关 PATCH 仅支持 title(无 user-model 字段),契约短期无法解;社区版 /v1/models 只返回占位名(intellect-agent),真实 provider 模型名(deepseek-flash)只能自由文本 |
| P1-4 contextLength | BFF 透传 | 降级为**防御性透传** | `/v1/runs` 契约的 usage 根本没有 context_length 字段(仅 prompt/completion/total),网关不发;前端 ContextRing 链路本身已通(promptTokens→46% 环实测) |

### 2. 本轮落地(代码,均未提交)

| 改动 | 文件 | 说明 |
|------|------|------|
| 会话级模型选择 | `src/pages/next-chats/hooks/use-send-chat-message.ts` | `selectedModel` state + localStorage `chat_model_<chatId>`(与 chat_app_name 同款兜底);gateway 发送 body 附 `model_id`;`/model` 重写:gateway→本地设置(自由文本,空参=恢复默认),RAG→原 patchChat 流程不变 |
| 模型芯片 UI | `src/components/message-input/next.tsx` | 新 props `modelValue/modelOptions/onModelChange`,Thinking 旁 Cpu 图芯片 + DropdownMenu;选项来自 `GET /api/bff/agents`(网关 /v1/models)+ "网关默认" |
| 模型列表接口 | `src/utils/api.ts` + `single-chat-box.tsx` | `gatewayModels` URL;react-query 拉取(enabled=isGatewayChat,staleTime 5min) |
| /model 自由文本兜底 | `slash-command-palette.tsx` | 模型子面板列表为空时,把已输入参数作为可点击自由文本条目(修复"No matching command"死路) |
| P1-4 防御性透传 | BFF `types/stream.ts` + parser + `sse-event-dispatcher.ts` | `TokenUsage.contextLength?` 三层打通:网关若补发 context_length 自动生效,缺失时前端维持默认 128000 |
| i18n | `locales/en.ts`/`zh.ts` | `chat.modelSelectorLabel`/`chat.modelSelectorDefault`(其余语言回退 en) |

### 3. 真实前端 e2e(社区网关 8642,mock 社区登录,配置已还原)

- **模型芯片**:composer 出现"Gateway default ▾";`/model deepseek-flash` → 自由文本条目点击 → 芯片变 deepseek-flash + localStorage 持久化 ✓
- **真实对话**:发送后请求携带 model_id(网关侧 session model=deepseek-flash);**社区 tool.started/completed 事件渲染为 Running/Completed 工具卡(含时长)**、Show reasoning 折叠条、最终回答正常 ✓
- **ContextRing**:完成态出现 46% 圆环(promptTokens→128000 默认窗口)✓
- **停止**:长任务中点停止 → BFF `POST .../stop` 204 → 流终止 → composer 立即恢复 ✓
- **composer 状态**:自然完成与停止两种路径均恢复正常输入(taDisabled=false)✓
- 回归:BFF 全量 965/965、前端聊天相关 89/89、tsc 干净

### 4. 残余与后续

- P0-2 的原始触发场景(远程企业网关 wust,流完成后卡死)未能在本地复现;社区网关下完成/停止两路径均正常。若企业网关再现:排查方向是上游 events 流静默不关闭(解析器已有 stream-interrupted error 兜底 + cancelMessage stop 兜底)。
- P1 剩余:消息时间戳、斜杠面板裸 "/" 全命令浏览、Activity 折叠树聚合(方案见 §三,未执行)。
- 已知交互小坑(本轮实测):CUA 坐标点击停止按钮易偏移,DOM data-testid(`chat-detail-model-toggle`/`chat-stream-status`)为稳定锚点,自动化测试建议用 testid。

## 七、第四轮(2026-10-16):质量与安全评审 → 加固落地

### 1. 评审发现与处置

| 编号 | 级别 | 发现 | 处置 |
|------|------|------|------|
| S1 | 中 | stop 路由与 sessionRuns 缺归属校验/租户隔离:AdapterRegistry 按 harness backendId 缓存实例,多租户绑同一后端共享 adapter → `sessionRuns` 跨租户共享,知道他人 session id 可停其 run | **已修**:`sessionRuns` 键改 `<backendId>:<sessionId>`(adapter.ts `sessionRunKey`),cancelMessage 按当前租户上下文查找,跨租户天然未命中 |
| S2 | 低 | clarifyRuns 同受 S1 影响 | **已修**:值改为 `{runId, ownerBackendId}`,submitClarify 仅在归属租户一致时走社区分支;不匹配视为未记录(不删条目、不泄露存在性),落入企业版路径由网关校验归属 |
| S3 | 低(信息) | run.failed 的 error 文本透传前端(含上游内部信息) | 接受,与既有 error 事件行为一致,记录在案 |
| S4 | 低 | model_id 客户端可控直达网关 | 接受:网关侧校验(社区 400 未知模型);可选后续:BFF 白名单 `^[A-Za-z0-9._\-/]{1,128}$` |
| S5 | 低 | registry 未就绪的 fallback 路径每请求新建 adapter → stop 静默无效 | **已修**:cancelMessage 未命中映射时 console.warn(含键名),消除"看似成功实则没停"的静默降级 |
| Q1 | 中 | adapter cancelMessage/submitClarify、stop 路由、palette 自由文本兜底无测试 | **已补**:adapter 7 例(命中/跨租户未命中/无映射/一次性消费/社区分支/跨租户落企业分支/未记录)、路由 5 例(204/503/501/缺参/502 不泄露内部信息)、palette 1 例(自由文本兜底可执行) |
| Q2 | 低 | 同名工具并发关联可能配错对;subagent_progress 固定 id 并发覆盖 | 接受(社区协议无 tool_id 的固有限制,代码注释已说明策略) |
| Q3 | 低 | /model 两分支 trim 不一致 | **已修**:RAG 分支统一 trimmed |
| Q4 | 信息 | 下拉无长度截断、localStorage 无清理、i18n 部分語言回退 en、菜单无选中勾选 | 接受(量级/观感类,与既有模式一致) |

### 2. 加固后的信任模型说明(重要)

- 隔离粒度与 approval 的 P0-S1 对齐:**backendId(租户上下文)级**。`BackendContext.userId` 来自客户端可设的 `X-User-Id` 头(backend-context.ts:35,非信任锚,类型注释亦声明"绝不信任"),因此**租户内跨用户**的 stop 防护依赖网关侧按 `X-Intellect-User` 鉴权(企业版 httpClient 注入服务端解析的 member_id);社区版为单用户部署,不适用。
- stop 幂等语义保持:映射未命中(BFF 重启/registry fallback/他租户)一律 204 + 服务端 warn,客户端仍以本地 abort 兜底。

### 3. 回归

BFF 全量 **977/977**(含新增 adapter 7 例 + 路由 5 例)、前端聊天相关 **109/109**(含 palette 新例)、tsc 干净。
