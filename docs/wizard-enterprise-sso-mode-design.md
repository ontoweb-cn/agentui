# 向导企业版双模式选型设计：企业版（SSO模式）/ 企业版（非SSO模式）

| 项 | 值 |
|---|---|
| 文档版本 | v1.2（含 §8 选型评审 + §9 质量/安全评审） |
| 日期 | 2026-11-23 |
| 状态 | 双卡主路径已实施；§9 **安全加固与质量债**为必跟进（公网暴露前先合 H1/M1/Q1） |
| 前置决策 | 用户确认方案 **A**：SSO 不再作为 `intellect-enterprise` Connection 内嵌可选项，而是 SelectType **独立首卡** |
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
| **S1** | **High / 公网 P0** | `GET /admin/wizard/sso/providers`（及 setup 白名单校验）经 `isUrlSafe` 后调用 `getLoginProviders` → 底层 **裸 `fetch`**，无 `safeFetch`、无 `redirect:'manual'`、无解析后私网复核；默认可打私网（`SSRF_ALLOW_PRIVATE_IP`） | **(1)** wizard 路径改为经 `safeFetch`（或给 `sso-providers` 注入可测的安全 fetch）；**(2)** 公网部署强制 `SSRF_ALLOW_PRIVATE_IP=false`；**(3)** 可选：providers 与 probe 同级要求 bootstrap/admin（收紧公开面）。单测：SSRF 拒绝 + 限流仍绿 |
| **S2** | **Med / P0** | `sso.providers[]` 仅 `typeof string && trim`，原样写入 `BFF_SSO_PROVIDERS=…`，可注入换行篡改运维粘贴的 `.env` | setup 生成 snippet 前：**仅允许** `^[a-zA-Z0-9_-]+$`，**且**（若已拉到渠道列表）须 ∈ 网关返回 id；非法 id → 剔出并 `warnings`，或整单 400。单测：含 `\n` / `=` 的 id 不得出现在 snippet |
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
| **Q1** | **P0** | `sso-section.tsx` 使用 `<Switch>`（静默重登）但 **未 import** → SSO 卡运行时/构建失败 | 补 `import { Switch } from '@/components/ui/switch'`（或改用既有 Checkbox 模式并删 Switch）；加组件/单测冒烟 |
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
