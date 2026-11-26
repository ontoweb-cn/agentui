# M3 测试大纲:已配置 / 重新输入

> 2026-11-25;九步 module `t42-m3-configured-ui`。
> 截图目录:`tests/e2e-tests/results/t42-m3-configured-ui/`(本 session 无浏览器,空)。
> 隔离:用例数据 `e2e-m3-*`;本地临时 PG,结束删除。
> 前置:Gateway migration + `INTELLECT_SECRET_KEY`;BFF/前端 unit 环境。
> R6:无浏览器自动化;UI 以 jsdom/契约单测 + HTTP/DB 取证,不伪造截图。

## 用例矩阵

| 组 | 用例 | 主题 | 结果 |
|---|---|---|---|
| A 已配置展示 | TC-M3-01 | GET session 返回 sanitized PC + configured 列表 | PASS(HTTP) |
| A | TC-M3-02 | schema/helper 允许已配置 provider 空 key | PASS(unit) |
| B 保存 | TC-M3-03 | 空 key PATCH 保留 secret/key_version | PASS(HTTP) |
| B | TC-M3-04 | 新 key PATCH 轮换 key_version | PASS(HTTP) |
| C 校验 | TC-M3-05 | 未配置 provider 空 key 仍拒绝 | PASS(BFF/前端 unit) |
| C | TC-M3-06 | keyless provider 空 key 放行 | PASS(unit) |
| D 运行时 | TC-M3-07 | `hasWebSearchProvider` configured 时 true | PASS(unit) |
| D | TC-M3-08 | Gateway 运行时 resolve 注入(代码路径) | 受限:未调用真实 provider |
| E 兼容 | TC-M3-09 | BFF 状态查询失败 → 严格校验 | PASS(unit 逻辑) |
| E | TC-M3-10 | 非 owner/旧 Gateway 不泄漏 key | PASS(member token HTTP) |

## 断言口径

- surface:HTTP JSON / jsdom / BFF vitest;
- 安全:响应无 `*_api_key`、无 ciphertext;configured 仅 provider 名称;
- 回归:前端 809 tests、BFF 1271 tests 全绿。
