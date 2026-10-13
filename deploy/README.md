# 部署(docker compose / k8s)+ 运行时插件发版 runbook

运行时插件采用 **方案 B(镜像烤入)+ 预留 C(制品库 URL 安装)**:
插件产物在发版时构建进 agentui 镜像,容器启动时由 entrypoint 自动安装;
后续应用市场成熟后扩展 zip 制品 + 安装 URL(内网制品库 hub.wust.edu.cn)。

## 发版 runbook(手动)

```bash
# 1) 打包插件(默认相邻 checkout ../cognitive-wargame,可 --ref 指定 tag/commit)
scripts/package-plugin-bundle.sh --ref <wargame-tag>

# 2) 构建镜像并推送内网制品库
docker build -t hub.wust.edu.cn/<项目>/agentui:<tag> .
docker push hub.wust.edu.cn/<项目>/agentui:<tag>
```

跳过第 1 步 = 构建纯宿主镜像(无插件,应用页为空,不影响宿主功能)。
插件版本被镜像 tag 锁定:更新插件 = 重跑 1)2) 换 tag;回滚 = 回滚镜像 tag。

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
