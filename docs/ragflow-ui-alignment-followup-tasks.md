# RAGFlow UI 对齐:移植后续任务清单

> 生成时间:2026-11-21 09:52;**v2(2026-11-21 09:54):按技术评审意见修正**——改写 T1.4/T2.1/T2.2/T2.4/T2.5/T2.7/T3.1/T3.6,新增 T2.8(错误揭示)/T2.9(校验差异决策)/T3.7(守卫增强)
> 基线:`dev` 分支,`65f69b4`(P0 主提交)+ `66f2f3d`(评审 P0 修复)已推送至 `origin/dev`
> 关联文档:[ragflow-ui-improvement-recommendations.md](./ragflow-ui-improvement-recommendations.md)(分析、勘误与 P0 实施记录)
> 来源:双评审(Bugbot 质量评审 / Security Review)跟进项 + 改进建议文档的 P1/P2 + 清单技术评审修正
> **⚠ 2026-11-21 过渡期评审勘验**:T4.1 靶点有误(provider 存储/聚合位/校验在 **Rust Gateway + BFF** 层,非 intellect-rag),并发现设置保存链路存在 title-only 存量断点——详见 [p0-port-transition-impact-review.md](./p0-port-transition-impact-review.md)
> **v3(2026-11-21 21:15)**:按 p0 过渡期评审与 [unfinished-tasks-review-20261121.md](./unfinished-tasks-review-20261121.md) 修订——**新增 T2.10(已完成,`7de6206`)**;T4.1 拆分为 **T4.1a(Gateway/BFF)/ T4.1b(intellect-rag)**;T2.4 前置决策**已解锁**(Gateway `prompt_config` 整列替换实证→短期维持整包,T4.2 收敛);T2.7 落点写死 BFF `bff-agents`;T1.1/T1.2/T1.3 完成(`22dce83`)
> **v4(2026-11-22)**:九步交付(module: ragflow-p1-batch,报告 [REPORT-ragflow-p1-batch-20261122.md](../tests/e2e-tests/reports/REPORT-ragflow-p1-batch-20261122.md))——**T2.3/T2.9/T1.4(`ff76959`)、T2.8(`f73e588`)、T2.1/T2.2(`f70df0f`)、T2.7(`d2bc74c`)全部完成**;T2.9 裁决=移植(依据与存量影响评估见该报告);P1 代码项仅余 T2.5/T2.6(清单排定下个迭代)。另:main 合入(v0.4.6)遗留 BFF tsc 9 处类型错误(auth/backchannel-logout/jose,见受限 L-RP1-03)与 login-next 裸色值破守卫(已修 `98c921d`)
> **v5(2026-11-22)**:质量/安全复评([quality-security-review-20261122.md](./quality-security-review-20261122.md))——安全 0 发现;质量 2 Medium+2 Low 已闭环(wizard `Routes`→`@/constants/routes`;保存失败双 toast 收敛到全局 `errorHandler`+服务端 detail;`dataset_ids !== undefined`;`await updateChat`)。T2.5 第一步(`9dadf97`)已合入 ee overlay。
> **v6(2026-11-22)**:九步交付(module: ragflow-t41a)——**T4.1a ①③ 复核 + ② BFF `external-info` 聚合 + GET metadata 透传已完成**;④ 写侧 prune **延期 T4.2**(与 T2.4「换回不丢 key」冲突)。报告 [REPORT-ragflow-t41a-20261122.md](../tests/e2e-tests/reports/REPORT-ragflow-t41a-20261122.md)。
> **v7(2026-11-22)**:九步交付(module: ragflow-next-iter)——**T2.6 oxlint 并行接入**;**T2.5 第二步 `pages/tasks`→`ee/pages/tasks`**;**T4.2 设计文档** [web-search-secret-storage-design.md](./web-search-secret-storage-design.md)。报告 [REPORT-ragflow-next-iter-20261122.md](../tests/e2e-tests/reports/REPORT-ragflow-next-iter-20261122.md)。
> **v8(2026-11-22)**:九步 next-iter-aihub-t3——**T2.5 aihub→`ee/features/aihub`**;**T3.1 虚拟滚动(CSV+chunk)**;**T3.7 color-tokens `--prune`/交叉校验**;T4.2 落地仍等 Gateway(L-T42-01)。报告 [REPORT-next-iter-aihub-t3-20261122.md](../tests/e2e-tests/reports/REPORT-next-iter-aihub-t3-20261122.md)。
> **v9(2026-11-23)**:对齐 HEAD `642d643` remaining-backlog——**T2.5 applications→`ee/features/applications` + admin 三页→`ee/pages/*`**;**T3.2/T3.4/T3.5/T3.6 完成**;九步 `t42-phasebc-prep` 交付 [Gateway secrets API 契约草案](./web-search-secrets-gateway-api-contract.md)+ [Phase B/C 前端对齐准备](./phase-bc-frontend-alignment-prep.md)。**T4.2 M1/M2 仍无 Gateway 实现(L-T42-01)**;D1 仍 L-09/L-10。报告 [REPORT-t42-phasebc-prep-20261123.md](../tests/e2e-tests/reports/REPORT-t42-phasebc-prep-20261123.md)。
> **v9.1(2026-11-23)**:质量/安全评审跟进——BFF `resolveWebSearchProvider` 与前端对齐(非法 provider 不回落 Tavily);补齐 `redactSessionWebSearchSecrets` 供 rag/mcp/openai-base `listSessions`;设计 §10 明确 GET 详情明文为 T4.2 过渡债与缓解面。
> **v9.2(2026-11-23)**:九步 `exec-triad-20261123` 复证三连闸门——Gateway secrets **仍无路由**(L-T42-01 不关闭);kubectl 缺失(L-09/L-10);Go SSE 未稳定(L-PHASEB-01)。交付 secrets probe 客户端 + Go SSE↔StreamChunk/MessageEventType 映射预备(**未接线** live)。报告 [REPORT-exec-triad-20261123.md](../tests/e2e-tests/reports/REPORT-exec-triad-20261123.md)。
> **v9.3(2026-11-23)**:九步 `gate-reverify-20261123` **再次复证**三连仍关——不伪关闭 L-*;增量 `npm run check:exec-gates`([scripts/check-exec-gates.mjs](../scripts/check-exec-gates.mjs))。报告 [REPORT-gate-reverify-20261123.md](../tests/e2e-tests/reports/REPORT-gate-reverify-20261123.md)。
> **v9.10(2026-11-25)**:M1 运行时密钥边界收口——`AgentConfig.web_search_api_key` 使用 `RuntimeSecret`(Debug redacted + zeroize),不再注入 PC;M2 CLI 增加 `--verify`(明文/非 v2 清零);provider guard 纳入 `npm run type-check`;member-token legacy 越权改 strict/404。仍待 native/Python consumer、M2 生产回填、M4 代码、真实浏览器/provider。
> **v9.9(2026-11-25)**:M3 安全评审修复——GET session 仅 owner 返回 PC;匿名/None owner 判定收紧;member token 对 legacy session 改 strict(secrets/PATCH 404);BFF 仅缺 key 时查 secrets;M2 回填补 camelCase/CAS/审计;新增主密钥轮换设计。M1 Gateway→Python `web_search`(仅 Tavily)注入已接;managed check 已开;仍待 `web_extract`/真实 provider、M2 生产回填、M4 代码;provider guard 已入 type-check。评审 [t42-m3-configured-ui-code-review.md](./t42-m3-configured-ui-code-review.md)。
> **v9.8(2026-11-25)**:M3 落地——Gateway GET/PATCH/fork 返回 **sanitized prompt_config + `web_search_configured_providers`**;BFF PATCH 先查 secrets 状态,已配置 provider 允许空 key;前端设置页显示「已配置 — 留空保持」,Internet 开关按 configured 判定;运行时 `apply_session_rag_config` resolve secret 注入内存(不写回 PC)。前端 809 tests/BFF 1271 tests/tsc/build 全绿;真实浏览器截图、真实 provider 与 M2 生产回填仍受限。报告 [REPORT-t42-m3-configured-ui-20261125.md](../tests/e2e-tests/reports/REPORT-t42-m3-configured-ui-20261125.md)。
> **v9.7(2026-11-25)**:补 T4.2 收尾工具——M2 回填 CLI(`web-search-secrets-backfill`,dry-run/apply)、独立 OpenAPI(`/docs/openapi-web-search-secrets.json`)、rotate 别名、provider 三方守卫(`check:web-search-providers`)。生产回填与前端 M3 仍待。
> **v9.6(2026-11-25)**:按安全评审补 Gateway PATCH 写入自保——提取 `*_api_key` → secrets upsert → **剥离 PC**;AES-GCM 增加 `enc:v2:` AAD(`session_id:provider`),相同 key 不重复轮换;`GET secrets` 加 `no-store`;新增 PATCH/AAD/ownership 测试。**新写入明文风险已关闭**;历史 M2、前端 M3、生产部署仍待。报告 [REPORT-t42-gateway-secrets-20261125.md](../tests/e2e-tests/reports/REPORT-t42-gateway-secrets-20261125.md);评审 [t42-gateway-secrets-code-review.md](./t42-gateway-secrets-code-review.md)。
> **v9.5(2026-11-25)**:九步 `t42-gateway-secrets` 落地 Gateway 密钥能力——新增 `web_search_secrets` migration/store 与 PUT/GET/DELETE API、加密/轮换/审计/HTTP 测试;**L-T42-01 Gateway 侧 OPEN**,但 BFF `sanitizePromptConfigWebSearchKeys`/前端 M3 仍未接线,T4.2 整体未完成。报告 [REPORT-t42-gateway-secrets-20261125.md](../tests/e2e-tests/reports/REPORT-t42-gateway-secrets-20261125.md);代码评审 [t42-gateway-secrets-code-review.md](./t42-gateway-secrets-code-review.md)。
> **v9.4(2026-11-25)**:九步 `gate-reverify-20261125` **三连仍 BLOCK**(L-T42-01 / L-09 / L-PHASEB-01);sanitize / Go SSE live **未接线**;oxlint 修 sso-settings 测试死代码(7→6 warning)。报告 [REPORT-gate-reverify-20261125.md](../tests/e2e-tests/reports/REPORT-gate-reverify-20261125.md)。

