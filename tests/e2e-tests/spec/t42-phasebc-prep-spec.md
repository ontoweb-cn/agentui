# Spec — t42-phasebc-prep(批准门)

> 用户指令「按九步交付技能,实施上面的1-3」= 预授权本 spec 范围。批准后连续执行至步骤9。

## 缺陷/工作项

| ID | 内容 | 处置 |
|---|---|---|
| W1 | 无 Gateway secrets → 无法 M1/M2 接线 | 交付契约草案;登记 **L-T42-01**;不 prune |
| W2 | D1 无集群权限 | 复证 **L-09/L-10**;改交付 Phase B/C 准备文档 |
| W3 | 清单 v8 漂移 | 升 **v9** 对齐 `642d643`+本批 |

## 修复方案(取舍)

1. **做**:契约 + Phase B/C prep + v9 + 九步报告。
2. **不做**:PATCH sanitize、生产 kubectl、画布 SSE 改码(无 Go 联调环境)。

## 归档

- 手册 `docs/t42-phasebc-prep-manual.md`
- 报告 `tests/e2e-tests/reports/REPORT-t42-phasebc-prep-20261123.md`
