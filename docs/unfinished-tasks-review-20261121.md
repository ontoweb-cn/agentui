# 未完成任务清单分析评审

> 生成时间:2026-11-21 18:40
> 评审对象:工作树(`dev` @ `72efd66` + 大量未提交改动)与三份任务跟踪文档中的全部"未完成"项
> 评审方法:逐项代码核实(读实现/测试/挂载点)+ 门禁实测(BFF vitest 全量、前端 type-check 三守卫)
> 关联文档:[ragflow-ui-alignment-followup-tasks.md](./ragflow-ui-alignment-followup-tasks.md)(v2)、[model-provider-p1b-remaining-analysis.md](./model-provider-p1b-remaining-analysis.md)、[p0-port-transition-impact-review.md](./p0-port-transition-impact-review.md)(v2)、[wizard-followup 大纲](../tests/e2e-tests/outline/wizard-followup.md)

## 一、总体结论

1. **在途工作的真实进度领先于文档记录**:Wizard-SSO 遗留(A5/A6/A7/A8)与 T2.10 的**编码已全部完成**并通过全部自动化门禁——BFF vitest **1109/1109**(基线 1035 → +74,含 sso-admin 9 例、sso-store 8 例、PATCH 新用例);前端 type-check 三守卫(hiedu-shared 快照 / color-tokens / tsc)全绿。文档中的"未完成"实质收敛为 **E2E 验证 + 提交**两个收尾动作。
2. **评审新增 1 个 P1 级缺口(文档未记录)**:A7 的 `/admin/sso/*` 仅挂 `authMiddleware`(纯凭据存在性检查,任意非空 cookie/header 即放行),未叠加同类管理路由的标准门控 `requireValidImtSession`(后端实校)——**任何能触达 BFF 的请求者均可改写全局 SSO 配置**。~~建议提交前补齐~~(**已于同日补齐**,见 §三.1 补强记录)。
3. 清单类任务(RAGFlow T1-T5、模型页 P1-b、D1/D2)均未启动,状态与文档一致;但 **T2.4 的前置决策已被 p0 评审实证解锁**(Gateway `prompt_config` 整列替换),决策输入已齐。
4. 最大风险不在任务本身,而在**工作树积压**:约 25 个改动文件横跨两条交付线(T2.10 / Wizard-SSO),未提交状态持续越久,冲突与丢失风险越大,建议立即分批提交。

## 二、逐项核实(证据表)

| 任务 | 文档口径 | 实际核实 | 证据 |
|---|---|---|---|
| **T2.10** BFF title-only 断点修复 | 清单 v2 无此项(p0 review §六建议新增) | **已实现,未提交** | `bff-agents.ts` L246-278 PATCH 路由透传 title/kb_ids/prompt_config(snake/camel 键名兼容);4 个 adapter 全部扩展(intellect-enterprise L244、intellect-rag L122、mcp-base L208、openai-base L129);`use-chat-request.ts` L277 附带修复 kb_ids 空数组放行(清空绑定可保存);新增 4 例 PATCH 测试(bff-agents.test.ts L560/L592/L607/L622、enterprise adapter L381),全绿 |
| **A5** 凭据迁出 sessionStorage | 大纲:待办 | **已实现,未提交** | `wizard/index.tsx` L63-156:`wizard-draft-credentials` 键、saveDraft 剥离凭据、sessionStorage 不可用静默降级(仅丢凭据) |
| **A6** babel glob Windows 修复 | spec:已完成 | 已实现,**未提交**(修复本体在工作树) | `babel-plugin-import-meta-glob.cjs` 为 M 状态;前端全量 750/750(spec 记录) |
| **A7** SSO 运行时配置 | 大纲:待办 | **已实现(含缺口,见 §三.1),未提交** | `sso-store.ts`(runtime>env 逐字段合并、文件损坏回落 env、删除即回滚)、`sso-admin.ts` GET/PUT/DELETE + 400 校验族、`index.ts` L322-323 挂载 |
| **A8** kag 类型说明文案 | 大纲:待办 | **已实现,未提交** | `harness-backends.tsx` L618-623 `kagHint`(MCP 协议族 spec-012/不在向导) |
| **A2** 首装 E2E / **A3** 真网关取证 | 大纲:待办 | 3 个 case 文件已写,**未执行** | `tests/e2e-tests/cases/wizard-followup/*`;受限项 L-01(IdP 凭据)、L-03(BFF 9390 接管重启需备份恢复) |
| **A4** 依赖治理 | 大纲:待办 | **部分间接证据**:根 type-check/vitest 在 Windows 均可跑;验收动作(`Test-Path bff/node_modules/tsx`、tsx/vitest 直调)未走 | package-lock.json 有改动(归因未逐项核实) |
| T1.1-T1.4 / T2.1-T2.9 / T3.* / T4.* | 清单 v2:未做 | 未做,与文档一致 | `.gitignore` 无 wsl 条目(T1.1);`tavily-form-field.tsx` 仍存在(T1.2) |
| 模型页 P1-b §4.1/4.4/4.6 + D1/D2 | 分析文档:未实施 | 未实施,与文档一致 | 以分析文档为准,未逐行复核 |

