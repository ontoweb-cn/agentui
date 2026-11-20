# 交付报告 — AgentUI 发版链路仓库侧改造

日期：2026-11-20；方法：九步交付法；spec：`tests/e2e-tests/spec/agentui-release-chain-spec.md`。
拓扑确认：**B. 独立子域根路径 `https://agentui.wust.edu.cn`**。

## 一、结论摘要

| 缺口 | 级别 | 状态 | 证据 |
|---|---|---|---|
| F-01 tag 不触发发版 | P0 | 已修复 | Jenkinsfile「解析版本」stage；`TAG_NAME` 去 v、自动 `RELEASE` |
| F-02 镜像 tag 默认过旧、元数据丢失 | P1 | 已修复 | 默认 `0.4.3`；`archiveArtifacts` 移至 post always |
| F-03 ArgoCD 未接入 | P0 | 已修复 | `deploy/k8s/kustomization.yaml` + `deploy/argocd/application.yaml` |
| F-04 Service 类型与线上漂移 | P0 | 已修复 | 清单固定 `NodePort 31390` |
| F-05 私有镜像无拉取凭证 | P0 | 已修复 | `imagePullSecrets: agentui-pull-secret` |
| F-06 `bff/data` 临时盘 | P0 | 已修复 | PVC `agentui-data` → `/app/data`（生产 dist 运行时目录） |
| F-07 SSO 变量未入清单 | P1 | 已修复 | ConfigMap `agentui-config` + 可选 Secret `agentui-sso` |
| F-08 外部网关无模板 | P0 | 已修复 | `deploy/gateway/agentui-subdomain.conf` |
| F-09 引用缺失的 ingress 文件 | P2 | 已修复（模板） | 补齐 `deploy/subpath/k8s-ingress.yaml`（example.com/default 为参考模板） |
| F-10 无发版冒烟 | P1 | 已修复 | `scripts/smoke-deploy.sh` + Jenkins `SMOKE_URL` stage |

## 二、执行与验证

| 检查 | 结果 |
|---|---|
| YAML 解析（agentui/config/pvc/kustomization/application/ingress） | 全部通过 |
| kustomization 资源存在 + 关键字段（image/configMap/PVC/pullSecret/nodePort） | 通过 |
| `bash -n scripts/smoke-deploy.sh` | 通过 |
| Jenkinsfile 静态检查（TAG_NAME/EFFECTIVE_TAG/IS_RELEASE/archiveArtifacts） | 通过 |
| `npm run type-check` | 通过（hiedu 快照一致） |
| BFF 全量测试 | 56 文件 / 1077 用例通过 |

## 三、交付物

- `Jenkinsfile`：tag 构建、版本解析、元数据归档、可选冒烟
- `deploy/k8s/agentui.yaml`：NodePort 31390、PullSecret、ConfigMap、PVC 挂载、SSO Secret
- `deploy/k8s/agentui-config.yaml`、`agentui-pvc.yaml`、`kustomization.yaml`
- `deploy/argocd/application.yaml`
- `deploy/gateway/agentui-subdomain.conf`
- `scripts/smoke-deploy.sh`
- `deploy/release-chain.md`（发版/回滚 Runbook）
- `deploy/subpath/k8s-ingress.yaml`（参考模板）
- 调研与 spec：`tests/e2e-tests/outline/agentui-release-chain-research.md`、`tests/e2e-tests/spec/agentui-release-chain-spec.md`

## 四、受限注记（R6）

- **L-01**：本机无 `kubectl`/ArgoCD/Jenkins 访问，未执行 `kustomize build`、未实际 apply、未触发流水线；
- **L-02**：Harbor 机器人凭据不可用，未执行镜像推送验证；
- **L-03**：外部网关（ai.wust.edu.cn）由第三方管理，nginx 片段未实际加载；
- **L-04**：Jenkins 任务需为 Multibranch + tag discovery，平台侧配置无法从仓库验证；
- **L-05**：DNS/证书、节点防火墙放行 31390、默认 StorageClass 需平台侧确认；
- **L-06**：首次接入 PVC 不迁移旧临时盘数据，需重跑向导或手工拷贝（生产目录为 `/app/data`）。
- **L-07**：Jenkinsfile 只做了关键字/结构检查，未执行 Groovy 语法解析；需在 Jenkins 首跑验证。
- **L-08**：部署完成后 SSO 仍为关闭（ConfigMap 默认 `false`），需按 Runbook 在 Git 中开启并同步。

## 五、平台侧待办

1. Jenkins：Multibranch + tag discovery；确认 `harbor-agentui-release` 凭据与 Docker agent；
2. ArgoCD：配置仓库凭据并 apply `deploy/argocd/application.yaml`；首次建议关闭 automated；
3. Harbor：创建/轮换 `agentui-release`、`agentui-pull` 机器人；
4. 网关：应用 `agentui-subdomain.conf`，配置 DNS/TLS；
5. 启用 SSO：创建 `agentui-sso` Secret、把 ConfigMap `BFF_SSO_ENABLED` 改 true，并先完成网关 provider；
6. 发版：`git tag v0.4.3 && git push origin v0.4.3`，随后跑 `scripts/smoke-deploy.sh`。

## 六、九步闭环声明

调研 ✅；手册（Runbook）✅；双向检视 ✅（F-01~F-10）；用例 ✅（[TC-REL-01](file:///d:/workspace/agentui/tests/e2e-tests/cases/agentui-release-chain/TC-REL-01-static-checks.md)）；执行 ✅（基线缺口）；批准门 ✅（拓扑已确认）；修复 ✅；构建/校验 ✅；回归 ✅；报告/归档 ✅。平台侧实测受限，已在 §四 登记。

## 七、评审修复记录（v1.1）

| # | 评审问题 | 处置 |
|---|---|---|
| R-01 | PVC 挂载路径错误（生产数据目录是 `/app/data`） | 挂载改 `/app/data`；Runbook/README 同步 |
| R-02 | 镜像 tag 0.4.2 可能不存在，且与 v0.4.3 不一致 | 版本统一 0.4.3：package.json×2、Jenkins 默认、base 清单、kustomization |
| R-03 | 直接改 ConfigMap 会被 ArgoCD selfHeal 回滚 | Runbook 改为「改 Git → 同步」并显式警告 |
| R-04 | RWO PVC + RollingUpdate 会 Multi-Attach | Deployment 增加 `strategy: Recreate` |
| R-05 | ArgoCD 跟踪 dev 分支风险 | `targetRevision` 改为 `main`，并注明生产不跟 dev |
| R-06 | k8s README 镜像/PullSecret/部署方式过时 | README 更新为 0.4.3、PullSecret 必需、ArgoCD 主路径、PVC 说明 |
| R-07 | 报告声称用例完成但目录缺失 | 新增 `TC-REL-01-static-checks.md` |
| R-08 | 元数据仅在 push 成功后归档 | 移到 `post { always }`，存在才归档 |
| R-09 | Jenkinsfile 仅静态检查 | 新增 L-07 受限说明 |
| R-10 | 未说明部署后 SSO 仍关闭 | 新增 L-08 |
| R-11 | F-09 表述过强 | 改为「已修复（模板）」 |
