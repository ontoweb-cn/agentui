# 调研笔记 — Wizard-SSO 交付遗留(module: wizard-sso-followup)

日期:2026-11-21。任务源:`REPORT-wizard-sso-20261121.md` §5 + 设计 §10(编号 A2-A8,跳过 A1 占位)。

## A2 首装 E2E 闭环(鉴权路径已核实)

- `wizardSetupAuth` 第 3 分支(wizard.ts):`BOOTSTRAP_ENABLED !== 'false'` 且 **`store.list().length === 0`(就绪后端为空)→ 无凭据放行**。即清空 harness-store 即可真实模拟首装,无需任何 token;
- BootstrapTokenManager(`bootstrap-token.ts`):token 落盘 `bff/data/.bootstrap-token`(0600,TTL 1h,一次性);首装检测时 generate 并控制台脱敏打印;setup 成功后 invalidate;
- **E2E 步骤**:停 BFF → 移走 `harness-backends.json`+`token-vault.json`+`bff-tenants.json`(备份已有)→ 启 BFF → 浏览器 `/` → WizardGuard 重定向 `/wizard`(无 mode)→ 六步全流程(Create 免鉴权)→ Done warnings → 恢复 3 文件 + 删除 `.bootstrap-token` → 重启 → 验证原状;
- 副产物覆盖:WizardGuard 重定向、全新租户 createBackend 分支、setup 未就绪 warnings。

## A3 真网关取证

- 真网关 `https://ai.wust.edu.cn/intellect-gateway` 为现网就绪后端;公开渠道端点 `GET /api/members/oauth/providers` 只读 GET(诊断性只读,R1 允许);
- IdP 登录需用户凭据,自动化不可代输 → **闭环留人工联调清单**,本次取证范围:真网关渠道拉取(向导 SSO 区块 + 登录页 channels)成功与否及截图。

## A4 依赖治理

- 症状:`bff/node_modules/.bin/{tsx,vitest}` shim 指向 bff 内模块路径,但包被 workspaces 提升至根 → MODULE_NOT_FOUND;根 rollup 缺 win32 原生模块(已 `--no-save` 补装);WSL 侧另有 esbuild 错配(Windows 本机 jest 实测无碍);
- 根治:根目录 `npm install` 重链 workspace bins + 安装平台 optional deps;验证 `Test-Path bff/node_modules/tsx`、`npm run dev` 可启、vitest/tsx 直调不再必需;
- 风险:package-lock 可能更新(正常);耗时数分钟。

## A5 草稿凭据迁出

- 现状:`wizard-draft` 整体(含 token/email/password)进 localStorage(Step 3-4);
- 方案:`saveDraft` 剥离凭据字段;凭据另存 `sessionStorage['wizard-draft-credentials']`(标签页级生命周期,天然短效);`loadDraft` 合并;`clearDraft` 双清;sso 非敏感字段留 localStorage;`ssoSecret` 维持内存态。

## A6 已修复(根因确认)

- `babel-plugin-import-meta-glob.cjs` 的 `resolvePattern` 在 Windows 产出反斜杠 pattern → fast-glob 视 `\` 为转义 → 零匹配 → `import.meta.glob` 静默为空 → `enabledModules=[]` → feature-registry 2 例失败(此前仅 WSL/Linux 跑过 jest,故基线即败);
- 修复:`toPosix()` 统一正斜杠;**验证注意**:jest 转换缓存不感知插件文件变更,须 `npx jest --clearCache`;修复后 9/9 通过。

## A7 接入点(SsoStore + 管理端设置页)

- BFF:
  - 新 `bff/src/services/sso-store.ts`:`bff/data/sso-config.json`(`{enabled,publicOrigin,providers,silentRelogin,updatedAt}`,**不存 stateSecret**),zod 校验,缺文件/损坏 → env 兜底;
  - `sso-config.ts` `loadSsoConfig` 改为 runtime>env 逐字段合并;`assertSsoConfigAtStartup` 校验合并后配置(runtime enabled 但 env secret 缺失 → fail-fast 明确报错);
  - 新 `bff/src/routes/sso-admin.ts`:`GET /admin/sso/config`(生效值+来源标记)、`PUT /admin/sso/config`(校验同 wizard sso);挂载 index.ts,继承全局 authMiddleware(cookie/header 存在性门槛);
  - **取舍**:wizard setup 维持 envSnippet 引导(首装闭环已成立),不直写 store —— SsoStore 服务"安装后调整"。
- 前端:
  - `src/services/sso-admin-service.ts` + `api.ts` 路径;`src/pages/admin/sso-settings.tsx`(enabled/publicOrigin[http 警告]/providers 逗号清单/silentRelogin;展示来源与"secret 由 .env 管理"提示);
  - `Routes.AdminSsoSettings` + routes.tsx 挂 navigation-layout children + navigation-layout nav 项 + i18n(zh/en)。

## A8 管理端 KAG 文案

- 落点:`harness-backends.tsx` 类型 Select(L590-620)kag 选项下方说明(hint 文案),i18n `admin.harnessBackends.kagHint`(zh/en)。

## 基线与回归命令

- 前端 jest 全量(修 A6 后应 750/750);`npm run type-check` / `build`;BFF `node node_modules/vitest/vitest.mjs run --root=bff`(1086);
- E2E 依赖:Vite 9391(已启)、mock-upstream 9399(已启)、BFF 9390(重启控制权在我方,现网 9390 由旧实例占用,重启即接管)。