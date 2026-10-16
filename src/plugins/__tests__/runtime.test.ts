/**
 * 运行时插件内核接线测试:宿主全局注册 + 元数据校验 + ModuleDefinition 转换
 * + 后台刷新监测(#10,mock fetch)。
 *
 * 注意:第二个 describe 会真实调用 registerRuntimeModules 改写全局 registry,
 * 依赖 jest 按声明顺序执行;新增用例请放在其后,避免注册状态互相影响。
 */
import {
  collectApps,
  collectRoutes,
  registerRuntimeModules,
} from '@/features/_registry';

jest.mock('sonner', () => ({
  toast: { info: jest.fn() },
}));
import { toast } from 'sonner';

import {
  getPluginRegistration,
  installAgentUIHostGlobal,
} from '../host-global';
import {
  rejectReason,
  compatibilityReason,
  initRuntimePlugins,
  resetPluginListWatchForTests,
  resetInitForTests,
  startPluginListWatch,
  toModuleDefinition,
  toHostModuleDefinition,
  RUNTIME_PLUGIN_IDS_KEY,
} from '../runtime';
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

  // 契约快照(评审 #9):window.AgentUI 导出面是插件的事实公共 API。
  // 增删改任何导出都会使快照失败——此时须同步:
  //   1) bump host-global.ts 的 HOST_API_VERSION;
  //   2) `npx jest -u` 显式更新快照;
  //   3) 同步插件仓库(web/agentui)对宿主 API 的消费。
  // 1.2.0:chat 命名空间;1.3.0:chat 增 submitApproval/submitClarify/history。
  it('导出面契约快照(变更须 bump HOST_API_VERSION)', () => {
    installAgentUIHostGlobal();
    const agentUI = agentUiGlobal();
    expect({
      version: agentUI.HOST_API_VERSION,
      globalKeys: Object.keys(agentUI).sort(),
      hostKeys: Object.keys(agentUI.host).sort(),
      chatKeys: Object.keys(agentUI.chat).sort(),
    }).toMatchInlineSnapshot(`
      {
        "chatKeys": [
          "completions",
          "createSession",
          "history",
          "submitApproval",
          "submitClarify",
        ],
        "globalKeys": [
          "HOST_API_VERSION",
          "chat",
          "host",
          "on",
          "registerApp",
        ],
        "hostKeys": [
          "getApiToken",
        ],
        "version": "1.3.0",
      }
    `);
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

  // peer.react / apiVersion 属兼容性声明(2026-10-14 起从 rejectReason 拆出):
  // 结构错误 = 不注册;兼容失败 = 卡片保留 + 明确原因(不静默消失)
  it('版本声明不再属于结构校验(合法元数据即使 peer/apiVersion 不满足也通过 rejectReason)', () => {
    expect(rejectReason({ ...meta, peer: { react: '^19' } })).toBeNull();
    expect(rejectReason({ ...meta, apiVersion: '^2.0.0' })).toBeNull();
  });
});

