import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { api, errorMessage, isApiError } from '@/services/hiedu/api';
import { maskEmail } from '@/services/hiedu/format';

/** 明文展示的最长时间；到时自动隐藏，降低肩窥与截屏风险。 */
const REVEAL_TIMEOUT_MS = 30_000;

/**
 * 邮箱 PII 字段：默认掩码；查看明文必须显式点击并调用
 * /api/persons/{id}/pii（后端会写 person.pii_view 审计）。
 */
export function PersonPIIField({
  personId,
  email,
  canRead,
}: {
  personId: number;
  email?: string | null;
  canRead: boolean;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentIdRef = useRef(personId);

  useEffect(() => {
    currentIdRef.current = personId;
    setRevealed(null);
    setError(null);
    setLoading(false);
  }, [personId]);

  useEffect(() => {
    if (revealed === null) return;
    const timer = window.setTimeout(() => setRevealed(null), REVEAL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setRevealed(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  async function handleReveal() {
    setLoading(true);
    setError(null);
    const requestedId = personId;
    try {
      const result = await api.personPII(requestedId);
      if (currentIdRef.current !== requestedId) return;
      setRevealed(result.data.email?.trim() || '未登记');
    } catch (err) {
      if (currentIdRef.current !== requestedId) return;
      if (isApiError(err) && err.status === 403) {
        setError('当前账号没有查看 PII 明文的权限');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            revealed !== null
              ? 'text-sm font-medium text-state-warning'
              : 'text-sm text-text-primary'
          }
        >
          {revealed ?? maskEmail(email)}
        </span>
        {canRead && revealed === null ? (
          <Button variant="outline" size="sm" onClick={handleReveal} disabled={loading}>
            {loading ? '查询中…' : '查看明文'}
          </Button>
        ) : null}
        {revealed !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRevealed(null);
              setError(null);
            }}
          >
            隐藏
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-state-error">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-text-tertiary">
        {canRead
          ? '查看明文会写入 PII 访问审计，请谨慎操作。'
          : '当前账号无 person:pii:read 权限，无法查看明文。'}
      </p>
    </div>
  );
}
