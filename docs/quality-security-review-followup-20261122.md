# 质量+安全评审跟进修复 — 2026-11-22

> 范围:对 `dev` vs `main`(含未提交 T4.1a/T2.6/T2.5/T4.2)双评审意见的代码闭环
> 关联评审:Bugbot(Node engines)+ Security Review(external-info / metadata 密钥面)

## 处置表

| 来源 | 意见 | 处置 |
|---|---|---|
| Bugbot Medium | oxlint 要求 Node `^20.19 \|\| >=22.12`,仓库仍 `>=18.20.4` | **已修** `package.json` engines 对齐;镜像已为 `node:20-alpine` |
| Security 加固 | list 宽面带回明文 `*_api_key` | **已修** `listSessions` 脱敏;详情 `getSession` 保留供设置页(T4.2 前过渡) |
| Security 加固 | 跨用户 GET 拒绝测 | **已补** adapter 404 + external-info 404 无密钥泄漏断言 |
| Security 加固 | external-info「公开」命名易误解 | **已补** 路由注释:非 publicPaths、勿匿名化 |
| 质量连带 | 前端只读顶栏 `prompt_config`,与 BFF metadata 形状脱节 | **已修** `mapGatewaySessionToDialog` 优先读 `metadata` |

## 有意不改

- GET 详情剥 Key → 设置页无法回填,等 T4.2 secrets API(M1/M3)
- 将 external-info 做成真正匿名 → 需独立 share-token 契约,超出本批