describe('compatibilityReason(兼容性校验:卡片保留+明确原因)', () => {
  it('合法元数据兼容', () => {
    expect(compatibilityReason(meta)).toBeNull();
  });

  it('peer.react 主版本不满足 → 原因含声明与宿主版本', () => {
    const reason = compatibilityReason({ ...meta, peer: { react: '^19' } });
    expect(reason).toContain('peer.react');
    expect(reason).toContain('^19');
    expect(compatibilityReason({ ...meta, peer: { react: '>=17' } })).toBeNull();
  });

  it('apiVersion 区间不满足 → 原因含声明与宿主 API 版本;缺省/满足区间放行', () => {
    const reason = compatibilityReason({ ...meta, apiVersion: '^2.0.0' });
    expect(reason).toContain('apiVersion');
    expect(reason).toContain('^2.0.0');
    expect(compatibilityReason({ ...meta, apiVersion: '^1.0.0' })).toBeNull();
    expect(compatibilityReason({ ...meta, apiVersion: undefined })).toBeNull();
  });

  it('不兼容插件仍注册:toModuleDefinition 卡片带 incompatibleReason(深链可见明确提示)', () => {
    const def = toModuleDefinition(
      { ...meta, apiVersion: '^2.0.0' },
      compatibilityReason({ ...meta, apiVersion: '^2.0.0' }) ?? undefined,
    );
    expect(def.app?.incompatibleReason).toContain('apiVersion');
    expect(def.routes.map((r) => r.path)).toEqual(['/cognitive-wargame/*']);
    // 兼容插件无标注
    expect(toModuleDefinition(meta).app?.incompatibleReason).toBeUndefined();
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

describe('Tier B host 插件(canvas-stage4 spec §9.2)', () => {
  const hostMeta: PluginAppMetadata = {
    ...meta,
    id: 'canvas',
    path: '/agent',
    label: 'Canvas',
    type: 'host',
    routes: ['/agent/:id', '/agent/:id/explore', '/agent/share'],
    sharedVersion: '^1.0.0',
  };

  it('rejectReason:host 插件缺 routes 或路由越出挂载前缀 → 拒绝', () => {
    expect(rejectReason(hostMeta)).toBeNull();
    expect(rejectReason({ ...hostMeta, routes: [] })).toContain('routes');
    expect(
      rejectReason({ ...hostMeta, routes: ['/other/:id'] }),
    ).toContain('越出挂载前缀');
    expect(rejectReason({ ...hostMeta, routes: ['/agent/../etc'] })).toContain(
      '越出挂载前缀',
    );
    // Tier A 无 routes 声明不受影响
    expect(rejectReason(meta)).toBeNull();
  });

  it('compatibilityReason:sharedVersion 三层判定(缺省放行/满足放行/不满足给原因)', () => {
    expect(compatibilityReason(hostMeta)).toBeNull();
    expect(
      compatibilityReason({ ...hostMeta, sharedVersion: undefined }),
    ).toBeNull();
    const reason = compatibilityReason({
      ...hostMeta,
      sharedVersion: '^2.0.0',
    });
    expect(reason).toContain('sharedVersion');
    expect(reason).toContain('^2.0.0');
  });

  it('toHostModuleDefinition:按声明路由表生成懒包装,零 bundle 拉取、无应用卡片', () => {
    const def = toHostModuleDefinition(hostMeta);
    expect(def.name).toBe('plugin:canvas');
    expect(def.routes.map((r) => r.path)).toEqual(hostMeta.routes);
    for (const route of def.routes) {
      expect(typeof route.Component).toBe('function');
    }
    expect(def.app).toBeUndefined();
  });

  it('toHostModuleDefinition 不兼容 → 回退 Tier A 原因页形态(path/* + 卡片标注)', () => {
    const reason = compatibilityReason({ ...hostMeta, sharedVersion: '^2.0.0' })!;
    const def = toHostModuleDefinition(hostMeta, reason);
    expect(def.routes.map((r) => r.path)).toEqual(['/agent/*']);
    expect(def.app?.incompatibleReason).toContain('sharedVersion');
  });

  it('initRuntimePlugins 写入 R2 压制标记(结构性合法 id 集合)', async () => {
    resetInitForTests();
    resetPluginListWatchForTests();
    delete (globalThis as Record<string, unknown>)[RUNTIME_PLUGIN_IDS_KEY];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [hostMeta, { ...meta, id: '' }],
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await initRuntimePlugins();
      const ids = (globalThis as Record<string, unknown>)[
        RUNTIME_PLUGIN_IDS_KEY
      ] as Set<string>;
      expect(ids).toBeInstanceOf(Set);
      expect(ids.has('canvas')).toBe(true);
      // 结构非法元数据不入标记
      expect(ids.size).toBe(1);
    } finally {
      resetPluginListWatchForTests();
    }
  });
});

describe('startPluginListWatch(后台刷新提示,#10)', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as Response;
  // jsdom 无全局 fetch(宿主真实用法即裸 fetch),直接赋值 stub
  const stubFetch = (impl: () => Promise<Response>) => {
    const fn = jest.fn(impl);
    (globalThis as { fetch?: unknown }).fetch = fn;
    return () => {
      delete (globalThis as { fetch?: unknown }).fetch;
    };
  };

  it('首个周期建立基线(静默);列表变化提示一次;翻回注册基线不再提示', async () => {
    const infoMock = jest.mocked(toast.info);
    infoMock.mockClear();
    resetPluginListWatchForTests();
    jest.useFakeTimers();
    // 第一次检查:基线为 null 时不提示——首查即基线
    // 第二次检查:version 变化 → 指纹变化 → 提示
    // 第三次检查:与上次相同 → 不再提示
    // 第四次检查:翻回注册基线 → 页面本就一致,不提示(评审 P3 防振荡)
    const responses = [
      okResponse([meta]),
      okResponse([{ ...meta, version: '2.0.0' }]),
      okResponse([{ ...meta, version: '2.0.0' }]),
      okResponse([meta]),
    ];
    const restoreFetch = stubFetch(async () =>
      responses.length > 1 ? responses.shift()! : responses[0]!,
    );

    const stop = startPluginListWatch();
    try {
      await jest.advanceTimersByTimeAsync(60_000);
      expect(infoMock).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(60_000);
      expect(infoMock).toHaveBeenCalledTimes(1);
      // i18n 未初始化时 t() 返回 key 本身;断言为字符串即可(词条映射无需单测)
      expect(typeof infoMock.mock.calls[0]?.[0]).toBe('string');

      await jest.advanceTimersByTimeAsync(60_000);
      expect(infoMock).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(infoMock).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      restoreFetch();
      jest.useRealTimers();
    }
  });

  it('窗口聚焦触发检查但受节流约束(30s 内不重复)', async () => {
    const infoMock = jest.mocked(toast.info);
    infoMock.mockClear();
    resetPluginListWatchForTests();
    jest.useFakeTimers();
    let calls = 0;
    const restoreFetch = stubFetch(async () => {
      calls += 1;
      return okResponse([meta]);
    });

    const stop = startPluginListWatch();
    try {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      expect(calls).toBe(1); // 首次聚焦:距上次检查超过节流窗口,执行

      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      expect(calls).toBe(1); // 节流:30s 内不重复

      await jest.advanceTimersByTimeAsync(30_001);
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      expect(calls).toBe(2); // 节流窗口过后再次执行
    } finally {
      stop();
      restoreFetch();
      jest.useRealTimers();
    }
  });
});
