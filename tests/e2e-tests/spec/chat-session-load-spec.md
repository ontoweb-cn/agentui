# Spec — Chat 会话加载修复(module: chat-session-load)

> 日期:2026-11-22;批准门:见 [unfinished-batch-20261122-spec.md](./unfinished-batch-20261122-spec.md) Module 1。

## 范围

实施 R1(BFF)+ R3(前端)+ i18n;提交。不实施 R2(Gateway)、R4(双 toast 基建)。

## 门禁

1. `cd bff && npx vitest run src/routes/bff-agents.test.ts` 全绿(含 TC-CSL-01)  
2. `npm run type-check` 零错  
3. 报告 `REPORT-chat-session-load-20261122.md`

## 受限

- L-CSL-01:Gateway detail/messages 500  
- L-CSL-02:双 toast(无 skipErrorHandler)  
- L-CSL-03:列表脏 session  
- L-CSL-04:不存在应 404 非 500(后端契约)
