# ai.wust.edu.cn 根路径切换 — 待执行清单（网关侧）

日期：2026-11-21；当前版本：`0.4.5`。

## 1. 集群内现状（已完成）

| 项 | 状态 |
|---|---|
| Argo CD 应用 | `agentui`，Synced to `67e176d`，**Healthy** |
| Pod | Running 1/1，镜像 `hub.wust.edu.cn/intellect/agentui:0.4.5` |
| Service | `agentui`，**NodePort 31390**（80→80） |
| PVC | `agentui-data`，Bound（`nfs-csi`） |
| ConfigMap | `BFF_PUBLIC_ORIGIN=https://ai.wust.edu.cn`，SSO 仍为 `false` |
| 集群内探针 | readiness `/api/bff/plugins`、liveness `/` 均通过 |

## 2. 唯一待执行的网关变更（集群外）

`ai.wust.edu.cn` 由**集群外 nginx**提供，仓库/ArgoCD 无权限。需要在现有 `443 server { server_name ai.wust.edu.cn; }` 中：

### 2.1 删除

```nginx
# 删除根路径到门户的 301
location = / { return 301 /frontend/; }

# 删除所有 /frontend/ 相关 location（门户下线）
location /frontend/ { ... }
```

### 2.2 新增（放在 server{} 内）

```nginx
location / {
    proxy_pass http://<cluster-node-ip>:31390;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE / 长连接
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
client_max_body_size 1024m;
```

> 保持不动的更具体 location：`/auth/`、`/intellect-gateway`、`/intellect-kb`、`/wargame/`。
> `<cluster-node-ip>` 可用任一 k8s 节点内网 IP（Service 已固定 31390）。

### 2.3 应用

```bash
cp /etc/nginx/conf.d/ai-wust.conf /etc/nginx/conf.d/ai-wust.conf.bak.20261121
nginx -t && nginx -s reload
```

## 3. 验证（网关生效后）

```bash
curl -I https://ai.wust.edu.cn/                     # 期望 200，不再是 301 /frontend/
curl -s https://ai.wust.edu.cn/api/bff/health       # 期望 {"status":"ok",...}
curl -I https://ai.wust.edu.cn/login                # 期望 200

# 仓库内冒烟
bash scripts/smoke-deploy.sh https://ai.wust.edu.cn
```

冒烟覆盖：health、首页、`/auth/config`、`/auth/login/channels`、SSO authorize（302）。

## 4. 可选：启用 SSO（集群内）

> 先确认网关 provider 已就绪（`intellect-auth`、exchange 开关、IdP client 回调 `https://ai.wust.edu.cn/api/bff/auth/oauth/callback`）。

```bash
# 1) 创建密钥（只做一次）
kubectl -n intellect create secret generic agentui-sso \
  --from-literal=state-secret="$(openssl rand -base64 48 | tr -d '\n')"

# 2) 在 Git 中把 deploy/k8s/agentui-config.yaml 的 BFF_SSO_ENABLED 改为 "true"
#    提交后 Argo CD Hard Refresh + Sync

# 3) 重启 Pod 使 env 生效：更新 Deployment 模板注解
#    kubectl.kubernetes.io/restartedAt: "<新的 ISO 时间>"
```

验证：

```bash
curl -I "https://ai.wust.edu.cn/api/bff/auth/sso/authorize/intellect-auth?tenant=0"
# 期望 302，Location 指向 https://ai.wust.edu.cn/auth/...
```

## 5. 回滚

1. 网关：恢复 `ai-wust.conf.bak.20261121` 并 `nginx -s reload`；
2. SSO：Git 中把 `BFF_SSO_ENABLED` 改回 `"false"` 并同步；
3. 镜像：修改 `deploy/k8s/kustomization.yaml` 的 `images.newTag` 回退版本。

## 6. 责任边界

| 项 | 负责方 |
|---|---|
| 集群内 Deployment/Service/PVC/ConfigMap | Argo CD（已完成） |
| 外部 nginx 根路径切换 | 网关 VM 管理员（待执行） |
| DNS / 证书 | 网络管理员 |
| IdP client / 网关 provider | 统一认证与网关管理员 |
