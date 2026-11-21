# 模型管理 P1-b 决策简报 — D1/D2/§4.5 收口

> 日期:2026-11-21;批准门:用户指示「实施遗留决策项」;关联:`docs/model-provider-empty-models-fix-design.md` §3、`docs/model-provider-p1b-remaining-analysis.md`(含 §5.1 生产开启检查单)
> 性质:D2/§4.5 **决策记录**(本文件即裁决载体);D1 **运维手册**(生产侧执行,代码仓无法代为落地)。

## 一、D2 决策:服务令牌覆盖范围 → **采纳"读+写"**(设计推荐)

| 项 | 内容 |
|---|---|
| 裁决 | 服务令牌覆盖模型管理路径的**读+写**(读=GET/HEAD;写=其余方法) |
| 依据 | 设计文档推荐;模型配置属租户级共享资源,与实例管理同权限级别自洽;§4.4 写门控(fail-closed)已实施并回归 |
| 生效条件 | 生产 `BFF_MODEL_MGMT_SERVICE_TOKEN=true`(read-write 档) |
| **已知的权限变化** | **GET 也走服务令牌 → 普通成员读范围从"成员可见"升为"租户全量"**(质量评审 #7;开启检查单首项) |
| 回摆路径 | 设 `BFF_MODEL_MGMT_SERVICE_TOKEN=read-only` 即退回"仅读"档(读强制、写走成员令牌、门控不适用),**无需改代码**;完全回滚 = 移除该变量 |
| 状态 | **已采纳**(2026-11-21,依据设计推荐 + 门控/回归就位;生产开启仍按检查单逐项确认) |

## 二、§4.5 确认:默认模型 PATCH 归类 → **随 D2 采纳确认**

`PATCH /models/default`(设默认模型)在 read-write 模式下要求 admin/owner 角色——普通成员在"设置默认模型"下拉选择将得到 403。设计自洽性论证(默认模型为租户级共享配置)随 D2 采纳一并确认;**若业务后续反馈成员需个人默认**,届时将默认模型改为用户级数据(超出本次 BFF 门控表达范围,另行立项),过渡期成员侧可由管理员代设。

## 三、D1 运维手册:生产 RAG 配置 `INTELLECT_TEAM_API_URL`

| 项 | 内容 |
|---|---|
| 目标 | 生产 intellect-rag 部署配置 `INTELLECT_TEAM_API_URL`,根治"成员令牌请求 RAG 模型管理 API 返回 401"(RAG 需经 intellect-team 网关校验成员令牌,缺此配置即无法校验) |
| 执行人 | 有生产部署权限者(代码仓无法代为落地;**待执行**) |
| 配置值 | intellect-team 网关基址(现网为 `https://ai.wust.edu.cn/intellect-gateway`) |
| 步骤 | ①定位生产 RAG 部署的 env(部署清单/compose/k8s manifest);②新增 `INTELLECT_TEAM_API_URL=https://ai.wust.edu.cn/intellect-gateway`;③重启 RAG 服务;④验证(下);⑤回滚预案(下) |
| 验证 | 成员会话下模型页四个 GET(providers 列表/实例/模型目录/默认模型)返回 200;BFF 日志无 `[proxy] upstream 401 .../providers` 类条目;flag 开/关行为一致(检查单 §5.1 第 4 项同源验证) |
| 回滚 | 移除该 env 并重启 RAG——恢复到"成员令牌 401、BFF 诚实透传错误"的现状,无数据风险 |
| 与 BFF 的关系 | 落地后"透传 401"分支在生产自然不再触发;**BFF 侧服务令牌/门控机制保留作为韧性**,不受影响 |

## 四、生产开启流程(汇总,详单见 p1b-remaining-analysis §5.1)

1. D1 按本手册落地并验证;
2. 生产 BFF `.env` 设 `BFF_MODEL_MGMT_SERVICE_TOKEN=true`(read-write 档);
3. 重启 BFF;验收:四 GET 200、非 admin 写 403、成员模型页可用、flag 开/关对比无 401 差异(D1 生效佐证);
4. 异常回滚:变量置空重启即回现状。

## 五、代码侧支撑(本批)

- `BFF_MODEL_MGMT_SERVICE_TOKEN` 三态化:`'true'`→read-write / `'read-only'`→仅读回退档 / 其余→off——**D2 回摆不再需要代码变更**;
- proxy 强制条件适配:read-only 模式仅 GET/HEAD 强制,写请求保持成员令牌(§4.4 门控自然不适用);
- 新增 3 例 read-only 用例(读强制/成员写不门控透传/admin 写亦成员令牌);BFF 全量回归绿。
