import dayjs from 'dayjs';

export type DateGroupKey = 'today' | 'yesterday' | 'earlier';

export interface DateGroup<T> {
  key: DateGroupKey;
  items: T[];
}

/**
 * 按本地日期把列表分为今天/昨天/更早,组内保持原顺序。
 * 无有效时间戳的项归入 earlier。
 */
export function groupByDate<T>(
  items: T[],
  getTimestamp: (item: T) => number | undefined,
  now = Date.now(),
): DateGroup<T>[] {
  const today = dayjs(now).format('YYYY-MM-DD');
  const yesterday = dayjs(now).subtract(1, 'day').format('YYYY-MM-DD');

  const buckets: Record<DateGroupKey, T[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const item of items) {
    const timestamp = getTimestamp(item);
    if (timestamp === undefined) {
      buckets.earlier.push(item);
      continue;
    }
    const date = dayjs(timestamp).format('YYYY-MM-DD');
    if (date === today) buckets.today.push(item);
    else if (date === yesterday) buckets.yesterday.push(item);
    else buckets.earlier.push(item);
  }

  return (['today', 'yesterday', 'earlier'] as const)
    .map((key) => ({ key, items: buckets[key] }))
    .filter((group) => group.items.length > 0);
}
