# 调研笔记 — auth-team-sso（HIEDU 开通/对账 + agentui SSO 现换 imt_*）

> 日期:2026-11-23  
> 依据:`docs/auth-intellect-auth-to-team-flow-status.md` §1.2–§1.5  
> 模块:`auth-team-sso`  
> 范围:企业版登录主路径;intellect-team **Rust + Python 双栈**契约;不覆盖 T4.2/Phase B

## 一、前端组件树

| 位置 | 职责 | 关键事实 |
|---|---|---|
| `src/pages/login-next/index.tsx` | 登录/注册 | `useAuthMode`→enterprise 显示 login_name;渠道按钮 `useLoginChannels`;`ssoError`/`error` query 提示 |
| `src/hooks/use-login-request.ts` | login/channels/logout/authMode | `useAuthMode` 公开拉 `/auth/config`;渠道点击最终 `window.location` 跳 BFF authorize |
| `src/hooks/auth-hooks.ts` | cookie 探测 | 企业版 `/auth/me`;401 清态;静默重登触发点与 BFF `sso/relogin` 配合 |
| `src/utils/api.ts` | 路径常量 | `loginChannels`/`authConfig` 等挂 `/api/bff/auth/*` |
| `src/locales/{zh,en}.ts` | 错误文案 | `member_not_provisioned`→「账号尚未开通」 |

## 二、BFF 路由/管线

| 端点 | 行为 | 锚点 |
|---|---|---|
| `GET /auth/config` | 公开返回 `authMode` | `bff/src/routes/auth.ts` |
| `GET /auth/login/channels` | SSO 开且 enterprise→`GET {team}/api/members/oauth/providers` | 同上;过滤 enabled+login |
| `GET /auth/sso/authorize/:provider` | BFF-as-RP:PKCE/state/nonce→302 IdP | `handleSsoAuthorize` |
| `GET /auth/sso/relogin` | `prompt=none` 静默 | 需 `sso_provider` cookie |
| `GET /auth/oauth/callback` | 验 state→`exchangeAuthorizationCode` 或 id_token 路径→`imt_token` | `sso-exchange.ts` |
| `POST /auth/login` | 密码→team `/api/members/login` | 不经 IdP |
| `GET /auth/me` / `POST /auth/logout` | member 会话 | cookie |

契约真源:`specs/014-sso-token-exchange/contracts/sso-exchange.ts` — 路径 **`POST /api/members/oauth/exchange`**。

## 三、intellect-team 双栈(跨仓 `/workspace/intellect-team`)

| 能力 | Rust `main`@`8fd124cd` | Python `adapter.py` |
|---|---|---|
| `POST /api/members/oauth/exchange` | **缺失**(曾 `1c034c51`+`9a0143dd`,D2 `065f21df` 冲掉) | **无** |
| 公开 providers + `client_id` | 有 `/api/members/oauth/providers`;**无 client_id 字段** | `/api/oauth/providers` 字段未对齐 |
| `POST /api/oauth/exchange-id-token` | 有(D2,默认 JIT) | 无 |
| 密码 login/register/`{id}/token` | 有 | 有 |
| HIEDU sync API | `hiedu_sync_api.rs`(团队/项目成员) | 未见对等 `_tsync/_sync` 纳管面 |
| `bind_identity_if_absent` | 存储层有 `create_member_with_identity_tx`;exchange handler 缺失 | 旧 `auto_provision*` |

## 四、运行库与环境基线(开工实测)

| 项 | 结果 |
|---|---|
| 本地 BFF `:9390` `/health` | 200 `intellect-agentui-bff` |
| 本地 Vite `:9391` | 200 SPA |
| 本地租户 `0` | `authMode=intellect-enterprise` |
| 本地 `GET /auth/config` | 200 → enterprise |
| 本地 `GET /auth/login/channels` | 200 → `intellect-auth` 渠道可见 |
| 公网 Gateway providers | `https://ai.wust.edu.cn/intellect-gateway/.../providers` **200**(模板渠道列表) |
| 公网 Gateway exchange | **404**(复证 T1) |
| IdP discovery | `https://ai.wust.edu.cn/auth/.well-known/openid-configuration` **200** |
| 完整 IdP 账号密码 | **受限 L-01**(凭据不可自动化) |
| 生产 agentui 首装 | 历史 L-10;本地已 enterprise,**生产是否仍 needsSetup 本轮另探针** |
| Python Gateway 真网实例 | **未单独暴露 URL** → Python 对齐验收走源码+本地/CI,**真网 Python E2E 受限** |

## 五、与既有九步资产关系

| 既有模块 | 关系 |
|---|---|
| `bff-sso-p2` | BFF RP 已交付;本模块聚焦 **team 双栈契约恢复 + HIEDU 开通语义 + 真网闭环** |
| `wizard-sso` | 向导/SSO 开关;本模块不重复向导 UI,仅依赖其产物(enterprise+SSO env) |
| `docs/bff-sso-login-manual.md` | 用户可见 SSO 行为;本模块手册补「开通/未开通」与双栈无感说明 |

## 六、初步缺陷/缺口(待步骤 5 编号)

1. **F-TEAM-RUST-01**:公网+源码均无 `members/oauth/exchange` → BFF SSO 主路径不可用  
2. **F-TEAM-PY-01**:Python 无同契约 exchange  
3. **F-TEAM-PROV-01**:providers 缺统一 `client_id`(BFF RP 依赖)  
4. **F-DOC-01**:spec-014 状态表曾标 ✅(已在现状文档/spec 头修订,步骤 3 再核)  
5. 部署/对账/深链属运维与 HIEDU 仓,本模块记 **受限** 或跨仓修复项

## 七、实施优先级(对齐现状文档落地顺序 0)

1. Rust 恢复 exchange(+路由快照测试防再丢)  
2. Python 对齐同契约  
3. providers.`client_id` 双栈  
4. agentui 联调/冒烟;HIEDU 开通与深链分仓跟进
