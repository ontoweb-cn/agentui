import React from 'react';
import { gotoVSCode, Inspector } from 'react-dev-inspector';
import ReactDOM from 'react-dom/client';
import '../tailwind.css';
import './global.less';
import { initLanguage } from './locales/config';

initLanguage()
  .then(async () => {
    // 运行时插件元数据必须在 App(路由树)求值前并入 registry:
    // App 改为动态 import,保证 collectRoutes/collectApps 看到运行时模块。
    // runtime 模块同样动态引入:它静态依赖 _registry(急求职值全部 manifest),
    // 若在此处静态引入,R2 压制标记(__AGENTUI_RUNTIME_PLUGIN_IDS__)会晚于
    // registry 首次求值,编译期同路径模块无法退位(真机冒烟实锤,见
    // canvas-stage4 spec §9.2)。
    const { initRuntimePlugins } = await import('./plugins/runtime');
    await initRuntimePlugins();
    return import('./app');
  })
  .then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <Inspector keys={['alt', 'c']} onInspectElement={gotoVSCode} />
        <App />
      </React.StrictMode>,
    );
  });
