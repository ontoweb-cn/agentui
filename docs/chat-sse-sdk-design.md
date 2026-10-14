# 宿主 chat/SSE 能力 SDK 化 — 技术方案(评审后)

> **Status**: **P1 已实施(2026-10-14)**;方案含 QwenPaw 参照修订(同日,源码到位后)。
> 实施纪要见 §九;任务状态见 [runtime-plugin-architecture.md](./runtime-plugin-architecture.md) §六 近期 #1
> **Date**: 2026-10-14
> **Priority**: 高(用户指定)——运行时插件体系的下一个能力档位
> **Related**: [runtime-plugin-architecture.md](./runtime-plugin-architecture.md)(架构总纲)、[plugin-development-guide.md](./plugin-development-guide.md)(§8 宿主 chat 能力)、[cognitive-wargame-plugin-migration-design.md](./cognitive-wargame-plugin-migration-design.md) §九(本项出处)
> **机制参照**: QwenPaw PawApp(`~/workspace/QwenPaw`,ctx.chat / pawapp-sdk)

---

## 一、背景与目标

### 1.1 问题陈述

当前运行时插件(`window.AgentUI`,1.1.0)的宿主 API 面只有
`registerApp` / `on(localechange|themechange)` / `host.getApiToken`——**全部是
UI 装载与壳层能力**。插件要用 LLM 能力只有两条路,都不成立:

1. 插件自建后端自采模型:每个插件重复解决凭据、网关、计费、流式协议;
2. 偷宿主凭证:`host.getApiToken()` 返回 localStorage JWT(社区模式语义),
   企业模式下为空/过期,且把网关凭证暴露进插件代码(违背凭证服务端化方向)。

宿主自己已有成熟的 chat 通道:企业模式下 `POST /api/bff/agents/chat/completions`
经 Adapter 调 intellect-gateway(`/v1/runs` + `/v1/runs/{id}/events` SSE),凭据
**(Bearer API_SERVER_KEY + X-Intellect-User 身份头)完全在 BFF 服务端**
(env/token-vault),BFF 把上游事件重序列化为统一的 `{event,data}` SSE 帧协议
(9 种帧)。插件体系缺的只是把这条通道**以受控、可归因、凭证不落地的方式**
开放给插件。

### 1.2 目标

- 插件经 `window.AgentUI.chat` 以 **AsyncGenerator 流式 API** 使用宿主 chat
  能力:建会话、发消息、逐帧接收(`message`/`message_end`/`error`/工具/审批帧),
  支持 abort 与提前 break;
- **插件代码零凭证、零 SSE 解析依赖**:网关凭据始终在 BFF 服务端;SSE 解析
  由宿主 SDK 完成,插件只消费已解析的帧对象;
- **能力声明制**:app.json `capabilities: ["chat"]` 显式声明,BFF 逐请求校验,
  未声明一律 403——部署者对"哪些插件能花模型额度"有一眼可见的清单;
