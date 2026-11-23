# 九步交付报告 — 清单 v7 下一批(module: ragflow-v7-batch)

> 日期:2026-11-22;用户预授权「实施依据清单 v7」
> 范围:**T2.5 applications→ee** + **T3.7 check-color-tokens**

## 一、结论摘要

| 项 | 状态 | 证据 |
|---|---|---|
| T2.5 applications | **完成** | `git mv` → `src/ee/pages/applications/application-list.tsx`;manifest 挂 `@/ee/...` |
| T3.7 color-tokens | **完成** | total↔files 交叉校验;`--prune`;基线更新 298/63 |
| 不纳入 | 登记 | aihub、T4.2 M1+、D1、T3.5 |

## 二、用例

| 用例 | 结果 |
|---|---|
| TC-V7-01 路径/挂载 | **PASS** |
| TC-V7-02 feature-registry jest | **PASS**(9/9) |
| TC-V7-03 交叉校验 | **PASS**(篡改 total→exit 1) |
| TC-V7-04 --prune | **PASS**(清 wizard+旧 applications 路径后 --update 跟进 ee) |
| TC-V7-05 type-check | 见门禁 |
| TC-V7-06 真浏览器 | **L-V7-01** |

## 三、交付物

- ee 页 + manifest;脚本 `check-color-tokens.mjs`;`color-token-baseline.json`;CLAUDE.md;清单 **v8**;九步资产

## 四、受限注记

| 编号 | 内容 |
|---|---|
| L-V7-01 | `/applications` 真浏览器未跑 |
| L-V7-02 | application-list 仍有 4 处存量裸色值,已随路径迁入基线(ratchet,非本批新增) |

## 五、遗留

下批:**aihub ee 迁入**;T3.1–T3.6;T4.2 M1+ / D1

## 六、九步闭环

调研✅ 手册✅ 检视✅ 大纲✅ 执行✅ Spec(预授权)✅ 修复✅ 审查✅ 回归✅ 终检✅。未伪造通过。