**门禁实测**:
- BFF:`npx tsc --noEmit` 0 错;`npx vitest run` **58 文件 1109/1109 通过(9.4s)**
- 前端:`npm run type-check` 0 错;hiedu-shared 快照一致(shared@1.0.0,7 文件);color-tokens 基线 299 无新增;**提示 `wizard/index.tsx` 已 clean,下次 `--update` 基线可收缩**

## 三、评审发现(按严重度)

### 1. [P1] A7 `/admin/sso/*` 鉴权强度不足(评审新增)

- **现状**:`app.use('/admin/sso/*', authMiddleware)`(index.ts L322)。`authMiddleware` 是**存在性检查**:企业版 flag 开启时任意非空 `imt_token` cookie 值即放行(不做签名/后端实校);RAG 版任意非空 Authorization 头即放行(auth.ts L36-58)。
- **对照**:`/admin/harness-backends/*` 挂 `authMiddleware + requireValidImtSession` 双层(index.ts L228-229),后者将 token 交企业后端实校(401 无效 / 502 认证源不可达 / 503 无就绪实例,fail-closed)。
- **影响**:PUT/DELETE `/admin/sso/config` 可改写全局 SSO 开关、providers、silentRelogin,且 **runtime 文件优先于 env、PUT 后即时生效**——等于把影响全员登录链路的运维面暴露给任意请求者。
- **建议**:提交前补 `requireValidImtSession`,并在 `sso-admin.test.ts` 补 401/403 用例(大纲 R6 L-02 原本预告了"错误=401/400"覆盖,当前 0 例鉴权测试)。改动量约 1 行中间件 + 测试,~1 小时。
- **补强记录(2026-11-21 同日)**:已补——index.ts 挂载 `authMiddleware + requireValidImtSession` 双层;`sso-admin.test.ts` 新增"鉴权门控(评审补强)"describe 5 例(PUT 无凭据 401 / 垃圾 cookie 实校 401 / 有效 token 放行 200 / 认证源不可达 502 fail-closed / 社区模式直通+存在性底线),14/14 绿;BFF 全量 **1114/1114** 通过,tsc 干净。社区模式弱放行路径(任意 Authorization 头)与既有 `/admin/*` 一致,已在注释中说明、不为其建绿测试。

### 2. [P2] T2.4 前置决策已解锁(信息更新,非缺陷)

- p0 review v2 已实证 Gateway `PATCH prompt_config` 为**整列替换**(`UPDATE sessions SET prompt_config=$1`)。叠加 T2.10 现在的链路:前端整包 → BFF 透传 → Gateway 整列替换——**非活动 provider 的 key 每次保存都会全量落库**(key 滞留现状坐实)。
- 决策建议:原三案中**方案 1(前端剥离)可排除**——整列替换语义下剥离 = 永久删除,换回需重填;**短期维持整包**(换回 provider 不丢 key,体验优先),把"存储侧按活动 provider 过滤"并入 **T4.1a / T4.2**(密钥独立存储),避免过渡期一次性投入。决策记录进清单 v3 即可。

