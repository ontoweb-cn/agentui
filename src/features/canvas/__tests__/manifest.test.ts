/**
 * 编译期 canvas 注册的 R2 压制测试(canvas-stage4 spec §9.2):
 * 运行时插件 id 标记(window.__AGENTUI_RUNTIME_PLUGIN_IDS__)含 'canvas' 时,
 * 编译期 manifest 必须放弃注册;未装/卸载后回退默认 enabled 语义。
 */
import manifest from '../manifest';
import type { ModuleContext } from '@/features/_types';

const ctx = (capabilities: string[] = []): ModuleContext => ({
  isEnterprise: false,
  capabilities: new Set(capabilities),
});

const setFlag = (ids: string[]) => {
  (globalThis as Record<string, unknown>).__AGENTUI_RUNTIME_PLUGIN_IDS__ =
    new Set(ids);
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>)
    .__AGENTUI_RUNTIME_PLUGIN_IDS__;
});

describe('features/canvas/manifest R2 压制', () => {
  it('routes 与包定义保持一致(深链零回归的静态保证)', () => {
    expect(manifest.name).toBe('canvas');
    expect(manifest.routes.map((r) => r.path)).toEqual([
      '/agent/:id',
      '/agent/:id/explore',
      '/agent/share',
    ]);
    const share = manifest.routes.find((r) => r.path === '/agent/share');
    expect(share?.layout).toBe(false);
  });

  it('无标记(未装运行时插件):默认 enabled 语义(能力空集放行)', () => {
    expect(manifest.enabled?.(ctx())).toBe(true);
    expect(manifest.enabled?.(ctx(['canvas']))).toBe(true);
    expect(manifest.enabled?.(ctx(['other']))).toBe(false);
  });

  it('标记含 canvas:无条件退位(能力与否均不注册)', () => {
    setFlag(['canvas']);
    expect(manifest.enabled?.(ctx())).toBe(false);
    expect(manifest.enabled?.(ctx(['canvas']))).toBe(false);
  });

  it('标记仅含其它插件:不影响编译期注册', () => {
    setFlag(['cognitive-wargame']);
    expect(manifest.enabled?.(ctx())).toBe(true);
  });
});
