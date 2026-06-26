# Feature Specification: Frontend Login Page Adaptation (P4d)

**Feature Branch**: `006-frontend-login-adaptation`

**Created**: 2026-06-26

**Status**: Planning

**Input**: P4b 完成后遗留的前端登录页适配工作

**Prerequisites**:
- [P4b 已完成](../005-bff-auth-default-tenant/spec.md) — BFF 认证路由 + authMode 路由就绪
- BFF `/api/bff/auth/*` 端点可用(企业版 + 社区版)

## User Scenarios & Testing

### User Story 1 - 登录页字段适配 (Priority: P1) 🎯 MVP

企业版部署下,登录页表单需显示 `login_name` 字段(而非 email),注册页需 `login_name` + `display_name` 字段。前端根据后端返回的 `authMode` 或 capabilities 动态调整表单字段,不硬编码后端类型。

**Why this priority**: P4b BFF 路由已支持 `login_name` 和 `email` 两种字段(BFF 自动映射),但前端登录页仍显示 "Email" 标签,企业版用户困惑。

**Independent Test**: 配置 enterprise tenant → 访问登录页 → 表单显示 "用户名" 而非 "邮箱" → 输入 login_name + password → 登录成功。

**Acceptance Scenarios**:

1. **Given** 当前 tenant 的 authMode=intellect-enterprise, **When** 用户访问登录页, **Then** 表单标签显示 "用户名"(login_name)而非 "邮箱"(email)
2. **Given** authMode=intellect-rag, **When** 用户访问登录页, **Then** 表单标签保持 "邮箱"(email),行为不变(零回归)
3. **Given** 企业版注册页, **When** 用户填写表单, **Then** 显示 login_name + password + display_name 字段(无 email)
4. **Given** 社区版注册页, **When** 用户填写表单, **Then** 保持 email + password + nickname 字段(零回归)
5. **Given** authMode 未确定(加载中), **When** 用户访问登录页, **Then** 显示通用 "账号" 标签,登录后根据实际 authMode 调整

### Edge Cases

- **authMode 探测时机**: 前端需在登录页渲染前知道 authMode。方案: 登录页先显示通用标签,`useHarnessCapabilities` 返回后动态调整;或 BFF 在未认证时也返回 authMode(通过 tenant 配置)
- **OAuth 登录渠道**: 企业版 OAuth 渠道列表来自 BFF `/auth/login/channels`,前端需在登录页展示;社区版用 intellect-rag 的 OAuth 渠道
- **字段校验差异**: login_name 无 email 格式校验,前端 zod schema 需按 authMode 切换
- **多 tenant 切换**: 用户切换 tenant 后登录页字段需刷新

## Requirements

### Functional Requirements

- **FR-001**: 前端登录页 MUST 根据 authMode 动态切换表单字段标签(email ↔ login_name)
- **FR-002**: 前端注册页 MUST 根据 authMode 动态切换表单字段(email+nickname ↔ login_name+display_name)
- **FR-003**: 前端 zod 校验 schema MUST 按 authMode 切换(email 格式校验 vs login_name 长度校验)
- **FR-004**: BFF MUST 在未认证时也提供 authMode 信息(供登录页渲染),通过 tenant 配置或默认值
- **FR-005**: 前端 OAuth 渠道列表 MUST 从 BFF `/auth/login/channels` 获取,不在前端硬编码
- **FR-006**: 所有改动 MUST 不影响社区版登录/注册行为(零回归)

### Key Entities

- **LoginFormSchema**: zod schema,按 authMode 切换 email/login_name 字段
- **RegisterFormSchema**: zod schema,按 authMode 切换字段组合

## Success Criteria

- **SC-001**: 企业版登录页显示 "用户名" 标签,社区版显示 "邮箱" 标签
- **SC-002**: 企业版注册页显示 login_name + display_name,社区版显示 email + nickname
- **SC-003**: 社区版登录/注册/OAuth 100% 不回归
- **SC-004**: TypeScript 编译零错误

## Assumptions

- authMode 可从 BFF `/api/bff/capabilities` 或专门的 `/api/bff/auth/mode` 端点获取(无需认证)
- 前端登录页已有 useLogin/useRegister hook,P4d 只改表单 UI 和校验逻辑
- P4d 不涉及 BFF 后端改动(已有 authMode 路由)
