# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the INTELLECT frontend.

## Project Overview

INTELLECT is the Agent Harness frontend for Intellect RAG, built with Vite:
- **Framework**: React 18 + TypeScript + Vite 7
- **Routing**: React Router v7 (lazy-loaded)
- **Components**: shadcn/ui (locked, do not modify `src/components/ui/`)
- **Styling**: Tailwind CSS 3 + LESS
- **State**: Zustand (local) + TanStack Query (server)
- **Data Fetching**: TanStack Query (React Query) via Axios
- **i18n**: react-i18next (17 languages)
- **BFF**: Hono (Node.js) in `bff/` directory for Harness-specific backend logic

## Architecture

This project was split from the Intellect RAG monorepo. It consists of:
1. **Frontend SPA** (`src/`) - React application
2. **BFF** (`bff/`) - Node.js/Hono backend-for-frontend layer
3. **Nginx** (`nginx/`) - Reverse proxy serving SPA + proxying to intellect-rag backend

API communication flows: Browser → Nginx → BFF(adapter-registry 多后端:chat 会话存储于 intellect-team Rust Gateway /api/sessions/*;RAG/数据集/检索经 intellect-rag Python fork,Go 化 Phase C 替换)

## Common Commands

```bash
# Frontend
npm install
npm run dev          # Dev server (port 9391)
npm run build        # Production build
npm run lint         # ESLint + oxlint(T2.6 并行;快捷 npm run lint:oxlint)
npm run test         # Jest tests
npm run type-check   # TypeScript check

# BFF
cd bff && npm install
npm run dev:bff      # BFF dev server (port 9390)
# Or run both together:
npm run dev:all      # Frontend + BFF concurrently

# API type generation (requires intellect-rag backend running)
npm run gen:api-types
```

## Development Conventions

### CSS and Layout Debugging
When fixing CSS/layout issues (especially flex truncation, ellipsis, or element sizing), **always inspect the full parent hierarchy** for `flex-shrink`, `min-width`, and `overflow` constraints before applying fixes like `min-w-0`. Do not repeatedly apply the same fix without verifying the root cause.
- Before editing, explain: (1) the full flex/container hierarchy from the target element up to the nearest non-flex ancestor, (2) what constraint is actually causing the bug, and (3) how the proposed fix addresses that root cause.

### Text Overflow

Any element rendering **user-generated or server-returned text** (names, titles, descriptions, file names, messages) inside a bounded container (card, table cell, dialog title, list item, badge, select trigger, button) must have an explicit overflow strategy. Never assume real data is short.

- Choose deliberately: single-line `truncate`, multi-line `line-clamp-N`, or intentional wrapping with `break-words`. Rendering with no strategy is a defect — long real-world data always finds it.
- `truncate` needs a width constraint to bite: add `min-w-0` on every flex ancestor between the text and the element that actually constrains the width (flex children default to `min-width: auto` and won't shrink below content size).
- Keep truncated text revealable: prefer the shared `TruncatedText` component (`src/components/truncated-text.tsx`), which shows a tooltip only when truncation actually occurs.
- Long i18n strings count as long text — a label that fits in Chinese may overflow in English.
- When overflow is suspected or the user asks, verify with extreme input (100+ characters, an unbroken no-space string, a CJK/Latin mix) rendered in a real browser or Storybook. jsdom and lint cannot measure layout.

### Scope and Boundaries
Respect explicit boundaries from the user. If the user says **"only fix the selected line"** or **"do not touch shared types/files"**, follow that instruction exactly. Do not investigate unrelated errors, modify shared schemas (e.g., `LlmSettingFieldSchema`), or refactor other files without confirmation. If a change outside the described scope seems necessary, ask for permission first.

### Internationalization (i18n)
For translation tasks, add keys **only to the explicitly requested language files** (commonly `src/locales/zh.ts` and `src/locales/en.ts`). Do not auto-propagate changes to all language files unless the user explicitly asks.
- **Style for `en.ts`**: Sentence case — first word capitalized, rest lowercase (e.g., `referenceAnswer: 'Reference answer'`). Proper nouns remain as-is.

### React Component Refactoring
When refactoring or extracting components, **verify layout behavior after each structural change** (especially `flex-1`, conditional rendering, or flex direction changes). Check that existing buttons, alignment, and responsive behavior remain intact. After extraction, verify: (1) all original props and behavior are preserved, (2) layout in parent contexts is identical, and (3) no syntax or type errors were introduced.

### State Management and Data Fetching

#### Query Key Factory (Mandatory)
**Never write raw `queryKey` arrays inline.** Always use a query key factory object that returns `as const` tuples. Raw arrays duplicated across `useQuery` and `invalidateQueries` are brittle, unreadable, and cause stale-cache bugs when key structures drift.

```ts
// ❌ Bad — raw array, hard to match with useQuery
queryClient.invalidateQueries({
  queryKey: [LLMApiAction.AddedProviders, params.provider_name, params.instance_name, 'models'],
});

// ✅ Good — factory reference, self-documenting
queryClient.invalidateQueries({
  queryKey: LlmKeys.instanceModels(params.provider_name, params.instance_name),
});
```

- Place the factory in the same file as the hooks, named `{Domain}Keys` (e.g., `LlmKeys`, `DatasetKeys`).
- Every `useQuery` and every `invalidateQueries` must reference the same factory function.
- Use `as const` on each factory return value for type-safe readonly tuples.

#### Cache Debugging
For React Query / cache invalidation bugs, **carefully compare query keys across all consuming components and mutation hooks**. Mismatched keys (e.g., with/without `refreshCount`) are a common root cause of stale data or duplicate requests.
- Systematically: (1) list every component/hook that calls `useQuery` for this data, (2) compare their query keys character-for-character, (3) check every mutation's `onSuccess` for cache invalidation, and (4) verify no parent re-renders are remounting the observer.

### Network Request Layering
HTTP requests are organized in three layers. **Never import `@/utils/request`, `@/utils/next-request`, or `@/utils/api` directly inside a hook**:
1. `src/hooks/use-xx-request.ts(x)` — React Query hooks; only call the service layer.
2. `src/services/xx-service.ts` — Register endpoints via `registerNextServer`, all going through `@/utils/next-request`.
3. `src/utils/next-request.ts` — The single axios instance; handles token, 401 redirects, and error notifications.

Interface types are split between two folders:
- Response/data shape → `src/interfaces/database/xx.ts`
- Request params/body → `src/interfaces/request/xx.ts`

Model-related endpoints (LLM provider / factory / my LLM, etc.) are consolidated in `src/services/llm-service.ts` rather than scattered across hooks. For GET endpoints, register with `method: 'get'` in the service, and on the call site pass `true` as the second argument to use the native axios config (e.g., `service.listProviders({ params: { available: true } }, true)`).

### Shared UI Component Lock
The folder `src/components/ui/` is the project's **shared UI library** — it contains both official shadcn/ui primitives and project-authored common components built on top of shadcn. Both kinds are intended to be reused across the app and **must not be modified casually**.

- **Do not modify, refactor, restyle, or "improve"** any file under `src/components/ui/` (including subfolders), even if it seems like the most direct fix.
- If a component does not meet requirements, **wrap or compose it** in a new component **outside** `src/components/ui/` (e.g., under `src/components/` or a feature folder), and customize via `className`, `props`, or composition.
- Exceptions require **explicit user approval** in the same conversation. When in doubt, ask first and propose a wrapper-based alternative.
- Adding a new shared component to `src/components/ui/`, or upgrading a shadcn primitive via the official `shadcn` CLI, is allowed only when the user explicitly requests it.

### React Patterns and Conventions
- **Prefer `requestAnimationFrame` or `useLayoutEffect`** over `setTimeout(..., 0)` for focus or DOM measurement operations.
- **Prefer `useTranslation` from `react-i18next`** over project-wrapped utilities like `useTranslate`.
- Extract complex logic into hooks or utils; keep components lean.
- Use `PascalCase` for constants and component names.
- Avoid duplicating component structures in JSX; favor render props or reusable components.

### ee Overlay 约定（T2.5）
- **`src/ee/`** 承载 agentui 私有内容（已迁：wizard、tasks、aihub、applications、BFF 专属 admin：harness-backends / sso-settings / tenant-bindings），对齐上游 ee overlay 化：共享层保持与上游 web/ 同构，后续同步上游子树时冲突面最小。
- 共享代码**只允许 import `@/ee/*`**（别名显式声明于 vite.config.ts / tsconfig.json / .storybook/main.ts；jest 经 `^@/(.*)$` 继承）；不得把 Intellect 专有逻辑内联进共享层，也不得反向（ee 之外的代码 import ee 内容仅限路由挂载点）。
- 迁移以"一次一个模块、独立提交"推进；ee 内新增模块需在迁移验证（构建 + 路由 + 既有测试）通过后合入。
- **T3.4 i18n overlay**：私有词条在 `src/ee/locales/{en,zh}-private.ts`，由 `src/locales/config.ts` merge；共享 `en.ts`/`zh.ts` 保持可 cherry-pick。
- **T3.6 上游同步**：`node scripts/sync-upstream-web.mjs --dry-run`（定案 archive+rsync，非根前缀 subtree）；`--apply` 写入后 `git diff` + 人工/安全审阅再提交；**永不覆盖** `src/ee/`、`locales/config.ts`、鉴权/请求层；默认**不** `--delete`，清理上游已删文件需显式 `--prune-deletes`；建议每月一次。

### Utility Libraries and Reuse
- **Time/date handling**: Use `dayjs` for all date/time formatting, parsing, and manipulation.
- **Utility hooks**: Prefer `ahooks` for common reusable hooks (e.g., `useDebounce`, `useSetState`).
- **General utilities**: Lodash is available for utility functions when needed.
- **Project utilities first**: Before reaching for a third-party library, check if the project already has an existing utility or hook that covers the need.
- **Extract and share**: If repeated logic cannot be satisfied by an existing project utility or a third-party library, extract it into an appropriate shared hook (`src/hooks/`) or utility file (`src/utils/`).
- **Check for duplicate patterns before adding**: When asked to add logic (validation, existence checks, API calls, etc.), first search for existing hooks/functions that do the same or similar thing — especially in the same file or sibling hooks. If a hook already does X, call it instead of re-implementing X inline. This applies to mutations calling mutations, utility wrappers, and boilerplate around API calls.

### Testing Infrastructure Notes（jest/vitest 陷阱备忘）
- **jest 挂起（worker 不退出）的高频根因**：mock 的数据 hook（如 `useFetchChat`）每次渲染返回**新对象引用** → 组件 `useEffect([data, form])` 内 `form.reset` 无限触发。夹具必须提升为模块级常量（稳定引用）；jest 必要时加 `--forceExit`（仓库已有存量 open-handle 警告）。
- **jsdom 组件测试三件套**：`Element.prototype.scrollIntoView` 需 stub（jsdom 未实现）；`ResizeObserver` 需 stub（radix use-size/ScrollArea）；`FormLabel tooltip` 的 FormTooltip 需要 `<TooltipProvider>` 包裹。
- **`jest.config.ts` 的 moduleNameMapper**：资产/样式 mock（`\.(css|…)$`、`\.(jpg|…|webp)$`）必须排在 `^@/(.*)$` 别名**之前**（mapper 首个命中生效，别名在前会让 `@/assets/x.svg` 解析成真实文件路径）。
- **组件 mock 面**：渲染 `ChatSettings` 需 mock `@/hooks/use-chat-request`、`use-llm-request`、`use-harness-capabilities`、`use-knowledge-request` 及展示型字段（rerank/similarity-slider/top-n/metadata-filter 等，并保留其 schema 导出为 `{}`——`z.object(undefined)` 会抛）。
- **BFF tsc**：曾因 main 合入（v0.4.6 SSO 批次）带 9 处类型错误，已于 2026-11-22 清偿归零（jose v6 类型 + auth.ts Context 泛型）；BFF 门禁 = vitest 全绿 + tsc 零错误。
- **回归口令**：前端 `npx jest --silent --forceExit`（60 套件）；BFF `cd bff; npx vitest run`（67 文件）；三守卫 `node scripts/check-hiedu-shared.mjs && node scripts/check-color-tokens.mjs && npx tsc --noEmit`。BFF vitest 必须在 `bff/` 目录内跑（根目录会扫到 127 个文件、口径错乱）。
- **九步交付产物索引**：`tests/e2e-tests/{outline,cases,spec,reports}/<module>-*`；已有 module：wizard-sso、wizard-sso-followup、ragflow-p1-batch。
