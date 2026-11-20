# Spec — AgentUI 发版链路仓库侧改造

日期：2026-11-20；关联调研：`tests/e2e-tests/outline/agentui-release-chain-research.md`。
用户指令：「开始实施」——视为修复范围预授权；拓扑二选一需确认后一次性落地。

## 一、缺陷/缺口

| # | 级别 | 缺口 | 证据 | 修复 |
|---|---|---|---|---|
| F-01 | P0 | 打 tag 不触发发版，镜像 tag 与 tag 无映射 | Jenkinsfile 无 `TAG_NAME` 逻辑 | 解析 stage：tag 优先（去 `v` 前缀），tag 构建自动 `RELEASE` |
| F-02 | P1 | `IMAGE_TAG` 默认 `0.4.0` 与当前版本不符；元数据未归档 | Jenkinsfile L32、L180 | 默认改 `0.4.2`；`archiveArtifacts deploy/release-metadata.json` |
| F-03 | P0 | ArgoCD 未接入 | 仓库无 ArgoCD 资源 | Kustomize + ArgoCD Application（同仓 `deploy/k8s`） |
| F-04 | P0 | Git 清单 Service=ClusterIP，线上为 NodePort 31390；ArgoCD 会回滚线上类型 | agentui.yaml L7-L19 + cluster-rollout L289 | 清单显式 `NodePort 31390` |
| F-05 | P0 | 私有镜像拉取凭证未启用 | agentui.yaml L112-L114 | 启用 `imagePullSecrets: agentui-pull-secret` |
| F-06 | P0 | `bff/data` 落在容器临时盘，Pod 重建丢向导数据 | k8s README L95 | 新增 PVC 挂载 `/app/bff/data` |
| F-07 | P1 | SSO 环境变量未进入部署清单 | 本仓 SSO P2 | ConfigMap + 可选 Secret（默认 `BFF_SSO_ENABLED=false`） |
| F-08 | P0 | 外部网关无 agentui location；仓库无可执行模板 | cluster-rollout L376 | 提供网关 nginx 片段（根域/子路径两版） |
| F-09 | P2 | 子目录 README 引用的 `k8s-ingress.yaml` 不存在 | deploy/subpath/README | 补齐或修正引用 |
| F-10 | P1 | 发版后无冒烟 | 无脚本 | `scripts/smoke-deploy.sh` + Jenkins 可选 stage |

## 二、修复方案（仓库侧）

| 任务 | 文件 |
|---|---|
| T1 Jenkins tag/版本/归档 | `Jenkinsfile` |
| T2 Kustomize + ArgoCD | `deploy/k8s/kustomization.yaml`、`deploy/argocd/application.yaml` |
| T3 清单加固（NodePort/PullSecret/PVC/ConfigMap/SSO） | `deploy/k8s/agentui.yaml`、新增 `agentui-config.yaml`、`agentui-pvc.yaml` |
| T4 网关片段 | `deploy/gateway/agentui-location.conf`（子路径版 + 独立域名版） |
| T5 冒烟与文档 | `scripts/smoke-deploy.sh`、`deploy/release-chain.md` |
| T6 子目录引用修正 | `deploy/subpath/README.md` |

## 三、待确认（阻塞 T1/T3/T4 的落地形态）

1. **对外拓扑**：
   - A. `https://ai.wust.edu.cn/agentui/`（子路径；需补齐子目录镜像与上游全 URL 支持，改动较大）
   - B. 独立子域根路径（如 `agentui.wust.edu.cn`；复用现有根镜像与 nginx，改动最小）
   - C. 暂只做 NodePort 直连（不做域名）
2. 选择后按对应形态落地 ConfigMap（`BFF_FRONTEND_BASE`）与网关片段。

## 四、验收

- `node -e` 解析全部新增 YAML 通过；Jenkinsfile 关键字检查（TAG_NAME/env.IS_RELEASE/archiveArtifacts）通过；
- `bash -n scripts/smoke-deploy.sh` 通过；
- `npm run type-check` 与 BFF 全量测试保持全绿（部署改动不应影响代码）；
- 平台侧（Jenkins/ArgoCD/网关）无法本地验证，记 R6 受限。
