# Jenkins CI agent(本地盘 workspace)

华为集群专用:镜像 `hub.wust.edu.cn/intellect/jenkins-agent-node20:1`
(node20 + JRE17 + git,烤入 TZ=Asia/Shanghai / npm_config_cache=/tmp/npm-cache /
NODE_OPTIONS=--max-old-space-size=2048)。背景与拓扑见
[cluster-rollout.md](../cluster-rollout.md) §5.3/§5.5。

## 构建

```bash
docker build -t hub.wust.edu.cn/intellect/jenkins-agent-node20:1 .   # 基础镜像走 1ms.run 源
skopeo copy --dest-creds "$HARBOR_USER:$HARBOR_SECRET" \
  docker-daemon:hub.wust.edu.cn/intellect/jenkins-agent-node20:1 \
  docker://hub.wust.edu.cn/intellect/jenkins-agent-node20:1          # 发版机 robot
```

## 运行(长驻 Pod,jenkins ns)

- Jenkins 侧:Node `ci-local`(JNLP 启动,remoteFS /home/jenkins/agent,2 执行器);
  连接密钥在控制器该 Node 的 JNLP 配置中;
- k8s 侧:Pod `jenkins-agent-ci-local`,env `JENKINS_URL=http://jenkins.jenkins.svc.cluster.local:8080`、
  `JENKINS_AGENT_NAME=ci-local`、`JENKINS_SECRET=<JNLP secret>`(建议以 Secret 注入),
  workspace 挂 emptyDir(节点本地盘);8C/8G;imagePullSecrets agentui-pull-secret;
- 控制器 built-in 执行器=0,`agent any` 全部落到本 agent。

## 维护

- Pod 重建 → workspace/缓存清空,首跑冷启动(<5 分钟);
- Jenkins 控制器升级后 agent.jar 不匹配 → 删 Pod 重建(entrypoint 自动重拉 jar)。
