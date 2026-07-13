# Feature Specification: Canvas Plugin Extraction(画布插件化)

**Feature Branch**: `009-canvas-plugin-extraction`
**Created**: 2026-07-13
**Status**: 阶段 0 已实施完成(2026-07-13,含评审修复 T007),阶段 1-4 待实施
**Prerequisites**: spec/008-explicit-canvas-service(阶段 2 硬依赖)

## 概述

将画布(Canvas)功能从 `src/pages/agent/` 物理迁入独立包 `packages/canvas-plugin/`,复用现有 `features/_registry.ts` module system,实现画布代码内聚与可插拔。

## 设计文档

**权威源**: [canvas-plugin-extraction-design.md](../../docs/canvas-plugin-extraction-design.md)

该设计文档包含:
- 背景与目标
- 技术评审记录(6 项评审发现)
- 最终方案(架构概览、关键决策、复用 Module System、泄漏解耦、BFF 配合)
- 实施路线图(4 阶段)
- 风险与缓解
- Constitution 对齐
- 验收标准(10 项 SC)
- 泄漏文件清单附录

## 任务清单

**权威源**: [tasks.md](./tasks.md)

任务分 4 阶段:
- **阶段 0**: 反向解耦 6 个泄漏文件(可与 spec/008 并行)
  - 详细任务:[phase0-detailed-tasks.md](./phase0-detailed-tasks.md)(T001-T006,含两轮评审)
  - T002/T003 调查与评审:[phase0-t002-t003-investigation.md](./phase0-t002-t003-investigation.md) + [phase0-t002-t003-review.md](./phase0-t002-t003-review.md)
  - **T002 最终方案**:方案 B(修订)— 通用版本拆为 hook + UI 子组件 + 画布扩展版本;非画布调用方零改动
  - **T003 最终方案**:方案 G — 阶段 0 仅修 hook 调用 bug,彻底解耦延后到 BFF 统一 widget API;SC-002 豁免 `floating-chat-widget.tsx`
- **阶段 1**: 包结构搭建(monorepo workspace + alias)
- **阶段 2**: 代码迁移(依赖 spec/008)
- **阶段 3**: 验证与收尾
- **阶段 4**(可选): 独立构建与发布(延后)

## 核心设计决策(评审后)

| 决策 | 选型 | 理由 |
|---|---|---|
| 插件协议 | 复用现有 `ModuleDefinition` | 项目已有 module system,避免重复造轮子 |
| 物理结构 | monorepo `packages/canvas-plugin/` | npm workspaces 已就绪 |
| UI 组件共享 | 主应用 alias 引用,不抽离共享包 | 成本过高 |
| 状态管理 | `useGraphStore` 随画布迁入,内部封装 | 消除泄漏 |
| 构建方式 | 随主应用一起编译(阶段 1) | 简化,延后独立构建 |

## Constitution 对齐

| Principle | 对齐情况 |
|---|---|
| I. BFF-Mediated Frontend | ✅ 画布插件调 BFF `/api/bff/canvas/*` |
| III. Canvas Hard-Bound to Intellect RAG | ✅ BFF `CanvasService` 硬绑定(spec/008) |
| VII. YAGNI + Test-First | ✅ 不引入完整插件协议;保留现有测试 |
| V. Tenant Isolation | ✅ 画布按 `BffTenant.canvasBackendId` 路由 |
