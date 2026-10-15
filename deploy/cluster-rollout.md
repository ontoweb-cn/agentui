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

勾选「参数化构建」无需手工配置——参数(RELEASE/IMAGE_TAG/PLUGIN_BUNDLE_IMAGE)
由 Jenkinsfile 定义,保存后首次 Build 会按定义出现。

### 1.5 首跑验证(三步递进)

> 注意:Jenkins Pipeline 参数在**首次构建完成后**才会出现在「Build with
> Parameters」表单——第 1 步只有普通 Build Now 属正常,跑完后再做第 2/3 步。

1. **纯验证**:agentui-ci → Build Now(此时无参数表单,默认仅验证)→ 期望:
   tsc×2 + jest + vitest 全绿;
2. **纯宿主试发**:RELEASE ✓,`IMAGE_TAG=0.4.1`,PLUGIN_BUNDLE_IMAGE 留空 →
   期望:Harbor 出现 `intellect/agentui:0.4.1`(无插件,应用页为空——符合预期);
3. **完整发版**:先在 cognitive-wargame 仓触发发版得 bundle 镜像
   (2026-10-15 起 wargame CI/CD 归其仓),再 RELEASE ✓,`IMAGE_TAG=0.4.1`,
   `PLUGIN_BUNDLE_IMAGE=hub.wust.edu.cn/intellect/wargame-plugin-bundle:<ref>`
   → 期望:镜像含插件 bundle(拉取解包成功)。

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

---

## §5 执行记录(2026-10-14,首次落地)

