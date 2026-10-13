import { collectApps, collectNav, enabledModules } from './_registry';
import mainEn from '@/locales/en';
import mainZh from '@/locales/zh';
import appEn from './applications/locales/en';
import appZh from './applications/locales/zh';

// 菜单需求(首页为导航栏静态项,不在 collectNav 范围内):
// 任务(聊天/智能体)、知识(知识库/文件管理/搜索)→记忆→应用。
// order 定义在各模块 manifest,此测试防止 order 调整或新模块加入悄悄改变菜单顺序。
//
// cognitive-wargame 已迁出为运行时插件(cognitive-wargame 仓库 web/agentui,
// 经 BFF /plugins 元数据 + src/plugins 装载,见 docs/cognitive-wargame-plugin-migration-design.md):
// 编译期不再有 wargame 模块,应用卡片与路由由运行时 registry 注入,
// 其词条/断言随插件仓库测试维护。
describe('feature registry:顶部导航与应用插件', () => {
  it('导航项顺序符合菜单需求', () => {
    expect(collectNav().map((n) => n.path)).toEqual([
      '/tasks',
      '/knowledge',
      '/memories',
      '/applications',
    ]);
  });

  it('聊天/智能体/知识库/文件管理/搜索已并入 hub,不再占用顶部导航', () => {
    for (const name of ['chats', 'agents', 'datasets', 'files', 'searches']) {
      const mod = enabledModules.find((m) => m.name === name);
      expect(mod).toBeDefined();
      expect(mod?.nav ?? []).toHaveLength(0);
    }
  });

  it('cognitive-wargame 已迁出为运行时插件,编译期不再注册', () => {
    expect(
      enabledModules.find((m) => m.name === 'cognitive-wargame'),
    ).toBeUndefined();
    expect(
      enabledModules.find((m) => m.name.startsWith('plugin:')),
    ).toBeUndefined();
  });

  it('编译期应用列表为空,wargame 卡片由运行时插件注入', () => {
    // 单测环境不执行 initRuntimePlugins bootstrap,collectApps 应为空;
    // 运行时注入路径由 src/plugins/__tests__ 覆盖。
    expect(collectApps()).toEqual([]);
  });

  // 防止重命名 i18n key 导致页面显示裸 key(如 header.applications)
  describe('导航与页面引用的 i18n key 存在', () => {
  it('header.applications 在主词条 zh/en 中存在', () => {
    // 主词条默认导出包裹在 translation 命名空间下
    expect(mainZh.translation.header.applications).toBeTruthy();
    expect(mainEn.translation.header.applications).toBeTruthy();
  });

  it('header.tasks(任务导航项)在主词条 zh/en 中存在', () => {
    expect(mainZh.translation.header.tasks).toBeTruthy();
    expect(mainEn.translation.header.tasks).toBeTruthy();
  });

  it('header.knowledge(知识导航项)在主词条 zh/en 中存在', () => {
    expect(mainZh.translation.header.knowledge).toBeTruthy();
    expect(mainEn.translation.header.knowledge).toBeTruthy();
  });

    it('应用页文案在模块词条 zh/en 中存在', () => {
      for (const bundle of [appZh, appEn]) {
        expect(bundle.applications.title).toBeTruthy();
        expect(bundle.applications.subtitle).toBeTruthy();
        expect(bundle.applications.enter).toBeTruthy();
        expect(bundle.applications.empty).toBeTruthy();
        expect(bundle.applications.emptyDescription).toBeTruthy();
      }
    });
  });
});
