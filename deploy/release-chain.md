# 发版链路 Runbook — tag → Jenkins → Harbor → ArgoCD → 域名

拓扑：**ai.wust.edu.cn 根路径 `/`**（原 `/frontend` 门户下线）。

## 1. 发版（Gitee tag，2026-11-22 起自动触发）

```bash
git tag v0.4.8
git push origin v0.4.8
```

触发机制（Gitee 公网无法回调内网 Jenkins，走轮询）：
- `intellect/agentui-release`（Multibranch）：跟踪 **main 分支 + v 语义化 tag**
  （`RegexSCMHeadFilterTrait ^(main|vX.Y.Z)$`），每 5 分钟扫描 Gitee；
  main 构建=纯验证；tag 条目存在但**不会因发现而自动构建**；
- `intellect/agentui-tag-watch`（Pipeline，cron H/2 每 2 分钟）：`git ls-remote`
  发现新的 `vX.Y.Z` tag → 先刷 multibranch 索引 → 触发对应 tag 子任务构建；
  已处理的 tag 记入工作区 `handled-tags.txt`（首次运行只建基线，不回溯构建）；
- 端到端延迟 ≈ 扫描/轮询间隔之和（通常 2–7 分钟）。

tag 构建自动 `RELEASE=true`，`IMAGE_TAG` 取 tag 去掉 `v` 前缀（`TAG_NAME`）；
手动构建仍用参数 `RELEASE` + `IMAGE_TAG`；非 tag 且未勾 `RELEASE` 只跑验证。
原有的 dev 跟踪任务 `agentui-ci` 已停用（保留历史），如需 dev 分支验证再启用。

镜像：`hub.wust.edu.cn/intellect/agentui:<tag>`，推送凭据 `harbor-agentui-release`。
发版元数据 `deploy/release-metadata.json` 由 Jenkins 归档。

插件 bundle：需要应用页时填 `PLUGIN_BUNDLE_IMAGE` 或 `PLUGIN_BUNDLE_ARTIFACT_URL + SHA256`；
留空为纯宿主镜像。

## 2. 部署（ArgoCD）

一次性：

```bash
kubectl apply -f deploy/argocd/application.yaml
```

日常：镜像 tag 变更二选一：
- 手动：修改 `deploy/k8s/kustomization.yaml` 的 `images.newTag` 并提交；
- 自动：配置 ArgoCD Image Updater 监听 Harbor 仓库。

**顺序要求**：先让 Jenkins 把该 tag 推到 Harbor，再改 `newTag`；否则 ArgoCD 同步会 ImagePullBackOff。

清单包含：
- Deployment/Service（NodePort **31390**，与线上一致）；
- ConfigMap `agentui-config`（SSO/站点配置）；
- PVC `agentui-data`（挂载 `/app/data`，即生产 `dist/index.mjs` 运行时的数据目录）；
- `imagePullSecrets: agentui-pull-secret`；Deployment 使用 `Recreate` 策略避免 RWO 多挂载。

首次接入 PVC 时旧临时盘数据不会迁移：需重跑 `/admin/wizard` 或从旧 Pod 拷贝数据目录（生产为 `/app/data`）。

## 3. 域名与网关

> 待执行的网关切换清单（含配置、验证、回滚、责任边界）见
> [ai-wust-gateway-cutover.md](./ai-wust-gateway-cutover.md)。

外部 nginx（ai.wust.edu.cn 所在网关）引用 [agentui-root.conf](../gateway/agentui-root.conf)：
- 在现有 `ai.wust.edu.cn` 443 server 中新增 `location /`，反代 `<cluster-node-ip>:31390`；
- **只删除**旧门户入口 `location = / { return 301 /frontend/; }` 及 `/frontend/` 相关 location；
- **必须保留并显式路由** `/portal`（hiedu-portal）、`/portal-api` 与 `/portal-oauth2`（hiedu-oauth2-proxy），
  建议交给 ingress-nginx；否则会被 `location /` 吞掉，Portal 表现为返回 AgentUI 的 index.html（2026-11-21 故障）；
- `/auth/`、`/intellect-gateway`、`/intellect-kb`、`/wargame/` 等更具体 location 保持不变；
- 关闭代理缓冲（SSE）、超时 3600s、`client_max_body_size 1024m`。

## 4. Secret（一次性）

```bash
kubectl -n intellect create secret docker-registry agentui-pull-secret \
  --docker-server=hub.wust.edu.cn \
  --docker-username="$HARBOR_USER" --docker-password="$HARBOR_SECRET"

kubectl -n intellect create secret generic agentui-plugin-admin \
  --from-literal=token="$(openssl rand -hex 32)"

# 启用 SSO 时：
kubectl -n intellect create secret generic agentui-sso \
  --from-literal=state-secret="$(openssl rand -base64 48 | tr -d '\n')"
```

## 5. 启用 SSO

前置（网关侧）：provider `intellect-auth`（issuer `https://ai.wust.edu.cn/auth`）、
`redirect_uris=https://ai.wust.edu.cn/api/bff/auth/oauth/callback`、
`INTELLECT_OAUTH_EXCHANGE_ENABLED=true`；IdP 侧 client 已注册。

步骤：
1. 创建 `agentui-sso` Secret；
2. 在 Git 中把 `deploy/k8s/agentui-config.yaml` 的 `BFF_SSO_ENABLED` 改为 `"true"` 并提交（**不要 kubectl edit**：ArgoCD `selfHeal` 会回滚）；
3. 确认 `BFF_PUBLIC_ORIGIN=https://ai.wust.edu.cn`；
4. 提交后 ArgoCD 同步，跑冒烟。

## 6. 冒烟

```bash
bash scripts/smoke-deploy.sh https://ai.wust.edu.cn
```

Jenkins 发版参数 `SMOKE_URL` 非空时自动执行同一脚本。

## 7. 回滚

- 镜像：把 `kustomization.yaml` 的 `newTag` 改回上一版本（或 ArgoCD 回滚历史版本）；
- SSO：`BFF_SSO_ENABLED=false` + 重启（ArgoCD 同步）；
- 数据：PVC 保留，回滚镜像不丢配置。

## 8. 已知受限

- Jenkins/ArgoCD/外部网关均无法从仓库验证，配置项需平台侧核对；
- 首次 ArgoCD 同步建议先关闭 `automated`，确认 PVC/NodePort/镜像拉取无误后再开启；
- Harbor 机器人证书 365 天轮换，轮换后更新 Jenkins 凭据与 `agentui-pull-secret`。
