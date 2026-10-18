import type { IDialog } from '@/interfaces/database/chat';

import { groupChatsByDate } from '../chat-list-group';

function makeChat(id: string, updateDate: string): IDialog {
  return {
    id,
    name: id,
    update_date: updateDate,
  } as IDialog;
}

describe('groupChatsByDate', () => {
  it('按今天/昨天/更早分组并保留组内顺序', () => {
    const now = new Date('2026-10-19T12:00:00+08:00').getTime();
    const chats = [
      makeChat('today-1', '2026-10-19T09:00:00+08:00'),
      makeChat('yesterday', '2026-10-18T09:00:00+08:00'),
      makeChat('today-2', '2026-10-19T10:00:00+08:00'),
      makeChat('old', '2026-10-01T09:00:00+08:00'),
    ];

    const groups = groupChatsByDate(chats, now);
    expect(groups.map((group) => group.key)).toEqual([
      'today',
      'yesterday',
      'earlier',
    ]);
    expect(groups[0].chats.map((chat) => chat.id)).toEqual([
      'today-1',
      'today-2',
    ]);
  });

  it('无有效时间的会话归入 earlier', () => {
    const now = new Date('2026-10-19T12:00:00+08:00').getTime();
    const chats = [
      { id: 'no-date', name: 'no-date', update_date: '' } as IDialog,
    ];
    const groups = groupChatsByDate(chats, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('earlier');
    expect(groups[0].chats[0].id).toBe('no-date');
  });
});
