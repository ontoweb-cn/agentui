# 用户手册 — 应用页与颜色守卫(module: ragflow-v7-batch)

> 日期:2026-11-22;九步步骤 2。本批以工程结构为主。

## 1. 应用中心(`/applications`)

### 1.1 入口
侧栏 **应用** → 卡片网格列出已注册应用;无应用时显示空态说明。

### 1.2 行为(不变)
点击卡片进入对应应用路由。标题/副标题/空态文案走 i18n。

### 1.3 对开发者
页面实现迁至 `src/ee/pages/applications/`(agentui 私有 overlay);URL 与业务行为不变。

## 2. 颜色 token 守卫(开发者)

执行 `npm run type-check`(内含 `check-color-tokens`)或 `node scripts/check-color-tokens.mjs`:
- 禁止新增裸色值/默认调色板类;
- 基线 `total` 必须等于各文件计数之和,否则失败并提示 `--update`;
- 文件已清零但仍在基线时打印 improved,并可用 `--prune` 自动收缩基线。

错误路径:新增违规 → 脚本 exit 1;手工改坏 total → 一致性校验失败。
