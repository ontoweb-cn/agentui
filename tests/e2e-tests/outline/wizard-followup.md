# 测试大纲 — Wizard-SSO 交付遗留(module: wizard-sso-followup)

关联手册:`docs/wizard-manual.md`(v2 增补 §3.1/§9/KAG 注);调研:`outline/wizard-followup-research.md`。

## 一、范围(任务映射)

| 任务 | 内容 |
|---|---|
| A2 | 首装模式 E2E 闭环(清空数据模拟首装,免鉴权全流程) |
| A3 | 真网关渠道取证 + IdP 人工联调清单 |
| A4 | 依赖治理(根 npm install 重链 shims + 平台原生依赖) |
| A5 | 草稿凭据迁出 localStorage(sessionStorage 会话级) |
| A6 | babel-plugin-import-meta-glob Windows 修复(**已完成**,750/750) |
| **交付状态(v2,2026-11-21 终检)** | **A2/A3/A4/A5/A6/A7/A8 全部完成**;报告 [REPORT-wizard-sso-followup-20261121.md](../reports/REPORT-wizard-sso-followup-20261121.md);受限 L-01~L-08 |
| A7 | SsoStore(runtime>env 合并)+ GET/PUT /admin/sso/config + 管理端设置页 |
| A8 | 管理端 kag 类型说明文案 |

隔离:同前(备份/恢复 + e2e 前缀)。

## 二、差异清单(步骤 3)

| # | 手册口径 | 现状 | 处置 |
|---|---|---|---|
| F-01 | §3.1 凭据仅标签页会话保存 | localStorage 明文长期存留 | A5 |
| F-02 | §9 统一认证设置页 | 不存在(env-only,改配置需重启) | A7 |
| F-03 | §2 KAG 不在向导(管理端可配) | 管理端类型选择无说明文案 | A8 |
| F-04 | 首装免鉴权全流程 | UI E2E 从未走通(Create 401) | A2 |
| F-05 | jest 全平台可跑 | Windows 下 import.meta.glob 失效 | A6(已完成) |
| F-06 | 开箱可跑(测试/启动) | shim 断链/原生依赖缺失 | A4 |
| — | 探测/渠道/错误路径 | 与上一交付一致 | 回归保障 |

## 三、执行方式与五轴

| 层 | 方式 |
|---|---|
| L1 UI | 浏览器自动化:A2 全流程(首装模式)、A5 刷新行为、A8 文案、A3 真网关渠道区块 |
| L2 单测/API | BFF vitest(sso-store/sso-admin/合并语义);前端 jest 全量 |
| L3 回归 | BFF 全量 + 前端全量 + 登录页/管理端冒烟 |

五轴:A2(正常+直达入口)A5(边界=刷新/关标签)A7(正常/边界=非法值/错误=401/400)A3(联动=真网关)。

## 四、R6 受限声明(预登记)

- L-01:IdP 凭据不可得 → A3 闭环留人工联调清单(手册化步骤),自动化只取证渠道列表;
- L-02:管理端设置页 UI 需管理员会话(现网 imt cookie);自动化以 API 层(401/400/单测)覆盖,UI 走查留待有会话环境;
- L-03:BFF 9390 为既有实例,A2/A7 涉及重启接管,恢复后需健康验证。

## 五、退出条件

- L2 全绿(BFF 新增用例 + 前端全量 750/750);L1 A2 全流程截图链完整;
- F-01~F-06 每项有实施与验收证据;受限项登记;三方一致复核。