## 使用说明

- 任务 ID 规则:`T<节>.<序号>`;状态用 `[ ]`/`[x]` 维护,完成后在行尾追加 `(commit <hash>)`。
- **通用验收门槛**(每项任务默认适用,不再逐条重复):`npm run lint` 与 `npm run type-check`(含 `check-color-tokens` 守卫)零错误;相关 jest 测试通过;不引入新的裸色值/未翻译字符串。
- 执行环境备忘:jest 需 `ESBUILD_BINARY_PATH=/tmp/esb025/node_modules/esbuild/bin/esbuild` 绕过存量 esbuild 错配;`npm run dev` 已修复(补装 `@rollup/rollup-linux-x64-gnu`)。
- 预估为单人净工时。

---

## T1 立即可做(合计约 1 天)

### T1.1 `.gitignore` 补日志条目(10 分钟)— **已完成**(`22dce83`,统一为 `*-wsl.log`)
- **动作**:`.gitignore` 已有 `vite-dev.log`、`*storybook.log`(L23/L42),追加 `bff-wsl.log`、`vite-wsl.log`(或统一为 `*-wsl.log`)。
- **验收**:`git status` 不再出现两个日志文件。

### T1.2 删除 `TavilyFormField`(10 分钟)— **已完成**(`22dce83`)
- **动作**:删除 `src/components/tavily-form-field.tsx`(已核实全仓零引用,唯一使用点已在 `65f69b4` 中替换为 `WebSearchFormField`)。
- **注意**:语言键 `tavilyApiKeyTip`/`tavilyApiKeyMessage` **必须保留**(新组件的 Tavily provider 在用);`tavilyApiKeyHelp` 已无消费者(唯一使用者就是被删组件自身),可顺手删除(可选)。**v3 执行记录:zh/en 的 Help 键已删;ar/bg/fr 等其余语言为死键,留待语言文件专项清理。**
- **验收**:全仓 grep 无 `TavilyFormField` 残留;type-check 绿。✅

