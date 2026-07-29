# 提交说明：Intellect-Team Python/Rust 两版本对齐需求

> **提交日期**: 2026-07-29
> **提交方**: AgentUI 团队
> **提交对象**: Intellect-Team 维护团队
> **等待期限**: 4 周（2026-08-26 前回复）
> **关联文档**: [intellect-team-alignment-requirements.md](./intellect-team-alignment-requirements.md)

---

## 提交背景

AgentUI BFF 在 v1.3.0/v1.4.0 迭代中，SSE 解析器与 HTTP 端点契约已全面对齐 Intellect-Team Rust Gateway（`intellect-gateway/src/platform/api_server.rs`）。近期技术评审发现 Python 版本（`plugins/platforms/api_server/adapter.py`）与 Rust 版本存在 **5 个 Blocker + 6 个 Major + 5 个 Minor** 级别的 API 不兼容差异，导致 BFF 对接 Python 后端时核心功能不可用。

## 需 Intellect-Team 优先确认的前置问题

在评估具体对齐需求前，请先回复以下 3 个问题（见对齐需求文档 §〇）：

| # | 问题 | 影响 |
|---|------|------|
| **P0** | Python 版本是否仍在维护？ | 决定对齐需求是否需要实施 |
| **P1** | 若仍在维护，是否有废弃时间表？ | 决定 AgentUI 是否需要双版本兼容 |
| **P2** | 新部署默认使用哪个版本？ | 决定 AgentUI 文档默认指引 |

## 核心诉求

### P0 级（Blocker，BFF 核心功能在 Python 后端不可用）

1. **B1**：Python 缺少 `GET /v1/models/{id}` 端点 → BFF getAgent 100% 返回 404
2. **B2**：Python 缺少 `POST /v1/chat/completions/{sid}/clarify` 端点 → v1.4.0 clarify 流程 100% 不可用
3. **B3**：SSE 工具调用事件名不一致（Python `tool.started`/`tool.completed` vs Rust `tool.progress` + 内层 `type`）→ 前端 ToolCallCard 不渲染
4. **B4**：SSE 推理事件名不一致（Python `reasoning.available` vs Rust `message.delta` + `type:reasoning.delta`）→ 推理过程不显示
5. **B5**：`GET /api/sessions/{id}/messages` 响应 schema 不兼容 → 会话历史永远为空

### P1 级（Major，功能可用但语义/安全有差异）

6 项，含 M3（`/api/tenant/info` 数据来源不同，Python 无 DB 访问途径，已降级为文档化）、M4（tenant_id 格式校验冲突，AgentUI 侧已适配）。

## AgentUI 侧已采取的行动

- BFF SSE 解析器、HTTP 客户端已全面对齐 Rust Gateway 格式
- spec-011 已实施 intellectTenantId 字段 + validateTenantConfigs 启动校验
- spec-011 测试用例将适配 32 位 hex tenant_id（D6 决策）
- 双版本兼容兜底方案已预设计完成（见 [dual-version-fallback-plan.md](./dual-version-fallback-plan.md)），**当前不启用**，等 Intellect-Team 回复后决定

## 期望回复

| 场景 | 期望回复 | AgentUI 后续动作 |
|------|----------|------------------|
| Python 仍在维护，可实施对齐 | P0+P1 实施时间表 | 等待实施，不启用兜底方案 |
| Python 仅安全补丁 | 仅 P0 实施时间表 | P1 降级为文档化，不启用兜底方案 |
| Python 已废弃 | 明确废弃声明 | 不启用兜底方案，文档化 Python 不支持清单 |
| 4 周内无回复 | — | 启用双版本兼容兜底方案（D7 决策） |

## 联系方式

请通过以下渠道回复：
- 代码仓库 Issue
- 或即时通讯渠道直接联系 AgentUI 团队

---

## 附件

1. [intellect-team-alignment-requirements.md](./intellect-team-alignment-requirements.md) — 完整对齐需求文档（含实证证据 + 行号引用）
2. [dual-version-fallback-plan.md](./dual-version-fallback-plan.md) — AgentUI 内部兜底方案（仅供参考，不需 Intellect-Team 实施）
3. [spec.md v8](./spec.md) — AgentUI spec-010 v8（Multi-Harness 扩展 + 接入向导）
