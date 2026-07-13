# P2 Cookie 模式适配 - 代码与文档评审报告

**评审日期**: 2026-07-13
**评审范围**: P2 阶段所有实施代码与文档(T001-T008)
**评审基线**: specs/006-frontend-login-adaptation/tasks-p2-cookie-mode.md + BFF auth 路由实际实现

---

## 评审方法

1. **契约一致性**: 前端字段访问 vs BFF 实际响应结构
2. **状态管理正确性**: localStorage 标记的生命周期(写入/读取/清除)
3. **错误处理健壮性**: 网络错误、BFF 错误、边界情况
4. **类型安全**: TypeScript 类型注解完整性
5. **文档一致性**: 实施文档 vs 实际代码

---

## 问题清单

### P1-A: BFF /auth/login 企业版响应不返回 email,前端 useLogin 访问 data.email 得到 undefined

**位置**: [src/hooks/use-login-request.ts:85-90](file:///Users/simon/project/agentui/src/hooks/use-login-request.ts#L85-L90)

**问题**:
BFF `/auth/login` 企业版响应 ([bff/src/routes/auth.ts:225-231](file:///Users/simon/project/agentui/bff/src/routes/auth.ts#L225-L231)) 只返回 `{ member_id, display_name, role }`,**不包含 email**。但前端 useLogin 试图读取 `data.email`:

```typescript
const userInfo = {
  name: data.display_name,
  email: data.email,        // ← undefined
  memberId: data.member_id,
  role: data.role,
};
```

而 `/auth/me` 端点 ([bff/src/routes/auth.ts:354-361](file:///Users/simon/project/agentui/bff/src/routes/auth.ts#L354-L361)) 返回的 data 包含 email。这导致:
- useLogin 写入的 userInfo.email = undefined
- useEnterpriseCookieProbe 写入的 userInfo.email = 实际值
- 两条路径产生的 localStorage userInfo 内容不一致

**影响**: 登录后立即访问 userInfo.email 的组件会得到 undefined,直到 probe 或 /auth/me 覆盖。

**建议修复**:
- 方案 A(推荐): 前端 useLogin 企业版分支不写 email 字段(因为 BFF 不返回),让 probe 后续补全
- 方案 B: BFF /auth/login 企业版响应补充 email 字段

---

### P1-B: KeySet 缺少 TenantId,登出后 localStorage 残留 tenantId 标记

**位置**: [src/utils/authorization-util.ts:10](file:///Users/simon/project/agentui/src/utils/authorization-util.ts#L10)

**问题**:
```typescript
const KeySet = [Authorization, Token, UserInfo, AuthMode];
//                                ↑ 缺少 TenantId
```

`removeAll` 用于登出和 401 拦截,会清除 Authorization/Token/UserInfo/AuthMode,但**不清除 TenantId**。登出后 localStorage 残留 `tenantId=0`。

**影响**:
- 状态不一致:authMode 已清除但 tenantId 残留
- 虽然值为 '0' 不构成安全问题,但下次登录前 localStorage 处于部分登录态
- 如果未来 tenantId 不再固定为 '0'(P5 多租户阶段),残留的 tenantId 可能导致错误路由

**建议修复**: KeySet 新增 TenantId:
```typescript
const KeySet = [Authorization, Token, UserInfo, AuthMode, TenantId];
```

---

### P2-A: useLogout 失败时不清除前端标记,用户卡在已登录状态

**位置**: [src/hooks/use-login-request.ts:177-191](file:///Users/simon/project/agentui/src/hooks/use-login-request.ts#L177-L191)

**问题**:
```typescript
mutationFn: async () => {
  const tenantId = localStorage.getItem(TenantId) || '0';
  const { data = {} } = await logoutWithHeaders({ 'X-Tenant-Id': tenantId });
  if (data?.code === 0) {           // ← 仅成功才清标记
    message.success(t('message.logout'));
    authorizationUtil.removeAll();
    redirectToLogin();
  }
  return data?.code;
}
```

如果 BFF /auth/logout 失败(网络错误、502 等),`data?.code !== 0`,前端不清除 localStorage 标记,用户卡在已登录状态,无法重新登录(因为 isLogin 仍为 true)。

**影响**: 用户主动登出失败后,UI 不响应,需要手动清缓存。

**建议修复**: 用户主动登出的意图明确,即使 BFF 失败也应清除前端标记(防御性):
```typescript
mutationFn: async () => {
  const tenantId = localStorage.getItem(TenantId) || '0';
  try {
    const { data = {} } = await logoutWithHeaders({ 'X-Tenant-Id': tenantId });
    if (data?.code === 0) {
      message.success(t('message.logout'));
    }
  } finally {
    // 防御性:无论 BFF 响应如何,用户主动登出都应清除前端登录态
    authorizationUtil.removeAll();
    redirectToLogin();
  }
}
```

---

### P2-B: useEnterpriseCookieProbe 缺少 try/catch,网络错误会在控制台抛未捕获错误

**位置**: [src/hooks/auth-hooks.ts:78-104](file:///Users/simon/project/agentui/src/hooks/auth-hooks.ts#L78-L104)

**问题**:
```typescript
queryFn: async () => {
  const resp = await fetch(api.userInfo, { ... });  // ← 可能抛错(网络断开)
  if (!resp.ok) { return false; }
  const json = await resp.json();                    // ← 可能抛错(非 JSON 响应)
  ...
}
```

`fetch` 和 `resp.json()` 都可能抛错。TanStack Query `retry: false` 会停止重试,error 状态下 `probe.data` 是 undefined,行为正确(未登录)。但抛错会在控制台显示未捕获错误,影响调试体验。

**影响**: 网络不稳定时控制台报错噪音,不影响功能。

**建议修复**: 加 try/catch,失败返回 false:
```typescript
queryFn: async () => {
  try {
    const resp = await fetch(api.userInfo, { ... });
    if (!resp.ok) return false;
    const json = await resp.json();
    ...
    return true;
  } catch {
    return false;  // 网络错误视为未登录
  }
}
```

---

### P2-C: tasks-p2-cookie-mode.md T002 描述的 authMode 值与实际不一致

**位置**: [specs/006-frontend-login-adaptation/tasks-p2-cookie-mode.md:38](file:///Users/simon/project/agentui/specs/006-frontend-login-adaptation/tasks-p2-cookie-mode.md#L38)

**问题**:
文档描述:
> 存储 localStorage 标记:`{ authMode: 'enterprise', tenantId: '0' }`

实际代码:
```typescript
authorizationUtil.setItems({
  [AuthMode]: 'intellect-enterprise',  // ← 不是 'enterprise'
  [TenantId]: '0',
  ...
});
```

**影响**: 文档误导,可能让后续开发者误以为 authMode 值是 'enterprise'。

**建议修复**: 文档修正为 `'intellect-enterprise'`。

---

### P3-A: probe 的 json 类型为 any,缺少类型注解

**位置**: [src/hooks/auth-hooks.ts:88](file:///Users/simon/project/agentui/src/hooks/auth-hooks.ts#L88)

**问题**:
```typescript
const json = await resp.json();   // ← any 类型
if (json?.code === 0 && json?.data) {
  const userInfo = {
    name: json.data.display_name,  // ← 无类型检查
    ...
  };
}
```

`json` 是 `any` 类型,字段访问无类型保护。如果 BFF 响应结构变化,前端不会在编译时报错。

**影响**: 类型安全薄弱,但不影响运行时。

**建议**: P1 阶段引入 Vitest 时补充接口类型定义。当前阶段可接受。

---

### P3-B: useLogin 成功后不触发 useAuth 的 useEffect 重算 isLogin

**位置**: [src/hooks/auth-hooks.ts:118-125](file:///Users/simon/project/agentui/src/hooks/auth-hooks.ts#L118-L125)

**问题**:
```typescript
useEffect(() => {
  const isEnterprise = localStorage.getItem(AuthMode) === 'intellect-enterprise';
  setIsLogin(...);
}, [auth, probe.data]);  // ← 依赖不含 localStorage 变化
```

useLogin 成功后写入 localStorage authMode 标记,但这个 useEffect 不会自动重新计算(因为 `auth` 和 `probe.data` 都没变)。

**实际影响**: 低。useLogin 成功后通常通过 `navigate('/')` 跳转,页面重新挂载,useAuth 重新执行,isLogin 正确计算。但如果 useLogin 后不跳转(异常路径),isLogin 不会更新。

**建议**: 后续可考虑用 React state 或 context 管理 authMode 标记,而非直接读 localStorage。当前阶段通过 navigate 规避,可接受。

---

### P3-C: useLogin 与 probe 写入的 userInfo 内容不一致(email 字段)

**位置**: 
- [src/hooks/use-login-request.ts:85-90](file:///Users/simon/project/agentui/src/hooks/use-login-request.ts#L85-L90) (useLogin)
- [src/hooks/auth-hooks.ts:90-95](file:///Users/simon/project/agentui/src/hooks/auth-hooks.ts#L90-L95) (probe)

**问题**: 见 P1-A。useLogin 写入 `email: undefined`,probe 写入 `email: 实际值`。两条路径产生的 localStorage userInfo 不一致。

**建议**: 与 P1-A 一并修复。

---

## 评审通过项

### 契约对齐 ✅
- T001 credentials: 'include' 与 BFF HttpOnly cookie + SameSite=Lax 配置对齐
- T004 X-Tenant-Id 严格校验与 BFF /auth/logout 400 行为对齐
- T005 registration_pending 字段与 intellect-team 注册响应对齐
- T006 /auth/me 探测路径与 BFF 路由对齐

### 安全性 ✅
- HttpOnly cookie token 前端 JS 不可读,localStorage 仅存非敏感标记(authMode/tenantId/userInfo)
- 401 拦截器 removeAll 清除标记(需扩展 KeySet,见 P1-B)
- OAuth callback 使用 fetch 绕开 401 拦截器,避免探测误触发跳转
- admin 路径跳过企业版探测,避免与 admin 认证流程冲突

### 错误处理 ✅(部分)
- T004 logoutWithHeaders 防御性 '0' 兜底(见 P2-A 改进建议)
- T006 probe enabled 条件严格(企业版 + 无标记 + 非 admin)
- T006 staleTime=Infinity 避免重复探测

### 文档 ✅(部分)
- T007 admin-service.ts 与 admin/login.tsx 注释清晰说明分离设计
- tasks-p2-cookie-mode.md 状态更新(见 P2-C 修正)

### 类型安全 ✅(部分)
- AuthMode 类型定义为联合类型 'intellect-rag' | 'intellect-enterprise'
- useLogin/useRegister/useLogout 参数类型完整
- probe 缺少类型注解(见 P3-A)

---

## 修复优先级

| 问题 | 优先级 | 建议处理时机 | 状态 |
|------|--------|-------------|------|
| P1-A email 字段 undefined | P1 | 本次修复 | ✅ 已修复(useLogin 不写 email,probe 补全) |
| P1-B KeySet 缺 TenantId | P1 | 本次修复 | ✅ 已修复(KeySet 新增 TenantId) |
| P2-A useLogout 失败不清标记 | P2 | 本次修复 | ✅ 已修复(try/finally 防御性清除) |
| P2-B probe 缺 try/catch | P2 | 本次修复 | ✅ 已修复(queryFn 加 try/catch) |
| P2-C 文档 authMode 值不一致 | P2 | 本次修复 | ✅ 已修复(文档改为 'intellect-enterprise') |
| P3-A probe json 类型 any | P3 | P1 阶段(Vitest) | ⏳ 延后 |
| P3-B useEffect 依赖不完整 | P3 | 后续优化 | ⏳ 延后 |
| P3-C userInfo 不一致 | P3 | 与 P1-A 一并 | ✅ 随 P1-A 修复 |

---

## 结论

P2 实现整体设计合理,核心流程(login/logout/probe)逻辑正确,安全性达标。发现 2 个 P1 问题(email 字段 undefined、KeySet 缺 TenantId)和 3 个 P2 问题(logout 防御性、probe try/catch、文档修正),已全部修复并通过 tsc 验证。P3 问题延后到 P1 阶段处理。

**修复验证**: `npx tsc --noEmit -p tsconfig.json` 所有 P2 修改文件零错误。