### T1.3 `PromptConfig.web_search_provider` 类型允许 `''`(30 分钟)— **已完成**(`22dce83`)
- **动作**:`src/interfaces/database/chat.ts` 中 `web_search_provider?: WebSearchProvider;` → `web_search_provider?: WebSearchProvider | '';`,与 `WebSearchKeyConfig`(`WebSearchProvider | ''`)及 schema(`.or(z.literal(''))`)对齐。
- **评审确认**:全仓仅 `web-search-form-field.tsx` L226 一处直读该字段,类型放宽无涟漪。
- **验收**:type-check 绿;`web-search-api-key.test.ts` 不需改即通过;后续可逐步移除测试中的 `as unknown as` 断言(顺带做)。

### T1.4 schema 接线测试(1-2 小时,移植而非新建)— **已完成**(`ff76959`,九步 module: ragflow-p1-batch)
- **动作**:上游 app-settings 已有现成测试族——`use-chat-setting-schema.test.tsx`、`chat-setting-schema.test.ts`、`validate-chat-prompt.test.ts`、`use-reveal-submit-errors.test.tsx`(以及 `agentic-rag-submit.test.ts`)。**移植而非从零写**:改 import 路径、按 agentui 现状取舍后跑通。最少覆盖 3 个断言:
  1. 选 `Search1API` 且 `search1api_api_key` 为空 → parse 失败,issue path === `['prompt_config', 'search1api_api_key']`,message 为 `webSearchApiKeyRequired`;
  2. `web_search_provider: ''`(清除)→ parse 成功(不回落 Tavily);
  3. `AnySearch` 无 key → parse 成功(keyless)。
