/**
 * Tier B 共享面契约快照(docs/canvas-stage4-independent-build-spec.md §五/R1):
 * 锁定 window.__AGENTUI_SHARED__ 的版本、模块清单与各模块导出名——
 * **改签名/删模块/删导出会让本测试红**,此时必须 bump SHARED_API_VERSION
 * (major)并同步 @agentui/plugin-sdk 的 host 段版本;新增模块/导出 = minor,
 * 快照更新 + CHANGELOG「Shared API」小节。
 */
import {
  AGENTUI_SHARED_GLOBAL_KEY,
  buildAgentUISharedHost,
  installAgentUISharedHost,
} from '../host-externals';
import { getSharedHost, SHARED_API_VERSION } from '@agentui/plugin-sdk/host';

describe('Tier B 共享面(__AGENTUI_SHARED__,canvas 档)', () => {
  it('SHARED_API_VERSION 三处同源(SDK 声明 = 安装值 = 快照锁定值)', () => {
    const shared = buildAgentUISharedHost();
    expect(shared.SHARED_API_VERSION).toBe(SHARED_API_VERSION);
    expect(shared.SHARED_API_VERSION).toBe('1.0.0');
  });

  it('ui 白名单模块清单锁定(canvas 实际消费集;新增走 minor,删除=major)', () => {
    const shared = buildAgentUISharedHost();
    expect(Object.keys(shared.ui).sort()).toEqual([
      'accordion',
      'breadcrumb',
      'button',
      'card',
      'checkbox',
      'collapsible',
      'command',
      'date-picker',
      'dialog',
      'dropdown-menu',
      'form',
      'hover-card',
      'input',
      'intellect-pagination',
      'label',
      'message',
      'modal',
      'multi-select',
      'popover',
      'progress',
      'radio',
      'radio-group',
      'scroll-area',
      'select',
      'separator',
      'sheet',
      'skeleton',
      'spin',
      'switch',
      'table',
      'tabs',
      'textarea',
      'tooltip',
    ]);
  });

  it('单例面齐备:react/reactDom/reactDomClient/reactQuery/i18n/lib.cn', () => {
    const shared = buildAgentUISharedHost();
    // namespace 非空且含标志性导出(结构抽查,导出全集由下方契约快照锁定)
    const keysOf = (ns: unknown) => Object.keys(ns as Record<string, unknown>);
    expect(keysOf(shared.react)).toContain('useState');
    expect(keysOf(shared.reactDomClient)).toContain('createRoot');
    expect(keysOf(shared.reactQuery)).toContain('QueryClient');
    expect(shared.i18n).toBeDefined();
    expect(typeof shared.lib.cn).toBe('function');
  });

  it('契约快照:各模块导出名(删改导出必须 bump SHARED_API_VERSION)', () => {
    const shared = buildAgentUISharedHost();
    const contract: string[] = [];
    for (const [mod, namespace] of Object.entries(shared.ui)) {
      const names = Object.keys(namespace as Record<string, unknown>).sort();
      contract.push(`${mod}: ${names.join(', ')}`);
    }
    expect(contract.join('\n')).toMatchSnapshot();
  });

  it('install 幂等:重复安装返回同一全局,且 getSharedHost 可读', () => {
    const first = installAgentUISharedHost();
    const second = installAgentUISharedHost();
    expect(second).toBe(first);
    expect(
      (globalThis as Record<string, unknown>)[AGENTUI_SHARED_GLOBAL_KEY],
    ).toBe(first);
    expect(getSharedHost()?.SHARED_API_VERSION).toBe(SHARED_API_VERSION);
  });
});