> 执行机:Simon 的 Mac(arm64,docker+skopeo);集群操作经 Jenkins
> (http://10.99.24.15:32080/)脚本控制台/FreeStyle job + 其 Pod 内
> ServiceAccount(jenkins ns,全集群工作负载 CRUD、无 ns/Ingress 权限)。
> **拓扑变化(相对 §0-§2 的原方案)**:wargamesrv 部署进集群(intellect ns),
> agentui 双通道改走集群内 Service——公网网关只剩「浏览器直连 /wargame」
> 一个待办(见 §5.4)。

### 5.1 集群侧落成物

| 对象 | 值 |
|---|---|
| namespace | `intellect`(复用现有;SA 无建 ns 权限) |
| Deployment `wargamesrv` | 镜像 `hub.wust.edu.cn/intellect/wargamesrv:0d8b07d-k8s1`(cognitive-wargame@0d8b07d + intellect-team@ea4b9481 烤入 /intellect-team;本地 docker build,阿里 pypi 源,skopeo 推送) |
| Service `wargamesrv` | ClusterIP + NodePort **31385**;env 要点:`AGENT_LOOP_BACKEND=intellect`、PG=`postgres:5432/intellect` schema `wargame`(复用 intellect-postgres)、Redis=`rag-redis` db5(密码取 `intellect-rag-secrets`)、`GATEWAY_URL=http://intellect-gateway-py:8642` |
| Secret `wargame-auth` | `WARGAMESRV_API_TOKEN`(64hex,推演用户在插件 UI 填写的 token) |
| Deployment `agentui` | 镜像 `intellect/agentui:0.4.0`(**已含** cognitive-wargame bundle,entrypoint 幂安装验证通过) |
| Service `agentui` | NodePort **31390** |
| Secret `agentui-plugin-admin` / `agentui-pull-secret` | 插件安装 token / Harbor 拉取凭证(robot$intellect+agentui-pull) |

**踩坑记录**(复现必读):

1. `harbor-regcred`(集群原有)拉不了新建的 `wargamesrv`/`agentui` 仓 → 补
   `agentui-pull-secret`(发版机 robot)并加进两 Deployment 的 imagePullSecrets;
2. Service 名 `wargamesrv` 触发 k8s 自动注入 `WARGAMESRV_PORT=tcp://…` 覆盖
   应用同名 env → Pod env 显式声明 `WARGAMESRV_PORT=9385` 压回;
3. **0.4.0 镜像内 nginx 模板仍是 host:port 形式**(网关化全 URL 上游是 0.4.0
   发版后才合入 dev 的,未进该镜像)→ 实际生效 env 是
   `WARGAME_HOST=wargamesrv`+`WARGAME_PORT=9385`(而非 `WARGAME_UPSTREAM`);
   RAG 同理走 `INTELLECT_RAG_HOST=intellect-rag` 集群内直连。
   ≥0.4.1 镜像(由 dev 分支构建)才支持 manifest 里的 `*_UPSTREAM` 全 URL 形式;
4. Jenkins 容器与宿主 docker 的 /tmp、workspace 路径不互通 → CI 用
   `tar -C "$WORKSPACE" -cf - . | docker run --rm -i` 流式传入(同 intellect 组
   现有 job 模式)。

### 5.2 验证结果(2026-10-14)

- wargamesrv:pod Ready;healthz 200(`redis:ok`、auth token 模式);
  启动日志 `storage=pg agent_loop=intellect`、`wargame schema 初始化完成`;
- REST 通道:`http://10.99.24.15:31390/api/v1/wargame/system/healthz` → 200
  (经 agentui nginx → wargamesrv);`/api/v1/wargame/scenarios` 无 token 401 /
  带 token `{"status":"ok","count":0}`(新库空列表,符合预期);
- 插件:`/api/bff/plugins` 200 返回 cognitive-wargame 0.1.0,
  `backendTargetOverride=http://wargamesrv:9385` 生效;
- 访问入口(内网):agentui **http://10.99.24.15:31390/**,
  wargamesrv 直连 http://10.99.24.15:31385/;
- 待人工:浏览器登录向导(`/admin/wizard`,企业 endpoint=
  `https://ai.wust.edu.cn/intellect-gateway`)、SSE 推演实测、chat 实测。

### 5.3 Jenkins(与 §1 的偏差)

**2026-10-14 晚间更新:插件已装齐,正式 Pipeline(CI)已上线,本节早间的
FreeStyle 过渡方案已废弃,以下为最终形态。**

- **插件安装**(免费开源,管理员经 update center/scriptText 安装):装
  workflow-job/timestamper/build-discarder/docker-workflow/pipeline-stage-view
  + declarative 家族(pipeline-model-{api,definition,extensions}、
  stage-tags-metadata 统一对齐 2.2293)。**踩坑**:update center 只推最新版,
  而 workflow-job 最新版要求 core ≥2.556(本控制器 2.541.2)→ 需按插件下载页
  的 per-version「Requires Jenkins」挑兼容版本(脚本闭包解析写入
  plugins/,同时要删同名解包目录);`agent { docker }` 形态在 NFS workspace
  下不可用(宿主 docker 看不到容器内 NFS 路径),故 node 走下面方案;
- **agent 运行环境**:内置节点无 node 二进制 → 从 node:20 镜像 tar 流提取
  node v20.20.2/npm 10.8.2 到 `/var/jenkins_home/tools/node20`(NFS 持久),
  内置节点环境属性注入 `PATH+node20`;`NODE_OPTIONS=--max-old-space-size=2048`
  (jest+vitest 并行峰值内存,jest worker 实测需 >1G);
- **控制器容量**:Pod 内存限额 6Gi→**16Gi**(并行双测试栈 + JVM 2G 实测会
  打爆 10Gi);JAVA_OPTS 追加
  `-Dorg.jenkinsci.plugins.durabletask.BourneShellScript.HEARTBEAT_CHECK_INTERVAL=86400`
  (NFS workspace 下 jest 长跑会被心跳检查误杀,JENKINS-48300);
- **凭据**:`gitee-token`(复用,SCM 拉取)+ `harbor-agentui-release`
  (robot,发版推送)已录入;
- **任务**:`intellect/agentui-ci`、`intellect/wargame-ci` 均为
  **Pipeline script from SCM**(dev/main 分支,各自仓库 Jenkinsfile);
  2026-10-14 验证:agentui-ci 全绿(jest 600/600 + vitest 46 文件 +
  tsc×2),wargame-ci 全绿(ci.sh 五步)。参数化构建用
  `buildWithParameters`(首次构建后出现参数表单,§1.5 三步可正常执行);
- **仓库侧修复**(已推送 dev):Jenkinsfile 两处正则改单引号字符串形式
  (CPS Groovy 解析器不接受字符类中未转义 `/`);package-lock.json 重生成
  (plugin-sdk 包化缺项致 `npm ci` EUSAGE——上游回归,CI 抓到)。

> **§5.5 CI 性能改造(2026-10-14 深夜,1–5 全做)**:流水线 8m45s → **约 3 分钟**。
>
> 1. **worker 显式对齐 cgroup**(`6508ed2`):容器内 `os.cpus()` 可见宿主全部
>    192 核(无 lxcfs),jest/vitest 默认开核数-1 个 worker 在 CPU 限额内严重
>    超配——此前连环 OOM 与慢跑的主因。Jenkinsfile 固化
>    `--maxWorkers`(jest 4 / vitest 3);
> 2. **恢复 jest transform 缓存**:移除 `package.json` test 脚本的 `--no-cache`,
>    缓存随 workspace 落本地盘,跨构建命中;
> 3. **独立 agent(本地盘 workspace)**:镜像
>    `hub.wust.edu.cn/intellect/jenkins-agent-node20:1`(node20+JRE17+git,
>    烤入 TZ/npm_cache/NODE_OPTIONS)跑长驻 Pod `jenkins/jenkins-agent-ci-local`
>    (8C/8G,workspace=emptyDir 节点本地盘 ~196G),经 svc jenkins:50000(JNLP,
>    NodePort 32000)反向连接控制器上的 Node `ci-local`(2 执行器,镜像内含
>    JENKINS_SECRET 见 k8s Secret 形态部署脚本);**built-in 执行器归零**,
>    `agent any` 自然全部落到本地盘 agent——仓库 Jenkinsfile 零改动;
> 4. 控制器 Pod CPU 限额 4→8(16Gi 不变),npm 缓存指向容器本地盘
>    (built-in 与 agent 镜像均已带 `npm_config_cache`);
> 5. 实测:agentui-ci 全量(jest 600/600+coverage、vitest 46 文件、tsc×2)
>    **2m59s**;wargame-ci(ci.sh 五步)**2m40s**。
>
> 运维注记:agent Pod 重建则 workspace/缓存清空,首跑冷启动(仍 <5 分钟);
> Jenkins 控制器升级后 agent.jar 版本不匹配时删 Pod 重建即可重新拉取。

### 5.4 遗留:公网 `/wargame`(需网关 VM 权限方执行)

网关(59.68.176.94 → 内网 10.99.24.12)为集群外独立 nginx,**Jenkins SA 与
执行机均无其配置权限**。在 ai.wust.edu.cn 的 443 server{} 加:

```nginx
# cognitive-wargame:纯剥前缀透传(SSE 禁缓冲)。
# 验证:curl -s -o /dev/null -w '%{http_code}\n' https://ai.wust.edu.cn/wargame/api/v1/scenarios  → 期望 401
location /wargame/ {
    proxy_pass http://10.99.24.15:31385/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # SSE 事件流禁缓冲(§0.2)
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
location = /wargame { return 301 /wargame/; }
```

应用后,agentui(≥0.4.1 镜像)若切回公网网关拓扑,`WARGAME_UPSTREAM`
应取 `https://ai.wust.edu.cn/wargame/api/v1/`(REST 通道补 /api/v1 前缀,
与 §0.2 的「网关纯剥前缀」前提对齐);当前集群内 Service 形态无此依赖。
