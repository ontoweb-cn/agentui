# Cognitive-Wargame 前端插件 TODO

> 来源：SSE 事件类型不一致修复（方案 A），2026-08-10 实施。
> 详见 cognitive-wargame/docs/gateway-cognitive-interfaces.md §D.3.5a 修复清单。
> 类型声明已在 use-sse-events.ts 就位，以下为待补的消费逻辑。

## 已实施（2026-08-10 评审修复）

- [x] R1：运行时事件类型校验（use-sse-events.ts 新增 VALID_EVENT_TYPES 集合 + `__unknown__` 兜底）
- [x] R2：提取 raw.payload 为局部变量复用（use-sse-events.ts）
- [x] R3：拆分 scenario.canceled / cancel_requested 的 case（RoundViewPage.tsx，canceled 清 taskId，cancel_requested 保留）
- [x] R4：scenario.round.started 消费（RoundViewPage.tsx，更新 currentRound）
- [x] D1：文档类别 3 计数表述修正
- [x] D2：文档 F25 timestamp 字段类型说明补充

## 待补：F13-F22 事件消费逻辑

### F13 `agent.acted.batch` — 批量 agent 行为流
- [ ] 在 RoundViewPage 或新组件中消费 `agent.acted.batch` 事件
- [ ] payload 结构：`{scenario_id, round_num, narrative_id, profile, agents:[...], count, total_processed, sampled}`
- [ ] 与现有 `agent.acted`（单个）互补，用于推演过程的批量行为展示
- 后端发布位置：cognitive-wargame/src/cognitive_wargame/agents/scenario_executor.py:753

### F14 `strategy.adapted` — 自适应策略调整
- [ ] 在 RoundViewPage 或新组件中消费 `strategy.adapted` 事件
- [ ] payload 结构：`{round_num, advice}`
- [ ] 展示策略调整提示
- 后端发布位置：scenario_executor.py:486

### F15 `strategy.multi.started` — 多策略并行启动
- [ ] 在多策略面板（待建）中消费
- [ ] payload 结构：`{parent_scenario_id, variant_count}`
- 后端发布位置：wargamesrv/apps/restful_apis/strategy_api.py:88

### F16 `strategy.variant.started` — 单变体开始
- [ ] 在多策略面板中消费，更新变体状态为"运行中"
- [ ] payload 结构：`{parent_scenario_id, child_id, variant_name, variant_index}`
- 后端发布位置：strategy_api.py:117

### F17 `strategy.variant.completed` — 单变体完成
- [ ] 在多策略面板中消费，更新变体状态为"已完成" + 展示 metrics
- [ ] payload 结构：`{child_id, variant_name, metrics, rounds_executed}`
- 后端发布位置：strategy_api.py:142

### F18 `strategy.variant.failed` — 单变体失败
- [ ] 在多策略面板中消费，更新变体状态为"失败" + 展示 error_type
- [ ] payload 结构：`{child_id, variant_name, error_type}`
- 后端发布位置：strategy_api.py:104

### F19 `strategy.multi.completed` — 多策略聚合完成
- [ ] 在多策略面板中消费，展示聚合结果
- [ ] payload 结构：aggregated dict
- 后端发布位置：strategy_api.py:195

### F20 `report.started` — 报告任务启动
- [ ] 在 ReportViewPage 中消费，与 useAsyncReport 的 2s 轮询互补
- [ ] payload 结构：`{task_type, scenario_id, ...}`
- [ ] 可用于减少无效轮询：收到 started 后再开始轮询
- 后端发布位置：wargamesrv/apps/restful_apis/report_api.py:183, 226

### F21 `report.completed` — 报告任务完成
- [ ] 在 ReportViewPage 中消费，停止轮询并直接获取结果
- [ ] payload 结构：`{task_type, scenario_id, report_path, ...}`
- [ ] 可消除 2s 轮询的最后一跳延迟
- 后端发布位置：report_api.py:206, 251

