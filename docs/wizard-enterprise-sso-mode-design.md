# 向导企业版双模式选型设计：企业版（SSO模式）/ 企业版（非SSO模式）

| 项 | 值 |
|---|---|
| 文档版本 | v1.4（§11 设计 + §12 评审 + **§13 质量/安全评审:通过,Q-1 已修,可提交**） |
| 日期 | 2026-11-25 |
| 状态 | §10 v1.3 已实施并随 **v0.4.9 发版上线**（2026-11-25，冒烟通过）；§11 v1.4 为**决策反转设计**——§12 评审**方向通过**，R-1（P0）吸收后定稿，实施载体 v0.5.0；实施完成前 §10 双卡形态（线上）维持现状；公网仍须 `SSRF_ALLOW_PRIVATE_IP=false`；S3 随 v1.4 实质缓解，S4–S5 为 backlog |
| 前置决策 | ~~用户确认方案 **A**：SSO 独立首卡~~（**v1.4 废止，见 §11.1 决策反转记录**）→ v1.4 方向：SSO 为**安装后管理页能力**，向导回归单张企业卡 |
| 关联 | `docs/wizard-kag-to-sso-design.md`（§4.2 / D2 被本文件修订）；`docs/auth-intellect-auth-to-team-flow-status.md`；spec-010 / spec-014 |
| 改动范围 | 本仓向导选型与 SSO 区块挂载；**不**新增 `authMode`；运行时仍仅 `intellect-enterprise` |

---

## 1. 背景与问题

现行实现（`docs/wizard-kag-to-sso-design.md` D2 / §4.2 + `src/ee/pages/wizard/`）：

- SelectType 只有一张 **Intellect Enterprise** 卡；
- SSO 是 Connection 步内嵌区块，**仅当** `selectedType === 'intellect-enterprise'` 且用户手动打开开关才配置；
- 目标路径「HIEDU 开通 → agentui SSO 现换 `imt_*`」在向导里被藏在企业版连接表单下方，首装路径不突出。

目标路径要求：企业 SSO 是**一等首装路径**，不应表现为「先选企业版，再决定要不要 SSO」。

---

## 2. 决策记录

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 选型形态 | **两张企业卡**，不再「一张卡 + 内嵌 SSO 开关」 |
| D2 | 文案 | 首卡 **「企业版（SSO模式）」**；次卡 **「企业版（非SSO模式）」** |
| D3 | 排序 | **企业版（SSO模式）排第一**；其后：企业版（非SSO模式）→ Community → HERMES → AgentScope |
| D4 | 运行时类型 | 两卡均落地 `BackendType = 'intellect-enterprise'`，租户 `authMode = 'intellect-enterprise'` |
| D5 | 区分键 | 新增向导 **`setupProfile`**：`enterprise-sso` \| `enterprise-password`（UI / setup 契约用；**不**写入 harness `type`） |
| D6 | SSO 模式行为 | 选中即 **强制走 SSO 配置**（无「稍后跳过」主路径）；Connection 展示完整 SSO 面，`sso.enabled` 固定为 `true` |
| D7 | 非 SSO 模式行为 | **不渲染** SSO 区块；setup **拒绝**携带 `sso.enabled=true`；登录面以密码为主（渠道按钮依赖 env 关闭） |
| D8 | 与旧设计关系 | 废止「SSO 仅 enterprise 内嵌可选区块」的产品表述；技术校验「仅 enterprise 可带 sso」保留并收紧为「仅 `setupProfile=enterprise-sso`」 |

---

## 3. 总体设计

### 3.1 SelectType 选项表（概念）

```text
[1] 企业版（SSO模式）        setupProfile=enterprise-sso      type→intellect-enterprise
[2] 企业版（非SSO模式）      setupProfile=enterprise-password type→intellect-enterprise
[3] Intellect Community      type→intellect-community
[4] HERMES
[5] AgentScope
```

BFF `GET /admin/wizard/backend-types` 返回**五张卡**（两张企业共享同一 `type`，靠 `setupProfile` + 不同 `label`/`description` 区分）。

建议字段扩展：

```ts
export interface WizardBackendTypeOption {
  type: BackendType;
  /** 向导选型区分；企业双卡必填，其它类型可省略或等于 type */
  setupProfile?: 'enterprise-sso' | 'enterprise-password';
  label: string;
  description: string;
  defaultEndpoint: string;
  capabilities: HarnessCapabilities;
  credentialKind: CredentialKind;
}
```

前端草稿：

```ts
selectedType: BackendType;
setupProfile?: 'enterprise-sso' | 'enterprise-password'; // 选企业卡时必有
sso: WizardDraftSso; // 仅 enterprise-sso 使用；非 SSO 卡重置为 INITIAL
```

### 3.2 流程

```text
Step1 Welcome
Step2 SelectType     — 首卡「企业版（SSO模式）」
Step3 Connection
        ├ enterprise-sso: 名称/端点/凭据/tenantId + **SSO 主配置面**（强制启用）
        └ enterprise-password: 名称/端点/凭据/tenantId（无 SSO）
Step4 Probe          — 两卡均走 intellect-enterprise 探测
Step5 Confirm        — SSO 卡展示 SSO 摘要；非 SSO 卡不展示
Step6 Done           — SSO 卡 envSnippet 必含 BFF_SSO_*；非 SSO 卡不含
```

### 3.3 SSO 主配置面（相对旧 SsoSection）

| 项 | 旧（嵌在 enterprise 下） | 新（SSO 模式卡） |
|---|---|---|
| 出现条件 | `type===enterprise` | `setupProfile===enterprise-sso` |
| 启用开关 | 默认关，可跳过 | **去掉或锁定为开**；文案表明本模式必须配置 SSO |
| 渠道 / origin / secret / 静默重登 | 同现实现 | 同现实现（校验仍要 publicOrigin + secret≥32） |
| setup | `sso` 可选 | **`sso.enabled` 必须 true**，否则 400 |
| 非 SSO 卡 | N/A | 不传 `sso`；若传 `enabled=true` → 400 |

### 3.4 setup 契约

```ts
export interface WizardSetupRequest {
  // …
  type: BackendType;
  setupProfile?: 'enterprise-sso' | 'enterprise-password';
  sso?: WizardSsoSettings;
}
```

校验规则：

1. `type === 'intellect-enterprise'` 且缺 `setupProfile` → **400**（新装强制显式；避免歧义）。存量脚本若只传 type，实施期可短暂兼容并默认 `enterprise-password` + warning，**首版推荐硬拒绝**以便行为清晰。
2. `setupProfile === 'enterprise-sso'`：`type` 必须为 `intellect-enterprise`；`sso.enabled === true`；origin/secret 校验同现网。
3. `setupProfile === 'enterprise-password'`：禁止 `sso?.enabled === true`。
4. 非 enterprise 类型携带任一企业 `setupProfile` 或 `sso.enabled` → 400。
5. 落盘 harness / 租户：`type` 与 `authMode` 仍只认 `intellect-enterprise`；**不**持久化 `setupProfile`（或仅写入一次性 setup 审计日志，非 runtime 配置源）。SSO 是否生效以 env（`BFF_SSO_ENABLED` 等）为准。

