# TC-REL-01 — 发版链路静态校验

截图目录：无（命令行校验）；前置：仓库根目录、Node 20+、bash。
隔离声明：只读检查，不部署、不推送镜像（R3）。
R6 声明：无 Jenkins/ArgoCD/kubectl 访问，全部为仓库侧静态验证。

## 用例清单

| 编号 | 目的 | 命令 | 预期 |
|---|---|---|---|
| TC-REL-01-01 | YAML 可解析 | `node -e "require('yaml').parseAllDocuments(fs.readFileSync(<file>))"` | 6 个清单全部 OK |
| TC-REL-01-02 | Kustomize 结构与关键字段 | Node 解析 `agentui.yaml`/`kustomization.yaml` | image=0.4.3、mount=/app/data、strategy=Recreate、nodePort=31390、pullSecret 存在 |
| TC-REL-01-03 | Jenkinsfile tag 逻辑 | grep `TAG_NAME`/`EFFECTIVE_TAG`/`IS_RELEASE`/`archiveArtifacts` | 均存在；无 `params.RELEASE` 作为 when 条件 |
| TC-REL-01-04 | 冒烟脚本语法 | `bash -n scripts/smoke-deploy.sh` | exit 0 |
| TC-REL-01-05 | 前端类型检查 | `npm run type-check` | exit 0（含 hiedu 快照门禁） |
| TC-REL-01-06 | BFF 回归 | `cd bff && npx vitest run` | 全绿 |

## 说明

- Jenkinsfile 仅做关键字与结构检查，未执行 Groovy 语法解析（受限，见报告 L-07）；
- ArgoCD/Kustomize 渲染需 `kubectl kustomize` 或 ArgoCD 环境，本地不可用（L-01）；
- 版本一致性由 TC-REL-01-02 + `package.json` 版本断言覆盖。