- **依赖**:建议先做 T2.3(提取纯构建器后可直接调 `buildChatSettingFormSchema(t)`,免 renderHook)。
- **验收**:移植用例绿;全量 next-chats 测试无回归。

---

## T2 P1:评审跟进与结构性改进(约 2-2.5 周)

### T2.1 legacy Tavily 对话框预选 provider(2-4 小时)— **已完成**(`f70df0f`)
- **动作**:在聊天设置表单的默认值装配处(grep `prompt_config` 默认值映射,位于 `use-chat-request` 或 app-settings 的 values builder)加:`web_search_provider ??= WebSearchProvider.Tavily`(**仅当值为 `undefined`**;显式 `''` 是"用户清除",不得回落)。
- **背景**:legacy 对话(仅存 `tavily_api_key`)运行时联网开关可见(`getWebSearchProvider` 推断 Tavily),但设置页 provider/key 均不显示——UI 与运行时脱节。
- **副作用(需知悉)**:预选后打开 legacy 对话并保存,会**首次写入** `web_search_provider: 'tavily'`(此前仅 `tavily_api_key`);与 T4.1 后端枚举无冲突(Tavily 是老字段)。
- **验收**:仅含 `tavily_api_key` 的对话框打开设置页,Tavily 已预选且 key 输入框回填;新建空对话框不受影响;**保存后重开仍预选**。

