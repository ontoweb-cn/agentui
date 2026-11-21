# Spec — Wizard-SSO 交付遗留实施(批准门)

module: `wizard-sso-followup` | 日期:2026-11-21 | 用户已指示「实施 A. Wizard-SSO 交付遗留」(预授权)

## 范围与实施顺序

1. **A6(已完成)**:babel-plugin-import-meta-glob Windows 反斜杠修复(toPosix)+ jest 缓存陷阱记录;前端全量 750/750 达成。
2. **A4**:根目录 `npm install` 重链 workspace shims + 平台原生依赖;验证 tsx/vitest shim 与 `npm run dev` 可启。
3. **A8**:管理端 harness-backends 类型选择 kag 说明文案(zh/en)。
4. **A5**:向导草稿凭据迁出 localStorage(saveDraft 剥离 + sessionStorage 会话级 + clearDraft 双清)。
5. **A7**:SsoStore(`bff/data/sso-config.json`,无 secret)+ `loadSsoConfig` runtime>env 逐字段合并 + `assertSsoConfigAtStartup` 校验合并后配置 + `GET/PUT /admin/sso/config`(继承全局鉴权)+ 管理端设置页(`/admin/sso-settings`,nav + routes + i18n)。
6. **A2/A3**:首装模式 E2E 全流程(清数据模拟,免鉴权)+ 真网关渠道取证;IdP 闭环出人工联调清单。

## 取舍(关键决策)

- wizard setup 维持 envSnippet 引导,**不直写 SsoStore**(首装闭环已成立;store 服务安装后调整,避免 setup 双写语义);
- A5 采用 sessionStorage(标签页生命周期)而非加密 localStorage:满足"刷新保留 + 关标签清除 + 不长期落盘",不引入加密依赖;
- A7 providers 管理为逗号清单文本(渠道发现仍走向导区块的只读拉取),不做拖拽多选(YAGNI);
- 不动 `auth.ts` 鉴权逻辑;新端点依赖既有全局中间件的会话门槛(与 harness-admin 同级)。

## 验收口径

- L2:BFF 新增 sso-store/sso-admin 用例全绿;前端 jest 全量保持 750+;type-check/lint/build 零错误;
- L1:A2 六步截图链(TC-FUP-01);A5 刷新证据(TC-FUP-02);A3 真网关截图或 502 取证;
- 恢复:运行库数据与备份哈希一致;受限项登记。

## 产物路径

报告 `reports/REPORT-wizard-followup-20261121.md`;截图 `results/wizard-sso-followup/`。
