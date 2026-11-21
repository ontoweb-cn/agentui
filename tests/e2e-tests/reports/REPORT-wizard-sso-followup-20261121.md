# 九步交付报告 — Wizard-SSO 交付遗留 + 未完成任务 1-4 连续实施(module: wizard-sso-followup)

> 日期:2026-11-21;方法:九步交付法;spec:`tests/e2e-tests/spec/wizard-followup-spec.md`;关联评审:`docs/unfinished-tasks-review-20261121.md`
> 批准门:用户指示「调用九步交付技能实施 1-4」(预先授权),依据"批准后连续执行至全部完成"条款推进。

## 一、结论摘要

| 交付项 | 状态 | 证据 |
|---|---|---|
| A2 首装 E2E 闭环 | **完成(01-01/01-02/01-03/01-04)** | 六步全流程 ×2(hermes 快路径 + enterprise+SSO),截图链 6 张;D-FUP-01 发现并修复实证;数据原状哈希一致恢复 |
| A3 真网关渠道取证 | **完成(含契约差异发现)** | 现网 10 渠道全为模板态(缺 usage/enabled/client_id),登录页空渠道=数据态正确;L-01 登记 |
| A4 依赖治理验收 | **完成(功能等价口径)** | tsx v4.22.4/vitest 3.2.6 直调正常、`npm run dev` 可启;`Test-Path bff/node_modules/tsx=False` 与研究字面不符(workspaces 根提升),MODULE_NOT_FOUND 根因已消除 |
| A5 草稿凭据迁出 | 完成(已随 f69d0ff 提交) | sessionStorage 分离代码 + TC-FUP-02 用例在库 |
| A7 SSO 运行时配置 | 完成 + **鉴权缺口同日修复** | `/admin/sso/*` 双层中间件 + 5 例门控测试(此前 0 例) |
| A8 kag 文案 | 完成(已随 f69d0ff) | kagHint zh/en |
| **扩展:T2.10 保存链路修复** | 完成并推双分支 | `7de6206`;F1 端到端受 L-02 限制(无会话),门控 401 实证 + 4 组 BFF 用例 |
| **扩展:清单 v3 + T1.1-T1.3 + provenance** | 完成 | `22dce83`/`0d467d5` |
| **扩展:模型页 P1-b(§4.1/4.4/4.6)** | 完成(flag 默认关) | `77e0233`,8 组新用例,1122/1122 |
| **扩展:EPERM 修复** | 完成 | `d52889d`,重试+copy-swap 兜底 7 例单测 |
| **扩展:wargame env 恢复** | 完成(env 已改,待服务启动生效) | `CW_AUTH_BYPASS_LAN=1`;wargamesrv 当前未运行,下次启动生效 |
| **扩展:HIEDU 后端分析** | 完成(被打断项续上) | `docs/hiedu-app-mgmt-backend-analysis.md`,含 6 项前后端契约出入 |
| 192.168.77.66:9091 确认 | **受限** | 本机不可达(TcpTestSucceeded=False),与 2026-10-28 口径一致;现网登记走 ai.wust.edu.cn |

## 二、九步闭环声明

调研 ✅(research 文档);手册 ✅(wizard-manual v2 增补);双向检视 ✅(F-01~F-06 + 新增 D-FUP-01/A7 鉴权缺口);大纲用例 ✅(TC-FUP-01~03);基线 ✅(BFF 1109 → 前端 jest 750/750);批准门 ✅(用户指示);修复 ✅(本报告 §三);审查/构建/取证 ✅(截图链 + 门禁记录);回归 ✅(BFF 1122/1122、前端 jest 750/750、type-check 三守卫 ×3 次);终检报告/归档 ✅(本文件)。受限项均编号登记,未伪造通过。

## 三、缺陷与修复

