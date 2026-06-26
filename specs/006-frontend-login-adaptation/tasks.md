# Tasks: Frontend Login Page Adaptation (P4d)

**Input**: specs/006-frontend-login-adaptation/spec.md

**Prerequisites**: P4b 完成(BFF 认证路由就绪)

**Organization**: 按 spec.md 的 User Story 分阶段

---

## Phase 1: Setup

- [x] T001 BFF 新增公开端点 GET `/api/bff/auth/config`(无需认证),返回 `{ authMode }`,文件 `bff/src/routes/auth.ts`
- [x] T002 确认前端登录页结构:主登录页 `src/pages/login-next/index.tsx` + Admin 登录页 `src/pages/admin/login.tsx`

---

## Phase 2: User Story 1 - 登录页字段适配 (P1) 🎯 MVP

### Tests

- [x] T003 编写 BFF auth config 端点测试(3 个场景:企业版/社区版/无 tenantId),文件 `bff/src/routes/auth.test.ts`

### Implementation

- [x] T004 创建 `useAuthMode` hook(`src/hooks/use-login-request.ts`),从 BFF GET `/api/bff/auth/config` 获取 authMode,TanStack Query 5min 缓存
- [x] T005 修改登录页表单(`src/pages/login-next/index.tsx`),authMode=intellect-enterprise 时显示 login_name 字段,authMode=intellect-rag 时显示 email 字段
- [x] T006 修改 zod 校验 schema,按 authMode 切换(email 格式校验 vs login_name 长度校验)
- [x] T007 修改注册页表单,authMode=intellect-enterprise 时显示 login_name + display_name,authMode=intellect-rag 时显示 email + nickname
- [x] T008 新增 i18n 键:loginNameLabel/loginNamePlaceholder/displayNameLabel/displayNamePlaceholder(en.ts + zh.ts)
- [x] T009 更新 useLogin/useRegister hook 类型,支持 login_name + display_name 字段

---

## Phase 3: Polish

- [x] T010 运行 `npx tsc --noEmit -p tsconfig.json`,确认前端零错误
- [x] T011 运行 `cd bff && npm test`,确认 214 个 BFF 测试全部通过
- [x] T012 运行 `cd bff && npm run type-check`,确认 BFF TypeScript 零错误

---

## Dependencies

- T001 阻塞 T004(BFF 端点必须就绪)
- T004 阻塞 T005/T006/T007(表单组件依赖 authMode hook)
- T008 独立(可与 T005-T007 并行)
