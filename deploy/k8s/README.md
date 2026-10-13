# k8s 部署(agentui + 运行时插件)

镜像:内网制品库 `hub.wust.edu.cn`(Harbor)。镜像内含 nginx + Node BFF
同容器(`docker-entrypoint.sh`),插件 bundle 烤入镜像并在启动时自动安装
(#2b 方案 B)。

## 前置

1. 构建含插件的镜像(发版机,手动):

   ```bash
   # 1) 打包插件产物到 deploy/plugin-bundles/cognitive-wargame/
   scripts/package-plugin-bundle.sh --ref <tag|commit>   # 默认相邻 ../cognitive-wargame
   # 2) 构建并推送
   docker build -t hub.wust.edu.cn/intellect/agentui:0.2.0 .
   docker push hub.wust.edu.cn/intellect/agentui:0.2.0
   ```

   不跑第 1 步则构建出「纯宿主」镜像(无插件,应用页为空)。

2. 准备 Secret(一次性;token 须强随机,与镜像内 entrypoint 使用的相同):

   ```bash
   kubectl -n <ns> create secret generic agentui-plugin-admin \
     --from-literal=token="$(openssl rand -hex 32)"
   ```

## 部署/更新

```bash
# 按环境修改 deployment.yaml 中的镜像 tag 与 WARGAME_HOST 后:
kubectl apply -f deploy/k8s/
```

更新发版 = 换镜像 tag 重新 apply;插件版本随镜像 tag 锁定,回滚即回滚镜像。

## 变量说明

| 变量 | 说明 |
|---|---|
| `WARGAME_HOST/WARGAME_PORT` | wargamesrv 地址(k8s 内为 Service 名/跨集群为 LB 地址),nginx REST 通道与 BFF 插件代理共用 |
| `BFF_PLUGIN_BACKEND_OVERRIDES` | 插件代理 target 覆盖,install 时应用并重过 SSRF 白名单 |
| `BFF_PLUGIN_INSTALL_TOKEN` | 插件安装 token(Secret 注入);BFF 本身绑定容器内回环 |

## 注意

- BFF 默认绑定 127.0.0.1(容器内 nginx 可达),**不要**在 k8s 中设置
  `BFF_HOST=0.0.0.0` 除非同时给 BFF 端口加上 NetworkPolicy/鉴权;
- 插件安装数据在容器临时目录,镜像版本即插件版本(无状态,滚动更新安全);
- intellect-rag / wargamesrv / PG / Redis 由各自部署提供,本 manifests
  仅覆盖 agentui 本体。
