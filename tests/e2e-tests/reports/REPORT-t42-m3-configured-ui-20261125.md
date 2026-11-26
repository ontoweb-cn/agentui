# M3 交付报告:设置页「已配置 / 重新输入」

> 2026-11-25;module `t42-m3-configured-ui`;九步交付。

## 1. 结论摘要

| 缺陷/缺口 | 修复 | 验收证据 |
|---|---|---|
| F1 设置页无 PC | Gateway GET/PATCH/fork 返回 sanitized PC | HTTP(PASS) |
| F2 已配置仍要求重填 | configured 列表 + 前端/BFF 校验放行 | Jest/Vitest |
| F3 Internet 开关消失 | `hasWebSearchProvider` 接受 configured | Jest |
| F4 BFF 拒绝空 key | PATCH 前查 Gateway secrets status | BFF route test |
| F5 运行时无 key | Gateway resolve 注入 `AgentConfig.web_search_api_key: RuntimeSecret` | 单测/代码路径;外部 provider 未调(R6) |
| F6 旧 Gateway 误放行 | 状态查询失败回落严格校验 | 逻辑/测试 |
| F7 GET 泄漏历史 key | 响应前 strip | HTTP/DB |
| F8 legacy 仅 key 无 provider | 回填/PATCH 单 key 保留 provider | HTTP(legacy) |
| H1 可见成员读 PC | 仅 owner 返回 sanitized PC/configured | member-token HTTP(无 PC) |

## 2. 用例执行

| 组 | 例数 | 结果 | 说明 |
|---|---|---|---|
| A 展示/校验 | 2 | PASS | HTTP + unit |
| B 保存/轮换 | 2 | PASS | HTTP |
| C 边界 | 2 | PASS | unit |
| D 运行时 | 2 | 1 PASS + 1 受限 | 真实外部 provider 未调 |
| E 兼容/权限 | 2 | PASS | member-token HTTP:GET 200 无 PC;PATCH/secrets 404 |

## 3. 验证命令

```bash
# Frontend
npx jest --silent --forceExit          # 66 suites / 809 tests
npm run type-check                     # 0 error
npm run build                          # built

# BFF
cd bff && npx vitest run               # 71 files / 1271 tests
cd bff && npx tsc --noEmit             # 0 error

# Gateway/Storage
cargo test -p intellect-gateway web_search   # 6 passed
cargo test -p intellect-core runtime_secret_debug # 1 passed
INTELLECT_PG_DSN=... cargo test -p intellect-storage --test web_search_secrets_pg # 1 passed
```

## 4. 交付物

- Gateway `src/platform/api_server.rs`、`src/web_search_providers.rs`;
- BFF `bff-agents.ts`、validation、enterprise adapter/interface;
- Frontend settings/form/helper/map/type/locales;
- 用例/大纲/spec/本报告;
- 手工 HTTP 记录:session sanitized PC + configured;空 key 保留 key_version=1;legacy 仅 `tavily_api_key` PATCH 后 PC 自动补 `web_search_provider=tavily`。

## 4.1 代码评审结论

见 [t42-m3-configured-ui-code-review.md](../../../docs/t42-m3-configured-ui-code-review.md):H1a/H1b/H1c/H1d/H1e/H2/H3/H4/H5/H6 已修;M1 已改 RuntimeSecret(native/consumer 仍待);M2 生产回填、M4 主密钥、真实 provider 仍开放。

## 5. 受限注记(R6)

| # | 项 | 原因 |
|---|---|---|
| R6-1 | 无真实浏览器 UI 截图/交互 | 本 session 无浏览器自动化工具 |
| R6-2 | 未调用真实 Tavily/外部 provider | 无外部凭证/网络依赖 |
| R6-3 | member-token 跨用户 HTTP 404 | 已本地 HTTP 验证(非 CI 临时库) |
| R6-4 | 历史明文生产回填 | M2 CLI 已就绪,生产 DB/L-09 未执行 |
| R6-5 | 主密钥轮换 | 未实现 |
| R6-6 | 原生 agent 通道/provider 真实消费 | key 已进 RuntimeSecret;Gateway 仅对 Tavily 注入 Python `web_search`;Exa/Parallel/Firecrawl 因 client 缓存不接;`web_extract`/外部 provider 未调 |

## 6. 遗留建议

- 在 CI 增加临时 PG + Gateway HTTP 自动化;
- 生产 M2 回填后,再验证历史会话 configured;
- M4 真实 provider 端到端搜索验收;
- 主密钥版本/轮换设计。

## 7. 九步闭环

调研 ✅;手册 ✅;检视 ✅;大纲/用例 ✅;执行 ✅(受限记录);spec ✅;修复 ✅;构建/类型 ✅;回归 ✅(限本模块);终检/报告 ✅。
不把 R6 受限项写成 PASS;T4.2 整体仍受 M2 生产回填、真实 provider 与浏览器验收约束。
