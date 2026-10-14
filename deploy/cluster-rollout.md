# 集群交付方案与执行手册 — Jenkins + k8s(华为集群)

> **Status**: 方案定稿(2026-10-14),由**持有集群/Jenkins 权限的执行机**按本手册执行;
> 仓库侧预备已完成(Jenkinsfile、nginx 全 URL 上游、manifest 网关化 env)。
> **凭据纪律**:Jenkins 管理员账密与 Harbor robot 密钥由用户线下交付执行机,
> **本文与仓库不含任何密钥**。
> 关联:[ci-jenkins.md](./ci-jenkins.md)(Jenkins 概览)、[k8s/README.md](./k8s/README.md)(镜像/Secret 前置)、
> [runtime-plugin-architecture.md](../docs/runtime-plugin-architecture.md) §六 近期 #2/#4。

## §0 前提与假设(执行前先核验)

### 0.1 网络前提

| 通道 | 要求 | 核验命令(执行机/Jenkins agent) |
|---|---|---|
| 集群 Pod → ai.wust.edu.cn:443 | egress 放行(三后端全走公网网关) | 见 §2.3 |
| Jenkins agent → gitee.com | git 拉取(Pipeline from SCM) | `git ls-remote https://gitee.com/wustbd/agentui.git dev` |
| Jenkins agent → hub.wust.edu.cn | docker push(仅发版) | 发版首跑即验证 |
| 用户浏览器 → 暴露地址 | 部署完成后可达 | §2.5 |

### 0.2 wargame 网关路径假设(**本方案的关键假设**)

wargamesrv 网关化到 `ai.wust.edu.cn/wargame`,假设**网关剥离 `/wargame` 前缀**:
`https://ai.wust.edu.cn/wargame/api/v1/models` → wargamesrv `/api/v1/models`。
BFF 两条通道都基于此前提:

- nginx REST 通道:`WARGAME_UPSTREAM=https://ai.wust.edu.cn/wargame/`
  (前缀改写:`/api/v1/wargame/x` → 上游 `/wargame/x`);
- BFF 插件代理:`BFF_PLUGIN_BACKEND_OVERRIDES=cognitive-wargame=https://ai.wust.edu.cn/wargame`
  (target 路径 + 透传 rest)。

**预检**(不符则回 §3 风险表处置):

```bash
# 用确证存在的端点 /api/v1/scenarios(/v1/models 是探活端点,
# /api/v1/models 不保证存在——404 会无法区分「前缀错」与「端点不存在」)
# 期望 401/403(wargamesrv 自身鉴权拦截)= 前缀通;404 = 前缀不符或未剥除
curl -s -o /dev/null -w '%{http_code}\n' https://ai.wust.edu.cn/wargame/api/v1/scenarios
```

**SSE 缓冲**:网关 `/wargame` location 必须等价 `proxy_buffering off`(否则插件
事件流被缓冲、推演页无实时事件)——这是 wargame 网关部署方的配置责任,验收时
用带 token 的 events 流看首字节延迟(§2.7 步骤 3)。

### 0.3 已就绪清单

- 镜像 `hub.wust.edu.cn/intellect/agentui:0.4.0` 已在 Harbor;
- Harbor robot 双账号(`agentui-pull` 仅拉 / `agentui-release` 推,365 天轮换),
  env 文件在发版机 `~/.config/agentui/harbor-robots/`(用户名含 `$` **必须单引号**);
- 两仓 Jenkinsfile 就绪(agentui 参数化发版含参数白名单防注入);
- nginx 模板支持全 URL 上游(`WARGAME_UPSTREAM`/`RAG_API_UPSTREAM`/`RAG_ADMIN_UPSTREAM`,
  默认值严格保持原 host:port 行为——本机已模拟渲染验证);
- **网关上游 Host 头已固化**(`nginx/proxy-gateway.conf`:`Host $proxy_host` +
  SNI + TLSv1.2/1.3,评审 P1)——proxy.conf 的 `Host $host` 会把入站地址
  (NodePort)透传给按 vhost 路由的网关导致三通道 404,网关化三 location 已切换;
- k8s manifest 已按网关化拓扑更新 env。

---

## §1 Jenkins 接入(预计 30–60 分钟)

### 1.1 登录

浏览器打开 `http://10.99.24.15:32080/`,用线下提供的管理员账密登录。

### 1.2 Agent 环境核验(一次性核验 job)

New Item → Pipeline → **Pipeline script**(非 SCM)→ 粘贴:

```groovy
pipeline {
  agent any
  stages {
    stage('env-check') {
      steps {
        sh 'node --version'   // 期望 v20+
        sh 'docker version'   // 期望 client+server 均可
        sh 'git ls-remote https://gitee.com/wustbd/agentui.git dev | head -1'
        sh 'curl -sI https://hub.wust.edu.cn -o /dev/null -w "%{http_code}\n"'
      }
    }
  }
}
```

