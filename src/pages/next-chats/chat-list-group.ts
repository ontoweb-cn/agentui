import type { IDialog } from '@/interfaces/database/chat';
import { groupByDate, type DateGroupKey } from '@/utils/date-group';
import { toEpochMs } from '@/utils/message-time';

export type ChatDateGroupKey = DateGroupKey;

/** 聊天列表按更新时间分组,与 TaskList 的 Today/Yesterday/Earlier 视觉对齐。 */
export function groupChatsByDate(
  chats: IDialog[],
  now = Date.now(),
): Array<{ key: ChatDateGroupKey; chats: IDialog[] }> {
  return groupByDate(
    chats,
    (chat) => toEpochMs(chat.update_date) ?? toEpochMs(chat.update_time),
    now,
  ).map((group) => ({ key: group.key, chats: group.items }));
}