### 3.5 i18n（仅 zh / en，按需）

| key 示意 | zh | en |
|---|---|---|
| `wizard.types.enterpriseSso` | 企业版（SSO模式） | Enterprise (SSO mode) |
| `wizard.types.enterprisePassword` | 企业版（非SSO模式） | Enterprise (non-SSO mode) |
| `wizard.types.enterpriseSsoDesc` | 统一认证登录；首装即配置 BFF SSO | Sign in with SSO; configure BFF SSO during setup |
| `wizard.types.enterprisePasswordDesc` | 使用成员密码登录；可稍后手工开启 SSO | Sign in with member password; enable SSO later if needed |

（en 遵循 sentence case；专有名词 SSO 保留。）

### 3.6 兼容与回滚

- **运行时 / Adapter**：无新 BackendType；社区与企业 authMode 语义不变。
- **已首装租户**：不受影响；仅影响未 setup 的向导 UI。
- **旧「enterprise + 可选 SSO 开关」**：产品路径移除；运维仍可用 env 在非 SSO 首装后手工打开 SSO（与 D7「稍后手工」一致）。
- **回滚**：选项表恢复单卡 + 内嵌开关即可；契约字段 `setupProfile` 可忽略。

---

## 4. 改动清单（实施指引）

### 4.1 BFF

| 文件 | 改动 |
|---|---|
| `bff/src/types/wizard.ts` | `WizardBackendTypeOption` / `WizardSetupRequest` 增 `setupProfile` |
| `bff/src/routes/wizard.ts` | `BACKEND_TYPE_OPTIONS` 拆成两张 enterprise 卡且 SSO 卡置顶；setup 按 §3.4 校验；`getOptionForType` 改为按 `(type, setupProfile)` 或 option id 查找 |
| `bff/src/routes/wizard.test.ts` | 选项顺序与双卡；sso / password 校验矩阵；缺 profile → 400 |

### 4.2 前端

| 文件 | 改动 |
|---|---|
| `src/services/wizard-service.ts` | 同步 `setupProfile` |
| `src/ee/pages/wizard/index.tsx` | 选型键改为 profile；Connection / Confirm / setup payload 按 profile 分支；切卡时重置 SSO |
| `src/ee/pages/wizard/sso-section.tsx` | 去掉「可跳过」主文案；启用态由父级锁定 |
| i18n `zh`/`en`（及 ee private 若有） | 双卡文案 |

### 4.3 文档 / 测试资产

| 文件 | 改动 |
|---|---|
| `docs/wizard-kag-to-sso-design.md` | 文首标注 §4.2/D2 被本设计修订 |
| `docs/auth-intellect-auth-to-team-flow-status.md` | 向导 / D1 / agentui P0 与落地顺序按本设计改写 |
| `tests/e2e-tests/cases/wizard/TC-WIZSSO-*` | 入口改为首卡 SSO 模式；非 SSO 卡无区块 |

---

## 5. 测试要点

1. `backend-types`：第一项 `setupProfile=enterprise-sso`，第二项 `enterprise-password`，`type` 均为 `intellect-enterprise`。
2. SSO 卡 setup 无 `sso` / `enabled=false` → 400；有完整 SSO → envSnippet 含 `BFF_SSO_*`。
3. 非 SSO 卡带 `sso.enabled=true` → 400；不带 → 200 且无 SSO env 行。
4. UI：选首卡必见 SSO 面且无法「关闭跳过」；选次卡不见 SSO 面。
5. 两卡 probe/setup 均创建 enterprise 后端且 `authMode=intellect-enterprise`。

---

## 6. 非目标

- 不新增 `authMode` 值（如 `intellect-sso`）。
- 不把 community / hermes 接到 team exchange。
- 不在本设计内做 HIEDU 深链或双栈 exchange（仍见 status 文档 T/D/I 项）。
- 不实现运行时 SsoStore；仍 envSnippet 落地。

---

## 7. 与目标路径的对齐

| 目标路径环节 | 本设计贡献 |
|---|---|
| 首装突出 SSO | 向导第一选项即「企业版（SSO模式）」 |
| 密码企业部署 | 「企业版（非SSO模式）」独立卡，避免误配半残 SSO |
| BFF 单一兑换协议 | 两卡共享 enterprise + 同一 exchange 客户端；无协议分叉 |
| 关闭标志 | 选 SSO 模式卡完成首装 + env 生效后，登录页可走统一认证 → `imt_token` |

---

## 8. 方案评审（v1.0 → v1.1）

评审方式:对照现行 `src/ee/pages/wizard/index.tsx`、`bff/src/routes/wizard.ts`、登录页双入口、status 目标路径。结论:**方向正确，可实施；下列项必须并入实现，否则双卡会在 UI/契约层直接失效。**

### 8.1 裁决摘要

| 维度 | 裁决 |
|---|---|
| 产品方向（SSO 一等首卡、密码企业独立卡） | **通过** |
| 不新增 authMode / 不协议分叉 | **通过**（与 status §1.5 一致） |
| 技术区分键仅靠共享 `type` | **不通过原样落地** → 必须有稳定 **option 主键**（见 R1） |
| envSnippet 仍需人工贴 env+重启 | **接受**（非本方案范围）；Done 页须明示，避免「选了 SSO 模式=已开通」 |
| 密码表单在 SSO 模式下是否隐藏 | **默认不隐藏**（破窗/运维）；本方案不引入「仅 SSO 可登录」 |

### 8.2 必吸收修订（实施约束）

