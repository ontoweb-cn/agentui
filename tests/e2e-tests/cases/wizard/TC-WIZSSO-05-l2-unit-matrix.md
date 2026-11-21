# TC-WIZSSO-05 — L2 单测 / API 层矩阵(bff vitest + 前端 jest)

截图目录:不适用(单元层)。
前置依赖:`cd bff && npm run test`;根目录 `npm run test` / `npm run type-check`。
隔离声明:vitest 全程 mock store/fetch,不触碰 `bff/data`(R3)。
R6 现状口径:实施前跑基线,X 相关断言按 §大纲 X 清单登记 FAIL/PENDING。

## 覆盖矩阵(与 wizard.test.ts 对应)

| # | 分支 | 预期 |
|---|---|---|
| U-01 | GET backend-types | 4 项,不含 kag / intellect-rag |
| U-02 | probe type=kag | 400 Unsupported backend type |
| U-03 | setup type=kag | 400 Unsupported backend type |
| U-04 | probe 未知 type(随意串) | 400 |
| U-05 | setup enterprise 缺 rag 字段 | 200 成功(校验移除,不再要求) |
| U-06 | setup enterprise 成功 | 不创建伴生 RAG;响应 envSnippet 无 RAG 行;warnings 含 RAG 提示 |
| U-07 | setup enterprise + sso(enabled,合法) | envSnippet 追加 5 行 BFF_SSO_*;secret 占位无明文回显 |
| U-08 | setup sso.secret <32 字符 | 400 |
| U-09 | setup sso.publicOrigin 非法 URL | 400 |
| U-10 | setup 非 enterprise + sso.enabled=true | 400 |
| U-11 | setup sso.providers 含未知 id | 200 + warnings 提示 |
| U-12 | setup body `sso.public_origin`(snake_case) | 归一化生效,等价 camelCase |
| U-13 | GET /admin/wizard/sso/providers 正常 | providers 仅 id/displayName/icon;misconfigured 含 broken-provider;**不含 clientId/authorizeUrl/scopes** |
| U-14 | GET sso/providers endpoint 非法(私有 IP+SSRF 拦截态) | 400 |
| U-15 | GET sso/providers 上游 500/超时 | 502 |
| U-16 | GET sso/providers 限流 | 429 |
| U-17 | 前端 getProtocolFamily('kag') | `mcp-protocol`(X-11) |
| U-18 | 既有方案A鉴权/bootstrap 用例 | 全部保持通过(回归) |
