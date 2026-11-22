# 质量 + 安全评审 — `dev` vs `main`（P1 批次后）

> 生成时间:2026-11-22
> 评审范围:`main`..`dev` @ `9dadf97`（P1 九步交付 + BFF 修复 + T2.5 ee overlay）
> 评审方法:Bugbot（质量）+ Security Review（安全）并行；关键发现对照源码实证
> 结论:**安全 0 发现**；质量 **2 Medium + 2 Low**（均已在同日闭环，见 §三）

## 一、安全评审

无新增可利用问题。维护提示（非缺陷）:BFF 与前端各维护一份 web-search provider 枚举，后续变更需同步。

## 二、质量发现总表

| # | 级别 | 位置 | 发现 |
|---|---|---|---|
| 1 | Medium | `src/ee/pages/wizard/index.tsx` | 从 `@/routes` 导入 `Routes`，连带加载 `createBrowserRouter` 副作用；与 `@/constants/routes` 约定及 `wizard-guard` 不一致，Jest/jsdom 易踩雷 |
| 2 | Medium | `use-chat-request.ts` `useUpdateChat.onError` | 保存失败双 toast：`message.error` + `next-request` 拦截器 `errorHandler`。根因：axios create 配置里 `errorHandler` 被注释，但响应拦截器 L199 仍手动调用 |
| 3 | Low | `useUpdateChat` `dataset_ids` 守卫 | `if (params.dataset_ids)` 对空数组今天可用（`[]` 为真），但应用 `!== undefined` 更稳妥、语义对齐 T2.10 |
| 4 | Low | `chat-settings.tsx` `onSubmit` | `updateChat`（`mutateAsync`）未 `await`，失败路径可能 unhandled rejection |

此前 High（intellect-rag `updateSession` 死 body）仍判定已修复；分享页 `has_tavily_key` 回落按 T4.1a 过渡设计不记缺陷。

## 三、修复记录（2026-11-22 同日闭环）

| # | 处置 | 证据 |
|---|---|---|
| 1 | Wizard 改为 `import { Routes } from '@/constants/routes'` | `src/ee/pages/wizard/index.tsx` |
| 2 | 移除 `useUpdateChat.onError` 重复 toast；`errorHandler` 经 `resolveHttpErrorDescription` **优先展示服务端 `data.message`**（保留 T2.7/T2.8 可读 detail，单 toast） | `next-request.ts`；新增 `resolve-http-error-description.ts` + 单测 |
| 3 | 抽取 `buildUpdateChatPatch`，`dataset_ids !== undefined` 才写入 `kb_ids`（含空数组清空） | `build-update-chat-patch.ts` + 单测；`use-chat-request.ts` 改用该 helper |
| 4 | `onSubmit` 改为 `await updateChat(...)` | `chat-settings.tsx` |

门禁（本批）:`npx jest` 4 套件 13/13 绿（`resolve-http-error-description` / `build-update-chat-patch` / `chat-settings-reveal` / `chat-settings-preselect`）;`npx tsc --noEmit` 0 错。