| 编号 | 级别 | 发现 | 处置（并入实现） |
|---|---|---|---|
| **R1** | **P0** | 现行 SelectType 用 `opt.type` 作 `key` / `RadioGroup` value / `options.find`。两卡同为 `intellect-enterprise` → 重复 key、无法区分选中、永远命中第一张卡 | 增加稳定主键 **`optionId`**（建议 `enterprise-sso` / `enterprise-password` / 与 type 同名的非企业项）。Radio/`key`/草稿选中态一律用 `optionId`；`type`+`setupProfile` 由选项表带出。`setupProfile` 可与企业 `optionId` 取值相同以降低心智负担 |
| **R2** | **P0** | `options.find(o => o.type === selectedType)`、草稿校验 `options.some(o => o.type === …)` 在双卡下语义错误 | 全部改为按 `optionId`（或 `(type, setupProfile)`）匹配；切卡重置 SSO 草稿 |
| **R3** | **P0** | 卡片上展示 `<code>{opt.type}</code>` 时两卡文案相同，用户无法区分 | SSO 卡展示 profile/徽章「SSO」；非 SSO 卡徽章「密码」；或隐藏重复 type code、改展示 `setupProfile` |
| **R4** | **P1** | `sso.enabled` 与 `setupProfile=enterprise-sso` 双重开关易矛盾 | SSO 卡：**去掉启用开关**；setup 由 profile 隐含 `enabled=true`；请求体可仍带 `sso.enabled=true` 作显式断言，BFF 以 profile 为准（profile=sso 且 enabled≠true → 400） |
| **R5** | **P1** | enterprise 缺 `setupProfile` 硬 400 会打断既有 setup API/单测/自动化 | **首版**：缺省时兼容默认 `enterprise-password` + `warnings` 提示「请显式传 setupProfile」；**下一版**再改硬 400。UI 始终显式传 profile |
| **R6** | **P1** | 旧 `wizard-draft` localStorage 仅有 `selectedType=intellect-enterprise`、无 profile | 加载草稿时：无 `optionId`/`setupProfile` 的 enterprise → **清空选型或回落非 SSO 卡并提示重新选择**；禁止静默当成 SSO 卡 |
| **R7** | **P1** | BFF `label` 英文化 vs 前端 i18n：若只改 BFF 中文 label，en 语言包错乱 | **前端按 `optionId`/`setupProfile` 做 i18n**，BFF `label`/`description` 仅 fallback；与现网部分直出 label 策略对齐时在 PR 说明 |
| **R8** | **P1** | SSO 模式完成向导 ≠ SSO 已生效（须复制 envSnippet 并重启 BFF） | Done/Confirm **强制提示**未配置 env 前登录页无渠道；与 D2 部署阻塞对齐；文案勿写「已启用统一认证」除非检测到运行时 `BFF_SSO_ENABLED`（向导阶段通常检测不到，故用「待写入环境变量」） |
| **R9** | **P2** | `setupProfile` 不落盘 → 事后无法从 tenant 判断首装模式 | **接受**；支持排障看 env / envSnippet 留存。若后续要审计，另立 tenant 注解，不阻塞本方案 |
| **R10** | **P2** | SSO 模式是否关闭密码登录未定义 | **明确不做**：登录页保持密码+渠道并存；「非SSO模式」= 不产出 SSO env，不是「SSO 模式禁用密码」 |
| **R11** | **P1** | 测试资产 TC-WIZSSO-01 仍期望 4 卡 | 改为 **5 卡**；顺序断言首卡 SSO 模式；增非 SSO 卡无 SsoSection 用例 |

### 8.3 建议的 option 契约（取代仅扩展 optional setupProfile）

```ts
export type WizardSetupProfile = 'enterprise-sso' | 'enterprise-password';

export interface WizardBackendTypeOption {
  /** 选型主键；企业双卡必不同；非企业可等于 type */
  optionId: string;
  type: BackendType;
  setupProfile?: WizardSetupProfile; // 仅 intellect-enterprise 双卡
  label: string;
  description: string;
  defaultEndpoint: string;
  capabilities: HarnessCapabilities;
  credentialKind: CredentialKind;
}
```

前端草稿最小集：`selectedOptionId` +（派生）`selectedType` / `setupProfile`；或显式存三者但以 `selectedOptionId` 为唯一选中源。

### 8.4 残留风险（不阻塞定稿）

1. team exchange 双栈未齐时，即使用 SSO 模式卡首装成功，真网一键登录仍卡 T1/T2——向导不能假装闭环；status 落地顺序 0 / 0b 并行关系不变。  
2. 「非SSO模式」日后靠手工 env 开 SSO，与卡面「非 SSO」字面略冲——靠 description「可稍后手工开启」消化即可。  
3. 两卡能力徽章相同，差异全靠文案/徽章；若 UI 拥挤可考虑 SSO 卡增加「统一认证」能力徽章（纯展示，不改 HarnessCapabilities）。

### 8.5 评审结论

**方案通过，附带 R1–R8、R11 为实施必做。** 产品分层（SSO 首卡 / 密码次卡 / 共享 enterprise 运行时）与目标路径一致；当前最大空洞是**选型主键仍写在 `type` 上**，必须在编码前改为 `optionId`。

> **实施注记（2026-11-23）**：R1–R8、R11 已在本仓落地（见九步 `REPORT-wizard-ent-sso-mode-2026-11-23.md`）。后续约束以 **§9** 为准。

---

## 9. 质量与安全评审（v1.1 → v1.2）

评审方式：代码安全审查（未提交 wizard-ent-sso-mode 相关 diff）+ 源码对照。结论：**无 Critical；受控/内网首装可合入；公网暴露 BFF 前必须吸收 S1、S2；质量 Q1 为阻断级缺陷（SSO 卡会炸）。**

### 9.1 裁决摘要

| 维度 | 裁决 |
|---|---|
| Secret 不回显 / 不落盘 / env 占位 | **通过**（`stateSecret` 仅请求期校验后丢弃；响应 `<your-secret>`） |
| Providers 响应字段裁剪 | **通过**（仅 id/displayName/icon） |
| 双模式 setup 校验矩阵 | **通过**（sso / password 互斥与强制） |
| 公开 `sso/providers` SSRF | **不通过公网默认** → 须 `safeFetch` 对齐 probe（S1） |
| envSnippet 对 `providers[]` 信任 | **不通过原样拼接** → 须 charset / 白名单消毒（S2） |
| Bootstrap 窗 CSRF | **接受为既有产品面**；SSO 放大诱导半径 → 记加固 backlog（S3），不阻塞内网 |
| `Switch` 未 import | **阻断质量债**（Q1） |

### 9.2 安全必跟进（并入方案）

| 编号 | 级别 | 发现 | 方案处置 |
|---|---|---|---|
| **S1** | **High / 公网 P0** | ~~裸 `fetch`~~ → **已改** `sso-providers.fetchPublicProviders` 走 `safeFetch`（2026-11-23） | 公网部署仍须 `SSRF_ALLOW_PRIVATE_IP=false`；单测见 `sso-providers.test.ts` |
| **S2** | **Med / P0** | ~~原样拼接 providers~~ → **已** `sanitizeSsoProviderIds` + warning（2026-11-23） | 保持；U-21 防回归 |
| **S3** | **Med / P1 backlog** | bootstrap 窗 `POST /admin/wizard/setup` 可无凭据（`BOOTSTRAP_ENABLED`）；SSO 使攻击者可诱导恶意 `publicOrigin` / gateway / snippet | **不改变**「首装零配置」默认，但文档标明风险；演进：**一次性 bootstrap token** 覆盖 setup + providers，或 CSRF token。与 status 部署基线交叉引用 |
| **S4** | **Med / 运维** | `stateSecret` 经 setup HTTPS 请求体（不回显） | 手册：禁止在网关/APM 全量记录 setup body；TLS 终止后日志勿存明文 |
| **S5** | **Med / 部署** | probe 与 providers 共用 IP 限流；`BFF_TRUST_PROXY=true` 时 XFF 可伪造 | 部署文档：仅在可信反代后开 TRUST_PROXY；限流键勿对公网裸奔伪造头 |
| **S6** | **Low** | `publicOrigin` 进 400 文案 / 无引号写入 snippet | 错误回显保持纯文本；snippet 侧去掉控制字符或对值加引号（与 S2 同类加固） |

