# 调研 — 未完成任务链批次(module 族: unfinished-batch-20261122)

> 日期:2026-11-22;九步交付法步骤 1(总览)。用户指令:「调用九步交付技能执行“本地 chat 加载修复提交 → T4.1a → T2.5 第二步 / T2.6 → 生产 D1 + 首装 → T3 / T4.2 / T5”」——视为预授权;按九步「批准后连续执行」条款推进,**整链拆为可独立闭环的 module**,跨仓/运维项编号受限、不伪造通过。

## 一、范围拆分

| Module | 内容 | 本仓可完成? | 依赖 |
|---|---|---|---|
| **chat-session-load** | BFF 404 误判 + 前端加载错误态;提交 | ✅ | 无 |
| **t4-1a-web-search** | `has_web_search_provider` 聚合位 + 存储侧活动 provider 过滤 | ⚠ 部分 | Rust Gateway 仓库;BFF 可先镜像/透传 |
| **t2-ee-oxlint** | T2.5 第二步(ee 迁模块)+ T2.6 oxlint | ✅ | T2.5 第一步已合入 |
| **prod-d1-setup** | D1 `INTELLECT_TEAM_API_URL` + 生产首装 + 开 flag | ❌ 运维 | kubeconfig / 现网凭据(L-09/L-10) |
| **t3-p2** | T3.1–T3.7 体验与架构 | ✅ 可迭代 | T2.5 对 T3.4/T3.6 |
| **t4-2-secrets** | 密钥独立存储设计评估 | 📄 设计 | Phase A/B 数据模型 |
| **t5-go** | Go 化 Phase A–D | ❌ 跨仓长期 | intellect-rag / 上游 Go |

## 二、关键事实(代码核实)

1. 工作树已有 chat-session-load 修复未提交(`bff-agents` 404 判定、`chat/index.tsx` loadError、locales、分析文档)。
2. 分享页已读 `has_web_search_provider ?? has_tavily_key`(`share/index.tsx`);聚合位未由 Gateway/BFF 产出则分享页联网开关仍回落旧字段。
3. T2.7 BFF web-search 校验已落地;T2.4 存储过滤并入 T4.1a。
4. 生产侧:agentui BFF `needsSetup:true`(L-10);D1 手册已出待执行(L-09)。

## 三、执行顺序(与用户指令对齐)

1. chat-session-load 闭环并提交  
2. t4-1a(本仓可做部分 + Gateway 缺口登记)  
3. t2-ee-oxlint  
4. prod-d1-setup(手册复核 + 受限登记;有权限再执行)  
5. t3-p2 → t4-2-secrets → t5-go(设计/立项,不伪造完工)

## 四、门禁口径(各 module 默认)

- 前端:`npm run type-check` 三守卫零错;相关 jest 绿  
- BFF:`vitest` 相关套件绿 + `tsc --noEmit` 零错  
- 不引入新裸色值/未翻译字符串(en/zh)  
- 受限项 `L-*` 编号登记,报告不写「已通过」
