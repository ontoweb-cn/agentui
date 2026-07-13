# Tasks: P2 Cookie 模式适配 (Frontend Auth Hardening)

**Input**: specs/006-frontend-login-adaptation/spec.md + P0 评审报告(2026-07-13)

**Prerequisites**: P4d 完成(前端登录页字段适配) + P4b 完成(BFF 认证路由 + cookie 模式)

**背景**: BFF 企业版认证使用 HttpOnly cookie 存储 member token,前端 JS 无法读取。
P4d 仅完成表单字段切换,未适配 cookie 模式的登录态建立/登出/注册/OAuth 回调流程。
P2 阶段补强这些缺口,使企业版认证完整可用。

**实施顺序**: T001 → T002 → T003 → T004 → T005 → T006 → T008 → T007

**状态**: 全部完成 (2026-07-13)
- T001 ✅ request.ts credentials: 'include'
- T002 ✅ useLogin 双认证模式
- T003 ✅ isLogin cookie 模式 + removeAll 扩展
- T004 ✅ useLogout X-Tenant-Id(修复 bug: 改用 logoutWithHeaders)
- T005 ✅ useRegister 企业版响应
- T006 ✅ OAuth 回调流程(useEnterpriseCookieProbe)
- T008 ✅ 端到端验证(tsc 通过,BFF 253/253 测试通过)
- T007 ✅ admin 入口文档化

---

## T001: request.ts 启用 credentials: 'include'

**文件**: `src/utils/request.ts`

**改动**: umi-request extend 配置新增 `credentials: 'include'`

**原理**: BFF 与前端同源(经 Vite proxy),`credentials: 'include'` 让浏览器自动携带 HttpOnly cookie。
社区版无 cookie 时行为不变(零回归)。

**安全说明**: 同源策略限制下,跨域请求不会携带 cookie,无安全风险。

**验证**: tsc --noEmit 通过

---

## T002: useLogin 适配双认证模式

**文件**: `src/hooks/use-login-request.ts`

**改动**:
- 在 hook 顶层调用 `useAuthMode`(非 mutationFn 内),authMode 作为闭包变量传入 mutationFn
- 企业版模式(`authMode === 'intellect-enterprise'`):
  - `code === 0` 即登录成功,不尝试从 body 取 token
  - 存储 localStorage 标记:`{ authMode: 'intellect-enterprise', tenantId: '0' }`(非敏感,仅前端状态判断)
  - 存储企业版返回的 `{ member_id, display_name, role }` 到 userInfo(不含 email,BFF /auth/login 不返回)
- 社区版模式:保持现有逻辑(从 body/header 取 token 存 localStorage)

**关键决策**: 企业版 localStorage 只存非敏感标记(authMode + tenantId + userInfo),真正 token 在 HttpOnly cookie 中。

**依赖**: T001

---

## T003: isLogin 适配 cookie 模式 + removeAll 扩展

**文件**: `src/hooks/auth-hooks.ts` + `src/utils/authorization-util.ts` + `src/utils/request.ts`(401 拦截器)

**改动**:
1. `authorization-util.ts`:
   - `KeySet` 新增 `AuthMode` 常量(key: `'authMode'`)
   - `removeAll` 清除 `authMode` 标记
2. `auth-hooks.ts` `useAuth`:
   - `isLogin` 判断:`!!getAuthorization() || !!auth || localStorage.getItem('authMode') === 'intellect-enterprise'`
3. `request.ts` 401 拦截器:
   - 现有 `authorizationUtil.removeAll()` 自动清除 authMode(因 KeySet 扩展)

**原理**: 企业版登录成功后 localStorage 有 `authMode=enterprise` 标记,isLogin 据此判断。
真实有效性由后续 `/auth/me` 请求验证(cookie 过期则 401 → 拦截器清标记 → 跳登录页)。

**依赖**: T002

---

## T004: useLogout 传 X-Tenant-Id

**文件**: `src/hooks/use-login-request.ts` + `src/services/user-service.ts`

**改动**:
- `useLogout` 从 localStorage 读取 tenantId(T002 登录时存入)
- `userService.logout` 支持传自定义 headers
- 企业版: X-Tenant-Id = 存储的 tenantId
- 社区版: X-Tenant-Id = 存储的 tenantId 或 '0' 兜底
- 登出成功后: 清除 localStorage 全部标记(含 authMode)

**防御性**: 若 localStorage 无 tenantId,用 '0' 兜底(避免 BFF 400 阻塞登出)。

**当前阶段**: tenantId 固定为 '0'(缺省租户),P5 多租户阶段再从 tenant 选择器获取。

**依赖**: T002

---

## T005: useRegister 适配企业版响应

**文件**: `src/hooks/use-login-request.ts`

**改动**:
- 企业版模式:响应 201 + `{ member_id, registration_pending }`
  - `registration_pending === 1`: 显示"注册成功,待管理员审批"
  - `registration_pending === 0`: 显示"注册成功,请登录"
- 社区版模式:保持现有逻辑

**注意**: 注册不自动登录(企业版需管理员审批),仅提示成功。

**依赖**: T002(useAuthMode)

---

## T006: OAuth 回调流程适配

**文件**: `src/hooks/auth-hooks.ts` + `src/pages/login-next/index.tsx`(或首页布局)

**改动**:
- BFF OAuth callback 返回 302 → 前端首页(cookie 已设置)
- 前端首页 `useEffect` 检测:若 `authMode=enterprise` 且无 localStorage Authorization → 调 `/auth/me` 验证 cookie
  - 200 → 存 localStorage 标记 → `isLogin = true`
  - 401 → 不做任何操作(未登录状态)
- `useOAuthCallback` 保留社区版 `?auth=` 逻辑不变

**原理**: 企业版 OAuth 登录的"登录态建立"不在 callback 时完成(cookie 对 JS 不可见),
而是在首页加载时通过 `/auth/me` 探测完成。

**性能**: 仅企业版模式 + 无 localStorage Authorization 时触发,社区版不触发。
TanStack Query 缓存避免重复调用。

**依赖**: T003

---

## T008: 端到端验证

**验证场景**:
1. 社区版回归: login → me → logout 全链路不回归
2. 企业版冒烟: login → me → logout(用 mock server)
3. OAuth 流程: channels → login/:channel → callback → me(企业版 mock)
4. 401 场景: 清 cookie → 访问 me → 401 → 跳登录页

**验证方式**: 手工冒烟 + tsc --noEmit + 现有测试不回归

**依赖**: T001-T006 全部完成

---

## T007: admin 入口文档化

**文件**: `src/services/admin-service.ts` + `src/pages/admin/login.tsx`

**改动**: 仅添加注释,不改动代码

**文档说明**:
- admin 登录是运维管理后台专用,与用户认证(BFF /auth/*)有意分离
- admin 走 intellect-rag `/api/v1/admin/login`(管理员 token),不走 BFF 统一认证
- admin 不需要多租户隔离,不涉及企业版 cookie 模式
- 这是设计决策,非遗漏

**依赖**: 无(独立任务)