### T2.2 provider→key 映射收敛单一来源(2-3 小时)— **已完成**(`f70df0f`;实现:web-search-catalog.ts 仅存真实数据,字段/语言键由 `webSearchProviderBaseKey` 枚举派生,catalog 完备性守卫测试 5 例)
- **动作**:把 `src/components/web-search-form-field.tsx` 的 `providerKeyConfig`(name/tip/placeholder/helpUrl)迁至 `src/pages/next-chats/chat/web-search-api-key.ts`(或新文件 `web-search-catalog.ts`);`webSearchApiKeyFields` 由 catalog 派生;form-field 只 import。
- **可更薄的实现(评审补充)**:tip/placeholder 语言键与 `*_api_key` 字段名均可由**枚举值直接派生**——`anysearch` → `anysearchApiKeyTip` / `anysearchApiKeyMessage` / `anysearch_api_key`(14 个 provider 全部符合该模式,含 `search1api`/`youcom`)。catalog 只需保留 **displayName / logo / helpUrl** 三项真实数据,其余一概派生。
- **背景**:当前两份映射并存,新增 provider 需改 5 处(枚举/catalog/映射/schema/locale),易漏。
- **验收**:全仓仅一处映射来源;新增一个 provider 只需改 枚举 + catalog(displayName/logo/helpUrl)+ locale 三处;测试绿。

### T2.3 提取 `buildChatSettingFormSchema(t)` 纯构建器 + `useMemo`(1-2 小时)— **已完成**(`ff76959`)
- **动作**:`use-chat-setting-schema.tsx`(L17 `useChatSettingSchema`)重构为上游模式:导出纯函数 `buildChatSettingFormSchema(t: (k: string) => string)`,hook 内 `useMemo(() => buildChatSettingFormSchema(t), [t])`(上游 hook 即此写法,照搬)。
- **关联**:重构时一并处理 T2.9 的 `chatPromptKbIssues` 决策。
- **验收**:T1.4 的测试可直接调用纯构建器;行为无变化。

### T2.4 处理非活动 provider 的 key 滞留(2-4 小时 + 后端确认)— **短期方案维持;收口并入 T4.2**
- **已核实事实**:保存链路为 `useUpdateChat`(use-chat-request.ts L266)→ `gatewayChatService.patchGatewayChat`(gateway-chat-service.ts L53)→ `api.patchAgentSession(GATEWAY_CHAT_AGENT_ID, chatId)`,patchData **整包**携带 `prompt_config`(`patchData.prompt_config = params.prompt_config`)——非当前 provider 的历史 key 均随每次保存提交(安全评审"凭证滞留"项)。**且保存链路 title-only 断点已由 T2.10 修复(`7de6206`),保存真正生效,本任务的前提成立。**
- **前置决策:v3 已解锁**——p0 过渡期评审实证 Gateway `PATCH prompt_config` 为**整列替换**(`UPDATE sessions SET prompt_config=$1`)。原三案裁决:
  1. ~~前端剥离~~ **排除**(整列替换语义下剥离 = 永久删除,换回需重填);
  2. **后端忽略(选定)**:短期维持前端整包(换回 provider 不丢 key,体验优先),存储侧按活动 provider 过滤并入 **T4.1a / T4.2**(密钥独立存储),避免过渡期一次性投入;
  3. ~~切换即清空~~ **排除**(误切换即丢数据)。
- **v9**:Gateway secrets **未实现**;禁止在无表时接线 `sanitizePromptConfigWebSearchKeys`。契约见 [web-search-secrets-gateway-api-contract.md](./web-search-secrets-gateway-api-contract.md)。
- **验收**:按选定方案,PATCH payload/存储中仅含策略定义的 key 集合;`use-show-internet` 与保存后重载行为一致。

