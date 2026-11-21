import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetImtSessionMapForTest,
  lookupImtSessions,
  recordImtSession,
  removeImtSessions,
  revokeImtSessions,
} from './imt-session-map';

const TMP = mkdtempSync(join(tmpdir(), 'imt-map-'));

beforeEach(() => {
  process.env.BFF_IMT_SESSION_MAP_FILE = join(TMP, 'imt-session-map.json');
  __resetImtSessionMapForTest();
});

describe('imt 会话映射（A1+A4）', () => {
  it('记录 → 撤销返回全部令牌并清空', () => {
    recordImtSession('e2epwd001', 'imt_a');
    recordImtSession('e2epwd001', 'imt_b');
    recordImtSession('other', 'imt_c');

    const revoked = revokeImtSessions('e2epwd001');
    expect(revoked.sort()).toEqual(['imt_a', 'imt_b']);
    // 其它用户不受影响
    expect(revokeImtSessions('other')).toEqual(['imt_c']);
    // 已清空 → 再次撤销为空
    expect(revokeImtSessions('e2epwd001')).toEqual([]);
  });

  it('重复记录同一令牌去重', () => {
    recordImtSession('e2epwd001', 'imt_a');
    recordImtSession('e2epwd001', 'imt_a');
    expect(revokeImtSessions('e2epwd001')).toEqual(['imt_a']);
  });

  it('持久化跨实例（重开文件读取）', () => {
    recordImtSession('e2epwd001', 'imt_persist');
    // 同文件新读取（模拟 BFF 内另一处调用）
    expect(lookupImtSessions('e2epwd001')).toEqual(['imt_persist']);
    removeImtSessions('e2epwd001', ['imt_persist']);
    expect(lookupImtSessions('e2epwd001')).toEqual([]);
  });

  it('lookup 与 remove 分离：撤销失败可保留映射待重试（评审 F-R1）', () => {
    recordImtSession('e2epwd001', 'imt_keep');
    const tokens = lookupImtSessions('e2epwd001');
    expect(tokens).toEqual(['imt_keep']);
    // 模拟撤销失败：不移除 → IdP 重试时仍可定位
    expect(lookupImtSessions('e2epwd001')).toEqual(['imt_keep']);
    removeImtSessions('e2epwd001', []);
    expect(lookupImtSessions('e2epwd001')).toEqual(['imt_keep']);
    // 全部成功后移除
    removeImtSessions('e2epwd001', tokens);
    expect(lookupImtSessions('e2epwd001')).toEqual([]);
  });

  it('记录超过上限丢弃最旧（评审 F-Q1）', () => {
    for (let i = 0; i < 10; i++) {
      recordImtSession('e2epwd001', `imt_${i}`);
    }
    const tokens = lookupImtSessions('e2epwd001');
    expect(tokens.length).toBe(8);
    expect(tokens[0]).toBe('imt_2'); // 最旧的两个被丢弃
    expect(tokens[tokens.length - 1]).toBe('imt_9');
  });


  it('非法入参忽略', () => {
    recordImtSession('', 'imt_x');
    recordImtSession('sub', '');
    expect(revokeImtSessions('sub')).toEqual([]);
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });
});
