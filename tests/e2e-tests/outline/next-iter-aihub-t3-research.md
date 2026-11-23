# 调研 — T2.5 aihub 续迁 + T3.1/T3.7 + T4.2 等待(module 族: next-iter-aihub-t3)

> 日期:2026-11-22;九步步骤 1。用户指令:「调用九步交付技能推荐顺序实施：T2.5 续迁 aihub，或 T3.1 / T3.7；密钥写侧与 T4.2 等 Gateway 契约。」——预授权连续执行。

## Module

| Module | 动作 | 本仓 |
|---|---|---|
| **t2-5-aihub** | `features/aihub` → `src/ee/features/aihub`;`_registry` 双 glob | ✅ |
| **t3-1-virtual** | `@tanstack/react-virtual`;CSV + chunk 列表虚拟化 | ✅ |
| **t3-7-color-tokens** | total↔sum 交叉校验;`--prune`;`--update` 收缩 | ✅ |
| **t4-2-wait** | 写侧 prune / secrets API | ❌ 等 Gateway(L-T42-01) |

## 定案备忘

- T4.1a ④ 仍延期 T4.2;`sanitizePromptConfigWebSearchKeys` 不接线 PATCH。
- applications 本批不迁(下一刀)。
