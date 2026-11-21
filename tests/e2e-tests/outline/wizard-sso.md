# 测试大纲 — Wizard SSO/KAG/RAG(module: wizard-sso)

关联手册:`docs/wizard-manual.md`;设计:`docs/wizard-kag-to-sso-design.md` v1.2;调研:`outline/wizard-sso-research.md`。

## 一、范围与基线

- 模块:首装向导(类型选择/连接信息/SSO 区块/探测/确认/完成)。
- 代码域:`bff/src/routes/wizard.ts(+types/test)`、`src/pages/wizard/*`、`src/services/wizard-service.ts`、`src/services/harness-admin-service.ts`、`src/utils/api.ts`、i18n(zh/en)。
- 环境:本地 dev(BFF 9390 / Vite 9391 / mock-upstream 9399);无真实 IdP。
- 隔离:破坏性用例(setup)前备份 `bff/data/{harness-backends,bff-tenants,token-vault}.json`,用例后停 BFF 恢复再启动(R3);用例数据统一 `e2e-` 前缀(R5)。

## 二、五轴覆盖矩阵

| 轴 | 覆盖用例 |
|---|---|
| 正常 | TC-01 类型选择;TC-03 SSO 渠道拉取;TC-04 全流程至 envSnippet |
| 边界 | TC-02 租户 ID 空/32hex/非法;TC-03 secret 重新生成/刷新丢失;TC-04 白名单空=不过滤 |
| 错误 | TC-02 RAG 字段不存在;TC-03 渠道拉取失败/http 警告;TC-04 探测失败重试/限流/kag 400 |
| 联动 | TC-04 setup 后租户绑定与管理端可见;TC-05 L2 契约矩阵(鉴权/SSRF/警告) |
| 直达入口 | TC-01 `?mode=add` 直达;TC-04 直达 step=5/6 回退逻辑 |

## 三、执行方式

| 层 | 方式 | 说明 |
|---|---|---|
| L1 UI | 浏览器自动化(真实 UI,9391) | 向导全流程走查 + 截图;SSO 登录闭环除外(无 IdP,受限) |
| L2 单测/API | bff `vitest` + 前端 `jest` | 路由分支/鉴权/契约;protocolFamily |
| L3 回归 | BFF 全量 vitest + 前端 type-check/jest/build + 登录页冒烟 | 保证既有登录/管理端不回归 |

## 四、手册 ↔ 代码双向检视差异清单(步骤 3)

| # | 手册口径 | 代码现状 | 处置 |
|---|---|---|---|
| X-01 | §2 仅 4 类后端 | 选项表含 kag(5 项) | P1 移除 |
| X-02 | §2 KAG 不出现 | 探测/创建对未知 type 未拦截(kag 仍可经 API 探测成功) | P1 probe `!option→400` |
| X-03 | §3.2 RAG 不在向导 | enterprise 强制 ragEndpoint/ragApiKey + 伴生创建 | P3 移除 |
| X-04 | §6 完成页有非阻断提示 | `warnings` 字段存在但前端不展示 | P3 Done 页展示 |
| X-05 | §3.3 SSO 区块 | 不存在 | P2 新增(区块+端点+setup 扩展) |
| X-06 | §3.3 渠道配置不完整标注原因 | 现状无此端点 | P2(响应含 misconfigured,字段裁剪) |
| X-07 | §3.3 http:// 警告 | 无 | P2 UI 警告(不阻断) |
| X-08 | §5 SSO 摘要/envSnippet 追加 | 无 | P2 |
| X-09 | §8 白名单未知渠道→警告 | 无 | P2 setup 降级 warnings |
| X-10 | §3.1 sso 仅企业版生效 | 无 | P2 非 enterprise 携带 sso→400 |
| X-11 | (内部)kag 协议族标注 | 前端映射 openai-compatible,实为 mcp-protocol | P1 修复(D6) |
| — | §4 探测/限流、§5 重复 409、§7 管理端补配 | 代码已有且一致 | 无需修改,回归保障 |

## 五、R6 受限声明(预登记)

- L-01:本机无 IdP,SSO「点渠道→IdP→回调→落首页」闭环无法真实执行;以 BFF 单测(mock exchange)+ 既有 bff-sso-p2 交付回归替代。
- L-02:真网关 `https://ai.wust.edu.cn/intellect-gateway` 可达性依网络环境;E2E 统一以 mock-upstream(9399)为探测/渠道数据源,不依赖外网。
- L-03:probe 限流(10 次/分/IP)对连续 UI 重试是真实约束;连续触发用例之间需等待窗口或以单测覆盖 429 分支,UI 侧只做一次触达验证。
- L-04:setup 会改写租户 `0` 绑定与 token-vault → 恢复流程为「停 BFF → 还原 3 个 json → 启 BFF → 健康验证」;恢复后再次确认管理端列表与登录页正常(回归证据)。

## 六、退出条件

- L2 全部通过;L1 用例全部通过(受限项除外);L3 全量回归无新增失败;
- 每个差异 X-0x 有实施与验收证据;受限项在报告专节登记;
- 三方一致(手册↔用例↔实测)复核通过。
