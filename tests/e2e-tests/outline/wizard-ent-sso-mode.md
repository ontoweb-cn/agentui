# 测试大纲 — wizard-ent-sso-mode

日期:2026-11-23  
手册:`docs/wizard-ent-sso-mode-manual.md`  
设计:`docs/wizard-enterprise-sso-mode-design.md` §8  
截图/契约目录:`tests/e2e-tests/results/wizard-ent-sso-mode/`

## 步骤 3 — 手册↔代码差异清单（修复后复检）

| 手册口径 | 修复后代码 | 差异 |
|---|---|---|
| §3.1 五卡且首卡 SSO 模式 | `BACKEND_TYPE_OPTIONS` 5 卡，`optionId` 置顶 enterprise-sso | **已关闭 F-WED-01** |
| §3.1 两企业卡可分别选中 | Radio/`key`/`find` 用 `optionId` | **已关闭 F-WED-02** |
| §3.2 SSO 卡强制配置 | `lockedEnabled`；无启用可跳过开关 | **已关闭 F-WED-03** |
| §3.3 非 SSO 无 SSO 区 | `setupProfile===enterprise-sso` 才渲染 | **已关闭 F-WED-03** |
| §4 完成页待写入 env | BFF warning + Done 页 `ssoEnvPending` | **已关闭 F-WED-06** |
| §6 旧草稿迁移 | 无 optionId 的 enterprise 草稿清空选型 | **已关闭 F-WED-07** |
| setup profile 契约 | setupProfile 校验 + R5 缺省兼容 | **已关闭 F-WED-04** |

## 用例矩阵

| 组 | 文件 | 覆盖 |
|---|---|---|
| 01 选型 | `TC-WED-01-select-type.md` | 五卡顺序、双卡互斥选中、徽章/文案区分 |
| 02 连接 | `TC-WED-02-connection.md` | SSO 强制面；非 SSO 无面；切换重置 |
| 03 契约 | `TC-WED-03-setup-contract.md` | BFF/单测：profile、envSnippet、缺省兼容 |
| 04 确认完成 | `TC-WED-04-confirm-done.md` | 摘要/snippet/待写入提示 |
| 05 回归旧资产 | `TC-WED-05-legacy-tc-align.md` | TC-WIZSSO-01 4→5 卡口径对齐 |

隔离:选型浏览用 `?mode=add` 只读；setup 破坏性用例需备份 `bff/data/*.json`（R3）。  
R6:浏览器 MCP 若无法稳定操作本机 9391，以直连 BFF 契约 + 组件/单测证据，并记受限。

## 设计 §9 跟进（安全/质量，下一补丁）

| ID | 大纲用例建议 |
|---|---|
| S1 | providers/setup 对不安全 URL → 400；与 probe 同 SSRF 口径 |
| S2 | `providers` 含 `\n`/`=` → snippet 无注入行 / 400 或 warning 剔除 |
| Q1 | SSO 卡渲染含静默重登控件且无运行时缺 import |

详见 `docs/wizard-enterprise-sso-mode-design.md` §9；status W3/W4；spec §7。
