import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { fetchChatModels, streamChat, type ChatMessage } from '../api';

/**
 * 智能体 Playground：SSE 流式对话。
 *
 * - 首轮携带 `X-Aihub-Asset-Id`，由后端注入 system prompt/kb 绑定；
 * - 会话靠 gateway 的 session-key 延续，这里只维护本地消息；
 * - 清空会 abort 当前流，避免退出后继续写入。
 */
export function AgentChat({
  assetId,
  tips,
}: {
  assetId: string;
  tips?: string[];
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchChatModels()
      .then((response) => {
        if (cancelled) return;
        const ids = response.data.items.map((item) => item.id).filter(Boolean);
        setModels(ids);
        setModel(ids[0] ?? '');
      })
      .catch(() => {
        // 模型列表不可用不阻塞对话；后端会使用默认模型。
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof list.scrollTo !== 'function') return;
    list.scrollTo({ top: list.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const history: ChatMessage[] = [
      ...messages,
      { role: 'user', content: text },
    ];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setError('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat({
        assetId,
        model,
        messages: history,
        signal: controller.signal,
        onDelta: (delta) =>
          setMessages((previous) => {
            const next = previous.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: `${last.content}${delta}`,
            };
            return next;
          }),
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setError((err as Error).message || t('aihub.chat.failed'));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  return (
    <div
      className="flex h-[420px] min-h-0 flex-col gap-2 p-5 text-sm"
      data-testid="aihub-agent-chat"
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-secondary" htmlFor="aihub-chat-model">
          {t('aihub.chat.modelLabel')}
        </label>
        <select
          id="aihub-chat-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-bg-input px-2 text-xs text-text-primary outline-none"
        >
          {models.length === 0 && (
            <option value="">{t('aihub.chat.defaultModel')}</option>
          )}
          {models.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            abortRef.current?.abort();
            setMessages([]);
            setError('');
          }}
          data-testid="aihub-chat-clear"
        >
          {t('aihub.chat.clear')}
        </Button>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-border p-3"
        data-testid="aihub-chat-messages"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 text-text-secondary">
            <p>{t('aihub.chat.empty')}</p>
            {(tips ?? []).slice(0, 4).map((tip) => (
              <button
                key={tip}
                type="button"
                className="rounded-md border border-border px-2 py-1 text-left text-xs hover:bg-bg-secondary"
                onClick={() => setInput(tip)}
              >
                {tip}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'rounded-md bg-bg-secondary p-2'
                : 'rounded-md border border-border p-2'
            }
          >
            <div className="mb-1 text-[11px] text-text-secondary">
              {t(`aihub.chat.role.${message.role}`)}
            </div>
            <p className="whitespace-pre-wrap break-words">
              {message.content ||
                (streaming && index === messages.length - 1 ? '…' : '')}
            </p>
          </div>
        ))}
        {error && (
          <p className="text-xs text-text-secondary" data-testid="aihub-chat-error">
            {t('aihub.chat.error', { message: error })}
          </p>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('aihub.chat.placeholder')}
          aria-label={t('aihub.chat.placeholder')}
          rows={2}
          className="min-h-16 flex-1 resize-none rounded border border-border bg-bg-input px-2 py-1 text-sm text-text-primary outline-none focus:border-border-button"
        />
        <Button
          type="submit"
          size="sm"
          disabled={streaming || !input.trim()}
          data-testid="aihub-chat-send"
        >
          {streaming ? t('aihub.chat.sending') : t('aihub.chat.send')}
        </Button>
      </form>
    </div>
  );
}
