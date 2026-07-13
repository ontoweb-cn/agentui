# Phase 1 Detailed Tasks: 包结构搭建(细化版)

> **Parent**: [tasks.md](./tasks.md) §阶段 1
> **Design Doc**: [canvas-plugin-extraction-design.md](../../docs/canvas-plugin-extraction-design.md) §3.1 + §3.2
> **Created**: 2026-07-13
> **Status**: 待实施
> **Prerequisites**: 阶段 0 已完成(T001-T007)
> **可与 spec/008 并行**:是(本阶段不依赖 BFF `/api/bff/canvas/*`)

## 概述

创建 `packages/canvas-plugin/` 骨架,配置 monorepo workspace,打通开发期编译链路。本阶段**不迁移任何业务代码**,仅搭建空壳包结构,验证 monorepo 解析、TS paths、Vite alias、Jest 配置正确。

**核心原则**:
- 源码直接引用(`main: "src/index.ts"`),无构建步骤
- `@agentui/canvas-plugin` 仅作为 alias,实际文件仍在 `packages/canvas-plugin/src/`
- 阶段 1 结束时,`features/canvas/manifest.ts` 被_registry 发现但导出空 module(不影响现有功能)

---

## 前置调查结论

### 现有 monorepo 基础设施

| 项 | 现状 | 本阶段调整 |
|---|---|---|
| `package.json.workspaces` | `["bff"]` | 扩展为 `["bff", "packages/*"]` |
| 根 `tsconfig.json` paths | `{"@/*": ["src/*"]}` | 新增 `@agentui/canvas-plugin` 映射 |
| `vite.config.ts` alias | `{'@': './src'}` | 新增 `@agentui/canvas-plugin` alias |
| `features/_registry.ts` | `import.meta.glob('./*/manifest.ts')` | **不改**,自动发现 `features/canvas/manifest.ts` |
| `ModuleDefinition` 接口 | 已含 `enabled`/`routes`/`nav`/`i18n`/`providers`/`init` | **不改**,画布插件直接实现 |

### 依赖清单(基于 `package.json` 调查)

**peerDependencies**(画布插件运行时由主应用提供):

```
react ^18.2.0
react-dom ^18.2.0
react-router ^7.10.1
@tanstack/react-query ^5.40.0
react-i18next ^14.0.0
i18next ^23.7.16
zustand ^4.5.2
@xyflow/react ^12.3.6
axios ^1.12.0
lodash ^4.17.23
dayjs ^1.11.10
ahooks ^3.7.10
```

**dependencies**(画布插件自带):

```
human-id ^4.1.1
eventsource-parser ^1.1.2
immer ^10.1.1
```

---

## 细化任务

### T010 [P] 创建 `packages/canvas-plugin/package.json`

**文件**:`packages/canvas-plugin/package.json`

**内容**:
```json
{
  "name": "@agentui/canvas-plugin",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "type-check": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router": "^7.10.1",
    "@tanstack/react-query": "^5.40.0",
    "react-i18next": "^14.0.0",
    "i18next": "^23.7.16",
    "zustand": "^4.5.2",
    "@xyflow/react": "^12.3.6",
    "axios": "^1.12.0",
    "lodash": "^4.17.23",
    "dayjs": "^1.11.10",
    "ahooks": "^3.7.10"
  },
  "dependencies": {
    "human-id": "^4.1.1",
    "eventsource-parser": "^1.1.2",
    "immer": "^10.1.1"
  }
}
```

**验证**:
- `name` 必须为 `@agentui/canvas-plugin`(与 alias 一致)
- `private: true`(阶段 1 不发布)
- `main` 指向源码(无构建步骤)
- peerDependencies 版本与根 `package.json` 对齐

### T011 [P] 创建 `packages/canvas-plugin/tsconfig.json`

**文件**:`packages/canvas-plugin/tsconfig.json`

**内容**:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["../../src/*"],
      "@agentui/canvas-plugin": ["./src"],
      "@agentui/canvas-plugin/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**验证**:
- `extends` 根 tsconfig(继承 strict/jsx/moduleResolution 等)
- `@/*` 映射到主应用 `src/*`(画布插件引用主应用通用层)
- `@agentui/canvas-plugin` 自引用
- `npx tsc --noEmit -p packages/canvas-plugin/tsconfig.json` 通过(空 src 时)

### T012 [P] 创建 `packages/canvas-plugin/jest.config.ts`

**文件**:`packages/canvas-plugin/jest.config.ts`

**内容**:
```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../../src/$1',
    '^@agentui/canvas-plugin/(.*)$': '<rootDir>/src/$1',
    '^@agentui/canvas-plugin$': '<rootDir>/src/index.ts',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['esbuild-jest', { loader: 'tsx' }],
  },
  setupFilesAfterEach: ['<rootDir>/../../jest.setup.ts'],
};

export default config;
```

