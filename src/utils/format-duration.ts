/**
 * 将毫秒时长格式化为活动树/状态行的短文本。
 *
 * - < 60s:`12s`
 * - >= 60s:`1:05`
 *
 * 非法/负值统一按 0 处理,避免渲染 `NaNs`。
 */
export function formatDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safeMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
