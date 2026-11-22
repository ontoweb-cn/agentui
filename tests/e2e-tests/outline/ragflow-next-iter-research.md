# 调研笔记 — 下迭代三项(module: ragflow-next-iter)

> 日期:2026-11-22;九步步骤 1
> 范围:**T2.6 oxlint → T2.5 第二步(pages/tasks) → T4.2 密钥存储设计**
> 基线:`dev` @ `d208f4b`(+ 工作树含未提交 T4.1a,本批不混入提交语义)
> 用户预授权:「调用九步法实施 T2.6 → T2.5 第二步 → T4.2 设计」

## 1. T2.6 oxlint

| 项 | 现状 |
|---|---|
| 脚本 | `package.json` `"lint": "eslint src --ext .ts,.tsx --report-unused-disable-directives"` |
| oxlint | **未安装** |
| 上游 | RAGFlow 已切 oxfmt/oxlint(Rust);本仓先并行不替换 |
| 验收 | `oxlint src` < 5s;存量告警处理或基线化 |

策略:安装 `oxlint` → `.oxlintrc.json`(先偏宽松/与上游常见规则对齐)→ `lint` 追加 `&& oxlint src` → 若告警爆炸则用 `categories` 收窄 + `ignorePatterns`,保证门禁可绿;报告记录告警基线数。

## 2. T2.5 第二步

| 候选 | 结论 |
|---|---|
| **pages/tasks** | **选定**:5 文件;挂载仅 `features/tasks/manifest.ts` 两处;模式对齐 wizard(`git mv` + 改挂载,无 stub) |
| features/aihub | 过大(19 文件)+ BFF 耦合,下批 |
| features/applications | 域耦合低但属 feature 包,需动 registry/glob,非 wizard 模式 |

迁移动作:`src/pages/tasks` → `src/ee/pages/tasks`;manifest 改 `@/ee/pages/tasks(+ /task-list)`;子路由 next-chats/agents 不动;文件头注释对齐 wizard。

## 3. T4.2 设计(文档任务)

| 项 | 现状 |
|---|---|
| 密钥位置 | 14 provider `*_api_key` 明文在 Gateway `sessions.prompt_config` JSON |
| 读写 | PATCH 整包(T2.10);T2.4 短期不 prune;T4.1a ④ 延期至此 |
| 公开面 | external-info 仅 bool(T4.1a 已做) |
| 目标 | 独立密钥存储 + 配置存引用 + 响应不回传明文 + 审计脱敏;作 Go 化 Phase A/B 数据模型输入 |

产物:`docs/web-search-secret-storage-design.md`(方案对比、推荐架构、迁移阶段、与 T4.1a/Gateway/BFF 边界、验收标准)。**本批不写生产密钥迁移代码**。

## 4. 门禁基线(实施前抽样)

- BFF vitest 此前 T4.1a 后 1201;本批前端为主
- `npm run lint` 现状 = 仅 eslint
- tasks jest:`src/pages/tasks/__tests__/*`
