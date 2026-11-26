# 九步交付报告 — t42-gateway-secrets(L-T42-01 Gateway)

> 日期:2026-11-25;模块:t42-gateway-secrets;仓库:agentui + intellect-team/intellect-gateway
> 指令:「调用九步交付实施 A. 等 Gateway 密钥能力(L-T42-01)」
> 代码评审:[t42-gateway-secrets-code-review.md](../../../docs/t42-gateway-secrets-code-review.md)

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| Gateway secrets API | **已实现** |
| Migration/store | **已实现** |
| 加密落库 | AES-256-GCM,无明文 |
| 轮换/删除/多 provider | PASS |
| 审计 | PASS(无 key) |
| L-T42-01(Gateway) | **OPEN**(源码/路由可探测) |
| L-09 / L-PHASEB-01 | 仍 BLOCK,不在本批 |
| agentui BFF/UI 接线 | **未做**,下一模块 `t42-m1-wire` |
| T4.2 新写入安全 | **已关闭**:PATCH 提取/剥离 + AAD |
| T4.2 整体 | **未完成**:M2 生产回填 + M3 真实浏览器/provider |

## 2. 用例执行

| 组 | 用例 | 结果 |
|---|---|---|
| 正常 | PUT+GET | PASS |
| 正常 | PATCH 提取/剥离 | PASS(事务) |
| 正常 | M2 历史回填 CLI | PASS(本地 PG dry-run/apply/verify) |
| 正常 | OpenAPI 文档 | PASS(200,3 paths) |
| 正常 | rotate 别名 | PASS(204) |
| 质量 | provider 三方守卫 | PASS(14) |
| 安全 | AAD 绑定 swap 拒绝 | PASS |
| 安全 | GET no-store | PASS |
| 正常 | 轮换 key_version 1→2 | PASS |
| 正常 | DELETE | PASS |
| 正常 | 多 provider 并存 | PASS |
| 错误 | 未认证 401 | PASS |
| 错误 | 非法 provider 400 | PASS |
| 错误 | 空 key 400 | PASS |
| 错误 | 超长 key 413 | PASS |
| 安全 | 密文 `enc:v2:`、AAD 绑定、无明文 | PASS |
| 安全 | 审计 action/无 key | PASS |
| 安全 | 相同 key 重复 PATCH 不轮换 | PASS |
| 受限 | 缺主密钥 HTTP 503 | 存储层 fail-closed PASS;HTTP 503 未单独重启验证 |
| 受限 | 非 owner 404 | 代码路径已实现;未用 member token 实测 |

证据:真实 Gateway HTTP(9099)+ PostgreSQL 查询;非 UI,无截图(R6)。

## 3. 交付物

### Gateway

- `intellect-storage/migrations/20261125000001_web_search_secrets.sql`
- `intellect-storage/src/web_search_secrets.rs`
- `intellect-storage/src/secret_crypto.rs`(AAD `enc:v2:` 支持)
- `intellect-storage/tests/web_search_secrets_pg.rs`
- `intellect-storage/src/lib.rs`(mod/export)
- `intellect-gateway/src/platform/api_server.rs`(routes/handlers/tests)
- `intellect-gateway/src/bin/web-search-secrets-backfill.rs`(M2 CLI)
- `intellect-gateway/src/web_search_providers.rs`(共享 allowlist/extract)
- `intellect-gateway/src/openapi-web-search-secrets.json`(OpenAPI)
- `scripts/check-web-search-providers.mjs`(三方 allowlist 守卫)

### agentui

- `docs/t42-gateway-secrets-manual.md`
- `tests/e2e-tests/outline/t42-gateway-secrets-research.md`
- `tests/e2e-tests/outline/t42-gateway-secrets.md`
- `tests/e2e-tests/outline/t42-gateway-secrets-review.md`
- `tests/e2e-tests/spec/t42-gateway-secrets-spec.md`
- `tests/e2e-tests/cases/t42-gateway-secrets/TC-T42GS-01-12.md`
- 本报告

## 4. 验证命令

```bash
# Gateway 单测
cd intellect-team/intellect-gateway
cargo test -p intellect-gateway web_search_secret_tests

# PG 集成(新库,自动 migrate)
cd intellect-team
createdb intellect_t42gs
INTELLECT_PG_DSN=postgresql://localhost/intellect_t42gs \
  cargo test -p intellect-storage --test web_search_secrets_pg

# 闸门
cd agentui
node scripts/check-exec-gates.mjs
```

结果:

- Gateway 单测:**6 passed**(provider/extract/timestamp)
- Storage PG:**1 passed**(多 provider/轮换/AAD/ownership/fail-closed)
- `cargo check -p intellect-gateway`:**通过**
- Gate:`OPEN L-T42-01`;`BLOCK L-09 / L-PHASEB-01`

## 5. 受限注记(R6)

| # | 内容 |
|---|---|
| R1 | Gateway PATCH 已自保;M3 BFF/UI 已接线;历史 M2 生产回填未执行 |
| R2 | M3 UI 已实现;真实浏览器截图未执行 |
| R3 | 生产 Gateway 未部署(L-09 无 kubectl);本地 9099 已实测 |
| R4 | member token 已实测 PATCH/secrets 404;CI 夹具未固化 |
| R5 | 缺主密钥 HTTP 503 未单独重启验证;存储层 fail-closed 已测 |
| R6 | API 能力无 UI 截图;证据为 HTTP/DB 输出 |
| R7 | OpenAPI/rotate 已补;自动 schema 校验未做 |
| R8 | M2 工具已做,生产回填未执行;前端 M3、M4 resolve 未做 |

## 6. 九步闭环

调研 ✅;手册 ✅;审查 ✅;大纲/用例 ✅;执行 ✅(受限记录);spec ✅;修复 ✅;本地构建 ✅;回归 ✅(限本 API);终检/报告 ✅。
生产部署、历史 M2 生产回填与真实浏览器/provider 验收 **未完成**,不伪关闭 T4.2;新写入路径已安全。