**验证**:
- 沿用根 jest 配置模式(esbuild-jest + jsdom)
- `@/*` 映射到主应用 src
- `@agentui/canvas-plugin` 自引用
- 阶段 1 无测试,仅验证配置可加载

### T013 修改根 `package.json` workspaces

**文件**:`package.json`(根)

**改动**:
```diff
- "workspaces": ["bff"],
+ "workspaces": ["bff", "packages/*"],
```

**验证**:
- `npm install` 成功
- `npm ls @agentui/canvas-plugin` 能解析到 `packages/canvas-plugin`

### T014 修改根 `tsconfig.json` paths

**文件**:`tsconfig.json`(根)

**改动**:
```diff
  "paths": {
-   "@/*": ["src/*"]
+   "@/*": ["src/*"],
+   "@agentui/canvas-plugin": ["./packages/canvas-plugin/src"],
+   "@agentui/canvas-plugin/*": ["./packages/canvas-plugin/src/*"]
  }
```

**验证**:
- `npx tsc --noEmit` 通过
- 在任意文件 `import {} from '@agentui/canvas-plugin'` 可解析

### T015 修改 `vite.config.ts` alias

**文件**:`vite.config.ts`

**改动**:
```diff
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
+     '@agentui/canvas-plugin': path.resolve(__dirname, 'packages/canvas-plugin/src'),
    },
  },
```

**验证**:
- `npm run dev` 启动成功
- Vite 能解析 `@agentui/canvas-plugin` import

### T016 创建 `packages/canvas-plugin/src/index.ts` 占位

**文件**:`packages/canvas-plugin/src/index.ts`

**内容**:
```typescript
import type { ModuleDefinition } from '@/features/_types';

// 阶段 1 占位:空 module,不影响现有功能
// 阶段 2 迁移完成后,填充完整 ModuleDefinition
const canvasModule: ModuleDefinition = {
  name: 'canvas',
  order: 40,
  enabled: () => false, // 阶段 1 禁用,避免与 features/agents 冲突
  routes: [],
};

export default canvasModule;
```

**验证**:
- `enabled: () => false` 确保不与现有 `features/agents` 冲突
- 阶段 2 迁移完成后改为 `enabled: (ctx) => ctx.capabilities.has('canvas')`

### T017 创建 `src/features/canvas/manifest.ts` 薄封装

**文件**:`src/features/canvas/manifest.ts`

**内容**:
```typescript
// 画布插件薄封装:指向独立包 @agentui/canvas-plugin
// _registry.ts 自动发现此文件,加载 packages/canvas-plugin/src/index.ts
export { default } from '@agentui/canvas-plugin';
```

**验证**:
- `features/_registry.ts` 的 `import.meta.glob('./*/manifest.ts', { eager: true })` 自动发现此文件
- 由于 `enabled: () => false`,不会注册任何路由/导航
- `npm run dev` 启动后,画布功能仍由 `features/agents` 提供

---

## Checkpoint(阶段 1)

### T018 workspace 解析验证

```bash
npm install
npm ls @agentui/canvas-plugin
```

**预期**:能解析到 `packages/canvas-plugin`,无 `UNMET` 或 `DEDUPED` 警告。

### T019 主应用 tsc 验证

```bash
npx tsc --noEmit -p tsconfig.json
```

**预期**:零新增错误(仅阶段 0 的 5 个预存在 gateway 错误)。

### T020 主应用启动验证

```bash
npm run dev
```

**预期**:
- Vite 启动无 alias 解析错误
- 浏览器访问主应用,画布功能(`/agent/:id`)正常(仍由 `features/agents` 提供)
- `features/canvas/manifest.ts` 被发现但因 `enabled: false` 不注册路由

### T021 插件包独立编译验证

```bash
cd packages/canvas-plugin && npx tsc --noEmit
```

**预期**:零错误(空 index.ts 应通过)。

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| npm workspace 解析 `@agentui/canvas-plugin` 失败 | 低 | 中 | T018 验证;若失败检查 `packages/*` glob 是否匹配 |
| Vite alias 与 workspace 解析冲突 | 中 | 中 | Vite alias 优先;若冲突,移除 workspace 中的 `@agentui/canvas-plugin` 软链接,仅用 alias |
| `features/canvas/manifest.ts` 导致 _registry 加载错误 | 低 | 高 | `enabled: () => false` 确保 module 被过滤;若仍报错,检查 index.ts 类型是否匹配 `ModuleDefinition` |
| Jest 在 monorepo 下模块解析问题 | 低 | 中 | T012 的 `moduleNameMapper` 显式映射;参考根 jest.config.ts |

---

## 与 spec/008 的并行性

本阶段**不依赖** spec/008:
- 不调用 `/api/bff/canvas/*`
- 不改动 `agent-service.ts` 或 `use-agent-request.ts`
- 仅搭建空壳包结构

spec/008 完成后,阶段 2 才需要消费 `/api/bff/canvas/*`。
