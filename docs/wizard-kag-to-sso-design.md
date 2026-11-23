# Wizard 首装向导改造设计:KAG 下架与 SSO(统一认证)配置引入

| 项 | 值 |
|---|---|
| 文档版本 | v1.3(选型形态修订指针,见下方「修订」) |
| 日期 | 2026-11-21(修订 2026-11-23) |
| 状态 | 部分被 supersede:**SSO 挂载形态见新设计** |
| 关联 spec | spec-010(向导)/ spec-012(KAG Adapter)/ spec-014(SSO Token Exchange,P1/P2 已交付) |
| 改动范围 | 本仓(BFF `bff/` + 前端 `src/`),无跨仓顺序约束 |

> **修订(2026-11-23)**:D2 / §4.1–4.2「SSO 作为 `intellect-enterprise` Connection 内嵌可选区块」**已废止**。  
> 新定稿:**SelectType 双企业卡**——首卡「企业版（SSO模式）」、次卡「企业版（非SSO模式）」;两卡均落地 `type=intellect-enterprise`,以 `setupProfile` 区分。  
> 真源:`docs/wizard-enterprise-sso-mode-design.md` **v1.2**（§8 选型 + **§9 质量/安全**:公网前须 S1 SSRF/`safeFetch`、S2 envSnippet 消毒、Q1 Switch import）。下文 KAG 下架、RAG 延后、envSnippet 仍有效;凡写「仅 enterprise 渲染可跳过 SSO」处一律以新设计为准。

---

## 1. 背景与目标

### 1.1 背景

- 首装向导(spec-010)当前提供 KAG 后端类型选项,但 KAG 能力价值最低(仅 MCP)、向导探测路径(`/v1/models`,OpenAI 兼容)与其 MCP 协议不匹配、卡片无可展示能力徽章;
- spec-014 已交付完整的 SSO 登录链路(BFF 作为 OIDC RP,网关 exchange 签发 `imt_*`),但其配置**只有 env 形态**(需手改 `.env` + 重启),与向导首装流程零耦合——首装完成后管理员仍需手工开启统一认证;
- 向导 enterprise 分支当前强制填写 RAG 插件(`ragEndpoint`/`ragApiKey`)并创建伴生 RAG backend;RAG 与登录链路解耦,不应阻塞首装,可延后至管理端配置。

### 1.2 目标

| 编号 | 目标 |
|---|---|
| G1 | 向导不再提供 KAG 后端类型(仅向导范围,管理端与 BFF Adapter 不动) |
| G2 | ~~向导在选定 `intellect-enterprise` 后提供内嵌 SSO 区块~~ → **改为** SelectType 首卡「企业版（SSO模式）」强制配置 SSO(见 `wizard-enterprise-sso-mode-design.md`) |
| G3 | SSO 配置通过向导产出 `.env` 片段落地(envSnippet 引导),不在 BFF 新增持久化面 |
| G4 | 向导移除 RAG 插件区块;enterprise 首装后画布/知识库等 RAG 依赖能力降级隐藏,后续经管理端(Harness Backends)补配即自动恢复 |
| G5 | 不破坏现有 env-only 部署与存量 kag 配置 |

### 1.3 非目标

- 不实现网关侧 OAuth provider 的 CRUD(provider 的 client_id/authorize_url/client_secret 仍在网关与 IdP 管理面维护,向导只读展示);
- 不做 SLO / token refresh(spec-014 边界不变);
- 不改动 spec-014 的旧链路(网关 302 回调)与 `/auth/login/channels` 开关逻辑;
- 不把 `WizardDraft` 中既有的 bearer token 迁出 localStorage(既有决策,见 §9 R8);
- 不实现 SsoStore 运行时配置存储(列为后续演进,见 §9 R14)。

---

## 2. 决策记录(已确认)

| # | 决策点 | 结论 |
|---|---|---|
| D1 | KAG 下架范围 | **仅向导**(管理端下拉/zod enum、BFF Adapter、`BackendType` 类型联合均保留) |
| D2 | SSO 步骤形态 | ~~Connection 内嵌可选区块~~ → **SelectType 独立首卡「企业版（SSO模式）」**(见新设计 D1–D7);仍保持 6 步状态机 |
| D3 | `BFF_SSO_STATE_SECRET` 处理 | **envSnippet 引导**(客户端生成随机值,运维复制到 `.env`;不落盘) |
| D4 | SSO 渠道白名单 | **进向导**(多选,映射 `BFF_SSO_PROVIDERS`;不选 = 不过滤) |
| D5 | RAG 插件区块 | **从向导移除**;管理端后续补配(PUT 已支持),运行时自动降级/恢复 |
| D6 | `getProtocolFamily('kag')` 前后端漂移 | **顺带修复**(前端映射 kag → `mcp-protocol`) |

