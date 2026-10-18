import {
  formatMessageTime,
  getMessageCreatedAt,
  toEpochMs,
} from '../message-time';

describe('message-time', () => {
  it('秒级与毫秒级时间戳归一化', () => {
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('ISO 字符串与数字字符串', () => {
    expect(toEpochMs('2026-10-18T10:00:00+08:00')).toBe(
      new Date('2026-10-18T10:00:00+08:00').getTime(),
    );
    expect(toEpochMs('1700000000')).toBe(1_700_000_000_000);
  });

  it('非法值返回 undefined', () => {
    expect(toEpochMs(undefined)).toBeUndefined();
    expect(toEpochMs('')).toBeUndefined();
    expect(toEpochMs('not-a-date')).toBeUndefined();
    expect(toEpochMs(0)).toBeUndefined();
  });

  it('getMessageCreatedAt 兼容三种字段', () => {
    expect(getMessageCreatedAt({ timestamp: 1_700_000_000 })).toBe(
      1_700_000_000_000,
    );
    expect(getMessageCreatedAt({ created_at: '2026-10-18T10:00:00Z' })).toBe(
      new Date('2026-10-18T10:00:00Z').getTime(),
    );
    expect(getMessageCreatedAt({ createdAt: 1_700_000_000_000 })).toBe(
      1_700_000_000_000,
    );
  });

  it('formatMessageTime 输出 MM-DD HH:mm', () => {
    const ms = new Date('2026-10-18T10:05:00+08:00').getTime();
    expect(formatMessageTime(ms)).toBe('10-18 10:05');
  });
});
