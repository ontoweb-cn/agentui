/**
 * use-inflight-state 单元测试（P2）
 *
 * 覆盖：saveInflight / loadInflight / clearInflight / mergeInflightTailMessages
 * P2 评审修复后新增：Q5（tailStart 扫描到 user）/ Q6（数据完整性校验）/ Q11（_live 类型）
 */
import { MessageType } from '@/constants/chat';
import { IMessage } from '@/interfaces/database/chat';
import {
  __resetInflightStateForTest,
  clearInflight,
  loadInflight,
  mergeInflightTailMessages,
  saveInflight,
} from '../use-inflight-state';

// 模块级 beforeEach：清理 sessionStorage 和内存 inflightMap（含 lazy hydrate 标记）
beforeEach(() => {
  sessionStorage.clear();
  __resetInflightStateForTest();
});

function makeMessage(
  id: string,
  role: MessageType,
  content: string,
  live = false,
): IMessage {
  return {
    id,
    role,
    content,
    conversationId: 's1',
    ...(live ? { _live: true } : {}),
  };
}

describe('use-inflight-state', () => {
  describe('saveInflight / loadInflight / clearInflight', () => {
    it('saveInflight 写入后 loadInflight 可读取', () => {
      const state = {
        sessionId: 's1',
        messages: [makeMessage('m1', MessageType.User, 'hello')],
        toolCalls: [],
        reasoning: '',
        uploadedFiles: [],
        updatedAt: Date.now(),
      };
      saveInflight(state);
      const loaded = loadInflight('s1');
      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe('s1');
      expect(loaded?.messages).toHaveLength(1);
    });

    it('clearInflight 后 loadInflight 返回 null', () => {
      saveInflight({
        sessionId: 's2',
        messages: [],
        toolCalls: [],
        reasoning: '',
        uploadedFiles: [],
        updatedAt: Date.now(),
      });
      expect(loadInflight('s2')).not.toBeNull();
      clearInflight('s2');
      expect(loadInflight('s2')).toBeNull();
    });

    it('loadInflight 不存在的 sessionId 返回 null', () => {
      expect(loadInflight('non-existent')).toBeNull();
    });

    it('throttle=true 时连续写入被节流', () => {
      const now = Date.now();
      saveInflight({
        sessionId: 's3',
        messages: [],
        toolCalls: [],
        reasoning: '',
        uploadedFiles: [],
        updatedAt: now,
      });
      const first = loadInflight('s3');
      // 立即再次 throttle 写入应被跳过
      saveInflight(
        {
          sessionId: 's3',
          messages: [makeMessage('m2', MessageType.User, 'second')],
          toolCalls: [],
          reasoning: '',
          uploadedFiles: [],
          updatedAt: now,
        },
        true,
      );
      const second = loadInflight('s3');
      expect(second?.messages).toEqual(first?.messages);
    });

    it('Q6: sessionStorage 被污染时不崩溃，返回空快照', () => {
      // 注入畸形数据
      sessionStorage.setItem(
        'agentui-inflight-state',
        JSON.stringify({
          badSession: { foo: 'bar' }, // 缺少必要字段
          validSession: {
            sessionId: 'validSession',
            messages: [],
            toolCalls: [],
            reasoning: '',
            uploadedFiles: [],
            updatedAt: Date.now(),
          },
        }),
      );
      // 重新触发 hydrate
      __resetInflightStateForTest();
      // 应跳过 badSession，仅加载 validSession
      expect(loadInflight('badSession')).toBeNull();
      expect(loadInflight('validSession')).not.toBeNull();
    });

    it('Q6: sessionStorage JSON 解析失败时降级返回空', () => {
      sessionStorage.setItem('agentui-inflight-state', '{invalid json');
      __resetInflightStateForTest();
      expect(loadInflight('any')).toBeNull();
      // 后续 saveInflight 应正常工作（不抛异常）
      saveInflight({
        sessionId: 's1',
        messages: [],
        toolCalls: [],
        reasoning: '',
        uploadedFiles: [],
        updatedAt: Date.now(),
      });
      expect(loadInflight('s1')).not.toBeNull();
    });
  });

  describe('mergeInflightTailMessages', () => {
    it('空 inflight 返回 base', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      expect(mergeInflightTailMessages(base, [])).toEqual(base);
    });

    it('无 _live 标记时从最后一条 user 消息开始作为 tail（Q15）', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      const inflight = [makeMessage('i1', MessageType.User, 'inflight')];
      const merged = mergeInflightTailMessages(base, inflight);
      expect(merged).toHaveLength(2);
      expect(merged[1].id).toBe('i1');
    });

    it('有 _live 标记时包含其前一条 user 消息', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      const inflight = [
        makeMessage('i1', MessageType.User, 'q'),
        makeMessage('i2', MessageType.Assistant, 'a', true), // _live
      ];
      const merged = mergeInflightTailMessages(base, inflight);
      // tail = inflight.slice(0) = [i1, i2]
      expect(merged).toHaveLength(3);
      expect(merged[1].id).toBe('i1');
      expect(merged[2].id).toBe('i2');
    });

    it('Q5: _live 前面有多条 assistant 消息时，仍能扫描到 user 消息', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      const inflight = [
        makeMessage('i1', MessageType.User, 'q'),
        makeMessage('i2', MessageType.Assistant, 'partial-1'),
        makeMessage('i3', MessageType.Assistant, 'partial-2'),
        makeMessage('i4', MessageType.Assistant, 'live', true),
      ];
      const merged = mergeInflightTailMessages(base, inflight);
      // tailStart 应为 0（i1 是 user 消息），tail = [i1, i2, i3, i4]
      expect(merged).toHaveLength(5);
      expect(merged[1].id).toBe('i1');
      expect(merged[4].id).toBe('i4');
    });

    it('Q5: _live 前无 user 消息时，tailStart = 0（全部作为 tail）', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      const inflight = [
        makeMessage('i1', MessageType.Assistant, 'partial'),
        makeMessage('i2', MessageType.Assistant, 'live', true),
      ];
      const merged = mergeInflightTailMessages(base, inflight);
      expect(merged).toHaveLength(3);
      expect(merged[1].id).toBe('i1');
      expect(merged[2].id).toBe('i2');
    });

    it('id 去重避免与 server 持久化的消息重复', () => {
      const base = [
        makeMessage('b1', MessageType.User, 'base'),
        makeMessage('i1', MessageType.User, 'q'), // server 已持久化
      ];
      const inflight = [
        makeMessage('i1', MessageType.User, 'q'), // 重复 id
        makeMessage('i2', MessageType.Assistant, 'a', true),
      ];
      const merged = mergeInflightTailMessages(base, inflight);
      // i1 被 dedupe，仅 i2 追加
      expect(merged).toHaveLength(3);
      expect(merged[2].id).toBe('i2');
    });

    it('_live 在首位时 tailStart=0，全部追加（带 dedupe）', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      const inflight = [makeMessage('i1', MessageType.Assistant, 'live', true)];
      const merged = mergeInflightTailMessages(base, inflight);
      expect(merged).toHaveLength(2);
    });

    it('Q15: 无 _live 且无 user 消息时，全部作为 tail', () => {
      const base = [makeMessage('b1', MessageType.User, 'base')];
      const inflight = [makeMessage('i1', MessageType.Assistant, 'orphan')];
      const merged = mergeInflightTailMessages(base, inflight);
      // anchorIdx = 0（末尾 fallback），无 user → tailStart = 0
      expect(merged).toHaveLength(2);
      expect(merged[1].id).toBe('i1');
    });
  });
});