---

## 3. 现状分析

### 3.1 统一认证(SSO)现状(spec-014 已交付)

BFF:

- `bff/src/services/sso-config.ts` — env 配置加载与启动 fail-fast:`BFF_SSO_ENABLED`、`BFF_SSO_STATE_SECRET`(≥32 字符)、`BFF_PUBLIC_ORIGIN`(生产强制 https,例外 `BFF_ALLOW_INSECURE_SSO=true`)、`BFF_SSO_PROVIDERS`(全局渠道白名单,null = 不过滤)、`BFF_SSO_SILENT_RELOGIN`(默认 true)、exchange 超时/provider 缓存;回调路径 `/api/bff/auth/oauth/callback`;
- `bff/src/services/sso-providers.ts` — 调网关**公开**端点 `GET /api/members/oauth/providers`(不携带 API_SERVER_KEY),按 `tenantId@baseUrl` 缓存 30s(旧值容忍 ≤5min),过滤 `enabled=true` + `usage=login` + PKCE S256;字段缺失 → misconfigured;
- `bff/src/services/sso-state.ts` — 签名 state Cookie(state/nonce/code_verifier/provider_id/tenant_id/return_to/silent);
- `bff/src/services/sso-exchange.ts` — `POST /api/members/oauth/exchange` 兑换 `imt_*` member token;
- `bff/src/routes/auth.ts` — `/auth/login/channels`、`/auth/sso/authorize/:provider`、`/auth/sso/relogin`(prompt=none)、`/auth/oauth/callback`(验签 → exchange → Set-Cookie → returnTo)。

前端:

- `src/pages/login-next/index.tsx` — 登录页 SSO 渠道按钮;
- `src/hooks/use-login-request.ts` — `useLoginChannels` / `useLoginWithChannel` / `useAuthMode`;
- `src/hooks/auth-hooks.ts` — 企业版 cookie 探测 + 401 静默重登(5 分钟节流);`useOAuthCallback` 处理 `?error=`/`?auth=`;
- `src/locales/zh.ts` — `login.ssoError.*` 12 个错误码。

**硬约束**:

1. SSO 仅在租户 `authMode === 'intellect-enterprise'` 时生效(`auth.ts` `resolveSsoTenantBackend`);authMode 由向导 setup 写入租户 '0'(enterprise → `intellect-enterprise`,其余 → `intellect-community`)——**向导选型与 SSO 生效条件天然对齐**;
2. SSO 配置目前仅 env 形态,运行时不可改;敏感凭证不落盘 JSON(Constitution Token Security)。

### 3.2 Wizard 现状(spec-010)

- 六步状态机:Welcome → SelectType → Connection → Probe → Confirm → Done;Step 3-4 草稿持久化到 localStorage `wizard-draft`,Step 5-6 刷新检测 `needsSetup`;
- BFF `BACKEND_TYPE_OPTIONS`(`bff/src/routes/wizard.ts`):`kag / intellect-enterprise / intellect-community / hermes / agent-scope`(`intellect-rag` 为伴生插件不单列);
- KAG 条目:`{ type:'kag', defaultEndpoint:'http://localhost:3000', capabilities: 仅 mcp=true, credentialKind:'bearer-token' }`;
- **KAG 问题**:probe 走通用 `/v1/models` OpenAI 兼容分支,与 MCP SSE 协议不匹配;Step 2 徽章仅渲染 canvas/knowledgeBase/multiTenant/modelManagement 四项,KAG 四项全 false,卡片无徽章;
- enterprise setup 当前强制:tenantId(32 位 hex)+ `ragEndpoint`/`ragApiKey`,并创建伴生 RAG backend + `setCanvasBinding(tenant, ragConfig.id)`;
- 鉴权:`wizardSetupAuth` = admin 会话(方案 A 经 `checkImtSession` 真实校验)或 bootstrap token 或首装无凭据放行;probe/backend-types/status 为公开端点,probe 有 IP 滑动窗口限流 + SSRF 防护;
- 兼容细节:前端 axios 拦截器将 camelCase 转 snake_case,BFF setup 已做 `toCamel` 归一化(嵌套对象需覆盖)。