Build Now。**处置**:node 缺失→安装或指定带 node 的 agent 标签(两个主任务的
agent 标签要一致);docker 权限→agent 用户入 docker 组;gitee 不通→出网代理
或内网镜像(阻塞项,回报用户);hub 不通同理。

核验通过后**删除该临时 job**。

### 1.3 Harbor 推送凭据

Manage Jenkins → Credentials → System → Global credentials → Add:

- Kind:**Username with password**
- ID:**`harbor-agentui-release`**(Jenkinsfile 硬引用,不可改)
- Username:`robot$intellect+agentui-release`(原样含 `$`)
- Password:发版机 `~/.config/agentui/harbor-robots/agentui-release.env` 的
  `HARBOR_SECRET`(从该机取值,勿经聊天工具明文传递)

### 1.4 建两个任务

| 项 | agentui-ci | wargame-ci |
|---|---|---|
| New Item | Pipeline | Pipeline |
| Definition | Pipeline script from SCM | 同左 |
| SCM | Git | Git |
| URL | `https://gitee.com/wustbd/agentui.git` | `https://gitee.com/wustbd/cognitive-wargame.git` |
| Branch | `*/dev` | `*/main` |
| Script Path | `Jenkinsfile` | `Jenkinsfile` |

勾选「参数化构建」无需手工配置——参数(RELEASE/IMAGE_TAG/PLUGIN_REPO/PLUGIN_REF)
由 Jenkinsfile 定义,保存后首次 Build 会按定义出现。

### 1.5 首跑验证(三步递进)

> 注意:Jenkins Pipeline 参数在**首次构建完成后**才会出现在「Build with
> Parameters」表单——第 1 步只有普通 Build Now 属正常,跑完后再做第 2/3 步。

1. **纯验证**:agentui-ci → Build Now(此时无参数表单,默认仅验证)→ 期望:
   tsc×2 + jest + vitest 全绿;
2. **纯宿主试发**:RELEASE ✓,`IMAGE_TAG=0.4.1`,PLUGIN_REF 留空 → 期望:Harbor
   出现 `intellect/agentui:0.4.1`(无插件,应用页为空——符合预期);
3. **完整发版**:RELEASE ✓,`IMAGE_TAG=0.4.1`,PLUGIN_REF=`<wargame 仓 commit>`
   (正式发版 pin commit,如 `998c6af`)→ 期望:镜像含插件 bundle,
   `scripts/package-plugin-bundle.sh` 拉取构建成功。

### 1.6 触发(可选,可后置)

手动 Build Now 起步;自动化二选一:轮询(`H/50 * * * *`)或 Gitee 插件 +
webhook 推送到 `<jenkins>/gitee-project/<job>`(需管理员装插件)。

### 1.7 故障排查

| 症状 | 处置 |
|---|---|
| clone gitee 超时 | agent 出网不通(§1.2 已核验项),需代理/镜像 |
| `docker push` 401 | 凭据 `$` 未原样录入 / robot 失效(发版机重取 env) |
| `docker: permission denied` | agent 用户入 docker 组 |
| jest/vitest OOM | agent 内存不足,`NODE_OPTIONS=--max-old-space-size` 或换大 agent |

---

## §2 k8s 部署(预计 30 分钟 + 两项决策)

### 2.1 kubeconfig

执行机配置集群 kubeconfig(用户提供)→ `kubectl cluster-info` 核验。

### 2.2 namespace 与 Secrets

```bash
kubectl create namespace agentui   # 或用既有 ns,下同替换

# 插件安装 token(强随机)
kubectl -n agentui create secret generic agentui-plugin-admin \
  --from-literal=token="$(openssl rand -hex 32)"

# Harbor 拉取凭证(项目私有时必须;robot env 取自发版机)
source ~/.config/agentui/harbor-robots/agentui-pull.env
kubectl -n agentui create secret docker-registry agentui-pull-secret \
  --docker-server=hub.wust.edu.cn \
  --docker-username="$HARBOR_USER" --docker-password="$HARBOR_SECRET"
# 并在 agentui.yaml 取消 imagePullSecrets 注释
```

### 2.3 集群 egress 核验(§0.1 的集群内侧验证)

```bash
# 用 agentui 镜像自身(busybox wget)——勿用 docker.io 的 curlimages/curl:
# 若 egress 仅放行 ai.wust.edu.cn,核验 pod 会因镜像拉取失败而误判(评审 P2);
# 顺带验证 Harbor 拉取凭证。项目私有时需在已配 pull secret 的 sa 下运行。
kubectl -n agentui run net-check --rm --restart=Never \
  --image=hub.wust.edu.cn/intellect/agentui:0.4.0 --command -- \
  sh -c 'for u in https://ai.wust.edu.cn/intellect-kb/ https://ai.wust.edu.cn/wargame/api/v1/scenarios; do
           echo "$u => $(wget -q -S -O /dev/null -T 8 "$u" 2>&1 | grep -m1 HTTP)";
         done'
```

