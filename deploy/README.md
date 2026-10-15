# 部署(docker compose / k8s)+ 运行时插件发版 runbook

运行时插件采用 **方案 B(镜像烤入)+ 预留 C(制品库 URL 安装)**:
插件产物在发版时构建进 agentui 镜像,容器启动时由 entrypoint 自动安装;
后续应用市场成熟后扩展 zip 制品 + 安装 URL(内网制品库 hub.wust.edu.cn)。

## 测试环境拓扑(2026-10-13 确认)

**测试环境 AgentUI 仅本机运行(dev 三件套),k8s 部署搁置**;后端对接
AI 集群已部署服务(经 `ai.wust.edu.cn` 路径路由):

| 服务 | 端点 | 形态(实测) |
|---|---|---|
| intellect-team gateway | `https://ai.wust.edu.cn/intellect-gateway` | FastAPI;`/api/tenant/info` 公开,Default Tenant `000…000`(32 位 hex);wizard probe healthy,capabilities 全开(multiTenant/kb/canvas/memory/mcp) |
| RAG(knowledge base) | `https://ai.wust.edu.cn/intellect-kb` | intellect-rag;**ragEndpoint 不带 `/api`**(adapter 自拼 `/api/v1/*`);需 Bearer API key |
| intellect-team 前端 | `https://ai.wust.edu.cn/intellect` | 302(UI) |

本机 BFF 接入(一条命令,缺两项部署侧凭证:gateway 账号/ token 与 kb API key):

```bash
curl -X POST http://localhost:9390/admin/wizard/setup \
  -H 'Content-Type: application/json' -d '{
    "name": "intellect-enterprise-default",
    "type": "intellect-enterprise",
    "endpoint": "https://ai.wust.edu.cn/intellect-gateway",
    "intellectTenantId": "00000000000000000000000000000000",
    "ragEndpoint": "https://ai.wust.edu.cn/intellect-kb",
    "ragApiKey": "<kb 的 API key>",
    "credentialKind": "email-password",
    "email": "<gateway 账号>", "password": "<gateway 密码>"
  }'
```

(或 `credentialKind: bearer-token` + `credential: <token>`)

**已按此配置打通(2026-10-13 实测)**:capabilities 返回完整能力面
(canvas/rag/mcp/memory/modelManagement/multiTenant,tenant 全零匹配)、
`/auth/login/channels` 返回 OAuth 渠道列表(登录页渠道按钮渲染)、
`/proxy/v1/system/config` 200(BFF→kb 代理 + API key 注入)。
gateway token 经 `bff/.env` 的 `HARNESS_INTELLECT_ENTERPRISE_DEFAULT_TOKEN`
与 `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY` 注入(两处同值);
**运维踩坑记录**:①向 .env 追加变量时先确认无同名旧行
(`grep -q || append` 守卫会静默跳过,旧 token 继续生效,症状为 gateway
401 "token did not match any known format");②tenant-validator 通过
不代表 token 有效(/api/tenant/info 公开匿名可达)。

## 发版 runbook(手动)

```bash
# 1) 拉取插件 bundle 镜像并解包(2026-10-15 起插件 CI/CD 归 cognitive-wargame 仓:
#    先在其仓发 bundle 镜像 scripts/build-plugin-bundle-image.sh --tag <ref> --push)
docker pull hub.wust.edu.cn/intellect/wargame-plugin-bundle:<wargame-ref>
cid=$(docker create hub.wust.edu.cn/intellect/wargame-plugin-bundle:<wargame-ref>) \
  && mkdir -p deploy/plugin-bundles \
  && docker cp "$cid":/opt/bundled-plugins/. deploy/plugin-bundles/ && docker rm "$cid"

# 2) 构建镜像并推送内网制品库
docker build -t hub.wust.edu.cn/intellect/agentui:0.4.0 .
docker push hub.wust.edu.cn/intellect/agentui:0.4.0
```

