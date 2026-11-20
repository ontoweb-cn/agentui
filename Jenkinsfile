// AgentUI 宿主 CI/发版流水线(华为集群 Jenkins,http://<jenkins-host>:32080/)
//
// 前置(管理员一次性):
//   1. agent 需 Node 20+(node 在 PATH)与 Docker;
//   2. 凭据管理器(Manage Jenkins → Credentials)添加 usernamePassword 凭据,
//      ID 固定为 harbor-agentui-release——用户/密码取发版机
//      ~/.config/agentui/harbor-robots/agentui-release.env 的
//      HARBOR_USER / HARBOR_SECRET(robot$intellect+agentui-release,push+pull);
//   3. 新建任务:Pipeline → Pipeline script from SCM → 本仓库 gitee URL(dev 分支)。
//
// 日常:仅验证(类型检查 + 双侧测试);勾选 RELEASE 或推送 tag 进入发版:
//   镜像 = hub.wust.edu.cn/intellect/agentui:$IMAGE_TAG,
//   PLUGIN_BUNDLE_IMAGE 非空时拉取 wargame 插件 bundle 镜像解包烤入。
// Tag 发版:Jenkins 任务需为 Multibranch Pipeline 并开启 tag discovery,
//   推送 vX.Y.Z tag 时自动 RELEASE=true,IMAGE_TAG 取去掉 v 前缀的 tag。
// 职责边界(2026-10-15):agentui 是前端宿主,wargame 的 CI/CD 归
//   cognitive-wargame 仓(其 Jenkinsfile 参数化发布 wargamesrv 镜像与
//   插件 bundle 镜像);本仓只消费成品 bundle 镜像,不再拉取其源码打包。
// 安全:全部参数在进 shell 前经白名单校验(评审 S1——params 经 env 进入 sh 的
// 双引号串不防 $( ) 命令替换与前导 - 的参数注入,故先在 Groovy 侧拒绝)。
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 40, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '50'))
  }

  parameters {
    booleanParam(name: 'RELEASE', defaultValue: false,
      description: '勾选则构建并推送正式镜像到 Harbor(否则仅验证)')
    string(name: 'IMAGE_TAG', defaultValue: '0.4.3',
      description: '镜像 tag(手动构建时使用;tag 触发时自动取 TAG_NAME 去 v 前缀)')
    string(name: 'PLUGIN_BUNDLE_IMAGE', defaultValue: '',
      description: '插件 bundle 镜像(cognitive-wargame CI 发布,如 hub.wust.edu.cn/intellect/wargame-plugin-bundle:0d8b07d);留空=纯宿主镜像')
    string(name: 'PLUGIN_BUNDLE_ARTIFACT_URL', defaultValue: '',
      description: '插件 bundle tarball URL(hTTPS,如 Harbor OCI artifact 导出地址);与 PLUGIN_BUNDLE_IMAGE 二选一;留空=纯宿主镜像')
    string(name: 'PLUGIN_BUNDLE_SHA256', defaultValue: '',
      description: 'PLUGIN_BUNDLE_ARTIFACT_URL 对应的 tarball sha256(64 位 hex,必填)')
    string(name: 'SMOKE_URL', defaultValue: '',
      description: '发版后冒烟基址(如 https://agentui.wust.edu.cn);留空跳过冒烟')
    booleanParam(name: 'BOOTSTRAP_BASE_IMAGE', defaultValue: false,
      description: '首次使用 Harbor 基础镜像时勾选:从 1ms.run 拉取 node:20-alpine 并推送到 Harbor')
  }

  environment {
    IMAGE_REPO = 'hub.wust.edu.cn/intellect/agentui'
  }

  stages {
    stage('参数校验') {
      steps {
        script {
          // IMAGE_TAG 在「解析版本」统一校验（tag 触发时以 TAG_NAME 为准）
          if (params.PLUGIN_BUNDLE_IMAGE?.trim() &&
              !(params.PLUGIN_BUNDLE_IMAGE.trim() =~ '^hub\\.wust\\.edu\\.cn/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$')) {
            error("PLUGIN_BUNDLE_IMAGE 非法(仅允许 hub.wust.edu.cn/<repo>:<tag> 形态): '${params.PLUGIN_BUNDLE_IMAGE}'")
          }
          // D2 载体切换(2026-10-21):tarball artifact 模式
          if (params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim()) {
            if (!(params.PLUGIN_BUNDLE_ARTIFACT_URL.trim() ==~ /^https:\/\/[^\s'"]+$/)) {
              error("PLUGIN_BUNDLE_ARTIFACT_URL 非法(仅允许 https URL): '${params.PLUGIN_BUNDLE_ARTIFACT_URL}'")
            }
            if (!(params.PLUGIN_BUNDLE_SHA256?.trim() ==~ /^[a-fA-F0-9]{64}$/)) {
              error('PLUGIN_BUNDLE_ARTIFACT_URL 模式必须提供 64 位 hex 的 PLUGIN_BUNDLE_SHA256')
            }
          }
          if (params.PLUGIN_BUNDLE_IMAGE?.trim() && params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim()) {
            error('PLUGIN_BUNDLE_IMAGE 与 PLUGIN_BUNDLE_ARTIFACT_URL 只能二选一')
          }
        }
      }
    }

    stage('解析版本') {
      steps {
        script {
          // tag 触发优先: v0.4.2 -> 0.4.2；tag 构建自动进入发版
          def rawTag = env.TAG_NAME?.trim()
          def effective = rawTag ? rawTag.replaceFirst('^v', '') : params.IMAGE_TAG
          if (!(effective ==~ /^[A-Za-z0-9._-]+$/)) {
            error("镜像 tag 非法(仅允许字母数字与 . _ -,不得为空): '${effective}'")
          }
          env.EFFECTIVE_TAG = effective
          env.IS_RELEASE = (params.RELEASE || rawTag) ? 'true' : 'false'
          echo "构建来源=${rawTag ? 'tag:' + rawTag : '手动'}，镜像 tag=${effective}，发版=${env.IS_RELEASE}"
        }
      }
    }

    stage('准备基础镜像') {
      when { expression { env.IS_RELEASE == 'true' && params.BOOTSTRAP_BASE_IMAGE } }
      steps {
        withCredentials([usernamePassword(
            credentialsId: 'harbor-agentui-release',
            usernameVariable: 'HARBOR_USER',
            passwordVariable: 'HARBOR_SECRET')]) {
          sh 'echo "$HARBOR_SECRET" | docker login hub.wust.edu.cn -u "$HARBOR_USER" --password-stdin'
          sh '''
            IMG=hub.wust.edu.cn/intellect/node:20-alpine
            if docker manifest inspect "$IMG" >/dev/null 2>&1; then
              echo "基础镜像已存在: $IMG"
              exit 0
            fi
            for SRC in \
              hub.wust.edu.cn/dockerhub/library/node:20-alpine \
              hub.wust.edu.cn/proxy/library/node:20-alpine \
              docker.m.daocloud.io/library/node:20-alpine \
              docker.nju.edu.cn/library/node:20-alpine \
              docker.1ms.run/library/node:20-alpine
            do
              echo "尝试基础镜像源: $SRC"
              if docker pull "$SRC"; then
                docker tag "$SRC" "$IMG"
                docker push "$IMG"
                echo "已转存: $SRC -> $IMG"
                exit 0
              fi
            done
            echo "所有基础镜像源均不可达，请手动推送 node:20-alpine 到 $IMG" >&2
            exit 1
          '''
        }
      }
    }

    stage('依赖安装') {
      steps {
        sh 'node --version'
        // bff 为根 workspaces 成员,根 lock 统一钉版,无需单独 install(评审 Q1)
        // Jenkins agent 目前为 Node 20，而 devDependencies 中 chromatic>=17 要求 Node >=22；
        // chromatic 不参与构建/测试，使用 --engine-strict=false 解除安装阻断。
        // 后续应把 Jenkins agent 镜像升级到 Node 22，并移除该参数。
        sh 'npm ci --no-audit --no-fund --engine-strict=false'
      }
    }

    stage('验证') {
      parallel {
        stage('宿主:tsc + jest(含 coverage 阈值)') {
          steps {
            sh 'npm run type-check'
            // maxWorkers 显式对齐 cgroup 限额:容器内 os.cpus() 可见宿主全部核
            // (无 lxcfs),jest 默认开核数-1 个 worker 会严重超配(华为集群实测)
            sh 'npm test -- --maxWorkers=4'
          }
        }
        stage('BFF:tsc + vitest') {
          steps {
            dir('bff') {
              sh 'npm run type-check'
              sh 'npm test -- --maxWorkers=3'
            }
          }
        }
      }
    }

    stage('拉取插件 bundle') {
      when { expression { env.IS_RELEASE == 'true' &&
        (params.PLUGIN_BUNDLE_IMAGE?.trim() || params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim()) } }
      steps {
        script {
          if (params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim()) {
            // D2 tarball 模式(2026-10-21):curl + sha256 + tar,无需 docker daemon
            sh """
              bash scripts/consume-plugin-bundle.sh \\
                --url '${params.PLUGIN_BUNDLE_ARTIFACT_URL.trim()}' \\
                --sha256 '${params.PLUGIN_BUNDLE_SHA256.trim()}'
            """
          } else {
            // 旧镜像模式(过渡期保留):bundle 镜像由 cognitive-wargame CI 发布;
            // 此处解包进构建上下文 —— Dockerfile 的
            // COPY deploy/plugin-bundles/ /opt/bundled-plugins/ 机制不变。
            sh '''
              docker pull "$PLUGIN_BUNDLE_IMAGE"
              cid=$(docker create "$PLUGIN_BUNDLE_IMAGE")
              mkdir -p deploy/plugin-bundles
              docker cp "$cid":/opt/bundled-plugins/. deploy/plugin-bundles/
              docker rm "$cid" >/dev/null
            '''
          }
        }
        script {
          // D6:登记「宿主镜像 ↔ 插件版本 ↔ 产物摘要」三元
          def src = params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim()
          def sha = params.PLUGIN_BUNDLE_SHA256?.trim()
          if (!src) {
            src = params.PLUGIN_BUNDLE_IMAGE.trim()
            sha = sh(returnStdout: true,
              script: 'docker inspect --format "{{index .RepoDigests 0}}" "$PLUGIN_BUNDLE_IMAGE" | cut -d@ -f2').trim()
          }
          sh "bash scripts/write-release-metadata.sh --source '${src}' --sha256 '${sha}' --image-tag '${env.EFFECTIVE_TAG}'"
        }
      }
    }

    stage('镜像构建') {
      when { expression { env.IS_RELEASE == 'true' } }
      steps {
        script {
          if (params.PLUGIN_BUNDLE_IMAGE?.trim() || params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim()) {
            echo "发版镜像含插件 bundle:${params.PLUGIN_BUNDLE_ARTIFACT_URL?.trim() ?: params.PLUGIN_BUNDLE_IMAGE.trim()}"
          } else {
            echo '发版纯宿主镜像(无插件,应用页为空)——确认这是预期(评审 Q4)'
          }
        }
        withCredentials([usernamePassword(
            credentialsId: 'harbor-agentui-release',
            usernameVariable: 'HARBOR_USER',
            passwordVariable: 'HARBOR_SECRET')]) {
          // 基础镜像来自私有 Harbor，构建前必须先登录
          sh 'echo "$HARBOR_SECRET" | docker login hub.wust.edu.cn -u "$HARBOR_USER" --password-stdin'
          sh 'docker build -t "$IMAGE_REPO:$EFFECTIVE_TAG" .'
        }
      }
    }

    stage('镜像推送') {
      when { expression { env.IS_RELEASE == 'true' } }
      steps {
        withCredentials([usernamePassword(
            credentialsId: 'harbor-agentui-release',
            usernameVariable: 'HARBOR_USER',
            passwordVariable: 'HARBOR_SECRET')]) {
          sh 'echo "$HARBOR_SECRET" | docker login hub.wust.edu.cn -u "$HARBOR_USER" --password-stdin'
          // Harbor 偶发 EOF(2026-10-13 本机实测),自动重试一次(评审 Q3)
          retry(2) {
            sh 'docker push "$IMAGE_REPO:$EFFECTIVE_TAG"'
          }
        }
      }
    }

    stage('冒烟验证') {
      when { expression { env.IS_RELEASE == 'true' && params.SMOKE_URL?.trim() } }
      steps {
        sh "bash scripts/smoke-deploy.sh '${params.SMOKE_URL.trim()}'"
      }
    }
  }

  post {
    always {
      // 失败路径也要归档发版元数据（存在才归档），再清 workspace
      archiveArtifacts artifacts: 'deploy/release-metadata.json', allowEmptyArchive: true
      // 失败路径也要清凭据:push 失败时 robot token 不得残留 agent(评审 S2)
      script {
        if (env.IS_RELEASE == 'true') {
          sh 'docker logout hub.wust.edu.cn || true'
        }
      }
      deleteDir()
    }
  }
}
