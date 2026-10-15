/**
 * plugin-compat-fixture 兼容基线(canvas 阶段 4 spec §七 R3,差距 G7 清偿):
 * 机制化验证"v1.0 代 SDK 声明的插件 × 当前宿主"仍判定兼容——宿主每次发版
 * 该测试必须绿,否则即破坏了老插件装载契约(见 packages/plugin-compat-fixture/README)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  compatibilityReason,
  rejectReason,
  toModuleDefinition,
} from '../runtime';
import type { PluginAppMetadata } from '../types';

const fixtureDir = resolve(
  __dirname,
  '../../../packages/plugin-compat-fixture',
);

const fixtureMeta = JSON.parse(
  readFileSync(resolve(fixtureDir, 'app.json'), 'utf-8'),
) as PluginAppMetadata;

describe('plugin-compat-fixture(老 apiVersion 声明 × 新宿主)', () => {
  it('夹具声明 v1.0 代 SDK(^1.0.0),当前宿主判定结构合法且兼容', () => {
    expect(fixtureMeta.apiVersion).toBe('^1.0.0');
    expect(rejectReason(fixtureMeta)).toBeNull();
    expect(compatibilityReason(fixtureMeta)).toBeNull();
  });

  it('冻结产物存在且形态正确;经注册器获得路由与卡片,无不兼容标注', () => {
    const entry = readFileSync(resolve(fixtureDir, fixtureMeta.entry!), 'utf-8');
    expect(entry).toContain('window.AgentUI.registerApp');
    expect(entry).toContain("'compat-fixture'");

    const def = toModuleDefinition(fixtureMeta);
    expect(def.app?.incompatibleReason).toBeUndefined();
    expect(def.routes.map((r) => r.path)).toEqual(['/compat-fixture/*']);
  });

  it('反向断言:同夹具若声明 ^2.0.0 则被标记不兼容(判定器对老声明的宽容只向同 major 开放)', () => {
    const reason = compatibilityReason({
      ...fixtureMeta,
      apiVersion: '^2.0.0',
    });
    expect(reason).toContain('apiVersion');
  });
});
