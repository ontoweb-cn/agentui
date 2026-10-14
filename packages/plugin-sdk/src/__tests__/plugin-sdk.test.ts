/**
 * @agentui/plugin-sdk 单测(宿主 jest 收集,mapper 解析包内相对导入)。
 * satisfiesApiVersion 是宿主装载校验与插件自检的共同语义,矩阵必须锁死。
 */
import {
  SDK_VERSION,
  definePlugin,
  getHostApiVersion,
  parseApiVersionRange,
  satisfiesApiVersion,
} from '../index';

describe('parseApiVersionRange(格式解析)', () => {
  it.each([
    '*',
    '^1.3.0',
    '~1.3',
    '>=2',
    '>1.2.3',
    '=1.3.0',
    '1.3.0',
    ' 1.3 ',
  ])('解析合法形态 %s', (range) => {
    expect(parseApiVersionRange(range)).not.toBeNull();
  });

  it.each(['1.3.x', '^abc', '>=', '1.2.3.4', 'latest', ''])(
    '拒绝非法形态 %s',
    (range) => {
      expect(parseApiVersionRange(range)).toBeNull();
    },
  );
});

describe('satisfiesApiVersion(装载校验语义,与 BFF 格式校验双端分工)', () => {
  it('缺省/空串/星号 = 任意版本兼容', () => {
    expect(satisfiesApiVersion(undefined, '0.0.1')).toBe(true);
    expect(satisfiesApiVersion('', '99.0.0')).toBe(true);
    expect(satisfiesApiVersion('*', '1.0.0')).toBe(true);
  });

  it('非法形态宽容放行(格式由安装侧硬校验拦截)', () => {
    expect(satisfiesApiVersion('latest', '1.0.0')).toBe(true);
    expect(satisfiesApiVersion('1.3.x', '1.0.0')).toBe(true);
  });

  it('^ 语义:同 major 且不低于声明;跨 major 不兼容(兼容策略核心)', () => {
    expect(satisfiesApiVersion('^1.0.0', '1.3.0')).toBe(true);
    expect(satisfiesApiVersion('^1.3.0', '1.3.0')).toBe(true);
    expect(satisfiesApiVersion('^1.3.0', '1.2.9')).toBe(false);
    // 老 SDK 插件在新宿主上:同 major → 兼容(需求"一定的兼容能力")
    expect(satisfiesApiVersion('^1.0.0', '1.99.0')).toBe(true);
    // 新 SDK 插件在老宿主上:明确不兼容(宿主将给出提示)
    expect(satisfiesApiVersion('^2.0.0', '1.99.0')).toBe(false);
  });

  it('~ 语义:同 major.minor 且不低于补丁', () => {
    expect(satisfiesApiVersion('~1.3.0', '1.3.2')).toBe(true);
    expect(satisfiesApiVersion('~1.3.0', '1.4.0')).toBe(false);
  });

  it('>= 与裸版本:不低于声明', () => {
    expect(satisfiesApiVersion('>=1.0.0', '1.3.0')).toBe(true);
    expect(satisfiesApiVersion('1.3', '1.3.0')).toBe(true);
    expect(satisfiesApiVersion('2', '1.9.9')).toBe(false);
  });

  it('= 精确与 > 严格更新', () => {
    expect(satisfiesApiVersion('=1.3.0', '1.3.0')).toBe(true);
    expect(satisfiesApiVersion('=1.3.0', '1.4.0')).toBe(false);
    expect(satisfiesApiVersion('>1.3.0', '1.3.1')).toBe(true);
    expect(satisfiesApiVersion('>1.3.0', '1.3.0')).toBe(false);
  });

  it('缺省 hostVersion 读全局;非宿主环境(null)宽容放行', () => {
    const g = globalThis as { AgentUI?: { HOST_API_VERSION: string } };
    g.AgentUI = { HOST_API_VERSION: '1.3.0' };
    expect(getHostApiVersion()).toBe('1.3.0');
    expect(satisfiesApiVersion('^1.3.0')).toBe(true);
    expect(satisfiesApiVersion('^2.0.0')).toBe(false);
    delete g.AgentUI;
    expect(getHostApiVersion()).toBeNull();
    expect(satisfiesApiVersion('^2.0.0')).toBe(true);
  });
});

describe('definePlugin(带类型注册入口)', () => {
  it('宿主存在时注册并原样返回 registration', () => {
    const registered: unknown[] = [];
    (globalThis as { AgentUI?: unknown }).AgentUI = {
      registerApp: (reg: unknown) => registered.push(reg),
    };
    const reg = {
      id: 't',
      mount: () => () => undefined,
    };
    expect(definePlugin(reg)).toBe(reg);
    expect(registered).toEqual([reg]);
    delete (globalThis as { AgentUI?: unknown }).AgentUI;
  });

  it('宿主缺失时抛出可诊断错误', () => {
    expect(() =>
      definePlugin({ id: 't', mount: () => undefined }),
    ).toThrow(/AgentUI 不存在/);
  });

  it('SDK_VERSION 与宿主契约版本同步(人工纪律的机器护栏)', () => {
    // bump 宿主 HOST_API_VERSION 时必须同步 bump 本包 version:
    // 两值在 1.3.0 对齐;漂移说明有契约变更未走 SDK 发版流程
    expect(SDK_VERSION).toBe('1.3.0');
  });
});
