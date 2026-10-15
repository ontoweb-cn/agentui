# @agentui/plugin-sdk

AgentUI 运行时插件 SDK——第三方插件开发**唯一的声明依赖**。零依赖、零副作用。

## 安装

宿主仓库内(workspace)自动可用;外部仓库经制品获取(`npm pack` 产物或制品库 URL,正式 registry 接入前用 file:/git 引用):

```bash
npm install @agentui/plugin-sdk
```

## 用法

### 1. 声明插件入口(替代手抄 `window.AgentUI` 接口)

```tsx
import { definePlugin } from '@agentui/plugin-sdk';
import { createRoot } from 'react-dom/client';

export default definePlugin({
  id: 'my-app',
  mount(el: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = '/* 插件自带 CSS */';
    document.head.appendChild(style);
    const root = createRoot(el);
    root.render(<MyApp />);
    return () => {
      root.unmount();
      style.remove();
    };
  },
});
```

### 2. 声明宿主 API 版本(app.json)

```jsonc
{
  "id": "my-app",
  "apiVersion": "^1.3.0",   // 见下方兼容语义;缺省 = 任意版本
  "peer": { "react": "^18" },
  "entry": "ui/dist/index.js"
}
```

### 3. 能力 feature-detect

```ts
import { getHostApiVersion, satisfiesApiVersion } from '@agentui/plugin-sdk';

if (host.chat) { /* chat 能力(1.2.0+) */ }
if (satisfiesApiVersion('^1.2.0', getHostApiVersion() ?? undefined)) {
  // 使用 1.2.0 新面
}
```

## 兼容性策略(宿主装载校验同语义,`satisfiesApiVersion`)

| 声明 | 语义 |
|---|---|
| 缺省 / `*` | 任意宿主版本 |
| `^1.3.0` | 同 major 且宿主 ≥ 1.3.0(major 内契约只做加法) |
| `~1.3.0` | 同 major.minor 且宿主 ≥ 补丁 |
| `>=1.3.0`、`1.3`、`1` | 不低于声明 |
| `=1.3.0` | 精确相等 |

不满足时宿主**拒绝装载插件 JS**,应用卡片仍可见并标注「不兼容」,挂载页显示具体原因(声明区间 vs 宿主版本)——不会静默失败。

## 版本纪律

本包 `version` 与宿主 `HOST_API_VERSION` 同步演进:契约加法演进 bump minor,破坏性变更 bump major(跨 major 宿主会在装载时按 `apiVersion` 区间给出明确不兼容提示)。

完整开发文档:宿主仓库 `docs/plugin-development-guide.md`。