### 3. [P2] 测试盲区:sso-admin 无鉴权用例

`sso-admin.test.ts` 9 例全为 400 校验与读写语义,0 个 401/403 用例;与发现 1 一并补齐。

### 4. [P3] T2.10 合入即改变存量行为,需发布说明

修复合入后设置页保存**首次真正生效**:存量对话(此前保存静默失败)首次保存会把整包 prompt_config 写入 Gateway;"清空知识库绑定"从不可能变为可能。建议提交信息与发版说明明确该行为变化,并执行 p0 review §七 F1 的端到端验证(改 system prompt → 保存 → `GET /api/sessions/{id}` 观察 prompt_config 变化)。

### 5. [P3] color-tokens 基线收缩窗口

type-check 提示 `wizard/index.tsx` 基线条目已清(improved);A5 收尾提交时顺手 `--update`,防 T3.7 所述"删净后残留"。

### 6. [P3] 文档时效

清单 v2→v3 迁移仍未做(p0 review §七.2);本文 §二 证据表可直接作为 v3 的状态基线。CLAUDE.md L24 拓扑表述、移植文件 provenance 注释(§七.4)建议同批处理。

## 四、优先级与节奏建议(修订)

```text
第 1 批(立即,~0.5 天)
  ① 补 A7 requireValidImtSession + 401/403 测试
  ② 分批提交:commit-1 = T2.10(BFF 路由+adapter+前端 kb_ids+测试,独立成提交)
             commit-2 = Wizard-SSO A5/A6/A7/A8(可按模块再拆)
  ③ 提交后 BFF 全量 + 前端全量作提交门禁
第 2 批(~1 天)  A2 首装 E2E 闭环(按 L-03 备份/恢复纪律)+ A3 真网关取证 → wizard-followup 交付闭环
第 3 批(~1 天)  清单升 v3 + T1.1/T1.2/T1.3(半天内)→ T1 全清
第 4 批(P1 主线) T2.3 → T1.4/T2.9 → T2.8 → T2.2;T2.4 按 §三.2 建议记录决策后实施
并行外线        D1/D2(P1-b,生产配置/业务拍板)、T4.1a(Gateway/BFF 侧)、A4 验收动作
```

## 五、风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 工作树约 25 文件积压,跨 T2.10 与 Wizard-SSO 两条交付线 | 高 | 立即分批提交(第 1 批);提交前 git diff 逐文件归因,排除误混入 |
| `/admin/sso/*` 鉴权缺口随 A7 提交被固化 | 高 | 提交前补 `requireValidImtSession`(§三.1) |
| A2 E2E 涉及 BFF 9390 重启与 3 个数据文件移走 | 中 | 按 L-03:备份 harness-backends/token-vault/bff-tenants + 删 `.bootstrap-token` + 重启后健康验证 |
| 保存链路修复后存量行为变化(§三.4) | 中 | 发布说明 + 端到端 F1 验证 |
| `has_web_search_provider` 聚合位未实现(T4.1a) | 中 | 前端回落 `has_tavily_key` 兜底,过渡期成立;T4.1a 尽早发起 |
| sso-config.json 运行时文件与 env 双源漂移 | 低 | GET `sources` 字段已标注来源;运维手册补"删文件即回滚 env" |

## 六、对跟踪文档的差异汇总(供清单 v3 更新)

- **T2.10**:从"建议新增"→"已实现待提交"(含 kb_ids 空数组附带修复与 4 例新测试);
- **T4.1**:维持 v2 review 的拆分建议(T4.1a Gateway/BFF、T4.1b intellect-rag 检索联动);
- **T2.4**:前置决策从"待确认"→"已解锁"(整列替换实证),建议短期整包 + T4.2 收敛;
- **Wizard-SSO**:A5/A6/A7/A8 状态"待办"→"已实现待提交";A2/A3 →"用例就绪待执行";A4 →"部分完成待验收";
- **新增条目**:A7 鉴权补强(§三.1)、sso-admin 401/403 测试(§三.3)、T2.10 行为变化发布说明(§三.4)、color-tokens 基线收缩(§三.5)。
