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

## 三、D1 运维手册:生产 RAG 配置 `INTELLECT_TEAM_API_URL`(K8s 精确版)

> **拓扑实测(2026-11-21,dev pod 只读探测)**:生产三服务均为 K8s Deployment,位于 **`intellect` 命名空间**(ClusterIP DNS 可解析):`agentui:80` / `intellect-rag:9380` / `intellect-gateway:9091`(网关 9091 迁移在集群内已生效)。变更走 Deployment env(若 RAG 用 ConfigMap 则改 ConfigMap 后重启),**不是字面 .env 文件**。

| 项 | 内容 |
|---|---|
| 目标 | `intellect` 命名空间的 `intellect-rag` Deployment 配置 `INTELLECT_TEAM_API_URL`,根治"成员令牌请求 RAG 模型管理 API 返回 401" |
| 执行前提 | **`intellect` 命名空间管理权限的 kubeconfig**(实测:dev pod 无 kubectl、无 SA 挂载、无 RBAC——见受限 L-09) |
| 配置值 | `https://ai.wust.edu.cn/intellect-gateway`(intellect-team 网关公网基址;若走集群内网可用 `http://intellect-gateway.intellect.svc.cluster.local:9091`,二选一,以 RAG 可达性为准) |
| 步骤 | ①备份:`kubectl -n intellect get deployment intellect-rag -o yaml > intellect-rag-backup.yaml`;②变更:`kubectl -n intellect set env deployment/intellect-rag INTELLECT_TEAM_API_URL=https://ai.wust.edu.cn/intellect-gateway`;③滚动:`kubectl -n intellect rollout status deployment/intellect-rag`;④验证(下) |
| 验证 | 成员会话下模型页四个 GET 返回 200;BFF 日志无 `[proxy] upstream 401 .../providers`;flag 开/关行为一致 |
| 回滚 | `kubectl -n intellect set env deployment/intellect-rag INTELLECT_TEAM_API_URL-` + `rollout status`,或 `kubectl rollout undo`;恢复"成员令牌 401、诚实透传"现状,无数据风险 |

## 四、生产开启流程(汇总,详单见 p1b-remaining-analysis §5.1)

> **⚠ 步骤 0(2026-11-21 实测新增,当前阻塞)**:生产 agentui BFF 现状 `needsSetup:true / backendCount:0`、**非 enterprise**(缺省/`authMode=intellect-community` 或未绑定企业后端)——**从未完成首装登记**。flag 验收的前提(后端绑定 + ragAdminToken + 企业模式)均不存在。须先完成:生产 BFF 向导登记(intellect-enterprise 后端 + RAG 伴生 + 租户绑定;需要现网网关凭据与管理员会话,见受限 L-02/L-10)。

1. ~~D1 按本手册落地并验证~~ → 待集群权限执行(§三);
2. 生产 BFF 完成向导登记(步骤 0);
3. 生产 BFF env 设 `BFF_MODEL_MGMT_SERVICE_TOKEN=true`(read-write 档):`kubectl -n intellect set env deployment/agentui BFF_MODEL_MGMT_SERVICE_TOKEN=true` + rollout;
4. 验收:四 GET 200、非 admin 写 403、成员模型页可用、flag 开/关对比无 401 差异(D1 生效佐证);
5. 异常回滚:`kubectl -n intellect set env deployment/agentui BFF_MODEL_MGMT_SERVICE_TOKEN-` + rollout。

## 六、受限登记(2026-11-21 执行面实测)

| 编号 | 内容 |
|---|---|
| L-09 | **无集群管理通道**:dev pod(SSH 2225)无 kubectl、无 SA 挂载、无跨 ns RBAC——D1 的 Deployment env 变更与 flag env 变更均无法从现有通道执行;需持有 `intellect` 命名空间权限的 kubeconfig/控制台,或授权 dev pod 的 RBAC |
| L-10 | **生产 agentui BFF 未完成首装登记**(backendCount:0、非 enterprise / 缺省 `authMode=intellect-community`,2026-11-21 实测)——flag 验收前提不存在;需持现网网关凭据走向导登记(凭据不可自动化代输,L-02 同源) |
| L-11 | 生产网关通道验证仅到 ClusterIP 层;集群内 RAG→gateway 9091 连通性待持权者在 D1 执行时一并用 `curl http://intellect-gateway.intellect.svc.cluster.local:9091` 自 pod 内验证 |

## 五、代码侧支撑(本批)

- `BFF_MODEL_MGMT_SERVICE_TOKEN` 三态化:`'true'`→read-write / `'read-only'`→仅读回退档 / 其余→off——**D2 回摆不再需要代码变更**;
- proxy 强制条件适配:read-only 模式仅 GET/HEAD 强制,写请求保持成员令牌(§4.4 门控自然不适用);
- 新增 3 例 read-only 用例(读强制/成员写不门控透传/admin 写亦成员令牌);BFF 全量回归绿。


