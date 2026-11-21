# 调研笔记 — Wizard SSO/KAG/RAG 交付(module: wizard-sso)

日期:2026-11-21。设计文档:`docs/wizard-kag-to-sso-design.md` v1.2(含已确认决策 D1-D6)。

## 1. 代码域定位

### 前端

| 文件 | 角色 |
|---|---|
| `src/pages/wizard/index.tsx` | 六步状态机页面(Step1-6 组件 + WizardDraft + probe/setup mutation + 草稿 localStorage `wizard-draft`) |
| `src/pages/wizard/sso-section.tsx`(新增) | P2 SSO 配置区块 |
| `src/services/wizard-service.ts` | 契约类型 + 4 个请求封装(`api.wizard.*`) |
| `src/wrappers/wizard-guard.tsx` | 路由守卫;导出 `WIZARD_STATUS_QUERY_KEY = ['wizard/status']` |
| `src/utils/api.ts` L477-482 | `wizard: { status, backendTypes, probe, setup }` 路径 |
| `src/locales/zh.ts` L2913+ / `en.ts` | `wizard.*` 文案 |
| `src/services/harness-admin-service.ts` L23-50 | `ProtocolFamily` 联合 + `PROTOCOL_FAMILY_BY_TYPE`(kag→openai-compatible,待修复为 mcp-protocol) |
| `src/pages/admin/harness-backends.tsx` L132/L614 | 管理端 kag 选项(**不动**,D1) |

### BFF

| 文件 | 角色 |
|---|---|
| `bff/src/routes/wizard.ts` | 选项表 L65-115(kag L66-74);probe L262-360(RAG 探测 L319-332;未知 type 未拦截,L340 起直接探测 `/v1/models`);setup L460-805(RAG 校验 L517-537、伴生 RAG L667-676、租户绑定 L738-786、envSnippet L796-801);setup 鉴权 `wizardSetupAuth` L414-455;probe IP 限流 `checkProbeRateLimit` L229-244;`toCamel` 归一化 L474-480(仅一层) |
| `bff/src/types/wizard.ts` | 契约类型(与前端 wizard-service 同步) |
| `bff/src/routes/wizard.test.ts` | 两个 describe(L153 主 / L960 方案A鉴权 / L1089 bootstrap);受影响用例见 §4 |
| `bff/src/services/sso-providers.ts` | `getLoginProviders(baseUrl, tenantId, config)` — P2 复用;返回含 clientId/authorizeUrl/scopes(需裁剪) |
| `bff/src/services/sso-config.ts` | `validateSsoConfig`(URL/https/secret≥32)/ `loadSsoConfig`(env) |
| `bff/src/services/ssrf-guard.ts` | `isUrlSafe`/`safeFetch`;**默认放行私有网段**(`SSRF_ALLOW_PRIVATE_IP !== 'false'`) |
| `bff/src/index.ts` | `assertSsoConfigAtStartup()` L67;kag 工厂注册 L102(**不动**);store 初始化 L77-80 |

### 数据与边界(不动项)

- `bff/src/types/harness.ts` BackendType 联合(保留 kag);`bff/src/services/harness-store.ts` L57 zod enum(保留,存量兼容);`bff/src/types/harness-admin.ts` L101 VALIDATION_RULES(保留);`bff/src/services/adapters/kag/*`(保留)。

## 2. 真实运行库(本机 dev)

- BFF:`cd bff && npm run dev` = `tsx watch --env-file=.env src/index.ts`,端口 9390;数据目录硬编码 `bff/data/`(harness-store.ts L23-24,无 env 覆盖);
- 前端:`npm run dev` 端口 9391;`npm run dev:all` 并行;
- **当前数据**:`harness-backends.json` 含就绪 `intellect-enterprise-default`(真网关 `https://ai.wust.edu.cn/intellect-gateway`)+ 伴生 `…-rag`;`bff-tenants.json` 租户 `0` = 企业版 + canvas 绑定 → `needsSetup=false` → **向导入口 = `/wizard?mode=add`**(mode=add 时不被重定向);
- **注意 setup 副作用**:会 upsert `harness-backends.json`、改写租户 `0` 绑定(`setHarnessBinding/setAuthMode/setIntellectBinding`)、写 `token-vault.json` → E2E 破坏性用例前必须备份 4 个 json,用例后停 BFF 恢复再启动(R3 清理)。

## 3. 上游依赖与替身

- 真网关/真 IdP 可用性不受控 → E2E 统一用**本地 mock upstream**(node 脚本,无依赖,端口 9399):
  - `GET /v1/models` → 200(community/hermes/agent-scope probe);
  - `GET /api/tenant/info` → `{ tenant_id: '<32位hex>' }`(enterprise probe);
  - `GET /api/members/oauth/providers` → 渠道数组(SSO 渠道拉取);
- SSO「登录闭环」(IdP 跳转/回调)本机无 IdP → 受限注记(L 系列),以 BFF 单测 + 既有 bff-sso-p2 交付回归覆盖。

## 4. 受影响测试用例图(wizard.test.ts)

| 用例(行) | P1 | P3 | 处置 |
|---|---|---|---|
| L227 返回 5 个后端类型选项 | 是 | | 改 4 个 |
| L246 每选项含 capabilities | 是 | | 数据驱动,随选项数通过 |
| L265/L276 ragProbePaths 两例 | | 是 | 删除(函数移除) |
| L361 enterprise 探测 tenant/info | | 是 | 保留 |
| L469 type=intellect-rag 400 | | 是 | 保留 |
| L596 缺必填 400 | | | 保留 |
| L610 enterprise 缺 rag 字段 400 | | 是 | 删除(校验移除) |
| L636 创建伴生 RAG+vault+canvas 绑定 | | 是 | 删除/改写(不再创建) |
| L681 tenant 校验失败 400+回滚 | | 是 | 保留(回滚分支去 RAG 清理) |
| L712 tenant_id 不匹配 400 | | 是 | 保留 |
| L739/L758 tenantId 必填/格式 | | 是 | 保留 |
| L1175 bootstrap 400 用例 body type:'kag' | 是 | | 改 `hermes` |
| 新增 | | | kag probe/setup 400;SSO 全套(见大纲) |

## 5. 基线命令

- BFF:`cd bff; npm run test`(vitest run);类型:`cd bff; npm run type-check`
- 前端:`npm run type-check`;`npm run test`(jest);`npm run lint`;`npm run build`
- 健康口令:BFF `GET /api/bff/health`(health 路由);前端 `http://localhost:9391` 可达
