import dayjs from 'dayjs';

/**
 * 将消息时间字段归一化为毫秒时间戳。
 *
 * 兼容:
 * - 秒级/毫秒级数字(Gateway `timestamp` 可能是秒)
 * - ISO 字符串 / 数字字符串(`created_at`/`createdAt`)
 */
export function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 0 && value < 1e12 ? value * 1000 : value;
    return ms > 0 ? ms : undefined;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toEpochMs(numeric);
    }
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.valueOf() : undefined;
  }

  return undefined;
}

/** 从消息对象上取 createdAt(兼容 Gateway timestamp / created_at / createdAt)。 */
export function getMessageCreatedAt(message: {
  timestamp?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
}): number | undefined {
  return toEpochMs(
    message.createdAt ?? message.created_at ?? message.timestamp,
  );
}

/** 消息时间展示格式:MM-DD HH:mm。 */
export function formatMessageTime(createdAt: number): string {
  return dayjs(createdAt).format('MM-DD HH:mm');
}