### F22 `report.failed` — 报告任务失败
- [ ] 在 ReportViewPage 中消费，停止轮询并展示错误
- [ ] payload 结构：`{task_type, scenario_id, error}`
- 后端发布位置：report_api.py:212, 257

## 待补：scenario.cancel_requested UI 提示

R3 修复后，`scenario.cancel_requested` 事件已不清 `currentTaskId`（任务仍在运行），但当前仅入 liveEvents 流，无显式 UI 提示。

- [ ] 在 RoundViewPage 中消费 `scenario.cancel_requested` 事件，显示"取消请求已提交，等待任务到达检查点"提示
- [ ] 可选：新增 `cancelRequested: boolean` store 状态，由 `scenario.cancel_requested` 置 true，`scenario.canceled` 置 false
- payload 结构：`{task_id}`

## 优化：report.* 事件与 useAsyncReport 轮询互补

当前 ReportViewPage 的 useAsyncReport Hook 每 2s 轮询任务状态（POLL_INTERVAL=2000）。
F20-F22 实现后可优化为事件驱动：

- [ ] 收到 `report.started` → 开始轮询（或降低轮询频率至 5s）
- [ ] 收到 `report.completed` → 停止轮询 + 立即 fetchResult
- [ ] 收到 `report.failed` → 停止轮询 + 展示错误
- [ ] 保留轮询作为兜底（防 SSE 断连）

## 关联文件

- 类型定义：hooks/use-sse-events.ts
- 消费入口：pages/RoundViewPage.tsx、pages/ReportViewPage.tsx
- store actions：store.ts
- API 定义：api.ts
- 后端文档：cognitive-wargame/docs/gateway-cognitive-interfaces.md §D.3.5

## 待补：CW_AUTH_BYPASS_LAN 同局域网免 token 方案

> 来源：cognitive-wargame `wargamesrv/auth.py` + `config.py`，2026-08-10 实施
> 详见 cognitive-wargame/docs/gateway-cognitive-interfaces.md §D.3.2

### 背景

cognitive-wargame 新增 `CW_AUTH_BYPASS_LAN` 环境变量，启用后来自可信局域网网段的请求跳过所有 API TOKEN 校验（REST + SSE + 异步任务）。适用于 AgentUI 与 Cognitive-Wargame 位于同一局域网（同网关）的内网部署场景。

| 配置项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| 启用开关 | `CW_AUTH_BYPASS_LAN` | `0`（关闭） | `1` 启用同局域网 bypass |
| 可信网段 | `CW_TRUSTED_LAN_CIDRS` | `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128` | 逗号分隔 CIDR |

### 前端兼容性确认（无需改动代码）

现有前端代码已兼容免 token 场景：

- **REST API**（`api.ts:36-42`）：`localStorage.getItem(Authorization)` 为空时不设 `Authorization` header → 后端 bypass 放行 ✅
- **SSE 连接**（`api.ts:559-565`）：token 为空时不添加 `?token=` query 参数 → 后端 bypass 放行 ✅

### 待办事项

- [ ] **部署文档**：在 AgentUI 部署文档中补充“内网部署免 token”说明——后端设置 `CW_AUTH_BYPASS_LAN=1`，AgentUI 无需配置 token（localStorage 留空）
- [x] **401 提示优化**：`api.ts` 401 拦截器已改用 `i18n.t('cognitiveWargame.errors.auth401')`，中英文词条已就位（2026-08-11）
- [x] **登录页适配**（可选）：内网部署免 token 场景下，登录页可显示“内网模式（免认证）”标识，避免用户困惑
- [x] **SSE 错误提示优化**：`use-sse-events.ts` 致命错误与重连提示已改用 `i18n.t('cognitiveWargame.errors.sseAuthRejected' / 'sseReconnecting')`，中英文词条已就位（2026-08-11）

### 安全约束

- `CW_AUTH_BYPASS_LAN=1` 时，来自可信网段的请求**跳过所有 token 校验**（包括 REST API）
- 公网部署**禁止启用**此选项
- 仅适用于内网部署/开发环境
