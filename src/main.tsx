import React from 'react';
import { gotoVSCode, Inspector } from 'react-dev-inspector';
import ReactDOM from 'react-dom/client';
import '../tailwind.css';
import './global.less';
import { initLanguage } from './locales/config';
import { initRuntimePlugins } from './plugins/runtime';

initLanguage()
  .then(async () => {
    // 运行时插件元数据必须在 App(路由树)求值前并入 registry:
    // App 改为动态 import,保证 collectRoutes/collectApps 看到运行时模块。
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
