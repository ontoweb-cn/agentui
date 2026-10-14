import { createRoot, type Root } from 'react-dom/client';
import {
  definePlugin,
  getHostApiVersion,
  type PluginAppRegistration,
} from '@agentui/plugin-sdk';
import { App } from './App';

/** 插件自带 CSS:挂载时注入 <style>,卸载时移除(对称清理,契约义务)。 */
const STYLE = `
.hello-world {
  font-family: system-ui, sans-serif;
  max-width: 28rem;
  margin: 4rem auto;
  padding: 2rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 12px;
}
.hello-world h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
.hello-world p { color: rgba(100, 116, 139, 1); font-size: 0.875rem; margin: 0.25rem 0; }
`;

let root: Root | null = null;
let styleEl: HTMLStyleElement | null = null;
let offLocaleChange: (() => void) | null = null;
let currentLang = 'zh';

function t(key: string): string {
  const messages: Record<string, Record<string, string>> = {
    zh: { greeting: '你好,世界!', hint: '这是由 AgentUI 宿主动态装载的插件。' },
    en: { greeting: 'Hello, world!', hint: 'This plugin is loaded dynamically by the AgentUI host.' },
  };
  return messages[currentLang]?.[key] ?? messages.zh[key];
}

function render(el: HTMLElement) {
  root?.render(
    <App
      greeting={t('greeting')}
      hint={t('hint')}
      hostApiVersion={getHostApiVersion() ?? 'unknown'}
    />,
  );
}

/**
 * 插件入口:definePlugin 提供类型并注册到 window.AgentUI。
 * mount 返回 dispose——宿主卸载/替换时调用,必须对称清理(root/style/订阅/连接)。
 */
export default definePlugin({
  id: 'hello-world',
  mount(el: HTMLElement): () => void {
    styleEl = document.createElement('style');
    styleEl.dataset.plugin = 'hello-world';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    currentLang = document.documentElement.lang?.startsWith('zh') === false ? 'en' : 'zh';
    root = createRoot(el);
    render(el);

    const host = (globalThis as { AgentUI?: {
      on?: (event: 'localechange', listener: (p: { lng?: string }) => void) => () => void;
    } }).AgentUI;
    offLocaleChange =
      host?.on?.('localechange', (p) => {
        currentLang = p.lng?.startsWith('zh') === false ? 'en' : 'zh';
        render(el);
      }) ?? null;

    return () => {
      offLocaleChange?.();
      offLocaleChange = null;
      root?.unmount();
      root = null;
      styleEl?.remove();
      styleEl = null;
    };
  },
} satisfies PluginAppRegistration);
