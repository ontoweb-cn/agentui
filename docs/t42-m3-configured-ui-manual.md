# M3 用户手册:联网搜索「已配置 / 重新输入」

## 1. 入口

会话 → 右上设置 → **Prompt 引擎** → **Web 搜索服务**。

## 2. 用户可见行为

### 2.1 已配置 provider

- 选择已保存密钥的 provider;
- key 输入框显示占位「留空保持已配置的密钥」,旁边显示「已配置 — 留空保持现有密钥」;
- 直接保存:保留旧密钥,不要求重新输入,不轮换 `key_version`;
- 想轮换:输入新 key 再保存,`key_version` +1。

### 2.2 未配置 provider

- 选择需要 key 的 provider,key 必填;
- 空 key 保存 → 前端 schema + BFF 均拒绝,提示 `xxx_api_key` 必填;
- 选择 AnySearch / You.com(keyless)→ key 可空。

### 2.3 切换 provider

- 切到已配置 provider:允许留空;
- 切到未配置 provider:必须输入 key;
- 已配置列表只影响当前选中的 provider,不会把别的 provider 的 key 复用。

### 2.4 Internet 开关

- 已配置 provider + 选择后,即使浏览器没有 key,`useShowInternet` 也显示联网开关;
- 运行时由 Gateway 从 `web_search_secrets` 解析出 key,注入当次 agent 配置(内存),不写回 PC。

## 3. 错误路径

| 场景 | 行为 |
|---|---|
| Gateway 无 secrets 表/查询失败 | session 仍可打开,configured 为空;UI 按未配置处理 |
| BFF 查状态失败(旧 Gateway) | 回落严格校验;要求输入 key |
| 加密不可用(无主密钥) | 保存 503,不落明文 |
| 非 owner | 404;不展示 configured |
| 历史明文未回填 | GET session 响应已剥离 key;DB 仍待 M2;legacy 单 key 会自动补 provider |

## 4. 不在本批

- 真实浏览器截图/交互回归(本 session 无浏览器工具);
- 真实外部 provider 搜索请求;
- 历史 M2 生产回填;
- 主密钥轮换。