期望:kb 任意 HTTP 状态码(非超时/000)= 443 可达;wargame 为 **HTTP/1.1 401/403**
(前缀通);超时/无输出 = egress 未放行,先解决再继续。

### 2.4 部署

```bash
kubectl -n agentui apply -f deploy/k8s/agentui.yaml
kubectl -n agentui rollout status deployment/agentui
kubectl -n agentui logs deploy/agentui | grep -E '插件|plugin|nginx'   # 看 entrypoint 安装日志
```

manifest 已按网关化拓扑预设:`RAG_API_UPSTREAM`/`RAG_ADMIN_UPSTREAM`=
`https://ai.wust.edu.cn/intellect-kb`,`WARGAME_UPSTREAM`=
`https://ai.wust.edu.cn/wargame/`,`BFF_PLUGIN_BACKEND_OVERRIDES`=
`cognitive-wargame=https://ai.wust.edu.cn/wargame`。

### 2.5 暴露(二选一,依集群实际)

```bash
# 选项 A:NodePort(最快)
kubectl -n agentui patch svc agentui -p '{"spec":{"type":"NodePort"}}'
kubectl -n agentui get svc agentui -o jsonpath='{.spec.ports[0].nodePort}'

# 选项 B:Ingress(需集群有 controller 与域名 TLS,示例)
# kubectl -n agentui apply -f - <<'EOF'
# apiVersion: networking.k8s.io/v1
# kind: Ingress
# metadata:
#   name: agentui
# spec:
#   rules:
#     - host: <待定域名>
#       http:
#         paths:
#           - path: /
#             pathType: Prefix
#             backend: { service: { name: agentui, port: { number: 80 } } }
# EOF
```

### 2.6 首次初始化(重要)

镜像内 `bff/data` 为空(data 不入库):企业模式需浏览器打开暴露地址 →
`/admin/wizard` 走首次安装向导(enterprise 后端 endpoint=
`https://ai.wust.edu.cn/intellect-gateway`,token 向管理方取)。
**注意**:向导数据写在容器临时盘,Pod 重建需重跑——是否加 PVC 持久化是
遗留决策项(§3)。

### 2.7 验收清单

| # | 项 | 通过标准 |
|---|---|---|
| 1 | Pod ready | rollout status 成功;readiness(`/api/bff/plugins`)过 |
| 2 | 登录 | 企业账号登录成功(会话校验经 gateway) |
| 3 | 插件 | 应用页出现 cognitive-wargame 卡片;场景列表可加载(REST 通道) |
| 4 | **SSE** | 打开一场推演,事件流实时推进(验证网关 `/wargame` 未缓冲——§0.2) |
| 5 | chat | 发送一条消息,流式回答正常(gateway 通道) |
| 6 | 停用断路 | `kubectl exec` 内 curl disable 后列表/卡片消失 |

### 2.8 回滚

```bash
kubectl -n agentui delete -f deploy/k8s/agentui.yaml   # 完全移除
# 或回退镜像: kubectl -n agentui set image deploy/agentui agentui=hub.wust.edu.cn/intellect/agentui:0.4.0
```

Jenkins 侧回滚 = 任务 Disable(不删,保留历史)。

---

## §3 未决与风险

| # | 项 | 影响 | 处置 |
|---|---|---|---|
| 1 | `/wargame` 剥前缀假设(§0.2) | 不成立则 REST/代理双通道 404 | 预检确认;不符则网关加剥除,或 wargame 侧按 /wargame 前缀挂载 |
| 2 | 网关 `/wargame` SSE 缓冲 | 推演无实时事件 | 网关 location 加 `proxy_buffering off`(wargame 部署方) |
| 3 | `RAG_ADMIN_UPSTREAM` 经公网网关的可达性 | 仅影响裸 /api/v1/admin 直调通道(向导/管理走 BFF 服务端,不受影响) | 预检 404 则该通道仅历史兼容,可接受 |
| 4 | data 临时盘(wizard/plugin-state/审计随 Pod 重建丢失) | 重建后需重跑向导;停用状态复位 | 决策:加 PVC(manifest 需扩展)或接受临时盘 |
| 5 | robot 密钥交付方式 | Jenkins 凭据录入 | 管理员上发版机取,或密钥管理通道;勿聊天明文 |
| 6 | 上游 DNS 在 nginx 启动时静态解析并缓存(评审 P3) | `ai.wust.edu.cn` 解析失败 → nginx 起不来(Pod crash-loop);DNS 变更需重启 Pod 生效 | §2.3 预检即覆盖启动期解析;DNS 变更后 `kubectl rollout restart deploy/agentui` |

## §4 完成定义(DoD)

1. §1.5 三步全绿,`agentui:0.4.1`(含插件)在 Harbor;
2. §2.7 验收 6 项全过;
3. 本文件追加「执行记录」节(日期/执行人/暴露地址/镜像 tag/遗留项)。