**明确保持的安全边界（勿回退）：**

- 向导 **永不** 把 `BFF_SSO_*` 自动写入磁盘或热加载运行时；生效仍靠运维贴 env + 重启。  
- 响应 / harness JSON **永不** 含 `stateSecret` 明文。  
- Providers 浏览器视图 **永不** 透出 `clientId` / `authorizeUrl` / `scopes`。  
- 登录页 **不** 因 SSO 模式隐藏密码（破窗，R10）。

### 9.3 质量必跟进

| 编号 | 级别 | 发现 | 方案处置 |
|---|---|---|---|
| **Q1** | **P0** | ~~`Switch` 未 import~~ → **已补** `@/components/ui/switch`（2026-11-23） | 保持 |
| **Q2** | **P1** | Connection `useEffect([option])` 无条件写回 `credentialKind`，双卡切换易覆盖用户输入 | 仅在 `credentialKind` 仍为初始/与 option 不一致且用户未脏写时更新；或切卡时显式重置整表（与切卡重置 SSO 一致） |
| **Q3** | **P1** | 双卡文案多靠 `defaultValue`，未进 `zh`/`en`（或 ee private） | 按项目 i18n 规则沉淀 `wizard.types.*` / `wizard.done.ssoEnvPending` / `wizard.sso.requiredHint` 等键 |
| **Q4** | **P2** | `getOptionForType(type)` 双卡同 type 永远命中首卡 | 改为 `getOptionForOptionId` / `(type, setupProfile)`；调用点随 profile 查找 |
| **Q5** | **P2** | Confirm「待写入」与 Done warning 双重提示 | **接受**（利于 R8）；文案统一用「尚未生效/待写入」，避免「已启用统一认证」 |

### 9.4 合入与发布门禁（修订）

| 场景 | 门禁 |
|---|---|
| 内网 / 受控首装 | Q1 必须合入；S1/S2 **强烈建议同批**，最迟下一补丁 |
| **公网可达 BFF** | **S1 + S2 + `SSRF_ALLOW_PRIVATE_IP=false` 为发布阻断**；S5 部署检查清单必过 |
| 与目标路径关闭标志 | 向导双卡 + §9 加固 ≠ team exchange 就绪；真网 SSO 仍卡 status T1–T3 |

### 9.5 文档与测试资产同步

| 资产 | 要求 |
|---|---|
| 用户手册 | 完成页口径「待写入」；增运维安全注意（勿盲信 snippet、勿记 setup 明文） |
| status.md | 增 W3/W4（SSRF / env 消毒）与 agentui 安全跟进项 |
| 单测 | S1/S2/Q1 落地后各补回归；既有 U-17～U-20 保持 |
| 九步 REPORT | 遗留建议指向 §9；不假装安全项已在步骤 6 关闭 |

### 9.6 评审结论

**双模式产品方案维持；安全/质量以 §9 为增量真源。** 无 Critical 密钥泄露路径。公网前阻断项：**S1、S2**；开发阻断项：**Q1**。S3 为 bootstrap 产品加固，与 SSO 双卡正交但因 snippet 诱导面扩大而升权记录。

---

## 10. v1.3：两条流程拆分（SSO 模式只配置统一认证）

> 2026-11-24 评审通过并实施。本节修订 §2 D6/D7、§3.2 流程、§3.4 校验规则 1–3 与 §9.3 的 Q2/Q3/Q4；其余章节不变。

### 10.1 问题

v1.2 落地后，两张企业卡共用同一个连接表单（名称 / 端点 / Bearer Token / 租户 ID）、同一个探测页、确认页与完成页，SSO 卡只是把 SSO 区块追加在表单下方。评审要求：

1. SSO 模式不配置 Agent Loop 后端，只设置统一认证信息，且没有「启用 SSO」按钮；
2. 非 SSO 模式不设置任何统一认证内容。

### 10.2 运行时约束（决定了方案边界）

- **SSO 自身依赖一条企业后端记录**：BFF 的 SSO 授权、回调、登录路由经 `getEnterpriseBackend()` 从租户绑定的企业后端读取网关地址；首装是否完成以「是否存在就绪后端」判断。后端不能不建，只能由系统自动登记。
- **网关服务密钥不只服务于 Agent Loop**：`enterpriseFetch` 发往网关的回调兑换、密码登录、注册请求都带 `API_SERVER_KEY`（即表单里的 Bearer Token）。不采集它，统一认证登录本身也走不通。

### 10.3 决策

| # | 决策点 | 结论 |
|---|---|---|
| D1 | SSO 模式是否保留网关服务密钥 | **保留，必填**；与认证网关地址同组呈现（§10.2） |
| D2 | 非 SSO 卡 | 文案去掉 SSO 字样；BFF 拒绝请求里出现任何 `sso` 字段（不再只拒绝 `enabled=true`） |
| D3 | 向导文案 | 副标题、步骤名、确认与完成页按模式切换；欢迎语改为模式中立 |
| D4 | 环境变量片段 | 凭据已写入 vault 时不再输出 `HARNESS_<ID>_TOKEN` 行；无 vault 时保留 |
| D5 | 已有企业后端时的 SSO 卡 | 「新增后端」场景隐藏 SSO 卡并指向「系统管理 → 统一认证设置」（`status.hasEnterpriseBackend`） |
| D6 | SSO 模式免重启生效 | **本版不做**；后续可在部署已配 `BFF_SSO_STATE_SECRET` 时直接写运行时配置 |
| D7 | 租户 ID 自动识别失败 | 验证步回退为手填（32 位 hex），其余三项结论照常展示 |
| D8 | 非 SSO 模式的租户 ID | 采集方式不变 |

启用状态由模式推定：前端草稿与请求都不再有 `enabled`，BFF 对 `enterprise-sso` 一律视为启用、忽略客户端传值。

### 10.4 两条流程

步骤数仍为六步，状态机、草稿与刷新恢复逻辑沿用，只按模式替换第 3–6 步。

| 步骤 | SSO 模式 | 非 SSO 模式 |
|---|---|---|
| 3 | **统一认证设置**：认证网关地址、网关服务密钥、登录渠道、公开来源地址、引导密钥、静默重登 | 连接信息：名称、端点、凭据、租户 ID（不变） |
| 4 | **验证**：认证网关可达、租户 ID（自动识别 / 手填）、网关服务密钥、统一认证服务 | 探测（不变） |
| 5 | 只显示统一认证摘要，按钮为「完成配置」 | 确认（不变） |
| 6 | `BFF_SSO_*` 片段与「待写入并重启」提示，说明企业网关已自动登记 | 完成（不变） |

SSO 模式第 3 步**不出现**：后端名称、租户 ID 输入框、启用开关、「可跳过」类提示。选型页的 SSO 卡也不再展示后端能力徽章与默认端点。

### 10.5 自动推导

