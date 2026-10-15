// AgentUI 宿主 CI/发版流水线(华为集群 Jenkins,http://10.99.24.15:32080/)
//
// 前置(管理员一次性):
//   1. agent 需 Node 20+(node 在 PATH)与 Docker;
//   2. 凭据管理器(Manage Jenkins → Credentials)添加 usernamePassword 凭据,
//      ID 固定为 harbor-agentui-release——用户/密码取发版机
//      ~/.config/agentui/harbor-robots/agentui-release.env 的
//      HARBOR_USER / HARBOR_SECRET(robot$intellect+agentui-release,push+pull);
//   3. 新建任务:Pipeline → Pipeline script from SCM → 本仓库 gitee URL(dev 分支)。
//
// 日常:仅验证(类型检查 + 双侧测试);勾选 RELEASE 进入发版:
//   镜像 = hub.wust.edu.cn/intellect/agentui:$IMAGE_TAG,
//   PLUGIN_BUNDLE_IMAGE 非空时拉取 wargame 插件 bundle 镜像解包烤入。
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
    string(name: 'IMAGE_TAG', defaultValue: '0.4.0',
      description: '镜像 tag(RELEASE=true 时使用)')
    string(name: 'PLUGIN_BUNDLE_IMAGE', defaultValue: '',
      description: '插件 bundle 镜像(cognitive-wargame CI 发布,如 hub.wust.edu.cn/intellect/wargame-plugin-bundle:0d8b07d);留空=纯宿主镜像')
  }

  environment {
    IMAGE_REPO = 'hub.wust.edu.cn/intellect/agentui'
  }

  stages {
    stage('参数校验') {
      steps {
        script {
          if (!(params.IMAGE_TAG =~ /^[A-Za-z0-9._-]+$/)) {
            error("IMAGE_TAG 非法(仅允许字母数字与 . _ -,不得为空): '${params.IMAGE_TAG}'")
          }
          if (params.PLUGIN_BUNDLE_IMAGE?.trim() &&
              !(params.PLUGIN_BUNDLE_IMAGE.trim() =~ '^hub\\.wust\\.edu\\.cn/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$')) {
            error("PLUGIN_BUNDLE_IMAGE 非法(仅允许 hub.wust.edu.cn/<repo>:<tag> 形态): '${params.PLUGIN_BUNDLE_IMAGE}'")
          }
        }
      }
    }

    stage('依赖安装') {
      steps {
        sh 'node --version'
        // bff 为根 workspaces 成员,根 lock 统一钉版,无需单独 install(评审 Q1)
        sh 'npm ci --no-audit --no-fund'
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
      when { expression { params.RELEASE && params.PLUGIN_BUNDLE_IMAGE?.trim() } }
      steps {
        // bundle 镜像由 cognitive-wargame CI 发布(scripts/build-plugin-bundle-image.sh);
        // 此处仅解包进构建上下文 —— Dockerfile 的
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

    stage('镜像构建') {
      when { expression { params.RELEASE } }
      steps {
        script {
          if (params.PLUGIN_BUNDLE_IMAGE?.trim()) {
            echo "发版镜像含插件 bundle:${params.PLUGIN_BUNDLE_IMAGE.trim()}"
          } else {
            echo '发版纯宿主镜像(无插件,应用页为空)——确认这是预期(评审 Q4)'
          }
        }
        sh 'docker build -t "$IMAGE_REPO:$IMAGE_TAG" .'
      }
    }

    stage('镜像推送') {
      when { expression { params.RELEASE } }
      steps {
        withCredentials([usernamePassword(
            credentialsId: 'harbor-agentui-release',
            usernameVariable: 'HARBOR_USER',
            passwordVariable: 'HARBOR_SECRET')]) {
          sh 'echo "$HARBOR_SECRET" | docker login hub.wust.edu.cn -u "$HARBOR_USER" --password-stdin'
          // Harbor 偶发 EOF(2026-10-13 本机实测),自动重试一次(评审 Q3)
          retry(2) {
            sh 'docker push "$IMAGE_REPO:$IMAGE_TAG"'
          }
        }
      }
    }
  }

  post {
    always {
      // 失败路径也要清凭据:push 失败时 robot token 不得残留 agent(评审 S2)
      script {
        if (params.RELEASE) {
          sh 'docker logout hub.wust.edu.cn || true'
        }
      }
      deleteDir()
    }
  }
}