### 3.3 KAG 引用面(仅向导下架 → 触碰范围)

- 触碰:`bff/src/routes/wizard.ts`(选项表 + probe 拒绝)、`bff/src/routes/wizard.test.ts`;
- **不动**:`bff/src/services/adapters/kag/*`、`bff/src/index.ts` 工厂注册、`bff/src/services/harness-store.ts` zod enum(删 enum 会导致存量 `harness-backends.json` 启动 fail-fast)、`bff/src/types/harness-admin.ts` VALIDATION_RULES、`src/services/wizard-service.ts` / `src/services/harness-admin-service.ts` 的 `BackendType` 联合、`src/pages/admin/harness-backends.tsx`(kag 仍可手工配置);
- 附带发现:前端 `PROTOCOL_FAMILY_BY_TYPE` 将 kag 映射为 `openai-compatible`,而 BFF 侧 KAG 属 `mcp-protocol` 族(spec-012);前端 `ProtocolFamily` 联合亦缺 `'mcp-protocol'`(D6 修复)。

---

## 4. 总体设计

### 4.1 向导流程(保持 6 步)

```
Step1 Welcome
Step2 SelectType        — KAG 卡片消失(BFF 选项表驱动)
Step3 Connection        — 通用:名称/端点/凭据
                          enterprise 附加:Intellect 租户 ID + SSO 区块(RAG 区块移除)
Step4 Probe             — enterprise:fetchTenantInfo(/api/tenant/info);其余:/v1/models
Step5 Confirm           — 新增 SSO 摘要行(secret 永不回显)
Step6 Done              — envSnippet(+SSO 片段);新增 warnings 展示(含 RAG 延后提示)
```

### 4.2 SSO 区块(新组件 `SsoSection`,`src/pages/wizard/` 下新文件)

仅当 `selectedType === 'intellect-enterprise'` 渲染;包含:

1. **启用开关**(默认关;关闭时折叠,显示"稍后可在管理端配置"提示);
2. **获取登录渠道**按钮 → `GET /api/bff/admin/wizard/sso/providers?endpoint=…` → 只读展示渠道(id/名称/icon/misconfigured 原因);
3. **渠道白名单**多选(不选 = 不过滤);
4. **publicOrigin** 输入,预填 `window.location.origin`;选 `http://` 时显示警告:生产启动将 fail-fast,需 https 或 `BFF_ALLOW_INSECURE_SSO=true`(内网 http 合法路径,不阻断);
5. **stateSecret**:「生成」按钮,`crypto.getRandomValues` 生成 48 字符;输入框支持明文切换与复制(**仅组件内存态,不进 localStorage 草稿**,刷新丢失可重新生成);
6. **静默重登**开关(默认开)。

### 4.3 API 契约变更(全部在现有 wizard 路由族)

**新增只读端点**(公开,与 probe 同级防护):

```
GET /api/bff/admin/wizard/sso/providers?endpoint=<enterprise-gateway-url>
→ 200 { providers: [{ id, displayName, icon }], misconfigured: string[] }
→ 400 URL 不安全 / 502 网关不可达
```

- 复用 `getLoginProviders(baseUrl, tenantId='wizard-probe', config)`;**响应字段裁剪**:仅 id/displayName/icon/misconfigured,不透出 clientId/authorizeUrl/scopes(BFF 内部构造授权 URL,遵循最小暴露);
- 防护:`isUrlSafe` SSRF 预校验(默认放行私有网段,内网部署不受阻)+ `safeFetch` 5s 超时 + 复用 probe 的 IP 限流。

**`POST /admin/wizard/setup` 请求体扩展**(可选嵌套字段):

```ts
export interface WizardSsoSettings {
  enabled: boolean;
  publicOrigin: string;
  /** 明文仅存在于请求期与前端内存态,不落盘;响应 envSnippet 用 <your-secret> 占位 */
  stateSecret?: string;
  /** 渠道白名单;缺省/null = 不过滤 */
  providers?: string[] | null;
  silentRelogin?: boolean;
}
```

setup handler 行为:

