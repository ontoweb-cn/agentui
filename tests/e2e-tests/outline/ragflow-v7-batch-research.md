# 调研笔记 — 清单 v7 下一批(module: ragflow-v7-batch)

> 日期:2026-11-22;九步步骤 1
> 范围:**T2.5 续迁 applications** + **T3.7 check-color-tokens 增强**
> 明确不纳入:aihub(下批)、T4.2 M1+(待 Gateway)、D1(运维)、T3.5 字体(视觉面过大)
> 用户预授权:「调用九步交付技能实施依据清单 v7」

## 1. T2.5 applications

| 项 | 结论 |
|---|---|
| 迁入 | `src/features/applications/pages/application-list.tsx` → `src/ee/pages/applications/application-list.tsx` |
| 挂载 | `manifest.ts` 改 `@/ee/pages/applications/application-list` |
| 保留 | manifest/routes/locales 仍在 features(registry glob + i18n) |
| 风险 | 低;无 BFF;ee→`@/features/_registry` 合法 |

## 2. T3.7 color-tokens

| 缺口 | 处置 |
|---|---|
| `baseline.total` 与 per-file 之和可漂移 | 启动时交叉校验,不一致则 fail 并提示 `--update` |
| 文件删净后基线条目残留 | 检测收缩时提示;新增 `--prune` 写回去掉零命中文件并重算 total |

## 3. 门禁

`npx tsc --noEmit`;`npx jest src/features/feature-registry.test.ts`;`node scripts/check-color-tokens.mjs`;可选 `--prune` 干跑。