| 项 | 取值 |
|---|---|
| 后端名称 | 客户端未传时用 `Intellect Enterprise Default`（`backendId = intellect-enterprise-default`） |
| 凭据类型 | `bearer-token` |
| 租户 ID | 网关公开端点 `/api/tenant/info`；读不到或格式不对且未手填 → 400 |
| 服务密钥 | 入加密 vault，不回显、不落 JSON |

### 10.6 契约变更

| 接口 | 变更 |
|---|---|
| `GET /admin/wizard/status` | 响应增加 `hasEnterpriseBackend`（按全部配置判断，含 token 未就绪的） |
| `POST /admin/wizard/probe` | 请求增加 `setupProfile`；`enterprise-sso` 时响应增加 `sso`：`{ gatewayOk, tenantId, keyValid, providersOk, providerCount? }`，`healthy` 为四项结论的合并 |
| `POST /admin/wizard/setup` | `enterprise-sso` 下 `name` / `credentialKind` / `intellectTenantId` 可缺省；`sso` 必填、`sso.enabled` 不再要求；`token` 必填 |
| `POST /admin/wizard/setup` | `enterprise-password` 显式携带 `sso` → 400；缺省 profile 且 `sso.enabled=false` 的旧请求仍按非 SSO 放行 |

密钥校验依次调用 `/v1/capabilities`、`/v1/models`：200 判有效，401/403 判无效，其余（404、5xx、网络错误）记为 `keyValid: null`，不阻断——不同网关实现的受保护端点并不一致，向导只对「网关明确拒绝」下结论。

校验顺序：输入形态类错误（缺 `sso`、缺密钥、非 SSO 模式带 `sso`）先于任何网络调用报出。

### 10.7 安全边界（保持不变）

- 服务密钥与引导密钥都不回显；服务密钥只进 vault，引导密钥只存在于向导页面。
- 探测沿用 SSRF 预校验与 IP 限流。
- `enterprise-password` 模式现在连「未启用的 sso 对象」也拒绝，比 v1.2 更严。

### 10.8 顺带修复

- **第 3 步重渲染循环**：选项数组每次渲染新建，`StepConnectionForm` 的 `[option]` 副作用无条件写回 `credentialKind`，形成「渲染 → 写状态 → 再渲染」的循环并反复写 localStorage。改为选项数组 `useMemo` + 副作用只在值不一致时写回（§9.3 Q2）。
- 选项查找改为按 `(type, setupProfile)`，企业版不再永远命中 SSO 卡（§9.3 Q4）。
- 双卡与 SSO 相关文案补进 `src/ee/locales/{zh,en}-private.ts`（§9.3 Q3）。

### 10.9 测试

| 层 | 内容 |
|---|---|
| BFF `wizard.test.ts` | 79 例（新增 21）：SSO 模式 setup 矩阵 W-01～08、验证矩阵 W-P01～09、`hasEnterpriseBackend`、选项文案 |
| 前端 `wizard-modes.test.tsx` | 6 例：两种模式第 3 步渲染差异、选型页差异、切卡重置、SSO 卡隐藏、租户 ID 手填回退 |
| e2e 用例 `TC-WED-01～04` | 已按本节修订；浏览器步骤未执行，真实网关联调待做 |

---

## 11. v1.4：移除向导 SSO 卡，SSO 配置迁移至管理页（已按 §12 评审修订实施,2026-11-25）

> 2026-11-25 发起。触发点：v1.3 发版落地后对 #1（认证网关地址）/#2（网关服务密钥）的性质分析
> （见与 HIEDU 端能力边界的讨论）。本节为**设计草案**，评审通过后才进入实施；
> 评审前 §10 双卡形态维持现状（已随 v0.4.9 上线，不受本节影响）。**实施状态:已实施（2026-11-25,dev 工作区,待提交发版）——验证 Node 20.20.2:宿主 jest 66 套件/807 用例、BFF vitest 1268 全过;tsc 0 错;R-1 吸收（选项查找回退,W-R1 固化）。报告 `tests/e2e-tests/reports/REPORT-sso-admin-v14-20261125.md`。**

### 11.1 决策反转记录

**废止 v1.2 前置决策「方案 A：SSO 独立首卡」**。理由（v1.3 实施与发版后暴露）：

1. **双卡前提不成立**：#1/#2 是 agentui↔team 的部署级连接信息，**非 SSO 模式同样必需**
   （密码登录 `/api/members/login`、会话校验 `/api/members/me`、Agent Loop 全靠它们）。
   两张企业卡的"后端连接"部分完全相同，唯一差别是"要不要顺带填 SSO 参数"——
   这是表单分层问题，不是部署形态问题，用两张卡表达属过度设计。
2. **首装配 SSO 给不出"能用的 SSO"**：完成时 SSO 仍未生效（envSnippet + 重启），
   生效动作必然发生在安装后，配置动作留在首装向导是错位的。
3. **安全面**：向导 setup 走 bootstrap 窗口（首装无凭据，§9 S3），
   而它采集 `stateSecret`；同样的配置放到管理页则处于管理员会话门控之内
   （`/admin/sso/*` 有 `requireValidImtSession`）——直接缓解 S3。
4. **验证时序**：SSO 配置的验证（渠道数/密钥有效性）只有在系统运行后才有意义；
   管理页"保存即时生效、当场可验"是天然正确的时序。

**v1.3 各决策（§10.3 D1–D8）在 v1.4 的处置**：

| v1.3 决策 | v1.4 处置 |
|---|---|
| D1 网关服务密钥（SSO 卡必填） | **保留必要性，变更归属**：密钥移到唯一企业卡（两种模式共用），不再属于"SSO 配置" |
| D2 非 SSO 卡去 SSO 字样 / BFF 拒绝 sso | 企业卡即原非 SSO 流程；BFF 对 setup 携带 `sso` 的拒绝**保留**（管理页路径不经 setup） |
| D3 文案按模式切换 | 失效（单一企业卡，无模式分支）；步骤条回归单一文案 |
| D4 envSnippet 去 token 行 | envSnippet 的 SSO 行随向导 SSO 路径一起消失；SSO 参数由管理页运行时配置承载 |
| D5 已有企业后端隐藏 SSO 卡 | 失效（无 SSO 卡）；`status.hasEnterpriseBackend` 字段保留做兼容 |
| D6 SSO 免重启生效（当时不做） | **反转落地**：管理页运行时配置天然即时生效——`BFF_SSO_STATE_SECRET` 预置后，启用 SSO 全程免重启（v1.3 未做的能力成为 v1.4 默认） |
| D7 租户 ID 识别失败回退手填 | 保留在管理页"前置状态"卡；向导首装回归手填（v1.1 行为） |
| D8 非 SSO 模式租户 ID 采集不变 | 无意义化（单一企业卡即此行为） |

**v1.3 资产存续**：探针 snake_case 归一化、选项 memo/[option] 副作用修复（普适 bug 修复）保留；
渠道拉取组件、四项验证逻辑（`verifyEnterpriseSso`）**移植管理页复用**；
BFF setup/probe 的 setupProfile 分支保留一版做兼容（11.3）。

### 11.2 目标形态与管理页交互稿