跳过第 1 步 = 构建纯宿主镜像(无插件,应用页为空,不影响宿主功能)。
插件版本被镜像 tag 锁定:更新插件 = 重跑 1)2) 换 tag;回滚 = 回滚镜像 tag。

CI 自动发版(华为集群 Jenkins,两仓 Jenkinsfile 已就绪):见 [ci-jenkins.md](./ci-jenkins.md)。

## docker compose

`docker-compose.yml` 已含全部所需 env。要点:

- `WARGAME_HOST`:wargamesrv 与本 compose 同网络时用服务名;
  独立部署时用宿主地址(`host.docker.internal` / `172.17.0.1` / 实际 IP);
- `BFF_PLUGIN_INSTALL_TOKEN`:必填(未设置 compose 直接报错),生产用强随机值;
- `BFF_PLUGIN_BACKEND_OVERRIDES`:由 WARGAME_HOST/PORT 拼出,install 时
  覆盖插件 app.json 内写死的 `127.0.0.1:9385`,替换后仍受 SSRF 白名单约束;
- 插件安装数据在容器内(`bff/data/plugins`),镜像版本即插件版本,无需挂卷。

## k8s

见 [k8s/README.md](./k8s/README.md):`kubectl apply -f deploy/k8s/`,
token 走 Secret,镜像来自 hub.wust.edu.cn。

## 冒烟记录与已知事项(2026-10-13 首次发版冒烟)

独立容器实测全链路通过:entrypoint 自动安装(含 override)、
`/api/bff/plugins` 列表(词条内联)、插件 JS 5.2MB、REST 经代理返回
真实数据、SSE `text/event-stream`、SPA 深链回退。冒烟同时修复三个
存量 nginx/BFF bug(见 git log):proxy_buffering 重复声明、catch-all
regex 抢占前缀 location、目录 301 丢端口。

**v0.4.0(首个正式版,2026-10-13)**:从 main(tag v0.4.0)构建,插件 pin
cognitive-wargame@998c6af,冒烟全绿(列表/JS 5.2MB/深链/安装面 fail-closed);
推送走 skopeo 通道(docker daemon EOF 既有预案);独立容器冒烟需
`--add-host` 补 nginx upstream 主机名(intellect-rag 等,compose 网络外无 DNS)。

注意事项:
- **首次部署需完成安装向导**(配置首个 harness backend)后应用页才可进入,
  WizardGuard 会将未初始化环境重定向到 /wizard——这是宿主既有行为;
- 内网构建拉不动 docker.io 时:`docker pull docker.1ms.run/library/node:20-alpine
  && docker tag ... node:20-alpine`,再 `DOCKER_BUILDKIT=0 docker build`
  (buildx 独立 builder 不走 daemon mirror);
- SSE 空闲断开有两层超时,**先到先生效**:BFF(Node fetch/undici)body
  空闲默认约 300s → nginx(proxy.conf)3600s;断开后靠 EventSource 自动
  重连兜底。长空闲场景若观察到频繁重连,优先给上游加心跳(或显式调整
  undici dispatcher 的 bodyTimeout);
- `BFF_PLUGIN_BACKEND_OVERRIDES` **存在即生效**(插件 app.json 未声明
  backend 段也可启用代理),改 env 重启容器即生效,无需重装插件。

## 链路速查

```
浏览器 ─ nginx :80
  ├─ 静态资源 /                  → 本地 dist
  ├─ REST /api/v1/wargame/*      → ${WARGAME_HOST}:${WARGAME_PORT}(9385)
  ├─ /api/bff/plugins/*          → 容器内 BFF :9390(文件/列表/代理)
  │    └─ 插件代理 /plugins/<id>/proxy/* → app.json backend.target
  │       (install 时经 BFF_PLUGIN_BACKEND_OVERRIDES 覆盖为 WARGAME_HOST)
  └─ 其余 /api /v1               → intellect-rag
```
