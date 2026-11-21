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

# 删除所有 /frontend/ 相关 location（旧门户入口下线）
location /frontend/ { ... }
```

> ⚠️ 只删除 `/frontend/`（旧入口）。**现行 HIEDU Portal 挂在 `/portal`、`/portal-api`、`/portal-oauth2`，必须保留并显式路由**，否则会被 `location /` 吞掉（2026-11-21 实际故障即此原因）。

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

### 2.2.1 必须补齐的 HIEDU Portal 路由（放在 `location /` 之前）

集群内已有 Ingress `hiedu/hiedu-portal`（`/portal-oauth2`、`/portal-api` → `hiedu-oauth2-proxy:4180`，`/portal` → `hiedu-portal:80`）。外部网关需要把这三条路径交给 **ingress-nginx**，而不是 AgentUI：

```nginx
# HIEDU Portal：交给 ingress-nginx，Host 必须保持 ai.wust.edu.cn
location ^~ /portal-oauth2/ {
    proxy_pass http://<ingress-nginx-http-nodeport>;
    proxy_set_header Host ai.wust.edu.cn;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
}
location ^~ /portal-api/ {
    proxy_pass http://<ingress-nginx-http-nodeport>;
    proxy_set_header Host ai.wust.edu.cn;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
}
location ^~ /portal/ {
    proxy_pass http://<ingress-nginx-http-nodeport>;
    proxy_set_header Host ai.wust.edu.cn;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
}
```

关键约束：
- `proxy_pass` **不能带 URI**，否则 `/portal-api/...` 前缀会被改写，oauth2-proxy 无法匹配 `--api-route`。
- `Host` 必须是 `ai.wust.edu.cn`，否则 ingress 规则不命中。
- `X-Forwarded-Proto https` 防止 ingress `force-ssl-redirect` 造成重定向循环。
- 若不经 ingress-nginx，也可将 `hiedu-portal`（80）与 `hiedu-oauth2-proxy`（4180）暴露 NodePort 后直连。

> 保持不动的更具体 location：`/auth/`、`/intellect-gateway`、`/intellect-kb`、`/wargame/`、`/portal-oauth2/`、`/portal-api/`、`/portal/`。
> `<cluster-node-ip>` 可用任一 k8s 节点内网 IP（Service 已固定 31390）。

### 2.3 应用

```bash
cp /etc/nginx/conf.d/ai-wust.conf /etc/nginx/conf.d/ai-wust.conf.bak.20261121
nginx -t && nginx -s reload
```

## 3. 验证（网关生效后）

### 3.1 AgentUI 与 IdP

| 检查 | 命令 | 期望 |
|---|---|---|
| 首页 | `curl -I https://ai.wust.edu.cn/` | 200，不再是 301 `/frontend/` |
| 登录页 | `curl -I https://ai.wust.edu.cn/login` | 200 |
| BFF 健康 | `curl -s https://ai.wust.edu.cn/api/bff/health` | `{"status":"ok",...}` |
| IdP discovery | `curl -s https://ai.wust.edu.cn/auth/.well-known/openid-configuration` | JSON，`issuer=https://ai.wust.edu.cn/auth` |

```bash
# 仓库内冒烟（覆盖 health、首页、/auth/config、/auth/login/channels、SSO authorize）
bash scripts/smoke-deploy.sh https://ai.wust.edu.cn
```

### 3.2 HIEDU Portal（回归必查）

| 检查 | 命令 | 期望 |
|---|---|---|
| 静态门户 | `curl -I https://ai.wust.edu.cn/portal/` | 200 `text/html`，内容为 Portal（不是 AgentUI） |
| API 未登录 | `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://ai.wust.edu.cn/portal-api/api/me` | **401** `application/json`（oauth2-proxy） |
| SSO 发起 | `curl -I 'https://ai.wust.edu.cn/portal-oauth2/start?rd=/portal/'` | 302 → `/auth/login/oauth/authorize` |
| 门户功能 | 浏览器打开 `/portal/`，登录后访问人员/项目页 | 200，无 JSON 解析错误 |

```bash
# 失败判定：若以下四个路径响应体哈希相同，说明 /portal* 又被 AgentUI SPA 吞掉
for p in / /portal/ /portal-api/api/me /login; do
  printf '%-20s ' "$p"
  curl -sS "https://ai.wust.edu.cn$p" | shasum -a 256 | cut -c1-16
done
```

正常结果：`/` 与 `/login` 相同（AgentUI SPA），`/portal/` 与 `/portal-api/api/me` 必须**不同**。

### 3.3 失败排查顺序

1. `nginx -t && nginx -s reload` 后仍是 200 HTML → 检查外部 nginx 是否命中新增的 `^~ /portal*` location（`nginx -T | grep -n portal`）。
2. `/portal/` 正常但 `/portal-api` 返回 502 → 检查 ingress-nginx NodePort、`Host` 头、`X-Forwarded-Proto`。
3. 全部 404 → 检查集群内 `hiedu/hiedu-portal` Ingress 是否 Synced、TLS Secret 是否存在。

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
| **HIEDU Portal 三条路由（`/portal`、`/portal-api`、`/portal-oauth2`）** | 网关 VM 管理员；集群内 Ingress 由 Argo CD（已完成） |
| DNS / 证书 | 网络管理员 |
| IdP client / 网关 provider | 统一认证与网关管理员 |

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-21 | 初版：根路径切换到 AgentUI |
| 2026-11-21 | 补漏：`/portal*` 被 `location /` 吞掉导致 Portal 不可用；新增 §2.2.1 与 Portal 验证清单 |