### T2.5 ee overlay 化改造— **本仓目标模块已完成**(v9)
- **评审调整**:原"3-5 天全量迁移"低估了 `features/_registry.ts`、`routes.tsx`、i18n、BFF 路由的耦合,改为增量验证式。
- **第一步(1-2 天)— 已完成**(`9dadf97`):建立 `src/ee/` 骨架与别名,迁移 `pages/wizard`。
- **第二步— 已完成**:tasks→`ee/pages/tasks`;aihub→`ee/features/aihub`;**applications→`ee/features/applications`**;BFF 专属 admin(`harness-backends`/`sso-settings`/`tenant-bindings`)→`ee/pages/*`(`642d643` remaining-backlog)。
- **背景**:上游已全面 ee overlay 化(#21667/#21696/#22304);此举使后续 cherry-pick 上游时冲突面最小。
- **验收**:ee 模块路由/构建正常;共享层仅 `@/ee/*` import。

### T2.6 引入 oxlint(0.5-1 天)— **已完成**(v7,`ragflow-next-iter`)
- **动作(已实施)**:安装 `oxlint@1.94`;`.oxlintrc.json`;`lint` 串行 `eslint && oxlint src`;`lint:oxlint` 快捷脚本;修复 `custom.d.ts` TS(2309) 阻断错误。
- **基线**:全仓 ~0.8s;exit 0;**23 条 warning 基线化**(未 `--deny-warnings`);稳定一轮后再考虑替换 eslint。
- **验收**:oxlint 全仓 < 5 秒 ✅;存量告警基线化 ✅。

### T2.7 agent session PATCH 校验镜像(0.5-1 天)— **已完成**(`d2bc74c`;`bff/src/utils/web-search-validation.ts` 纯函数 10 例 + 路由 7 例)
- **已核实链路(v3 定案)**:PATCH 服务方 = **BFF `bff/src/routes/bff-agents.ts`**(Gateway 实证);T2.10(`7de6206`)已透传 `prompt_config`/`kb_ids`,校验在 BFF 透传前叠加。
- **动作**:在 BFF PATCH 路由增加校验:合法 `web_search_provider` 枚举 + 需 key 的 provider 必须携带非空 key(复刻 `missingWebSearchApiKeyField` 规则,可移植为服务端纯函数);非法即 4xx。
- **背景**:前端 `superRefine` 可被直接 HTTP 调用绕过(安全评审"中"项);agent session 是分享/嵌入场景的同一数据面,校验尤为重要。
- **验收**:绕过表单直接发 PATCH(缺 key)返回 4xx 及明确错误信息;服务方侧有单测。

### T2.8 保存错误揭示机制(P1 内靠前,建议紧随 T2.3;1-2 天)— **已完成**(`f73e588`;关键配套:`collapse.tsx` 同步移植上游渲染期受控版本,旧版 useEffect 同步使内容挂载晚一 commit、布局效应扑空——插桩实证)
- **动作**:
  1. 移植上游 `use-reveal-submit-errors`(+测试 `use-reveal-submit-errors.test.tsx`);
  2. `chat-prompt-engine.tsx` 对齐上游 `ChatPromptEngineProps` 的受控展开参数(`advancedSettingOpen` / `onAdvancedSettingOpenChange` / `naiveSettingOpen` / `agenticSettingOpen` 等),由保存失败驱动对应 Collapse 展开;
  3. 滚动/聚焦到首个出错字段。
- **背景**:`66f2f3d` 补的 `<FormMessage />` 只解决了"错误有处渲染";**高级设置面板默认折叠时用户依然看不见**——本任务是让评审 P0 修复真正对用户可见的最后一环。
- **验收**:构造缺 key 保存 → 面板自动展开、视口滚动到该字段、FormMessage 可见;上游相关测试移植通过。
- **v5 补强**:HTTP 层保存失败改为仅由 `next-request` `errorHandler` 弹一次 toast,且优先展示 BFF `data.message`(去掉 `useUpdateChat.onError` 双弹);见 [quality-security-review-20261122.md](./quality-security-review-20261122.md)。

### T2.9 schema 校验差异决策(0.5 天:决策 + 记录或补齐)— **已完成,裁决=移植**(`ff76959`)
- **背景**:上游 formSchema 的 superRefine 除 missing-key 外还调用 `chatPromptKbIssues`(`validate-chat-prompt.ts`,校验 system prompt 与知识库变量引用等);agentui 自 fork 起**无此文件与校验**。
- **动作(二选一)**:
  1. 认定为 fork 时点缺失 → 随 T2.3 一并移植 `validate-chat-prompt.ts` + 测试;
  2. 认定为 agentui 有意去除 → 在本清单/CLAUDE.md 记录原因,防止后续同步时误判为缺陷。
- **验收**:决策记录在案;若选移植,`chatPromptKbIssues` 相关测试绿且存量对话保存不回归。

### T2.10 设置保存链路修复(v3 新增,**已完成** `7de6206`,0.5-1 天 → 实际 ~0.5 天)
- **动作(已实施)**:①`bff-agents.ts` PATCH 路由透传 `prompt_config`/`kb_ids`(移除 title-only 提取与 400 拦截,snake/camel 键名兼容);②四个 adapter(intellect-enterprise/intellect-rag/mcp-base/openai-base)的 `updateSession` 签名扩展 `{ title?, kbIds?, promptConfig? }` 并透传;③前端 `use-chat-request.ts` 附带修复 kb_ids 空数组放行(清空知识库绑定可保存);④新增 PATCH 透传/空数组/camelCase/非法值 4 组用例。
- **遗留收口**:见 [chat-settings-save-f1-release-notes.md](./chat-settings-save-f1-release-notes.md);生产实网 F1 仍受限 L-09。

---

## T3 P2:体验与架构(随版本迭代)

### T3.1 虚拟滚动(1-2 天)— **已完成**(v8)
- **动作(已实施)**:依赖 `@tanstack/react-virtual`;`csv-preview.tsx` 行虚拟化;knowledge-chunk / dataflow `chunker` 列表虚拟化(+measureElement)。
- **验收**:万行 CSV/千条 chunk 滚动帧率稳定,内存不随行数线性增长。

### T3.2 分块引用图预览源文档(1-2 天)— **已完成**(九步 remaining-backlog)
引用图悬停「查看源文档」→ `navigateToChunkParsedResult(document_id, dataset_id)`。

### T3.3 `builtin-pipeline` 只读展示页(2-3 天)
后端暴露 builtin pipelines 列表后新增 `src/pages/builtin-pipeline`(上游 #20656 模式:agents 列表中只读展示)。**依赖澄清:该 API 属上游 Go 后端能力,agentui 当前对接的 intellect-rag Python fork(v0.26.1)没有——实际阻塞于 T4.1/Phase C,不应在 Python 侧实现。**

### T3.4 i18n overlay 拆分(1 天)— **已完成**(zh/en)
私有词条 → `src/ee/locales/{en,zh}-private.ts`,由 `locales/config.ts` merge。

### T3.5 字体 token 化(0.5 天)— **已完成**
`--font-display` / `--font-mono` 语义别名 → TRAE;tailwind `font-display`/`font-mono` 走别名。

### T3.6 上游子树同步机制(1 天)— **已完成**(定案 archive+rsync)
`scripts/sync-upstream-web.mjs`;CLAUDE.md 每月节奏;不覆盖 `src/ee/`。

### T3.7 `check-color-tokens` 增强(0.5 天)— **已完成**(v8)
- **动作(已实施)**:`total`↔sum(files) 交叉校验失败即退出;改进文件提示 `--prune`;`--prune`/`--update` 重写基线并剔干净文件。基线收缩 299→298。
- **来源**:Bugbot 评审指出的守卫局限。

---

## T4 跨仓库配套

### T4.1 后端 provider 枚举同步(v3 拆分,原单条靶点有误)
- **T4.1a Rust Gateway/BFF(1-2 天)— 代码项已完成(v6,九步 ragflow-t41a)**:①透传复核(多 key 共存 PATCH 用例);②`GET /api/bff/agents/chat/sessions/:id/external-info` 聚合 `has_web_search_provider`(+`has_tavily_key`),前端 chat 分享改打该路径;enterprise `normalizeSession` 经 metadata 透传 `prompt_config`/`kb_ids`;③T2.7 既有;④**写侧 prune 延期 T4.2**(短期整包保「换回不丢 key」;external-info 响应侧永不回传 key)。`sanitizePromptConfigWebSearchKeys` 已在 BFF utils 就绪,待 T4.2 接线。
- **T4.1b intellect-rag(随 Phase C 评估)**:仅检索执行联动——联网搜索执行链路按 provider 分发(未支持的 provider 保存后静默失效是当前最大风险)。**不在 Python fork 上做一次性投入**,Go 化后实现。

### T4.2 密钥存储架构评估— **Gateway API✓(v9.5);BFF/前端 M1+ 待接线**
- 设计:[web-search-secret-storage-design.md](./web-search-secret-storage-design.md) 方案 C,M0–M4。
- **v9 契约草案**:[web-search-secrets-gateway-api-contract.md](./web-search-secrets-gateway-api-contract.md)(PUT/GET/DELETE secrets、PC 剥离时机、禁止无表 prune)。
- **M1/M2 接线**:Gateway API 已实现(2026-11-25);下一步开 module `t42-m1-wire` 接 BFF/前端;T4.2 仍未完成。
- **v9.2 预备**:`bff/src/utils/web-search-secrets-client.ts`(probe);未挂路由。
- Phase B/C 前端准备:[phase-bc-frontend-alignment-prep.md](./phase-bc-frontend-alignment-prep.md);Go 映射预备 `map-go-stream-agent-event.ts` / `go-canvas-sse-adapter.ts`(**L-PHASEB-01** 未接线)。

---

## T5 Go 化主线(既定,详见 intellect-rag/docs/go-migration-feasibility-and-repo-strategy.md)

| 阶段 | 内容 | 量级 | 并行前端任务 |
|---|---|---|---|
| Phase A | intellect-mem → Go(复用上游 memory,作 Go 服务化样板) | 2-4 人周 | — |
| Phase B | intellect-dsl → Go。完成度与剩余项:`ragflow/docs/plans/agent-dsl-go-development-plan.md`(约七成可跑主流画布;与 Python `1718fd9` 约六成)。设计真源仍是 `agent-go-port-design.md` | 3-6 人月 | **画布页面对齐**:事件适配 + `NormalizeForCanvas`。对接任务 F-01～F-03 在该计划第 7 节。`go-canvas-sse-adapter.ts` 仍是 **L-PHASEB-01 未接线**;G-01 冻结 SSE 事件前不打开 Phase B live |
| Phase C | intellect-rag:上游 Go 基座 + 回植多租户 scope/deepdoc 定制/chunk 过滤;`cmd/` 多入口 | 3-6 人月 | dev proxy 切 Go API;T3.3 的 pipeline API 在此到位 |
| Phase D | 删 Python、CI 全面切 Go、docs 去迁移化表述 | ~1 个月 | 全量前端回归 |

---

## 依赖关系与建议节奏

```text
T4.2 契约草案 ──▶ Gateway 实现 ──▶ t42-m1-wire(BFF sanitize + GET 标志)
Phase B 准备文档 ──▶ Go SSE 稳定 ──▶ phase-b-sse-adapter
D1 手册 ──▶ 持权 kubeconfig ──▶ prod-d1-exec
```

建议节奏(**v9.4**):~~设计/契约/probe/映射预备/闸门探测脚本~~ **已完成**;2026-11-25 复验闸门 **仍关**(`npm run check:exec-gates`)。余 **T4.2 M1 真接线**、**D1 真执行**、**Phase B live**、**T3.3 / T4.1b / T5**(均依赖跨仓/生产闸门 OPEN)。

## 工作量汇总

| 分组 | 任务数 | 量级 |
|---|---|---|
| T1 立即可做 | 4(**全部完成**) | ~1 天 ✓ |
| T2 P1 | 10(**T2.1–T2.3/T2.5–T2.10 完成;T2.4 收口→T4.2**) | 余 T4.2 接线 |
| T3 P2 | 7(**T3.1/2/4/5/6/7✓;T3.3 等 Go**) | 随 Phase C |
| T4 跨仓库 | T4.1a✓ / T4.2 Gateway API✓ / T4.1b→Phase C / T4.2 BFF/UI 待接线 | **t42-m1-wire** |
| T5 Go 化 | 4 阶段 | 3-5 人 × 6-9 个月 |
