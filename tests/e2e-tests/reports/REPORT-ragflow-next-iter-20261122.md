# 九步交付报告 — T2.6 + T2.5 二步 + T4.2 设计(module: ragflow-next-iter)

> 日期:2026-11-22;方法:九步交付法;spec:`tests/e2e-tests/spec/ragflow-next-iter-spec.md`
> 用户预授权连续执行

## 一、结论摘要

| 交付项 | 状态 | 证据 |
|---|---|---|
| **T2.6** oxlint 并行 | **完成** | `oxlint@1.94`;`.oxlintrc.json`;`lint`/`lint:oxlint`;修 `custom.d.ts` TS(2309);~0.8s exit 0;23 warning 基线 |
| **T2.5 二步** tasks→ee | **完成** | `git mv src/pages/tasks → src/ee/pages/tasks`;manifest 两处 `@/ee/pages/tasks`;jest 6/6 |
| **T4.2** 密钥存储设计 | **完成(文档)** | `docs/web-search-secret-storage-design.md` 方案 C + M0–M4;无现网代码变更 |

## 二、用例执行

| 用例 | 结果 |
|---|---|
| TC-NI-01 oxlint < 5s exit 0 | **PASS**(~0.8s) |
| TC-NI-02 lint:oxlint | **PASS** |
| TC-NI-03 `@/pages/tasks` 源码零命中 | **PASS** |
| TC-NI-04 ee/pages/tasks jest | **PASS**(6/6) |
| TC-NI-05 type-check | **PASS** |
| TC-NI-06 T4.2 设计章节 | **PASS** |
| TC-NI-07 `/tasks` 真浏览器 | **受限 L-NI-01** |

## 三、交付物

- 依赖/配置:`package.json`(+lock)、`.oxlintrc.json`、`src/custom.d.ts`
- ee:`src/ee/pages/tasks/**`、`src/features/tasks/manifest.ts`
- 文档:T4.2 设计、手册、research/outline/cases/spec;清单 **v7**
- 报告:本文件

## 四、受限注记

| 编号 | 内容 |
|---|---|
| L-NI-01 | `/tasks` 真浏览器冒烟未跑(无本地登录态);以 jest + import 守卫代验 |
| L-NI-02 | oxlint 23 warnings 基线化,未启用 `--deny-warnings`;稳定后再收紧 |
| L-NI-03 | T2.5 仍余 aihub/applications;T4.2 仅设计,M1+ 待 Gateway secrets API |

## 五、遗留建议

1. 下批 ee:aihub(或 applications 若要先小步)
2. Gateway 侧评审 T4.2 方案 C 表结构与 API
3. 可选:分批消化 oxlint warning 后开 `--deny-warnings`

## 六、九步闭环声明

调研 ✅;手册 ✅;检视 ✅;大纲用例 ✅;执行 ✅;Spec(预授权) ✅;修复 ✅;审查构建 ✅(oxlint+jest+type-check);回归 ✅;终检归档 ✅(本报告 + 清单 v7)。受限编号登记,未伪造通过。
