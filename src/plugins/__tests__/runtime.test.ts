/**
 * 运行时插件内核接线测试:宿主全局注册 + 元数据校验 + ModuleDefinition 转换。
 * (initRuntimePlugins 的 fetch/bootstrap 链路由 E2E 覆盖,单测不 mock 网络。)
 *
 * 注意:第二个 describe 会真实调用 registerRuntimeModules 改写全局 registry,
 * 依赖 jest 按声明顺序执行;新增用例请放在其后,避免注册状态互相影响。
 */
import {
  collectApps,
  collectRoutes,
  registerRuntimeModules,
} from '@/features/_registry';

import {
  getPluginRegistration,
  installAgentUIHostGlobal,
} from '../host-global';
import { rejectReason, toModuleDefinition } from '../runtime';
import type { AgentUIHostGlobal, PluginAppMetadata } from '../types';

const agentUiGlobal = () =>
  (window as unknown as { AgentUI?: AgentUIHostGlobal }).AgentUI!;

const meta: PluginAppMetadata = {
  id: 'cognitive-wargame',
  path: '/cognitive-wargame',
  label: '认知博弈推演',
  description: '红蓝对抗认知域推演与评估',
  icon: '🧠',
  order: 50,
  entry: 'ui/dist/index.js',
  peer: { react: '^18' },
};

describe('plugins host global', () => {
  it('安装 window.AgentUI 并接受插件注册', () => {
    installAgentUIHostGlobal();
    expect(agentUiGlobal()).toBeDefined();
    agentUiGlobal().registerApp({
      id: 'test-app',
      mount: () => () => undefined,
    });
    expect(getPluginRegistration('test-app')).toBeDefined();
    localStorage.setItem('Authorization', 't');
    expect(agentUiGlobal().host.getApiToken()).toBe('t');
    localStorage.removeItem('Authorization');
    expect(agentUiGlobal().host.getApiToken()).toBeNull();
  });
});

describe('rejectReason(注册前校验)', () => {
  it('合法元数据放行', () => {
    expect(rejectReason(meta)).toBeNull();
  });

  it.each([
    ['根路径', { ...meta, path: '/' }],
    ['宿主保留路由', { ...meta, path: '/login' }],
    ['应用页路由', { ...meta, path: '/applications' }],
    ['含参数段', { ...meta, path: '/x/:id' }],
    ['非斜杠开头', { ...meta, path: 'cognitive-wargame' }],
    ['entry 穿越', { ...meta, entry: '../etc/passwd' }],
    ['entry 绝对路径', { ...meta, entry: '/etc/passwd' }],
    ['缺 id', { ...meta, id: '' }],
  ])('拒绝 %s', (_name, bad) => {
    expect(rejectReason(bad as PluginAppMetadata)).toBeTruthy();
  });

  it('peer.react 主版本不满足时拒绝(硬失败)', () => {
    expect(rejectReason({ ...meta, peer: { react: '^19' } })).toBeTruthy();
    expect(rejectReason({ ...meta, peer: { react: '^17' } })).toBeTruthy();
  });

  it('peer.react 次版本不低于声明时放行', () => {
    expect(rejectReason({ ...meta, peer: { react: '>=17' } })).toBeNull();
  });
});

describe('toModuleDefinition', () => {
  it('生成挂载路由与应用卡片(懒装载,不含即时 JS 装载)', () => {
    const def = toModuleDefinition(meta);
    expect(def.name).toBe('plugin:cognitive-wargame');
    expect(def.routes.map((r) => r.path)).toEqual(['/cognitive-wargame/*']);
    for (const route of def.routes) {
      // Component 是懒加载包装:调用后才装载插件 JS,注册阶段零网络请求
      expect(typeof route.Component).toBe('function');
    }
    expect(def.app).toMatchObject({
      id: 'cognitive-wargame',
      path: '/cognitive-wargame',
      label: '认知博弈推演',
      description: '红蓝对抗认知域推演与评估',
    });
    expect(def.app?.icon).toBeDefined();
  });

  it('并入 registry 后 collectApps/collectRoutes 可见', () => {
    registerRuntimeModules([toModuleDefinition(meta)]);
    expect(collectApps().some((a) => a.id === 'cognitive-wargame')).toBe(true);
    expect(
      collectRoutes().some((r) => r.path === '/cognitive-wargame/*'),
    ).toBe(true);
  });
});
