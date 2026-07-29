/**
 * OfflineBanner — 离线横幅（P2）
 *
 * 参考 webui showOfflineBanner (ui.js L16-112)，但移除 fetch monkey-patch
 * （与 project_memory 约束 "fetchWithRagToken 显式列出参数" 冲突，且影响所有 HTTP 请求）。
 *
 * 行为：
 * - 仅响应 navigator.onLine 状态变化
 * - 离线时显示黄色横幅
 * - 重连探针：每 30s 探测 /health（GET，5s 超时），恢复在线时自动消失
 * - "立即重试"按钮：手动触发探针
 *
 * 已知限制（Q12）：
 * - navigator.onLine 在 captive portal / DNS 故障场景下可能误报为 true，
 *   此时本横幅不显示，但实际网络不可达。SSE/HTTP 错误仍由各业务模块处理。
 */
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PROBE_INTERVAL_MS = 30 * 1000; // 30s 探测周期
const PROBE_TIMEOUT_MS = 5 * 1000; // 5s 超时，避免按钮长时间禁用

export function OfflineBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [probing, setProbing] = useState(false);
  const probeTimer = useRef<ReturnType<typeof setInterval>>();

  const updateOnlineStatus = useCallback(() => {
    setVisible(!navigator.onLine);
  }, []);

  const probe = useCallback(async () => {
    if (navigator.onLine) {
      setVisible(false);
      return;
    }
    setProbing(true);
    // 5s 超时，避免离线场景下 fetch 默认 60s+ 超时导致按钮长时间禁用
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      // 用 GET 探测 /health（BFF 仅注册 GET，HEAD 会返回 404）
      await fetch('/health', { method: 'GET', cache: 'no-store', signal: controller.signal });
      // fetch 成功说明网络恢复（navigator.onLine 可能滞后）
      setVisible(false);
      // 注：不派发原生 'online' 事件，避免污染其他模块（如 React Query）的 online 状态感知。
      // 其他模块的 online 监听应依赖浏览器原生事件，本横幅仅负责 UI 反馈。
    } catch {
      // 探测失败或超时，保持离线状态
    } finally {
      clearTimeout(timeoutId);
      setProbing(false);
    }
  }, []);

  // 监听 online/offline 事件
  useEffect(() => {
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, [updateOnlineStatus]);

  // 离线时启动重连探针（首次立即探测，之后按周期）
  useEffect(() => {
    if (visible) {
      probe(); // 立即探测一次，避免首次需等 30s
      probeTimer.current = setInterval(probe, PROBE_INTERVAL_MS);
      return () => {
        if (probeTimer.current) clearInterval(probeTimer.current);
      };
    }
  }, [visible, probe]);

  if (!visible) return null;

  return (
    <div className="bg-yellow-500 text-black px-4 py-2 text-sm flex items-center gap-2 justify-center">
      <WifiOff className="h-4 w-4 flex-shrink-0" />
      <span>{t('offline.browser')}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="link"
            size="sm"
            onClick={probe}
            disabled={probing}
            className="h-auto p-1 text-black underline"
          >
            {probing ? t('offline.probing') : t('offline.retry')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('offline.retryTip')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
