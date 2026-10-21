# Storybook 视觉回归(Chromatic)

> 状态:配置已就绪;实际 baseline 需要 `CHROMATIC_PROJECT_TOKEN`,本轮未上传。

## 一、已落地

- devDependency:`chromatic@18.13.0`(仅 CI/本地视觉回归,不进生产 bundle)。
- `package.json` script:
  ```bash
  npm run chromatic
  # 实际执行 chromatic --build-script-name=build-storybook
  ```
- Storybook 构建:`npm run build-storybook`(已通过;TRAE Token 已注入)。

## 二、使用方式

```bash
# 本地/CI 必须提供项目 token
export CHROMATIC_PROJECT_TOKEN=<your-token>
npm run chromatic
```

CI 示例(以 Jenkins 为例):

```groovy
stage('Visual Regression') {
  when { expression { env.CHROMATIC_PROJECT_TOKEN != null } }
  steps {
    sh 'npm ci'
    sh 'npm run chromatic'
  }
}
```

## 三、安全与产物

- Storybook 生产构建通过 `webpackFinal` 关闭 `devtool`,不产出 `.map`;Chromatic 只上传压缩后的静态产物。
- 已核对重建后的 `storybook-static`:`*.map` 数量为 0,故事数 107。
- token 只从 `CHROMATIC_PROJECT_TOKEN` 读取,不写入仓库;上传前仍需按团队数据政策确认 bundle 内容。

## 四、范围

- 当前 Storybook 故事覆盖 `src/**/*.stories.tsx`,包括 `TRAE-Work/*`、`Message/ActivityTree`、`Message/StreamStatus`、`Chat/WorkspacePanel`。
- ActivityTree 覆盖 Completed/Running/Failed/ManyTools(50 条上限);StreamStatus 覆盖 Streaming/Done/Failed/Stopped;WorkspacePanel 覆盖 Empty。
- Chromatic 只上传构建产物与截图,不上传源码/环境变量;token 必须放 CI secret。

## 五、未完成

- 无 `CHROMATIC_PROJECT_TOKEN`,因此未创建 baseline、未验证 diff 流程。
- 未接入 Jenkins stage(避免无 token 时构建失败;建议用 `when` 条件包裹)。