1. `req.sso` 缺省 → 与现状完全一致;
2. `sso.enabled=true` 时校验:publicOrigin 合法绝对 URL;stateSecret ≥32 字符;providers 每项须在网关渠道列表内(不满足 → 降级 `warnings` 非阻断);
3. **`type !== 'intellect-enterprise'` 且携带 `sso.enabled=true` → 400 明确拒绝**(前端已隐藏区块,此为防御;避免"静默忽略让用户误以为已启用");
4. 不落盘任何 SSO 数据;响应 `envSnippet` 追加:

```
# 统一认证(SSO)
BFF_SSO_ENABLED=true
BFF_PUBLIC_ORIGIN=<publicOrigin>
BFF_SSO_STATE_SECRET=<your-secret>
BFF_SSO_PROVIDERS=<a,b,c | 留空=不过滤>
BFF_SSO_SILENT_RELOGIN=true
```

5. 嵌套对象的 snake_case(`sso.public_origin` 等)纳入既有 `toCamel` 归一化(需递归处理嵌套层)。

**probe / setup 的 RAG 收缩**:

- probe:删除 enterprise 的 RAG 附加探测;`WizardProbeRequest` 删 `ragEndpoint/ragApiKey`,`WizardProbeResponse` 删 `ragHealthy/ragError`;
- setup:删除 RAG 必填校验、伴生 RAG 创建、`setCanvasBinding`、回滚分支 RAG 清理;`WizardSetupRequest` 删 `ragEndpoint/ragApiKey`;`envSnippet` 不再含 RAG key 行;
- enterprise 保留:tenantId 32 位 hex 校验 + `fetchTenantInfo` 一致性校验(影响 `X-Intellect-Tenant` 头注入,不属于可延后项);
- 未知 type(含 kag):probe 入口补 `if (!option) return 400`;setup 沿用既有 `Unsupported backend type` 400。

### 4.4 数据与安全

| 项 | 处理 |
|---|---|
| stateSecret | 客户端生成 → 请求体(HTTPS)→ 响应仅 `<your-secret>` 占位;**不落任何 JSON**;与 adminTokenEnvVar 模式同构 |
| 草稿 | `WizardDraft.sso` 中 **stateSecret 除外**(内存态),其余(enabled/publicOrigin/providers/silentRelogin)随现有 Step 3-4 localStorage 机制持久化 |
| publicOrigin | 复用 `validateSsoConfig` 的 URL 校验语义;启动 fail-fast 已有(`assertSsoConfigAtStartup`) |
| 新端点滥用 | SSRF + 限流 + 超时,全部复用 probe 既有设施 |
| 白名单错误兜底 | 运行期白名单含未知 id → SSO 渠道全部隐藏(密码登录不受影响,非阻断),Done 页与文档明示 |
| 开放重定向/CSRF | `sanitizeReturnTo`、签名 state cookie 逻辑不动(本方案不触碰 `auth.ts`) |

### 4.5 兼容与回滚

- env-only 存量部署:无 schema/文件变更,行为不变;
- 存量 kag 后端:store 层类型联合保留,运行无影响;
- 移除 RAG 后:无 `ragBackendId` → capabilities 端点自动将 RAG 依赖能力置 false(前端隐藏入口);直接画布调用抛既有 `CanvasBackendNotBoundError`;管理端补配后经 `resolveRagBackendId` 规则 3(enterprise.ragBackendId)**自动恢复**,无需额外绑定;
- 回滚:SSO 本身 `BFF_SSO_ENABLED=false`;向导 SSO 区块可加 `BFF_SSO_WIZARD=false` 隐藏开关(可选,与 `feature-flags.ts` 模式一致);
- 发布顺序:本仓一体变更,无跨仓约束。

---

## 5. 详细改动清单

### 5.1 BFF(`bff/`)

| 文件 | 改动 |
|---|---|
| `src/routes/wizard.ts` | ① 删 kag 选项;② probe 入口 `!option → 400`;③ 删 `RAG_PLUGIN_OPTION`/`ragProbePaths`/`probeRagPlugin`/`buildCompanionRagConfig` 引用与伴生 RAG 逻辑;④ 新增 `GET /admin/wizard/sso/providers`;⑤ setup 增 `sso` 处理(校验/400/递归 toCamel/envSnippet/warnings);⑥ setup 响应 warnings 增「RAG 插件未配置:画布/知识库/记忆/模型管理在管理端补配前不可用(Admin → Harness Backends)」 |
| `src/types/wizard.ts` | 增 `WizardSsoSettings`;probe/setup 请求删 RAG 字段;probe 响应删 `ragHealthy/ragError` |
| `src/routes/wizard.test.ts` | backend-types 断言去 kag;新增 kag probe/setup 400 用例;L1175 缺字段用例 `type:'kag'` 改 `hermes`;删除/改写伴生 RAG 用例(如 `ragBackendId === 'enterprise-rag'`);新增 SSO 用例(见 §7) |