**向导（4 卡）**：

```text
[1] Intellect Enterprise   ← 唯一企业卡 = 原「非 SSO 模式」流程
[2] Intellect Community
[3] HERMES
[4] AgentScope
```

企业卡描述追加："安装后可在 系统管理 → 统一认证设置 开启统一认证登录"；
完成页（企业后端）追加同一指引。SSO 卡、sso-section、验证/确认/完成的双模式分支全部移除。

**管理页（系统管理 → 统一认证设置）扩展交互稿**：

```text
┌─ 系统管理 › 统一认证设置 ─────────────────────────────────────────────┐
│ 副标题：统一认证(SSO)登录的运行时配置；保存后即时生效，无需重启。       │
│                                                                        │
│ ┌─ ① 前置状态（只读，[重新检测] 触发服务端实时检查）─────────────────┐ │
│ │ 企业后端   intellect-enterprise-default                            │ │
│ │   认证网关  https://ai.wust.edu.cn/intellect-gateway     ✓ 可达    │ │
│ │   服务密钥  ✓ 有效（网关侧校验：/v1/capabilities→/v1/models）      │ │
│ │   租户 ID   fedcba98…cdef（网关自动识别）                          │ │
│ │ 登录渠道   1 个可用（intellect-auth）                               │ │
│ │ BFF_SSO_STATE_SECRET   ✓ 部署配置已设置 / ✗ 未设置（黄字警示）      │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ ┌─ ② 生效配置（可编辑；保存即写入运行时配置 sso-config.json）────────┐ │
│ │ 启用统一认证登录            [开关]（后端未绑定/密钥未设时禁用+提示）│ │
│ │ 公开来源地址   [https://ai.wust.edu.cn]（http 黄字警告）            │ │
│ │ 登录渠道白名单  [获取渠道]  ☑ 统一认证(intellect-auth) ☐ …         │ │
│ │   （不勾 = 展示全部；配置缺失渠道灰显标注）                          │ │
│ │ 会话过期后静默重登          [开关]                                   │ │
│ │ [保存]   来源标注：运行时配置 / 环境变量兜底（沿用 A7 语义）        │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ ┌─ ③ 提示区 ────────────────────────────────────────────────────────┐ │
│ │ · 密钥未设时启用 → 黄字：重启后 BFF 将启动失败，先在部署配置设置     │ │
│ │ · 企业后端未绑定 → 启用开关禁用 + 指引到「Harness 后端」             │ │
│ │ · 启用后验证：打开登录页应出现渠道按钮（密码保留为破窗，非缺陷）     │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**三种状态与页面表现**：

| 状态 | ① 前置状态 | ② 生效配置 |
|---|---|---|
| 未就绪（无企业后端） | 后端未绑定，检测项灰显 | 启用开关禁用 + 指引 |
| 就绪未启用 | 全 ✓ | 可编辑，启用开关可用；保存即生效 |
| 已启用 | 全 ✓ | 可编辑；登录页应见渠道按钮 |

**运维顺序（对比 v1.3：五步 envSnippet 粘贴 → 一次静态预置 + 界面开关）**：

```text
① 首装：向导选 Intellect Enterprise（名称/网关/服务密钥/租户 ID）→ 完成
② 一次性：部署配置预置 BFF_SSO_STATE_SECRET（k8s Secret，静态值）
③ 管理员以成员密码登录（非 SSO 首装的天然破窗路径）
④ 统一认证设置：启用 + 公开来源 + 渠道 → 保存即时生效
⑤ 登录页出现渠道按钮，当场验证
```

**明确不做（边界）**：
- 管理页**不生成、不展示、不修改** `BFF_SSO_STATE_SECRET`（维持"密钥不入运行时存储"宪法边界）；
- 不做"自动写部署配置/自动重启"；
- 不改登录页交互（密码破窗保留）；
- 不动 HIEDU 链路；不新增 `authMode`。

### 11.3 契约与兼容策略

| 项 | v1.4 处置 |
|---|---|
| `GET /admin/wizard/backend-types` | **移除** `enterprise-sso` 卡（4 卡）；UI 与 BFF 同镜像发布，无跨版本组合风险 |
| `POST /admin/wizard/setup` 的 `setupProfile` | **保留一版 deprecated**：`enterprise-sso` 请求继续按现语义接受（建后端+出 SSO snippet），代码标注 deprecated；下一版再删。兼容已部署的 v0.4.9 UI + 新 BFF 组合 |
| `POST /admin/wizard/probe` 的 SSO 验证分支 | **保留**（管理页"重新检测/测试"的服务端复用点；含 snake_case 归一化修复） |
| `GET /admin/wizard/status` 的 `hasEnterpriseBackend` | 字段保留（兼容），UI 不再消费 |
| `GET /admin/wizard/sso/providers`（公开+限流） | 保留不动；管理页渠道预览**新增** admin 门控端点 `GET /admin/sso/providers`（走绑定后端，复用 `getLoginProviders` 裁剪视图），避免管理页依赖公开限流端点 |
| `GET /admin/sso/config` | **扩展**：视图增加 `stateSecretConfigured`（布尔，永不回显值）、`boundBackend { id, endpoint, gatewayOk, tenantId, keyValid, providersOk, providerCount }`；支持 `?check=1` 触发服务端实时四项检测（服务端复用 `verifyEnterpriseSso`） |
| `PUT /admin/sso/config` | 语义不变；新增服务端守卫：绑定后端缺失/密钥未设时返回 warnings（启用开关的前端禁用为 UX 层，服务端校验为准） |
| 数据迁移 | **无**。`sso-config.json`/env 语义不变；v0.4.9 向导路径只产出过 envSnippet（未写运行时存储），已装环境无需迁移 |

**版本载体**：建议 **v0.5.0**（向导选型结构变化 = minor；顺带统一 repo 内 0.4.8 的 package.json 版本号遗留）。

### 11.4 测试要点（实施后门禁）

1. 向导 4 卡；企业流程（连接/探测/确认/完成）与 v1.3 非卡路径行为一致；完成页含管理页指引。
2. 兼容：`setupProfile=enterprise-sso` 的 setup 仍 200（deprecated 路径回归）；未知 profile 仍 400。
3. 管理页：`GET /admin/sso/config?check=1` 四项状态正确（可达/租户/密钥/渠道）；`stateSecretConfigured` 布尔正确且响应永不含密钥值；`GET /admin/sso/providers` 门控（未登录 401）+ 字段裁剪。
4. `PUT /admin/sso/config`：后端未绑定/密钥未设时的 warnings；启用后登录页渠道出现（真实网关联调项）。
5. 回归保留：向导第 3 步重渲染循环、probe snake_case 归一化（W-P10）、选项按 (type, profile) 查找。

### 11.5 实施清单

**前端**

| 文件 | 动作 |
|---|---|
| `src/ee/pages/wizard/index.tsx` | 移除 SSO 卡与全部双模式分支（第 3–6 步 SSO 变体、Stepper 双文案、`hideSsoCard`、probe 发送 setupProfile）；保留 options memo、[option] 条件写回；企业完成页加管理页指引 |
| `src/ee/pages/wizard/sso-section.tsx` | 迁移为管理页组件（渠道预览 + 白名单勾选），向导不再引用 |
| `src/ee/pages/sso-settings.tsx` | 按 §11.2 交互稿扩展（前置状态卡 / 启用守卫 / 来源标注沿用） |
| `src/services/sso-admin-service.ts` | 扩展 view 类型；新增 providers 预览调用 |
| `src/services/wizard-service.ts` | 类型保留（兼容），UI 移除 sso/setupProfile 发送 |
| `src/ee/locales/{zh,en}-private.ts` | `wizard.sso*`/`ssoSetup`/`verify.*` 迁移至 `admin.ssoSettings.*`；清理废弃键 |
| `src/ee/pages/wizard/__tests__/wizard-modes.test.tsx` | 重写：4 卡 + 渲染循环回归保留；SSO 卡用例删除 |
| 新增 sso-settings 组件测试 | 前置状态/守卫/渠道预览渲染 |

**BFF**

| 文件 | 动作 |
|---|---|
| `bff/src/routes/wizard.ts` | 选项表移除 enterprise-sso 卡；setupProfile 分支标 deprecated 保留；probe SSO 验证保留；status 字段保留 |
| `bff/src/routes/sso-admin.ts` | view 扩展（`stateSecretConfigured` + `boundBackend`，`?check=1`）；新增 `GET /admin/sso/providers` |
| `bff/src/types/wizard.ts` | `setupProfile` 标 deprecated（不删） |
| `bff/src/routes/wizard.test.ts` / `sso-admin.test.ts` | 兼容用例标注 deprecated；新增管理页扩展用例 |

**文档 / 用例资产**

| 资产 | 动作 |
|---|---|
| 本文件 | §11 即草案；评审通过后状态改"已实施" |
| `docs/wizard-manual.md` | 4 卡；移除 SSO 章节；完成页指引 |
| `docs/wizard-ent-sso-mode-manual.md` | 改写为「统一认证配置手册（安装后管理页）」或并入 sso 手册 |
| `deploy/release-chain.md` | 「启用 SSO」章节改为：预置 Secret → 管理页启用（即时生效） |
| `docs/auth-intellect-auth-to-team-flow-status.md` | P0 首装口径更新（"首装选 SSO 卡"→"首装企业卡 + 管理页启用"） |
| `tests/e2e-tests/cases/wizard-ent-sso-mode/*`、`spec` | 按 v1.4 重写；新增管理页用例（建议 `TC-SOA-*`） |

### 11.6 待评审拍板项

| # | 决策点 | 建议 |
|---|---|---|
| 1 | `setupProfile=enterprise-sso` 兼容语义 | 保留一版 deprecated alias，下版删除 |
| 2 | 管理页"测试/检测"实现 | 扩展 `GET /admin/sso/config?check=1`（admin 门控，服务端复用 `verifyEnterpriseSso`），不复用公开 wizard 端点 |
| 3 | 渠道预览端点 | 新增 admin 门控 `GET /admin/sso/providers` |
| 4 | 未绑定企业后端 / 密钥未设时的启用开关 | 前端禁用 + 服务端 warnings（双保险） |
| 5 | 版本载体 | v0.5.0 |
| 6 | 向导专属 locale 键清理幅度 | 当版一次清理，管理页复用键迁至 `admin.ssoSettings.*` |

### 11.7 非目标

- 管理页不生成/不展示/不落盘 `BFF_SSO_STATE_SECRET`；
- 不做"自动写部署配置/自动重启"；
- 不改登录页交互（密码破窗保留，R10 延续）；
- 不动 HIEDU 链路；不新增 `authMode`；
- 不在 v0.5.0 删除 setupProfile 兼容分支（下一版再删）。

---

## 12. §11 v1.4 草案评审（草案 → 定稿修订）

> 评审方式：代码级核对 `bff/src/routes/wizard.ts`（选项表/`getWizardOption`/setup/probe 兼容路径）、
> `bff/src/index.ts`（sso-admin 挂载与全局 store 注入）、`docs/auth-intellect-auth-to-team-flow-status.md`
> §1.2–1.3，对 §11 逐条推演。
> **结论：方向通过（维持决策反转）；R-1 为实施阻断项，吸收后 §11 升为定稿；
> R-2/R-3/R-4 实施必做；R-5–R-10 并入清单。**

### 12.1 裁决摘要

| 维度 | 裁决 |
|---|---|
| 产品方向（决策反转：SSO 移交管理页） | **通过**。四条理由成立，且与"配置应在管理员会话内、验证应在系统运行后"的架构事实一致 |
| 兼容策略（§11.3） | **原样不通过 → R-1**：兼容声明与选项表实现自相矛盾，吸收后通过 |
| 管理页扩展（§11.2） | **通过，附补全**：R-6/R-7/R-8 为交互稿补全项 |
| 安全边界（stateSecret 不进管理页/运行时存储） | **通过**；S3（bootstrap 窗口）随向导 SSO 路径移除实质性缓解 |
| 实施清单（§11.5） | **通过，附 R-2/R-3 增补** |
| 版本载体 v0.5.0 | **通过** |

### 12.2 发现与处置

| 编号 | 级别 | 发现 | 处置（并入实现） |
|---|---|---|---|
| **R-1** | **P0 实施阻断** | §11.3 兼容声明与实现矛盾：`getWizardOption(type, profile)` 从 `BACKEND_TYPE_OPTIONS` 查找，**移除 enterprise-sso 卡后**，deprecated 的 `setupProfile=enterprise-sso` setup/probe 在选项查找处即返回 400 `Unsupported backend type`——"旧 UI + 新 BFF 不炸"的承诺落空 | 选项查找加 fallback：企业卡缺 `enterprise-sso` 条目时回退 `enterprise-password` 条目（capabilities 相同）；或选项表保留隐藏条目（不出现在 backend-types 响应）。**推荐前者**（无隐藏状态）。补兼容回归用例：删卡后 setup/probe 的 enterprise-sso 路径仍 200 |
| **R-2** | P1 | `?check=1` 需在 sso-admin 路由复用 `verifyEnterpriseSso`（现居 wizard.ts）——路由互相 import 不洁；且最坏耗时 ~15s（tenant 5s + 密钥探测 2×5s + 渠道 5s） | 将 `verifyEnterpriseSso`/`SERVER_KEY_PROBE_PATHS` 抽到 `bff/src/services/enterprise-sso-check.ts`；管理页 UI 增加检测 loading 态；可选：三项检测并发执行 |
| **R-3** | P1 | §11.3"PUT 服务端守卫（后端未绑定/密钥未设 warnings）"需要 stores——已核实 `harnessStore`/`backendStore` 为 app 级注入（index.ts:131–132），sso-admin 可 `c.get`，但当前路由未消费 | 实施清单补：sso-admin PUT 前校验默认租户 '0' 绑定的企业后端存在且就绪（沿用 auth.ts 的 `resolveSsoTenantBackend` 口径），缺失→warnings |
| **R-4** | P1 | 租户口径未定义：运行时 sso-config 是**全局**的，而渠道/回调按租户绑定解析后端；多企业后端部署下"管理页改的是哪个后端的 SSO"有歧义 | 明确：**管理页面向默认租户 '0' 的绑定后端**（与登录页 `resolveSsoTenantBackend('0')` 口径一致）；多企业后端/非默认租户场景记为不支持并写入手册（当前产品形态本就是单实例单租户） |
| R-5 | P2 | `stateSecretConfigured` 仅"存在性"不够：env 有值但 <32 字符时启动会 fail-fast，管理员看到的却是 ✓ | 布尔升级为三态：未设置 / 已设置 / 已设置但不合规（长度校验，不回显值）；③ 提示区文案对应 |
| R-6 | P2 | 交互稿前置状态卡缺 `keyValid=null` 第三态（网关无受保护端点时的"无法判定"） | 状态卡补"无法判定，将在使用时验证"展示态（复用 §11 verify.keyUnknown 文案） |
| R-7 | P2 | 租户 ID 缺失/不一致时管理页只读展示，无修正入口指引 | 状态卡补指引：租户 ID 修正走「系统管理 → Harness 后端」编辑页 |
| R-8 | P2 | "启用后验证登录页"未给出具体入口 | ③ 提示区补：新开页访问 `/login-next` 应见渠道按钮（+ IdP/网关侧 `redirect_uris` 白名单核对项，人工清单） |
| R-9 | P3 | 文档标题《向导企业版双模式选型设计》在 v1.4 后成为历史名 | 文首加一行历史名注记（v1.4 起双模式废止），标题不改（保留决策链可追溯） |
| R-10 | P3 | locale 边界测试（`src/locales/config-boundaries.integration.test.ts`）可能受键迁移影响 | 实施清单补：locale 键迁移后跑 locale 边界测试 |

### 12.3 §11.6 拍板项复核

| # | 拍板项 | 复核结论 |
|---|---|---|
| 1 | enterprise-sso setup 兼容语义 | **确认保留一版 deprecated**，但按 R-1 修选项查找 fallback |
| 2 | 检测实现 `GET /admin/sso/config?check=1` | 确认，按 R-2 抽共享 service |
| 3 | 渠道预览 `GET /admin/sso/providers` | 确认；租户口径按 R-4（默认租户 '0'） |
| 4 | 启用开关双保险 | 确认，按 R-3 补 stores 消费 |
| 5 | 版本载体 v0.5.0 | 确认 |
| 6 | locale 键清理 | 确认，按 R-10 补边界测试 |

### 12.4 评审结论

**§11 方向与主体设计通过；R-1 吸收（选项查找 fallback + 兼容回归用例）后，§11 升为 v1.4 定稿。**
实施按 §11.5 清单 + R-2/R-3 增补执行；R-5–R-10 随实现并入。实施完成前，§10 双卡形态（v0.4.9 已上线）维持现状不受影响。

---

## 13. v1.4 实施的质量与安全评审（实施后,评审发现已吸收）

> 评审方式:对 v1.4 全部实施 diff 做代码级核对(BFF 路由/服务/类型、前端向导重写/管理页扩展/service、locales、测试),安全面按 §9 清单口径复核。
> **结论:可提交。Q-1(P1 功能缺陷)评审中发现并当场修复(含回归用例);S 面无新增风险,既有边界保持。**

### 13.1 质量发现

| 编号 | 级别 | 发现 | 处置 |
|---|---|---|---|
| **Q-1** | **P1 功能缺陷** | 管理页手动渠道输入为受控输入直接绑定归一化 join/split——用户敲的逗号被立即剥掉,**无法连续输入多个渠道 id**(v1.3 用独立 providersText state 正是为规避此坑,重写时丢失) | 恢复独立 `providersText` state:数据加载/勾选联动写入,输入 onChange 即时解析到 form.providers;回归断言"键入 `a, b,` 逗号保留、保存产出 `['a','b']`"固化 |
| **Q-2** | P2 语义缺陷 | 管理页渠道预览走 `loadSsoConfig()`(含 env 白名单过滤)——被全局过滤掉的渠道在预览中不可见,管理员**无法重新勾选** | 预览改 `{...loadSsoConfig(), providers: null}`(与 wizard 检测口径一致);PUT 后保存的白名单才是过滤生效处 |
| **Q-3** | P3 卫生 | wizard.ts 残留未使用导入 `WizardProbeSso`(检测抽离后不再引用);`TENANT_ID_RE` 与共享服务重复定义 | 删除未使用导入;TENANT_ID_RE 改从 `enterprise-sso-check` 导入(单一来源) |
| Q-4 | P3 | `runLiveCheck` 中 `bound===undefined` 与 `===null` 两分支体相同 | 保留显式分支(语义不同:stores 缺失跳过 vs 确实未绑定),不合并 |

### 13.2 安全发现

| 编号 | 级别 | 复核项 | 结论 |
|---|---|---|---|
| S-1 | — | 新增 admin 端点门控 | ✅ `GET /admin/sso/providers`、`?check=1` 均在 `/admin/sso/*` 挂载点内,受 authMiddleware+requireValidImtSession 双层门控(与既有 /admin/* 一致) |
| S-2 | — | SSRF 面 | ✅ providers/check 的出站目标是**存储内绑定后端**(非用户输入),且 getLoginProviders/检测内部走 safeFetch;wizard probe 的 SSRF 预校验+限流未回退 |
| S-3 | — | bootstrap 窗口(§9 S3) | ✅ 实质缓解:向导不再采集 stateSecret/SSO 参数;SSO 配置全部在管理员会话内 |
| S-4 | — | 密钥泄露面 | ✅ `stateSecretStatus` 三态、`boundBackend` 仅 id/endpoint;providers 裁剪视图无 clientId/authorizeUrl/scopes;任何响应无 stateSecret/API_SERVER_KEY 明文(V-01 断言) |
| S-5 | — | CSRF(既有) | ⚠️ 不变:admin 写入口仍为 cookie 鉴权,CSRF 防护维持 §9 S3 backlog 口径(v1.4 未扩大也未收敛);记 backlog |
| S-6 | — | 注入/XSS | ✅ 渠道 id 白名单消毒(sanitizeSsoProviderIds)保留;管理页/向导无 dangerouslySetInnerHTML,所有动态文本经 React 转义 |
| S-7 | — | 限流 | ✅ 公开 wizard providers/probe 端点限流未回退;新增 admin 端点为门控态,无限流需求(检测最坏 ~15s,仅管理员可触发) |

### 13.3 评审结论

**通过,可提交。** Q-1 已修复并带回归用例;Q-2/Q-3 已吸收;S 面六项复核无新增风险,既有 backlog(CSRF/S5、限流)口径不变。发布载体 v0.5.0,发版顺序红线(先镜像后 newTag)不变。
