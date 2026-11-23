# 测试大纲 — auth-team-sso

模块:auth-team-sso | 日期:2026-11-23  
手册:`docs/auth-team-sso-manual.md` + `docs/bff-sso-login-manual.md`  
现状真源:`docs/auth-intellect-auth-to-team-flow-status.md`

## 差异清单(步骤 3 手册↔代码)

| ID | 手册口径 | 代码/上游 | 处置 |
|---|---|---|---|
| D-01 | SSO 成功进工作台 | BFF 调 `POST …/members/oauth/exchange`;**公网 404 / Rust 源码无路由** | 记 **F-TEAM-RUST-01**;步骤 6 恢复 Rust |
| D-02 | 同上双栈无感 | Python **无** exchange | **F-TEAM-PY-01** |
| D-03 | 渠道按钮出现 | 依赖 providers;`client_id` 契约要求 vs 当前结构缺失 | **F-TEAM-PROV-01**;本地仍可能靠兜底展示 intellect-auth |
| D-04 | 「账号尚未开通」 | BFF 映射 `member_not_provisioned`;上游无 exchange 时用户更常遇 404/不可用 | 恢复后以 TC 覆盖 |
| D-05 | 静默重登 | BFF `sso/relogin`+`prompt=none` 已实现 | 手册一致;真 IdP 受限 L-01 |
| D-06 | 仅 IdP 注册不能进站 | 无自动 imt;与手册 §1 一致 | 保持;用例 TC-ATS-03 |
| D-07 | spec-014 曾标已实现 | 文档已修订 Status | 关闭文档债 F-DOC-01(文档侧) |

## 用例矩阵

| 用例 | 轴 | 优先级 | 依赖 |
|---|---|---|---|
| TC-ATS-01 登录页企业态+渠道可见 | 正常 | P0 | 本地 BFF enterprise |
| TC-ATS-02 点击统一认证发起(至 IdP 或错误页) | 正常 | P0 | 渠道;真 IdP 可达 |
| TC-ATS-03 未开通语义(member_not_provisioned 文案/映射) | 错误 | P0 | mock/夹具或上游 |
| TC-ATS-04 公网/源码 exchange 存在性 | 契约 | P0 | 只读探针 |
| TC-ATS-05 providers 含 client_id | 契约 | P0 | 只读探针 |
| TC-ATS-06 BFF SSO 单测回归(authorize/callback/exchange mock) | 回归 | P0 | vitest |
| TC-ATS-07 Python 源码具备同路由(静态检视) | 双栈 | P0 | 源码 rg |
| TC-ATS-08 密码登录对照(enterprise) | 对照 | P1 | 需测试账号→可能受限 |
| TC-ATS-09 静默重登(relogin prompt=none) | 边界 | P1 | vitest+可选 UI |
| TC-ATS-10 HIEDU 仅注册不能直接进站(文档/错误路径) | 联动 | P1 | 手册+错误码 |

隔离:R3/R5 — 本模块以只读探针+BFF mock 为主,不写生产数据。  
R1:UI 用例走真实浏览器;契约探针允许只读 GET/空 POST 取证。  
R6:L-01 IdP 凭据;L-PY-PROD 无独立 Python 公网实例;L-10 生产首装另册。

## 夹具

见 `fixtures/auth-team-sso/`(exchange 错误体、providers 样例)。
