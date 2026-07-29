/**
 * 安全 JSON 序列化（P3 启用）
 *
 * 处理以下不可序列化类型：
 * - 循环引用：替换为 '[Circular]'
 * - function：替换为 '[Function]'
 * - symbol：替换为 '[Symbol: <description>]'
 * - bigint：替换为 '[BigInt: <value>]'
 *
 * 兜底：若 JSON.stringify 仍抛错（如 WeakMap/WeakSet 键），返回对象类型字符串。
 */
export function safeJsonSerialize(value: unknown): unknown {
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        if (typeof v === 'function') return '[Function]';
        if (typeof v === 'symbol') return `[Symbol: ${v.toString()}]`;
        if (typeof v === 'bigint') return `[BigInt: ${v.toString()}]`;
        return v;
      }),
    );
  } catch {
    return Object.prototype.toString.call(value);
  }
}
