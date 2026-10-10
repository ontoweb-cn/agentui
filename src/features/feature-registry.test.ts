import { collectApps, collectNav, enabledModules } from './_registry';
import mainEn from '@/locales/en';
import mainZh from '@/locales/zh';
import appEn from './applications/locales/en';
import appZh from './applications/locales/zh';
import wargameEn from './cognitive-wargame/locales/en';
import wargameZh from './cognitive-wargame/locales/zh';

// 菜单需求(首页为导航栏静态项,不在 collectNav 范围内):
// 任务(聊天/智能体)、知识(知识库/文件管理/搜索)→记忆→应用。
// order 定义在各模块 manifest,此测试防止 order 调整或新模块加入悄悄改变菜单顺序。
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

  it('cognitive-wargame 收敛为应用插件,不占用顶部导航', () => {
    const wargame = enabledModules.find((m) => m.name === 'cognitive-wargame');
    expect(wargame).toBeDefined();
    expect(wargame?.nav ?? []).toHaveLength(0);
  });

  it('应用列表包含 cognitive-wargame,入口为 /cognitive-wargame', () => {
    const apps = collectApps();
    expect(apps.map((a) => a.id)).toEqual(['cognitive-wargame']);
    expect(apps[0].path).toBe('/cognitive-wargame');
    expect(apps[0].labelKey).toBe('cognitiveWargame.common.title');
    expect(apps[0].descriptionKey).toBe('cognitiveWargame.common.subtitle');
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

    it('认知博弈 app 卡片文案在模块词条 zh/en 中存在', () => {
      for (const bundle of [wargameZh, wargameEn]) {
        expect(bundle.cognitiveWargame.common.title).toBeTruthy();
        expect(bundle.cognitiveWargame.common.subtitle).toBeTruthy();
      }
    });
  });
});
