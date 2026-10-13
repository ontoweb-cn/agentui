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
//   PLUGIN_REF 非空时先打包插件烤入(cognitive-wargame @ 指定 tag/commit)。
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    booleanParam(name: 'RELEASE', defaultValue: false,
      description: '勾选则构建并推送正式镜像到 Harbor(否则仅验证)')
    string(name: 'IMAGE_TAG', defaultValue: '0.4.0',
      description: '镜像 tag(RELEASE=true 时使用)')
    string(name: 'PLUGIN_REPO', defaultValue: 'https://gitee.com/wustbd/cognitive-wargame.git',
      description: '插件仓库(package-plugin-bundle.sh --repo);留空=纯宿主镜像')
    string(name: 'PLUGIN_REF', defaultValue: '',
      description: '插件 tag/commit(--ref);留空=纯宿主镜像')
  }

  environment {
    IMAGE_REPO = 'hub.wust.edu.cn/intellect/agentui'
  }

  stages {
    stage('依赖安装') {
      steps {
        sh 'node --version'
        sh 'npm ci --no-audit --no-fund'
        dir('bff') { sh 'npm install --no-audit --no-fund' }
      }
    }

    stage('验证') {
      parallel {
        stage('宿主:tsc + jest') {
          steps {
            sh 'npm run type-check'
            sh 'npx jest --no-cache'
          }
        }
        stage('BFF:tsc + vitest') {
          steps {
            dir('bff') {
              sh 'npm run type-check'
              sh 'npm test'
            }
          }
        }
      }
    }

    stage('插件打包') {
      when { expression { params.RELEASE && params.PLUGIN_REF?.trim() } }
      steps {
        sh './scripts/package-plugin-bundle.sh --repo "$PLUGIN_REPO" --ref "$PLUGIN_REF"'
      }
    }

    stage('镜像构建') {
      when { expression { params.RELEASE } }
      steps {
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
          sh 'docker push "$IMAGE_REPO:$IMAGE_TAG"'
          sh 'docker logout hub.wust.edu.cn'
        }
      }
    }
  }

  post {
    always {
      deleteDir()
    }
  }
}
