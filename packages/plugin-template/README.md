# my-agentui-plugin(AgentUI 插件模板)

复制本目录、全局替换 `hello-world` → 你的插件 id、`my-agentui-plugin` → 你的包名,即可开始开发一个可被 AgentUI 宿主动态装载的运行时插件。

```bash
npm install        # @agentui/plugin-sdk 在宿主仓库 workspace 内自动链接;
                   # 独立仓库请先获取 SDK(npm pack 产物 / file: 引用,registry 接入后直接 install)
npm run build      # 产物 ui/dist/index.js(单文件自包含 ESM)
npm run lint:imports
npm run type-check
```

## 本模板演示的契约要点

| 要点 | 位置 |
|---|---|
| `definePlugin` 注册 + mount/dispose 对称清理(root/style/事件订阅) | `src/index.tsx` |
| 跟随宿主语言(`on('localechange')`) | `src/index.tsx` |
| 卡片词条(`ui/locales/*.json` → BFF 内联下发,JS 未装载也可本地化) | `ui/locales/` |
| 版本兼容声明 `apiVersion`(不满足时宿主显式标注不兼容) | `app.json` |
| 自包含边界守卫(裸导入必须声明依赖) | `scripts/check-external-imports.mjs` |
| lib 单文件构建(顶层目录 ∈ {ui, assets, dist}) | `vite.config.ts` |

## 安装到宿主验证

```bash
curl -X POST http://localhost:9390/plugins/install \
  -H 'Content-Type: application/json' \
  -H 'X-Plugin-Admin-Token: <BFF_PLUGIN_INSTALL_TOKEN>' \
  -d '{"source": "/abs/path/to/my-agentui-plugin"}'
```

完整开发文档(构建要求/后端代理/SSE/调试):宿主仓库 `docs/plugin-development-guide.md`。
