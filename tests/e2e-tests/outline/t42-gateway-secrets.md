# 测试大纲 — t42-gateway-secrets

> 2026-11-25;九步步骤 4。对象:Gateway `/api/sessions/{id}/web-search-secrets` + storage。

## 1. 范围

- Gateway API:PUT / GET / DELETE
- 加密落库、轮换、审计
- 输入边界、鉴权
- **不覆盖**:agentui UI(BFF 未接线)、生产部署、历史回填、检索 resolve

## 2. 用例矩阵

| 组 | 用例 | 结果 |
|---|---|---|
| 正常 | TC-T42GS-01 PUT+GET | PASS |
| 正常 | TC-T42GS-02 轮换 key_version | PASS |
| 正常 | TC-T42GS-03 DELETE | PASS |
| 边界 | TC-T42GS-04 多 provider 并存 | PASS(PG 集成) |
| 错误 | TC-T42GS-05 未认证 401 | PASS |
| 错误 | TC-T42GS-06 非法 provider 400 | PASS |
| 错误 | TC-T42GS-07 空 key 400 | PASS |
| 错误 | TC-T42GS-08 超长 key 413 | PASS |
| 安全 | TC-T42GS-09 密文落库/无明文 | PASS |
| 安全 | TC-T42GS-10 审计无 key | PASS |
| 安全 | TC-T42GS-13 PATCH 明文剥离 | PASS |
| 安全 | TC-T42GS-14 AAD 绑定 | PASS(PG 集成) |
| 安全 | TC-T42GS-15 no-store | PASS |
| 正常 | TC-T42GS-16 M2 历史回填 | PASS(本地 PG) |
| 安全 | TC-T42GS-11 缺主密钥 fail-closed | PASS(存储层);HTTP 503 未单独重启验证 |
| 受限 | TC-T42GS-12 非 owner 404 | 未执行(需 member token;核心 primitive 已测) |

## 3. 环境

- 本地 Gateway:9099;test DB `intellect_t42gs`(fresh migrations)
- `API_SERVER_ENABLED=1`,`API_SERVER_KEY=t42-test-key`
- `INTELLECT_SECRET_KEY` 32-byte base64
- 夹具:HTTP JSON `{"api_key":"..."}`;无文件
- 隔离:所有 session 标题 `t42gs-*`,用例后删除 session(级联删 secrets)

## 4. R6 声明

本能力无 UI;证据为真实 Gateway HTTP 响应 + PostgreSQL 查询,非截图。受限项不伪造 PASS。
