# 发版链路 Runbook — tag → Jenkins → Harbor → ArgoCD → 域名

拓扑：**独立子域根路径** `https://agentui.wust.edu.cn`（2026-11-20 确认）。

## 1. 发版（Gitee tag）

```bash
git tag v0.4.3
git push origin v0.4.3
```

Jenkins 任务要求：Multibranch Pipeline + 开启 tag discovery（或等价 webhook 传入 `TAG_NAME`）。
- tag 构建自动 `RELEASE=true`，`IMAGE_TAG` 取 tag 去掉 `v` 前缀；
- 手动构建仍用参数 `RELEASE` + `IMAGE_TAG`；
- 非 tag 且未勾选 `RELEASE` 时只跑验证，不产出镜像。

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

外部 nginx（ai.wust.edu.cn 所在网关）引用 [agentui-subdomain.conf](../gateway/agentui-subdomain.conf)：
- `agentui.wust.edu.cn` → `<cluster-node-ip>:31390`；
- 关闭代理缓冲（SSE）、超时 3600s、`client_max_body_size 1024m`；
- 证书路径按网关实际填写，DNS 指向网关公网 IP。

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
`redirect_uris=https://agentui.wust.edu.cn/api/bff/auth/oauth/callback`、
`INTELLECT_OAUTH_EXCHANGE_ENABLED=true`；IdP 侧 client 已注册。

步骤：
1. 创建 `agentui-sso` Secret；
2. 在 Git 中把 `deploy/k8s/agentui-config.yaml` 的 `BFF_SSO_ENABLED` 改为 `"true"` 并提交（**不要 kubectl edit**：ArgoCD `selfHeal` 会回滚）；
3. 确认 `BFF_PUBLIC_ORIGIN=https://agentui.wust.edu.cn`；
4. 提交后 ArgoCD 同步，跑冒烟。

## 6. 冒烟

```bash
bash scripts/smoke-deploy.sh https://agentui.wust.edu.cn
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
