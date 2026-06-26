# Tasks: Frontend Login Page Adaptation (P4d)

**Input**: specs/006-frontend-login-adaptation/spec.md

**Prerequisites**: P4b 完成(BFF 认证路由就绪)

**Organization**: 按 spec.md 的 User Story 分阶段

---

## Phase 1: Setup

- [ ] T001 调研 BFF 是否需要新增 `/api/bff/auth/mode` 端点(无需认证即可返回 authMode),或复用 `/api/bff/capabilities`(需认证)
- [ ] T002 确认前端登录页现有表单结构(src/pages/login/ 或 src/features/auth/),梳理需改动的组件

---

## Phase 2: User Story 1 - 登录页字段适配 (P1) 🎯 MVP

### Tests

- [ ] T003 编写登录表单组件测试,验证:authMode=intellect-enterprise 时标签为 "用户名",authMode=intellect-rag 时标签为 "邮箱"

### Implementation

- [ ] T004 创建 `useAuthMode` hook(或扩展现有 hook),从 BFF 获取 authMode 信息(无需认证)
- [ ] T005 修改登录页表单组件,根据 authMode 动态切换字段标签(email ↔ login_name)
- [ ] T006 修改 zod 校验 schema,按 authMode 切换(email 格式 vs login_name 长度)
- [ ] T007 修改注册页表单组件,根据 authMode 切换字段(email+nickname ↔ login_name+display_name)
- [ ] T008 修改 OAuth 渠道列表,从 BFF `/auth/login/channels` 获取(不硬编码)

---

## Phase 3: Polish

- [ ] T009 运行 `npx tsc --noEmit -p tsconfig.json`,确认前端零错误
- [ ] T010 运行 `cd bff && npm test`,确认 BFF 测试不回归
- [ ] T011 验证社区版登录/注册/OAuth 100% 不回归

---

## Dependencies

- T001 阻塞 T004(需要确定 authMode 获取方式)
- T004 阻塞 T005/T006/T007(表单组件依赖 authMode hook)
- T008 独立(可与 T005-T007 并行)
