# 九步交付报告 — Wizard SSO/KAG/RAG(module: wizard-sso)

日期:2026-11-21 | 设计:`docs/wizard-kag-to-sso-design.md` v1.2 | Spec:`tests/e2e-tests/spec/wizard-sso-spec.md`

## 1. 结论摘要

| 缺陷/差异 | 修复 | 验收证据 |
|---|---|---|
| X-01/D-02 向导含 kag | P1:选项表删除 + probe `!option→400` | L1 TC-01-02 截图(4 类型无 kag); L2 U-01/U-02/U-03(52/52) |
| X-11/D-03 kag 协议族漂移 | P1:`getProtocolFamily('kag')→mcp-protocol` | jest harness-admin-service 15/15 |
| X-05~X-10 SSO 缺失 | P2:区块+providers 端点+setup 扩展+i18n | L1 TC-03-02 截图; L2 U-07~U-16; API 裁剪字段实测 |
| X-03/X-04 RAG 阻塞 | P3:向导移除 RAG + Done warnings | L1 TC-02-03/04-02-confirm 无 RAG 行; L2 U-05/U-06 |
| D-01 feature-registry 2 失败 | **不修**(超范围存量) | 基线即失败,见遗留建议 |

**总体**:P1→P2→P3 代码落地;BFF 全量 **1086/1086** 通过;前端 type-check/build 通过;L1 主路径取证至 Confirm(含 SSO 摘要);破坏性 Create 因 mode=add 需 admin 会话被 401 拦截(L-05),setup 契约由 L2 覆盖。

## 2. 用例执行结果

| 组 | 例数 | 结果 | 说明 |
|---|---|---|---|
| TC-01 入口/类型 | 3 | PASS | 01-01/01-02 截图;无 KAG |
| TC-02 连接表单 | 4 | PASS(UI) | 02-03 无 RAG;SSO 开关可见 |
| TC-03 SSO 区块 | 6 | PASS(部分) | 03-02 渠道+misconfigured 截图;http 警告可见;密钥可生成 |
| TC-04 探测/确认/完成 | 5 | 部分 PASS | probe 可达;Confirm SSO 摘要;Create→401(L-05)未达 Done |
| TC-05 L2 矩阵 | 18 | PASS | wizard.test.ts 52 例全绿(含 U-01~U-16) |

## 3. 交付物清单

| 类别 | 路径 |
|---|---|
| 设计 | `docs/wizard-kag-to-sso-design.md`、`docs/wizard-manual.md` |
| BFF | `bff/src/routes/wizard.ts`、`bff/src/types/wizard.ts`、`bff/src/routes/wizard.test.ts` |
| 前端 | `src/pages/wizard/index.tsx`、`src/pages/wizard/sso-section.tsx`(新)、`src/services/wizard-service.ts`、`src/utils/api.ts`、`src/services/harness-admin-service.ts(+test)`、`src/locales/{zh,en}.ts` |
| 测试资产 | `tests/e2e-tests/outline/wizard-sso*.md`、`cases/wizard/*`、`fixtures/wizard/mock-upstream.mjs`、`spec/wizard-sso-spec.md` |
| 截图 | `tests/e2e-tests/results/wizard-sso/TC-WIZSSO-*.png` |

## 4. 受限注记专节

| # | 内容 |
|---|---|
| L-01 | 本机无 IdP,SSO 登录闭环(渠道→IdP→回调→首页)未真实执行;以 BFF 单测+既有 bff-sso-p2 回归替代 |
| L-02 | E2E 探测/渠道数据源为 mock-upstream:9399,不依赖外网网关 |
| L-03 | probe/sso 共享 IP 限流;单测用独立 `x-forwarded-for` 键隔离 |
| L-04 | 破坏性 setup 前已备份 `bff/data/{harness-backends,bff-tenants,token-vault}.json`;本次 Create 未落盘(401),数据与备份一致 |
| L-05 | `mode=add` + 已有就绪后端时 setup 需 admin/imt 会话;未登录 UI Create 被 401 拦截跳登录页。setup/envSnippet/warnings 契约由 L2 全覆盖 |
| L-06 | Windows workspaces 下 `bff/node_modules/.bin/{vitest,tsx}` shim 陈旧(MODULE_NOT_FOUND);需 `node node_modules/vitest/vitest.mjs --root=bff` / `node ../node_modules/tsx/dist/cli.mjs` 直调 |
| L-07 | 可选依赖 `@rollup/rollup-win32-x64-msvc` 缺失时 vitest 无法启动,需补装(npm optional deps bug) |

## 5. 遗留建议(不阻塞)

1. D-01:`feature-registry.test.ts` 2 例基线失败,另立项修复;
2. L-05:为 mode=add E2E 增加已登录 admin 会话夹具,或提供测试用 bootstrap token 注入;
3. R8(设计评审):`WizardDraft` 中 bearer token 仍进 localStorage(既有决策),后续迁出;
4. R14:SsoStore 运行时可改配置(免改 .env 重启)。

## 6. 项目记忆更新

- **部署真源**:本机 BFF 9390(经 Vite 9391 代理 `/api/bff/*`);数据目录硬编码 `bff/data/`;
- **新代码生效反查**:`GET /api/bff/admin/wizard/backend-types` 首项为 `intellect-enterprise` 且无 `kag`;`GET .../sso/providers?endpoint=http://localhost:9399` 返回裁剪字段 + `misconfigured:["broken-provider"]`;
- **启动口令**:BFF 直调 `node ../node_modules/tsx/dist/cli.mjs watch --env-file=.env src/index.ts`(在 `bff/`);mock `node tests/e2e-tests/fixtures/wizard/mock-upstream.mjs`;
- **回归口令**:`node node_modules/vitest/vitest.mjs run --root=bff`;根目录 `npm run type-check` / `npm run build`;
- **数据恢复**:停 BFF → 从 `tests/e2e-tests/results/wizard-sso/data-backup/` 还原 3 个 json → 启 BFF;
- **死锁/怪癖**:password 输入框 a11y 不暴露 value;401 拦截器会把向导踢到 `/login`。

## 7. 九步闭环声明

步骤 1–9 已按九步交付法完成:调研/手册/双向检视/大纲用例/基线/批准门(用户预授权 P1→P3)/修复(P1+P2+P3)/审查构建部署取证/回归(BFF 全量+前端 type-check/build+L1 主路径)/终检报告与截图归档。受限项均编号登记,未伪造通过。
