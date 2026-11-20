# 调研 — AgentUI 发版链路（tag → Jenkins → Harbor → ArgoCD → 域名）

日期：2026-11-20；范围：仓库侧可控部分。

## 1. 链路现状

| 环节 | 仓库证据 | 结论 |
|---|---|---|
| Gitee tag → Jenkins | [Jenkinsfile](../../../Jenkinsfile#L29-L40) | 仅手动参数化构建，`RELEASE` 默认 false；无 `TAG_NAME`/`buildingTag` 逻辑；`IMAGE_TAG` 默认 `0.4.0` |
| 验证 | Jenkinsfile L73-L99 | `tsc×2 + jest + vitest`，完整 |
| 构建镜像 | [Dockerfile](../../../Dockerfile#L1-L20) | 三阶段：前端、canvas 插件、BFF esbuild |
| 推 Harbor | Jenkinsfile L155-L169 | build/push/retry/logout 完整，凭据 `harbor-agentui-release` 由 Jenkins 管理 |
| 元数据 | [write-release-metadata.sh](../../../scripts/write-release-metadata.sh#L23) | 写 `deploy/release-metadata.json`；Jenkins `post { deleteDir() }` 会清除且未归档 |
| ArgoCD | 全仓 grep 无 `argocd` | **未接入**：无 Application/AppProject/Kustomize/Helm |
| 集群清单 | [agentui.yaml](../../../deploy/k8s/agentui.yaml) | Deployment + ClusterIP Service；镜像 tag 硬编码 `0.4.0`；`imagePullSecrets` 注释；无 PVC；无 SSO env |
| 实际部署记录 | [cluster-rollout.md](../../../deploy/cluster-rollout.md#L284-L289) | 线上为 NodePort **31390**（与 Git 清单的 ClusterIP 不一致） |
| 域名 | cluster-rollout.md L376-L397 | `ai.wust.edu.cn` 由**集群外独立 nginx** 提供，CI 无权限；只有 `/wargame` 示例，无 agentui location |
| 子目录方案 | [deploy/subpath](../../../deploy/subpath) | 有 Dockerfile/配置/entrypoint，但缺插件安装与 `*_UPSTREAM` 全 URL 支持；README 引用的 `k8s-ingress.yaml` **文件不存在** |

## 2. 真实运行库与限制

- 本机无 `kubectl`、无 ArgoCD/Jenkins 访问，无法验证 cs2/cs4 平台侧配置；
- Harbor 可达但需机器人凭据，未执行 push；
- `ai.wust.edu.cn` 实测：`/api/bff/health` 503、`/agentui/` 404，只能说明当前未接通，不能定位是路由缺失还是上游未就绪；
- 发版镜像必须含本次 SSO P2 代码（当前镜像 `0.4.0` 早于该特性）。

## 3. 部署拓扑事实

- 域名根 `/` 301 → `/frontend/`，已被门户占用；
- 若 agentui 落在同一域名，只能走子路径（如 `/agentui/`）或独立子域；
- 子路径需要：`VITE_BASE_URL=/agentui/`、`BFF_FRONTEND_BASE=/agentui`、BFF 回调仍在根 `/api/bff/*`；
- 独立子域可直接复用现有根路径镜像与 nginx 配置，改动最小。