- **归因与隔离**:插件调用经专属路由 `/plugins/:id/chat/*`,天然可审计(与
  #9 审计日志衔接);插件会话标题强制 `plugin:<id>:` 前缀,**宿主主聊天列表
  默认不展示**(经 API/深链仍可访问)。

### 1.3 非目标(YAGNI)

- ❌ **iframe 档内的 chat 桥接**:本方案仍面向同源可信插件;
- ❌ **embedding/RAG 检索能力**(knowledge 检索 SDK 化是独立方案);
- ❌ **多模态输入**(attachments 字段预留透传,v1 不承诺行为);
- ❌ **进程内 hook 复用**:不复用 `useSendAgentMessageWithSse`(React 状态机
  与宿主 UI 深耦合),只复用 BFF 帧协议;
- ❌ **会话历史读取 API**(`chat.history`,QwenPaw `get_session_history`
  对应物):P2 候选,等首个需要历史的插件;
- ❌ **逐插件配额/限流**:P3(先有审计归因数据再谈限额)。

### 1.4 QwenPaw 参照(2026-10-14 源码核验,`~/workspace/QwenPaw`)

初版方案(无源码时)以"ctx.chat 概念对齐"从零设计;源码到位后逐项比对,
**关键事实与取舍**:

| # | QwenPaw 事实 | AgentUI 取舍 |
|---|---|---|
| 1 | 能力挂两套面:后端插件 `ctx.chat()`(进程内 AsyncIterator);前端插件 `window.QwenPaw.paw.forApp(id).chatStream()`(**AsyncGenerator**,SSE 解析由 SDK 完成) | AgentUI 只有前端插件面 → **采纳 AsyncGenerator**(初版为回调,已修订,见 D2) |
| 2 | 权限声明 `plugin.json meta.permissions: {chat: true}` **声明但不校验**——manifest meta 是自由 dict,装载/调用全链路无校验,App Center 也不展示 | **AgentUI 强于参照**:capabilities 经 BFF 逐请求校验,未声明 403;取"声明制 + 强校验"中点——不是 QwenPaw 的"纯文档声明",也不做沙箱级安全边界(同源信任模型不变) |
| 3 | 会话归属:app 会话与 console 会话**同 catalog**(`ChatManager`),id 强制 `pawapp:{app_id}` 前缀,所有权记录 `ChatSpec.meta.pawapp`;**主聊天列表默认过滤 app 会话**(`include_app_owned=False`) | **采纳两件**:标题强制 `plugin:<id>:` 前缀(BFF 侧)+ 主聊天列表过滤 `plugin:` 前缀(前端 useFetchChatList)。差异:AgentUI 会话 id 由 gateway 生成,前缀在标题而非 id |
| 4 | 模型无入参——由宿主 agent 配置决定 | **不采纳**:AgentUI gateway 通道原生支持 `model_id`(BFF 已预留),透传更有用;P3 可加 env 白名单(风险 R2) |
| 5 | 历史由宿主持有,`get_session_history` 过滤 reasoning 后提供给插件 | 对应能力列入 P2 候选(§1.3);v1 不做 |
| 6 | 无按插件配额/审计;取消不对称(console 有 stop,pawapp stream 无) | AgentUI 归因靠专属路由(审计 P3 扩展);abort 语义 v1 即内建(signal + break,优于参照) |
| 7 | `window.QwenPaw.chat` 是聊天 UI 扩展点命名空间(welcome/气泡插槽),**不是 LLM 调用** | 命名澄清:AgentUI 的 `chat` 命名空间即 LLM 能力;未来若有 UI 扩展诉求另立命名空间 |

---

## 二、事实基础(2026-10-14 代码调研)

| # | 事实 | 出处 |
|---|---|---|
| F1 | 宿主 chat 路由 `POST /agents/chat/completions`:body `{session_id, content, agent_id, attachments?, model_id?}` → `adapter.sendMessage(ctx, req)` → `streamChunksAsSSE(c, iterable)` | `bff/src/routes/bff-agents.ts` |
| F2 | 帧协议 9 种:`message`/`tool_start`/`tool_complete`/`tool_progress`/`message_end`/`workflow_finished`/`error`/`approval_request`/`clarify_request`,形状 `{event,data}`,由 `serializeChunk` 单点定义 | `bff-agents.ts`、`src/hooks/logic-hooks/sse-event-dispatcher.ts` |
| F3 | 鉴权链:`authMiddleware` → `requireValidImtSession`(社区模式直通,企业模式 gateway 真实验证 60s 缓存,fail-closed)→(flag 开启时)`authSessionMiddleware` → `backendContextMiddleware` | `bff/src/index.ts`、`middleware/imt-session-guard.ts` |
| F4 | `/plugins/*` 原无会话守卫(代理路由不套 auth 是评审 M2 明示决策);`app.use('/api/*', authMiddleware)` 因 rewrite 不命中插件路径 | `bff/src/index.ts`、`plugins.ts` |
| F5 | Adapter 接口:`createSession(ctx, agentId, title?): Promise<Session>`、`sendMessage(ctx, req): Promise<StreamIterable>`;`streamChunksAsSSE`/`serializeChunk` 已是导出函数;`getAdapter`/`handleAdapterError` 本次导出复用 | `bff/src/types/adapter.ts`、`bff-agents.ts` |
| F6 | `window.AgentUI` 导出面快照锁定;1.1.0 → **1.2.0**(本次) | `src/plugins/host-global.ts`、`__tests__/runtime.test.ts` |
| F7 | 宿主流式消费原语:`fetch` + `TextDecoderStream` + `EventSourceParserStream`(eventsource-parser,宿主依赖) | `src/hooks/logic-hooks.ts` 等 |
| F8 | 宿主主聊天列表 `useFetchChatList` 客户端过滤/分页(Gateway 返回全量) | `src/hooks/use-chat-request.ts` |

---

## 三、方案评审记录(2026-10-14;D2 于 QwenPaw 源码核验后修订)

| # | 决策点 | 选型 | 理由 |
|---|---|---|---|
| D1 | 复用 `/agents/chat/completions` vs 插件专属路由 | **专属路由 `/plugins/:id/chat/*`** | 归因(哪个插件花的额度)、能力门控逐请求校验、未来按插件限额/审计的挂点;宿主内部路由保持插件不可见的"内部契约"地位 |
| D2 | 插件消费流式帧的形态 | **AsyncGenerator 递已解析帧**(修订:初版为 `onFrame` 回调) | QwenPaw 前端 SDK 参照(`chatStream(): AsyncGenerator`)——`for-await` 惯用、提前 break 经生成器 finally 自动中断上游、无回调注册面;SSE 解析仍由宿主完成(插件零 eventsource-parser 依赖,与参照一致) |
| D3 | `capabilities` 声明是不是安全边界 | **不是——是运维门控** | 同源插件全信任(总纲 §2.2)。QwenPaw 的 permissions 声明完全不校验(§1.4 #2);AgentUI 逐请求强校验是运维闸门:额度消费者显式清单 + 安装时评审;不可信场景等 iframe 档 |
| D4 | 守卫挂载方式 | **`pluginsRoutes.use('/plugins/:id/chat/*', guard)` 逐中间件挂载**,链 = `authMiddleware → requireValidImtSession → (flag)authSessionMiddleware → backendContextMiddleware`,与 `/agents/*` 完全一致 | F4:`/api/*` 全局守卫因 rewrite 不命中;`app.use('/plugins/*')` 会误伤公开路由;chat 是 `/plugins` 族第一批会话守卫路由(花的是用户身份下的 gateway 额度),注释明示该差异 |
| D5 | 社区/RAG 模式 | **通道语义继承宿主**:与 `/agents/chat/completions` 同一条 adapter 解析链(租户绑定什么后端就走什么),部署无 chat 后端时与宿主同语义失败(503) | 不另设模式分支——插件 chat 行为永远 = 宿主 chat 行为,无双事实源 |
| D6 | 会话语义 | **BFF 代建,`POST /plugins/:id/chat/sessions`**,标题强制 `plugin:<id>:` 前缀;主聊天列表默认过滤 | QwenPaw 同 catalog + 主面 opt-out(§1.4 #3);completions 必须携带已建 sessionId,不做匿名一次性会话 |
| D7 | abort 形态 | **双层 + 收口**:`options.signal`(外部中止,**流正常结束不 throw**)+ for-await 提前 break(生成器 finally abort 上游 fetch)。真实 fetch 被 abort 时挂起的 fetch()/read() 会 reject AbortError——生成器 catch 中检测中止状态并转为 return(评审 P2 整改,含"模拟 fetch abort-reject"的用例防测试替身再次掩盖);预先已中止的 signal 入口检查直接 return(DOM 规范:已中止 signal 的 addEventListener 永不触发) | DOM 惯例 + 生成器语义;BFF `streamChunksAsSSE` 检测客户端断连退出 |
| D8 | 版本化 | **HOST_API_VERSION 1.2.0**(增量加 `chat`),插件 `feature-detect`(`window.AgentUI.chat &&`) | 契约纪律:导出面变更必须 bump + 快照更新 + 插件仓库同步 |
| D9 | 审批/澄清(approval/clarify)帧 | **v1 只透传帧**;响应可直调既有 `/agents/*` 审批路由;SDK helper 等 P2 | 同初版评审 |
| D10 | 额度/限流 | **v1 不做**(会话鉴权 + gateway 侧配额兜底),P3 经审计日志做按插件用量核算 | 同初版评审 |

---

## 四、契约规格(已实施)

### 4.1 app.json 能力声明

```jsonc
{
  // ...既有字段不变...
  "capabilities": ["chat"]     // 可选;v1 唯一合法值 "chat",未知值容忍(前向兼容)
}
```

安装时**不**校验能力名(前向兼容);chat 路由逐请求检查
`meta.capabilities?.includes('chat')`,未声明 403。`PluginAppJson`/
`PluginAppMetadata` 均含 `capabilities?: string[]`。

### 4.2 BFF 路由面(plugins.ts,均挂 D4 守卫链)

```
POST /plugins/:id/chat/sessions
     body { title?: string }
     → adapter.createSession(ctx, 'chat', `plugin:<id>:${title ?? id}`)
     → 200 Session JSON(与 /agents/:agentId/sessions 同形)

POST /plugins/:id/chat/completions
     body { session_id(必填), content(必填), model_id?, attachments? }
     → adapter.sendMessage(ctx, { sessionId, content, agentId: 'chat', ... })
     → streamChunksAsSSE:200 text/event-stream(与宿主 chat 逐帧一致)
```

共用校验顺序(评审定序):守卫链 401 → id 白名单 403 → **停用断路 404**
(reuse 评审 P1 的 `isPluginDisabled`,kill switch 覆盖 chat)→ 安装/清单 404 →
capabilities 403 → body 400。复用链:`getAdapter`/`handleAdapterError`/
`streamChunksAsSSE` 自 bff-agents.ts 导出,不另起一套。

### 4.3 宿主全局 API(`window.AgentUI.chat`,HOST_API_VERSION 1.2.0)

```ts
interface ChatFrame { event: string; data: unknown }

interface ChatCompletionsRequest {
  sessionId: string;          // 必填,chat.createSession 创建
  content: string;            // 必填
  modelId?: string;           // 可选,透传 gateway
  attachments?: unknown;      // 可选,透传(v1 不承诺行为)
}

interface AgentUIChatApi {
  createSession(pluginId: string, title?: string):
    Promise<{ id: string; title?: string }>;
  completions(pluginId: string, request: ChatCompletionsRequest,
              options?: { signal?: AbortSignal }):
    AsyncGenerator<ChatFrame, void, undefined>;
}

interface AgentUIHostGlobal {
  HOST_API_VERSION: '1.2.0';
  registerApp(...); on(...); host: { getApiToken(): string | null };
  chat: AgentUIChatApi;       // 1.2.0 新增
}
```

**插件侧用法**(推荐形态):

```ts
const chat = window.AgentUI.chat;   // feature-detect: if (!chat) 降级
const { id } = await chat.createSession('my-app', '推演');
for await (const frame of chat.completions('my-app', { sessionId: id, content })) {
  if (frame.event === 'message') render(frame.data);
  else if (frame.event === 'error') showError(frame.data);
  else if (frame.event === 'workflow_finished') break;   // 终止帧后自动结束
}
```

语义要点:
- **error 帧是协议内数据**:yield 后正常结束;HTTP/网络层失败才 throw
  (消息含状态码);
- **提前 break 即中断上游**(生成器 finally abort fetch,BFF 检测断连退出);
- **未知 event 必须忽略**(前向兼容义务);
- 实现:`src/plugins/chat-client.ts`(零 React;eventsource-parser 静态导入,
  已入 jest 全局流式原语 polyfill)。

### 4.4 帧类型速查(插件作者视角,与宿主 chat 完全一致)

| event | data 要点 | 插件典型处理 |
|---|---|---|
| `message` | `{content?, answer?, start_to_think?/end_to_think?}` | 增量拼接回答;start_to_think 包裹推理段 |
| `tool_start`/`tool_complete`/`tool_progress` | 工具名/参数/进度 | 工具执行状态 UI(可忽略) |
| `message_end` | `{usage}` | 计数/收尾 |
| `workflow_finished` | `true` | 结束流(此后无帧) |
| `error` | `{message, answer?, errorDetails?, run_id?}` | 错误渲染(流终止) |
| `approval_request` | `{tool_name, arguments, choices, run_id}` | v1 可忽略;需交互工具流时直调 `/agents/:agentId/runs/:runId/approval`(P2 收编) |
| `clarify_request` | `{question, choices, clarify_id, session_id}` | 同上(P2) |

---

## 五、信任模型与安全边界

1. **凭证不落地**:gateway Bearer key 与 X-Intellect-User 身份解析全部在 BFF;
   插件只持同源企业 cookie;
2. **能力门控是运维闸门不是安全边界**(D3);较 QwenPaw(声明不校验)更严格;
3. **身份与租户**:守卫链与 `/agents/*` 完全一致(含企业 flag 关闭时的直通
   语义),插件调用与用户手聊同权限域,无提权;`getAdapter` 同一租户隔离解析;
4. **停用即断路**:chat 路由读取 plugin-state,disabled 插件 404(与评审 P1
   的 files/proxy 门控同一机制);
5. **会话可见性**:标题前缀 `plugin:` + 主聊天列表过滤(QwenPaw 主面 opt-out
   模式);会话仍在同一 gateway 体系,经 API/深链可管理;
6. **不扩大公开面**:chat 是 `/plugins` 族第一批守卫路由,文件头注释明示与
   M2 决策(列表/文件/代理不套会话守卫)的差异及理由。

## 六、分期实施计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P1 SDK v1** | ①BFF:capabilities 字段 + 两条 chat 路由与守卫链 + 停用断路;②宿主:`window.AgentUI.chat`(AsyncGenerator)+ 1.2.0 快照;③主聊天列表过滤 plugin: 前缀;④jest-setup-env 流式原语 polyfill;⑤测试与文档 | ✅ 2026-10-14(§九) |
| **P2 交互帧 helper + history** | `chat.submitApproval/submitClarify` SDK 化;`chat.history(sessionId)`(QwenPaw get_session_history 对应物,含 reasoning 过滤) | 待首个需求插件 |
| **P3 用量核算** | 审计日志扩 `chat_completion` 事件(pluginId/usage),可选 env 模型白名单 | 待多插件 + 成本治理诉求 |

## 七、风险登记册

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | 插件会话混入用户会话列表 | 低 | 标题前缀可辨识 + 主列表默认过滤(D6);经 API/深链可管理。**已知妥协**:用户若手输 `plugin:` 开头的会话名也会被主列表隐藏——gateway Session 无元数据字段前,标题前缀是唯一归属载体(QwenPaw 用 `ChatSpec.meta.pawapp` 做归属);gateway 支持会话元数据后应切换 |
| R2 | modelId 任意传→绕开部署模型管控 | 中 | v1 透传(gateway 配额兜底);P3 env 白名单 |
| R3 | 帧协议漂移破坏插件 | 低 | 帧由 `serializeChunk` 单点定义;插件"忽略未知帧"义务写入 guide |
| R4 | 插件页离开未 abort→长流悬挂 | 低 | BFF 客户端断连自动退出 + break/双层 signal;P2 可考究 visibilitychange 自动 abort |
| R5 | 消费侧插件 bug | 低 | error 帧协议内传递;生成器 throw 语义与 fetch 一致 |
| R6 | 契约快照失稳 | 低 | bump 1.2.0 + 快照已更新;插件仓库同步待插件接入时执行 |

## 八、验收标准(P1)与实测

| # | 标准 | 结果 |
|---|---|---|
| 1 | 未声明 chat 能力 403;未安装/停用 404 | ✅ vitest(能力门控 describe) |
| 2 | 无效鉴权 401(守卫链挂 chat 子路径) | ✅ vitest |
| 3 | createSession 标题 `plugin:<id>:` 前缀 | ✅ vitest(plugins-chat.test.ts) |
| 4 | completions 帧序与宿主 chat 逐帧一致(同一 streamChunksAsSSE) | ✅ vitest(delta→message / usage→message_end / done→workflow_finished) |
| 5 | abort/break 后上游流终止 | ✅ jest(signal 透传 + break abort fetch stub) |
| 6 | 1.2.0 契约快照更新;主列表过滤 plugin: 前缀 | ✅(快照 inline;过滤在 useFetchChatList) |
| 7 | BFF vitest + 前端 jest + 双侧 tsc 全绿 | ✅(BFF 921 / jest 572,2026-10-14 整改后) |

## 九、实施纪要(2026-10-14)

**BFF**(`bff/src/routes/plugins.ts`、`bff-agents.ts` 导出 getAdapter/
handleAdapterError):chat 路由守卫经 `pluginsRoutes.use('/plugins/:id/chat/*')`
逐中间件挂载(Hono .post 参数展开 spread 会破坏重载解析);校验顺序
401→403(id)→404(停用)→404(安装/清单)→403(capabilities)→400(body)。
测试:`plugins.test.ts` 门控 describe + `plugins-chat.test.ts` 快乐路径
(假 adapter 接线仿 bff-agents.test.ts)。

**宿主**(`src/plugins/chat-client.ts` 新文件 + host-global/types):
completions 为 async generator,finally 双层 abort;**eventsource-parser 静态
导入**——曾试惰性动态 import 以缩小入口 chunk,但 jest(CJS)不支持运行时
dynamic import,且回退路径引入两套行为,放弃(入口增量约数 KB,可接受);
`jest-setup-env.ts` 补 TransformStream/TextDecoderStream/ReadableStream
(node:stream/web → globalThis,仿既有 TextEncoder 先例)——eventsource-parser
在模块求值期就要 TransformStream,jsdom 缺失。**文档注释含 `tool_*/` 时
`*/` 会提前终止块注释**(types.ts 实测踩坑)。

**主列表过滤**(`src/hooks/use-chat-request.ts`):`useFetchChatList` 过滤
`title.startsWith('plugin:')`,与客户端搜索/分页同层。

**已知限制**:契约快照注释要求的"同步插件仓库(web/agentui)"待 wargame
接入 chat 时执行(当前插件无 chat 诉求,1.2.0 向后兼容,feature-detect 即可);
RAG/社区模式走同一 adapter 链,行为=宿主 chat(D5),未单独验收。

**评审整改(2026-10-14 同日,质量/安全评审后)**:P2——abort 契约在真实
fetch 下不成立(AbortError 抛穿,单测 stub 手动 close 流掩盖)+ 预中止 signal
被忽略,已修(入口检查 + catch 收口 + 模拟 undici abort-reject 的用例);
P3——createSession 加 15s 超时兜底(jsdom 无 AbortSignal.timeout 则跳过)、
BFF title 截断 200 字符、补 completions 503 与 model_id 透传用例、
R1 补记前缀过滤误伤妥协。安全核实:imt_token cookie `sameSite:'Lax'+
httpOnly`(auth.ts),chat POST 的跨站表单 CSRF 被天然阻断。
