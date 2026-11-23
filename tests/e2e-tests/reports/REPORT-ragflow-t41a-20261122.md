# 九步交付报告 — T4.1a Gateway/BFF 联网搜索聚合(module: ragflow-t41a)

> 日期:2026-11-22;方法:九步交付法;spec:`tests/e2e-tests/spec/ragflow-t41a-spec.md`
> 基线:`dev` @ `d208f4b` + 本批未提交改动;用户预授权「按推荐顺序开发」

## 一、结论摘要

| 交付项 | 状态 | 验收证据 |
|---|---|---|
| ① prompt_config 透传复核 | **完成** | PATCH 多 key 共存用例:整包透传、写侧不 prune |
| ② `has_web_search_provider` 聚合 | **完成** | `GET .../external-info` + 前端 chat 分享改打 BFF;`web-search-capability` 纯函数 |
| ③ T2.7 校验 | **回归绿** | 既有 T2.7 describe 全通 |
| ④ 写侧按活动 provider 过滤 | **延期 T4.2** | 与 T2.4「换回不丢 key」冲突;响应侧永不回传 key 已保证 |
| GET metadata 透传 | **完成** | enterprise `normalizeSession` → `metadata.prompt_config`/`kb_ids` |

## 二、用例执行结果

| 用例 | 层级 | 结果 |
|---|---|---|
| TC-T41A-01 聚合纯函数 | vitest | **PASS** |
| TC-T41A-02/05 无 key 泄漏 | vitest | **PASS** |
| TC-T41A-03 Gateway enrich | vitest | **PASS** |
| TC-T41A-04 无 PC → flags false | vitest | **PASS** |
| TC-T41A-06 metadata 透传 | vitest | **PASS** |
| TC-T41A-07/08 T2.7 + 多 key 透传 | vitest | **PASS** |
| TC-T41A-10 真浏览器嵌入 | E2E | **受限 L-T41A-01** |

## 三、交付物清单

- 代码:`bff/src/utils/web-search-capability.ts(+test)`、`bff-agents.ts` external-info、`intellect-enterprise-adapter.ts` normalizeSession、`gateway-chat-service.ts`、`use-chat-request.ts`、`api.ts`
- 文档:research/outline/cases/spec/manual;`docs/ragflow-ui-alignment-followup-tasks.md` 升 v6
- 门禁:BFF vitest **1201/1201**;BFF tsc 0 错;前端 type-check 三守卫绿

## 四、受限注记专节

| 编号 | 内容 |
|---|---|
| L-T41A-01 | 真浏览器分享页走查未执行(需登录态+嵌入会话+已配非 Tavily provider);以路由/纯函数证据代验 |
| L-T41A-02 | agent 分享仍走 RAG `chatbots/{id}/info`(无 `has_web_search_provider`);本批仅 chat/Gateway 路径 |
| L-T41A-03 | ④ 写侧 prune 延期 T4.2;短期切换服务商 Key 仍保留(手册 §2.2) |

## 五、遗留建议(不阻塞)

1. 下个迭代:**T2.6 oxlint**、**T2.5 第二步**
2. **T4.2** 密钥独立存储时落地写侧过滤
3. 环境就绪后补 TC-T41A-10

## 六、九步闭环声明

调研 ✅;手册 ✅;双向检视 ✅;大纲用例 ✅;执行 ✅;Spec(预授权) ✅;修复 ✅;审查构建 ✅(tsc+vitest+type-check);回归 ✅(1201);终检归档 ✅(本报告 + 清单 v6)。受限项编号登记,未伪造通过。