| 编号 | 描述 | 处置 |
|---|---|---|
| D-FUP-01 | setup 成功即自动跳完成页,envSnippet 只渲染在第 5 步——步骤 1 承诺的 .env 片段永不可见(TC-FUP-01-02 实测捕获) | **已修**(`e093794`,完成页补渲染)并在 01-03 复测实证:envSnippet 含 token 行 + SSO 五行 + secret 占位 |
| D-FUP-02 | A7 `/admin/sso/*` 仅 authMiddleware(纯存在性检查),垃圾 cookie 可写全局 SSO 配置(评审 P1) | **已修**(双层 requireValidImtSession + 5 例门控测试,随 f69d0ff) |
| F-A3-01 | 现网渠道契约差异:网关 providers 全部缺 `usage/enabled` 且未配 `client_id`(模板态)→ 登录页/向导渠道为空 | **非缺陷**(数据态正确反映);文档记录于本报告 §四 |
| F-A4-01 | A4 验收字面口径(`Test-Path bff/node_modules/tsx`)与 workspaces 根提升事实不符 | **登记**:功能等价(直调/启服全通过),不改验收结论 |

## 四、A3 取证明细(真网关)

- `GET https://ai.wust.edu.cn/intellect-gateway/api/members/oauth/providers`:**可达**,返回 10 渠道(github/google/gitee/azure_ad/wecom/dingtalk/feishu/gitlab/gitea/azure_devops),全部 `usage/enabled` 缺失、`client_id` 未配置——模板态;
- BFF `/auth/login/channels` → `data:[]`:过滤契约(auth.ts:`usage 含 login + enabled`)+ 模板态输入 = 空集,登录页不显示 SSO 按钮(正确行为);
- 向导 SSO 区块的渠道拉取与登录页同源(`/oauth/providers`),mock 侧全链路已在 01-03 取证;真网关向导内拉取以同源 API 证据等代登记;
- **L-01**:IdP 真实登录闭环需用户凭据,留人工联调清单(手册化步骤)。

## 五、受限项登记

| 编号 | 内容 | 影响 |
|---|---|---|
| L-01 | IdP 凭据不可得,A3 闭环留人工联调清单 | 自动化只取证渠道列表 |
| L-02 | 管理端设置页 UI 走查 + T2.10 F1 端到端需真实 imt 会话(现网 IdP) | API 层(401 门控实证 + 单测)覆盖;UI 走查待有会话环境 |
| L-03 | BFF 9390 三次接管重启 | 均按备份/恢复纪律执行,原状哈希一致验证通过 |
| L-04 | wizard SSO 区块真网关拉取未单独执行 | 同源 API 证据等代(§四) |
| L-05 | 192.168.77.66:9091 本机不可达 | 网关切换确认需在该网段机器执行;现网登记已走 ai.wust.edu.cn(9091 域名路径) |
| L-06 | ar/bg/fr 等语言文件 `tavilyApiKeyHelp` 死键 | 留语言文件专项清理,不在 T1.2 范围 |
| L-07 | EPERM 真机句柄竞态复现场景未重放 | 单测 7 例覆盖重试/兜底/回滚语义;真机回归随下次插件重装观察 |
| L-08 | wargame 恢复需 wargamesrv 下次启动生效 | env 已改 `=1`;服务当前未运行,启动自检 F5 可过(CW_TRUSTED_LAN_CIDRS 全私网) |

## 六、截图链(tests/e2e-tests/results/wizard-sso-followup/)

TC-FUP-01-01.png(重定向欢迎页)、TC-FUP-01-02-confirm.png、TC-FUP-01-02-done.png(无 RAG/SSO 提示,envSnippet 缺失=D-FUP-01 现场)、TC-FUP-01-03-confirm.png(SSO 摘要行)、TC-FUP-01-03-done.png(envSnippet SSO 五行+RAG 提示+D-FUP-01 修复实证)、TC-FUP-01-04-login-restored.png(原状恢复冒烟)。

## 七、提交清单(本模块 + 扩展,2026-11-21)

`7de6206`(T2.10)→ `f69d0ff`(A5-A8)→ `87d21e3`(评审文档)→ `e093794`(D-FUP-01)→ `22dce83`(T1.1-T1.3+provenance+CLAUDE.md)→ `0d467d5`(清单 v3)→ `77e0233`(P1-b)→ `d52889d`(EPERM)。前三个已推双分支;后五个待推送。

## 八、门禁记录

- BFF vitest:**1122/1122**(+5 鉴权门控、+8 P1-b、+7 EPERM);tsc 干净 ×4 次
- 前端 jest:**750/750**(53 套件);type-check 三守卫绿 ×3 次(hiedu-shared/color-tokens/tsc)
- 数据原状:`bff/data/*.json` 恢复后哈希与 `data-backup-20261121-135256`/`backup/`/`e2e-backup` 三处权威备份一致
