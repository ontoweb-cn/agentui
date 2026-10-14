# 内部 CI 接入 — Jenkins(华为集群)

> 集群 Jenkins 地址:<http://10.99.24.15:32080/>(2026-10-13 可达,Jetty 12.1.5)。
> 两仓库均已提供平台无关的流水线入口,任意 Jenkins(含本集群)从 SCM 拉起即可。
> **执行手册**(管理员三步的逐步操作、环境核验、首跑与排障):见
> [cluster-rollout.md](./cluster-rollout.md) §1(2026-10-14 方案定稿)。

## 覆盖范围

| 仓库 | 入口 | 产物 |
|---|---|---|
| `wustbd/agentui`(本仓库,dev 分支) | `Jenkinsfile` | 验证:tsc×2 + jest + vitest;RELEASE 参数化发版:插件打包 → docker build → push Harbor |
| `wustbd/cognitive-wargame`(main 分支) | `Jenkinsfile` | 调 `web/agentui/scripts/ci.sh`:导入边界 + tsc + 入口契约测试 + 插件构建 |

插件 CI 脚本本身平台无关(`scripts/ci.sh`),Gitee Go/GitHub Actions 亦可直调。

## 管理员一次性配置

1. **Agent 环境**:Node 20+(node 在 PATH)、Docker(仅 agentui 发版需要)。
2. **Harbor 推送凭据**:Manage Jenkins → Credentials → Add:
   - Kind:`Username with password`;
   - ID 固定 `harbor-agentui-release`(Jenkinsfile 引用);
   - 值取发版机 `~/.config/agentui/harbor-robots/agentui-release.env` 的
     `HARBOR_USER` / `HARBOR_SECRET`(robot,仅 intellect 项目 push+pull;
     365 天轮换,轮换后只需更新此凭据)。
3. **建任务**(两仓库各一个):New Item → Pipeline →
   Pipeline script from SCM → gitee 仓库 URL → 对应分支。
   触发:手动 Build Now 起步;可选 H/50 轮询或 gitee WebHook
   (推送到 `<jenkins>/gitee-project/<job>`,需 gitee 插件)。

## 发版操作(agentui 任务)

勾选参数化构建:

| 参数 | 说明 |
|---|---|
| `RELEASE` | 勾选进入发版(不勾=仅验证) |
| `IMAGE_TAG` | 镜像 tag,与宿主版本一致(如 `0.4.0`) |
| `PLUGIN_REPO` | 默认 gitee cognitive-wargame;留空 PLUGIN_REF 则发纯宿主镜像 |
| `PLUGIN_REF` | 插件 tag/commit;**正式发版 pin commit**(如 `998c6af`),保证可复现 |

四个参数进入 shell 前由 `参数校验` stage 白名单强制(评审 S1):IMAGE_TAG 限
`[A-Za-z0-9._-]`,PLUGIN_REF 拒绝前导 `-` 与 `..`,PLUGIN_REPO 仅允许
`https://gitee.com/**.git`——防 params → sh 的命令替换与 git 参数注入;
打包脚本自身另有一层 charset 校验(本地直调同样受保护)。

流程等价手动 runbook(deploy/README.md §发版):验证全绿 →
`package-plugin-bundle.sh --repo --ref` → `docker build` → 机器人凭据
`docker login/push` → 登出。镜像内含插件 bundle,容器启动 entrypoint 幂等安装。

## 与本地发版的分工

- Jenkins 发版为正道(凭据不落开发者机器、构建可追溯);
- 本机手动发版仍可用(deploy/README.md),Harbor 推送优先走
  `agentui-release` 机器人(同 env 文件),admin 账号不用于 CI/发版。