### 5.2 前端(`src/`)

| 文件 | 改动 |
|---|---|
| `src/services/wizard-service.ts` | 同步契约:增 `WizardSsoSettings`,删 RAG 字段(`BackendType` 联合保留 `'kag'`) |
| `src/pages/wizard/index.tsx` | Step3 删 RAG 两字段及校验;Step4 删 RAG 提示行;Step5 删 RAG 摘要行;Step5/6 增 warnings 展示;`WizardDraft` 删 `ragEndpoint/ragApiKey`、增 `sso`(secret 走内存态);`handleSelectType` 重置清单收缩;渲染 `SsoSection` |
| `src/pages/wizard/sso-section.tsx`(新) | §4.2 全部交互;文本遵循 Text Overflow 规则(渠道名/超长 publicOrigin 必要处用 `TruncatedText`) |
| `src/services/harness-admin-service.ts` | `ProtocolFamily` 联合补 `'mcp-protocol'`;`PROTOCOL_FAMILY_BY_TYPE.kag = 'mcp-protocol'`(D6) |
| `src/services/harness-admin-service.test.ts` | L339 断言改 `'mcp-protocol'` |

### 5.3 i18n(仅 `zh.ts` / `en.ts`,遵循项目规则)

- 删:`wizard.connection.ragEndpoint/ragApiKey`、`wizard.probe.ragWarning/ragHealthy`、`wizard.confirm.ragEndpoint`;
- 增:`wizard.sso.*`(标题/开关/获取渠道/白名单/publicOrigin 及警告/生成 secret/静默重登/渠道为空/misconfigured 提示)、`wizard.done.ragHint`;
- en 文案 sentence case。

### 5.4 文档

- `docs/multi-harness-design.md` L1283 附近补注:「kag 已从向导选项下架,仍支持管理端手工配置;协议族 mcp-protocol」。

---

## 6. 移除 RAG 后的运行时行为(已核实)

| 场景 | 行为 | 依据 |
|---|---|---|
| 首装完成、未配 RAG | capabilities 端点将 canvas/knowledgeBase/memory/mcp/modelManagement 置 false → 前端隐藏对应入口 | `bff/src/routes/capabilities.ts` L119-129 |
| 直接调画布接口 | 抛 `CanvasBackendNotBoundError`(明确错误,非 500 模糊) | `adapter-registry.test.ts` L394 |
| 管理端补配 RAG | PUT `needsCreate` 分支校验 ragEndpoint+ragApiKey → upsertCompanion 写 `ragBackendId` + vault 凭据 | `harness-admin.ts` L337-403 |
| 补配后能力恢复 | `resolveRagBackendId` 规则 3:enterprise.ragBackendId 即返回,无需重跑向导 | `rag-plugin-backend.ts` L50-67 |

---

## 7. 测试计划

**BFF 单测(`wizard.test.ts`)**:

1. backend-types 不含 `kag`;
2. `type:'kag'` probe → 400、setup → 400;
3. setup 带 `sso` → envSnippet 含 5 行 SSO 配置、secret 为 `<your-secret>` 占位、无明文回显;
4. `stateSecret` <32 字符 → 400;`publicOrigin` 非法 → 400;
5. 非 enterprise 类型携带 `sso.enabled=true` → 400;
6. providers 白名单含未知渠道 → 200 + warnings;
7. 嵌套 snake_case 归一化(`sso.public_origin` → `sso.publicOrigin`);
8. enterprise setup 不再创建伴生 RAG(响应无 RAG env 行,store 无 `ragBackendId`);
9. `/admin/wizard/sso/providers`:正常裁剪字段、网关 500/超时 → 502、SSRF 拦截 → 400、限流 → 429。

**前端**:

1. enterprise 选中 → SSO 区块出现;community/hermes/agent-scope → 隐藏;
2. RAG 字段不再出现;表单校验通过条件相应收缩;
3. 跳过 SSO → Confirm 无 SSO 行、envSnippet 无 SSO 行;
4. Done 页展示 warnings(RAG 提示);
5. 极端输入:超长 publicOrigin/渠道名(遵循 Text Overflow 规则,jsdom 不可测布局,需 Storybook/浏览器验证);
6. 刷新场景:Step 3-4 草稿恢复,stateSecret 为空需重新生成。

