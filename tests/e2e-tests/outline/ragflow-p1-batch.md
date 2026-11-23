# 测试大纲 — RAGFlow P1 剩余批次(module: ragflow-p1-batch)

> 日期:2026-11-22;九步交付法步骤 4。关联手册:[chat-settings-web-search-manual.md](../../docs/chat-settings-web-search-manual.md)
> 本模块为**代码实施 + 自动化测试资产**交付:E2E 受限项见 §R6 现状注记,主验证面为 jest/vitest 自动化门禁 + 受控组件级用例。

## 组头约定

- 截图目录:`tests/e2e-tests/results/ragflow-p1-batch/`(E2E 可执行时归档;受限时记 R6)
- 前置依赖:前端 jest(ESBUILD_BINARY_PATH 口径见清单 v3)、BFF vitest
- 隔离声明:纯自动化用例无数据副作用(R3/R5 天然满足);E2E 若执行,数据带 e2e 前缀并清理
- 原生弹窗:无涉及
- 手册↔代码双向检视差异清单:已并入调研笔记 §3(模型设置折叠区无错误字段 → modelSettingOpen 不接线,记适配差异)

## 用例矩阵

| 编号 | 名称 | 层级 | 关联任务/手册 | 优先级 |
|---|---|---|---|---|
| TC-RP1-01 | 纯构建器 schema 校验矩阵(空 system/缺 {knowledge}/空变量名/缺 web key) | jest | T2.3/T2.9/§3.3 | P0 |
| TC-RP1-02 | hook 形态 schema(provider 保留/清除/缺 key 拒绝,save-reload 往返) | jest | T2.3/T1.4/§2.2 | P0 |
| TC-RP1-03 | chatPromptKbIssues 规则族(七分支) | jest | T2.9/§3.3 | P0 |
| TC-RP1-04 | 错误揭示 hook(初始折叠/展开+滚动/重复提交重复滚动) | jest | T2.8/§3.2 | P0 |
| TC-RP1-05 | 设置页无效提交 → 面板展开 + FormMessage 可见 + 滚动调用(组件级) | jest(组件) | T2.8/§3.2 | P0 |
| TC-RP1-06 | legacy Tavily 预选与清除语义(含 save-reload 保持) | jest(组件/helper) | T2.1/§2.3 | P1 |
| TC-RP1-07 | catalog 完备性 + 派生一致性(枚举↔catalog↔field/键名三处对齐) | jest | T2.2/§2.1 | P1 |
| TC-RP1-08 | BFF 校验纯函数(枚举/缺 key/legacy/空 provider) | vitest | T2.7/§4 | P0 |
| TC-RP1-09 | BFF PATCH 路由校验(合法放行/缺 key 400/未知 provider 400/无 prompt_config 不受影响) | vitest | T2.7/§4 | P0 |
| TC-RP1-10 | 真浏览器设置面板走查(错误揭示视觉/滚动/预选) | E2E | T2.1/T2.8 | P2(受限) |

## R6 现状注记(预登记)

| 编号 | 内容 |
|---|---|
| L-RP1-01 | TC-RP1-10 真浏览器走查依赖本地登录态与已注册后端;若环境不可用,以 TC-RP1-05 组件级证据代验,真机走查登记受限 |
| L-RP1-02 | 空变量名的 zod required_error 为英文原文("Required"/min(1) 文案),上游同款;非本批范围 |