**手工 E2E**:真实网关 + IdP 闭环——向导开启 SSO → 复制 env → 重启 BFF → 登录页出现渠道 → 一键登录成功 → 登出后静默重登符合 spec-014 语义。

---

## 8. 工作量与实施顺序

| 阶段 | 内容 | 估算 |
|---|---|---|
| P1 | KAG 向导下架 + probe 400 + protocolFamily 修复 + 相关测试 | 0.5 天 |
| P2 | SSO 区块 + `sso/providers` 端点 + setup 扩展 + i18n + 测试 | 2 天 |
| P3 | RAG 区块移除 + warnings/Done 提示 + 测试清理 | 0.5 天 |

---

## 9. 评审记录(v1.1 → v1.2)

评审方式:设计自查 + 代码事实核查。结论:**方案可行,以下修订已并入正文**。

| 编号 | 级别 | 发现 | 处置 |
|---|---|---|---|
| R1 | 修订(已并入 §4.3) | 非 enterprise 类型携带 `sso` 时的行为未定义;静默忽略会让用户误以为已启用 | 定为 **400 明确拒绝**;前端区块隐藏保证正常流不触发 |
| R2 | 修订(已并入 §4.3) | `getLoginProviders` 原样返回含 `clientId/authorizeUrl/scopes`,直接透出违反最小暴露 | 新端点响应裁剪为 id/displayName/icon |
| R3 | 修订(已并入 §4.2/4.4) | `stateSecret` 若随 `WizardDraft` 进 localStorage,等于明文密钥落盘 | secret 仅组件内存态,刷新丢失重新生成(成本≈0) |
| R4 | 修订(已并入 §4.2) | 用户填 `http://` publicOrigin 时,生产启动将 fail-fast,UI 需提前告知 | http 时显式警告(https 或 `BFF_ALLOW_INSECURE_SSO`),不阻断 |
| R5 | 核实通过 | 新端点走 `isUrlSafe` 是否会拦内网网关? | 不会:SSRF 守卫默认放行私有网段(`SSRF_ALLOW_PRIVATE_IP !== 'false'`,ssrf-guard.ts L14-19),公网暴露部署可显式收紧 |
| R6 | 修订(已并入 §4.4) | 白名单含未知 id 的运行期后果未说明 | 后果 = SSO 渠道全部隐藏,密码登录不受影响;Done 页与文档明示 |
| R7 | 核实通过(D6 范围) | `getProtocolFamily` 修复的影响面 | 消费方仅 admin 列表"协议族"展示列(`harness-backends.tsx` L397),纯展示修复;需同步补 `'mcp-protocol'` 联合成员与测试 |
| R8 | 风险提示(超范围,记录待办) | `WizardDraft` 现状已将 bearer token 明文存 localStorage | 既有决策,本次不扩大;建议后续立项将草稿凭据迁出 localStorage(或改 sessionStorage + 短 TTL) |
| R9 | 核实通过 | 移除 RAG 后登录与能力恢复路径 | 见 §6,四条路径均有既有代码支撑,无需新机制 |
| R10 | 实施注意 | `wizard.test.ts` 伴生 RAG 断言(如 L662)与 `ragProbePaths` 导出用例 | 随 P3 改写/删除,不影响对外契约 |
| R11 | 核实通过 | 选项表删除 kag 后前端旧缓存风险 | `['wizard/backend-types']` query 无 staleTime,重新挂载即刷新;无需版本化 queryKey |
| R12 | 边界确认 | 是否触碰 `auth.ts` | 否;spec-014 旧链路与 channels 开关逻辑原样保留 |
| R13 | 修订(已并入 §5.2) | `WizardSetupResponse.warnings` 前端当前无展示位 | Step6 Done 新增 warnings 展示 |
| R14 | 演进项(非目标) | SSO 配置运行时可改性(env 免重启) | 后续可立 SsoStore(runtime > env 合并),本期 envSnippet 已满足首装诉求 |

---

## 10. 遗留待办(超本方案范围)

1. `WizardDraft` 凭据(localStorage)迁出/加密(R8);
2. SsoStore 运行时配置 + 管理端 SSO 设置页(R14);
3. 管理端"协议族"列补充 KAG 说明文案(随 D6 修复顺带评估)。
