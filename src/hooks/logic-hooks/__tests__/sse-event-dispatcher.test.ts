/**
 * sse-event-dispatcher 单元测试
 *
 * 覆盖 P0 验收 checklist（chat-session-sse-completion-plan.md §2.3）:
 * - 7 种事件类型路由
 * - snake_case → camelCase 字段命名转换
 * - 未知 event 容错
 * - JSON 解析失败容错
 * - reasoning 开闭状态维护（去重 / 隐式闭合）
 */

import {
  createDispatcherState,
  dispatchSseFrame,
  type SseEventHandlers,
} from '../sse-event-dispatcher';

// 创建一个记录所有回调调用的 mock handlers，便于断言
function createMockHandlers(): SseEventHandlers & {
  calls: Array<{ type: string; args: unknown[] }>;
} {
  const calls: Array<{ type: string; args: unknown[] }> = [];
  const push = (type: string) => (...args: unknown[]) =>
    calls.push({ type, args });

  return {
    onDelta: push('onDelta'),
    onReasoning: push('onReasoning'),
    onToolStart: push('onToolStart'),
    onToolComplete: push('onToolComplete'),
    onToolProgress: push('onToolProgress'),
    onUsage: push('onUsage'),
    onError: push('onError'),
    onDone: push('onDone'),
    onApprovalRequest: push('onApprovalRequest'),
    onApprovalResponded: push('onApprovalResponded'),
    onClarifyRequest: push('onClarifyRequest'),
    calls,
  };
}

// 构造 SSE 帧的 data 字段（JSON 字符串）
function frame(event: string, data: unknown): string {
  return JSON.stringify({ event, data });
}

describe('dispatchSseFrame', () => {
  let handlers: ReturnType<typeof createMockHandlers>;
  beforeEach(() => {
    handlers = createMockHandlers();
  });

  describe('event routing', () => {
    it('routes message event with plain delta to onDelta', () => {
      const state = createDispatcherState();
      const rawData = frame('message', {
        content: 'hello',
        answer: 'hello',
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onDelta',
        args: ['hello', undefined],
      });
    });

    it('routes tool_start event to onToolStart with camelCase fields', () => {
      const state = createDispatcherState();
      const rawData = frame('tool_start', {
        tool_name: 'web_search',
        tool_call_id: 'call_123',
        args: { query: 'test' },
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onToolStart',
        args: [
          {
            toolName: 'web_search',
            toolCallId: 'call_123',
            args: { query: 'test' },
          },
        ],
      });
    });

    it('routes tool_complete event to onToolComplete with camelCase fields', () => {
      const state = createDispatcherState();
      const rawData = frame('tool_complete', {
        tool_call_id: 'call_123',
        result: { hits: 5 },
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onToolComplete',
        args: [{ toolCallId: 'call_123', result: { hits: 5 } }],
      });
    });

    it('routes tool_progress event to onToolProgress with camelCase fields', () => {
      const state = createDispatcherState();
      const rawData = frame('tool_progress', {
        tool_name: 'web_search',
        tool_call_id: 'call_123',
        content: 'progress update',
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onToolProgress',
        args: [
          {
            toolName: 'web_search',
            toolCallId: 'call_123',
            content: 'progress update',
          },
        ],
      });
    });

    it('routes message_end event to onUsage with token usage', () => {
      const state = createDispatcherState();
      const rawData = frame('message_end', {
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onUsage',
        args: [{ promptTokens: 100, completionTokens: 50 }],
      });
    });

    it('routes workflow_finished event to onDone and terminates', () => {
      const state = createDispatcherState();
      const rawData = frame('workflow_finished', true);

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(true);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({ type: 'onDone', args: [] });
    });

    it('routes error event to onError and terminates', () => {
      const state = createDispatcherState();
      const rawData = frame('error', {
        message: 'something went wrong',
        answer: '**ERROR**: something went wrong',
        tool_call_id: 'call_123',
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(true);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onError',
        args: ['something went wrong', 'call_123', undefined],
      });
    });

    it('routes error event without tool_call_id to onError with undefined', () => {
      const state = createDispatcherState();
      const rawData = frame('error', {
        message: 'fatal',
        answer: '**ERROR**: fatal',
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      expect(terminate).toBe(true);
      expect(handlers.calls[0]).toEqual({
        type: 'onError',
        args: ['fatal', undefined, undefined],
      });
    });
  });

  describe('field name conversion', () => {
    it('converts _metadata to metadata in message event', () => {
      const state = createDispatcherState();
      const reference = { chunks: [{ id: 'c1' }] };
      const rawData = frame('message', {
        content: 'answer with ref',
        answer: 'answer with ref',
        _metadata: { reference },
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0]).toEqual({
        type: 'onDelta',
        args: ['answer with ref', { reference }],
      });
    });

    it('handles missing content/answer as empty strings', () => {
      const state = createDispatcherState();
      const rawData = frame('message', {});

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0]).toEqual({
        type: 'onDelta',
        args: ['', undefined],
      });
    });

    it('handles missing tool_call_id in tool_progress as undefined', () => {
      const state = createDispatcherState();
      const rawData = frame('tool_progress', {
        tool_name: 'coder',
        content: 'working',
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0]).toEqual({
        type: 'onToolProgress',
        args: [
          {
            toolName: 'coder',
            content: 'working',
          },
        ],
      });
      // toolCallId 字段不存在（undefined）
      expect(
        (handlers.calls[0].args[0] as { toolCallId?: string }).toolCallId,
      ).toBeUndefined();
    });

    it('coerces non-string tool_call_id to string', () => {
      const state = createDispatcherState();
      const rawData = frame('tool_start', {
        tool_name: 't',
        tool_call_id: 123,
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toMatchObject({
        toolCallId: '123',
      });
    });

    it('coerces missing usage numbers to 0', () => {
      const state = createDispatcherState();
      const rawData = frame('message_end', { usage: {} });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toEqual({
        promptTokens: 0,
        completionTokens: 0,
      });
    });
  });

  describe('reasoning state management', () => {
    it('opens reasoning on first startToThink=true', () => {
      const state = createDispatcherState();
      const rawData = frame('message', {
        content: 'thinking...',
        answer: 'thinking...',
        start_to_think: true,
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onReasoning',
        args: ['thinking...', true, false],
      });
      expect(state.reasoningOpen).toBe(true);
    });

    it('dedupes repeated startToThink=true (BFF sends on every reasoning chunk)', () => {
      const state = createDispatcherState();

      // 第一条 reasoning：开
      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      // 第二条 reasoning：重复 start_to_think=true，仅追加 content，不重复 isStart
      dispatchSseFrame(
        frame('message', { content: 'b', answer: 'b', start_to_think: true }),
        handlers,
        state,
      );

      expect(handlers.calls).toHaveLength(2);
      expect(handlers.calls[0].args).toEqual(['a', true, false]);
      expect(handlers.calls[1].args).toEqual(['b', false, false]);
      expect(state.reasoningOpen).toBe(true);
    });

    it('closes reasoning on endToThink=true', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(
        frame('message', { content: '', answer: '', end_to_think: true }),
        handlers,
        state,
      );

      expect(handlers.calls).toHaveLength(2);
      expect(handlers.calls[1].args).toEqual(['', false, true]);
      expect(state.reasoningOpen).toBe(false);
    });

    it('implicitly closes reasoning before tool_start', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(
        frame('tool_start', { tool_name: 't', tool_call_id: 'c1' }),
        handlers,
        state,
      );

      // 期望顺序：onReasoning(open) → onReasoning(close) → onToolStart
      expect(handlers.calls).toHaveLength(3);
      expect(handlers.calls[0].type).toBe('onReasoning');
      expect(handlers.calls[0].args).toEqual(['a', true, false]);
      expect(handlers.calls[1].type).toBe('onReasoning');
      expect(handlers.calls[1].args).toEqual(['', false, true]);
      expect(handlers.calls[2].type).toBe('onToolStart');
      expect(state.reasoningOpen).toBe(false);
    });

    it('implicitly closes reasoning before tool_complete', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(
        frame('tool_complete', { tool_call_id: 'c1' }),
        handlers,
        state,
      );

      // 隐式闭合 + tool_complete
      expect(handlers.calls).toHaveLength(3);
      expect(handlers.calls[1].type).toBe('onReasoning');
      expect(handlers.calls[1].args).toEqual(['', false, true]);
      expect(handlers.calls[2].type).toBe('onToolComplete');
      expect(state.reasoningOpen).toBe(false);
    });

    it('implicitly closes reasoning before workflow_finished', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(frame('workflow_finished', true), handlers, state);

      // 隐式闭合 + done
      expect(handlers.calls).toHaveLength(3);
      expect(handlers.calls[1].type).toBe('onReasoning');
      expect(handlers.calls[1].args).toEqual(['', false, true]);
      expect(handlers.calls[2].type).toBe('onDone');
      expect(state.reasoningOpen).toBe(false);
    });

    it('implicitly closes reasoning before error', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(
        frame('error', { message: 'fail', answer: '**ERROR**: fail' }),
        handlers,
        state,
      );

      expect(handlers.calls).toHaveLength(3);
      expect(handlers.calls[1].type).toBe('onReasoning');
      expect(handlers.calls[1].args).toEqual(['', false, true]);
      expect(handlers.calls[2].type).toBe('onError');
      expect(state.reasoningOpen).toBe(false);
    });

    it('does NOT implicitly close reasoning on tool_progress (no open state change)', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(
        frame('tool_progress', { tool_name: 't', content: 'p' }),
        handlers,
        state,
      );

      // 仅 onReasoning + onToolProgress，无隐式闭合
      expect(handlers.calls).toHaveLength(2);
      expect(handlers.calls[0].type).toBe('onReasoning');
      expect(handlers.calls[1].type).toBe('onToolProgress');
      // reasoningOpen 仍为 true（tool_progress 不触发闭合）
      expect(state.reasoningOpen).toBe(true);
    });

    it('implicitly closes reasoning before a plain delta (non-reasoning message)', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      dispatchSseFrame(
        frame('message', { content: 'final answer', answer: 'final answer' }),
        handlers,
        state,
      );

      // 隐式闭合 + onDelta
      expect(handlers.calls).toHaveLength(3);
      expect(handlers.calls[1].type).toBe('onReasoning');
      expect(handlers.calls[1].args).toEqual(['', false, true]);
      expect(handlers.calls[2].type).toBe('onDelta');
      expect(state.reasoningOpen).toBe(false);
    });
  });

  describe('error tolerance', () => {
    it('returns false and skips on empty rawData', () => {
      const state = createDispatcherState();
      const terminate = dispatchSseFrame('', handlers, state);

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(0);
    });

    it('returns false and skips on JSON parse failure', () => {
      const state = createDispatcherState();
      const terminate = dispatchSseFrame(
        'not valid json{',
        handlers,
        state,
      );

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(0);
    });

    it('returns false and skips on unknown event name', () => {
      const state = createDispatcherState();
      const terminate = dispatchSseFrame(
        frame('unknown_event', { foo: 'bar' }),
        handlers,
        state,
      );

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(0);
    });

    it('returns false and skips on missing event field', () => {
      const state = createDispatcherState();
      const terminate = dispatchSseFrame(
        JSON.stringify({ data: { foo: 'bar' } }),
        handlers,
        state,
      );

      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(0);
    });

    it('returns false and skips on missing data field (treats as empty)', () => {
      const state = createDispatcherState();
      const terminate = dispatchSseFrame(
        JSON.stringify({ event: 'message' }),
        handlers,
        state,
      );

      // message 事件无 data 时，convertMessageData 处理空对象，content/answer 为 ''
      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onDelta',
        args: ['', undefined],
      });
    });
  });

  // -------------------------------------------------------------------------
  // v1.3.0 审批事件(approval_request / approval_responded)
  // -------------------------------------------------------------------------

  describe('approval events (v1.3.0)', () => {
    it('routes approval_request event to onApprovalRequest with camelCase fields', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_request', {
        tool_name: 'bash',
        arguments: '{"command":"ls -la"}',
        choices: ['once', 'session', 'always', 'deny'],
        run_id: 'run-abc',
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      // approval_request 不终止流
      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onApprovalRequest',
        args: [
          {
            toolName: 'bash',
            arguments: '{"command":"ls -la"}',
            choices: ['once', 'session', 'always', 'deny'],
            runId: 'run-abc',
          },
        ],
      });
    });

    it('approval_request missing choices → defaults to 4 options', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_request', {
        tool_name: 'bash',
        arguments: '{"command":"ls"}',
        run_id: 'run-x',
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toMatchObject({
        choices: ['once', 'session', 'always', 'deny'],
      });
    });

    it('approval_request filters invalid choices values', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_request', {
        tool_name: 'bash',
        arguments: '{}',
        choices: ['once', 'invalid', 'always', 'another_invalid'],
        run_id: 'run-y',
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toMatchObject({
        choices: ['once', 'always'],
      });
    });

    it('approval_request missing run_id → empty string', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_request', {
        tool_name: 'bash',
        arguments: '{}',
        choices: ['once'],
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toMatchObject({
        runId: '',
      });
    });

    it('approval_request non-string arguments → empty string', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_request', {
        tool_name: 'bash',
        arguments: { command: 'ls' }, // 应为字符串,BFF 透传原始 JSON 字符串
        choices: ['once'],
        run_id: 'run-z',
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toMatchObject({
        arguments: '',
      });
    });

    it('routes approval_responded event to onApprovalResponded with camelCase fields', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_responded', {
        choice: 'session',
        resolved: 2,
        run_id: 'run-abc',
      });

      const terminate = dispatchSseFrame(rawData, handlers, state);

      // approval_responded 不终止流
      expect(terminate).toBe(false);
      expect(handlers.calls).toHaveLength(1);
      expect(handlers.calls[0]).toEqual({
        type: 'onApprovalResponded',
        args: [
          {
            choice: 'session',
            resolved: 2,
            runId: 'run-abc',
          },
        ],
      });
    });

    it('approval_responded invalid choice → choice=null (P2-Q6: 不回退 deny)', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_responded', {
        choice: 'invalid',
        resolved: 0,
        run_id: 'run-bad',
      });

      dispatchSseFrame(rawData, handlers, state);

      // P2-Q6 修复:非法 choice 返回 null 而非 'deny',
      // 调用方(onApprovalResponded)应跳过状态更新,保留 pending 状态等待用户操作。
      expect(handlers.calls[0].args[0]).toMatchObject({
        choice: null,
        resolved: 0,
      });
    });

    it('approval_responded missing resolved → defaults to 0', () => {
      const state = createDispatcherState();
      const rawData = frame('approval_responded', {
        choice: 'always',
        run_id: 'run-no-resolved',
      });

      dispatchSseFrame(rawData, handlers, state);

      expect(handlers.calls[0].args[0]).toMatchObject({
        resolved: 0,
      });
    });

    it('approval_request does NOT close reasoning (independent UI element)', () => {
      const state = createDispatcherState();

      // 开启 reasoning
      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      // 触发 approval_request
      dispatchSseFrame(
        frame('approval_request', {
          tool_name: 'bash',
          arguments: '{}',
          choices: ['once'],
          run_id: 'run-1',
        }),
        handlers,
        state,
      );

      // 仅 onReasoning(open) + onApprovalRequest,无隐式闭合
      expect(handlers.calls).toHaveLength(2);
      expect(handlers.calls[0].type).toBe('onReasoning');
      expect(handlers.calls[1].type).toBe('onApprovalRequest');
      // reasoningOpen 仍为 true(approval_request 不触发闭合)
      expect(state.reasoningOpen).toBe(true);
    });

    it('approval_responded does NOT close reasoning (independent UI element)', () => {
      const state = createDispatcherState();

      // 开启 reasoning
      dispatchSseFrame(
        frame('message', { content: 'a', answer: 'a', start_to_think: true }),
        handlers,
        state,
      );
      // 触发 approval_responded
      dispatchSseFrame(
        frame('approval_responded', {
          choice: 'once',
          resolved: 1,
          run_id: 'run-1',
        }),
        handlers,
        state,
      );

      // 仅 onReasoning(open) + onApprovalResponded,无隐式闭合
      expect(handlers.calls).toHaveLength(2);
      expect(handlers.calls[0].type).toBe('onReasoning');
      expect(handlers.calls[1].type).toBe('onApprovalResponded');
      expect(state.reasoningOpen).toBe(true);
    });

    it('approval_request followed by workflow_finished terminates stream normally', () => {
      const state = createDispatcherState();

      dispatchSseFrame(
        frame('approval_request', {
          tool_name: 'bash',
          arguments: '{}',
          choices: ['once'],
          run_id: 'run-1',
        }),
        handlers,
        state,
      );
      const terminate = dispatchSseFrame(
        frame('workflow_finished', true),
        handlers,
        state,
      );

      // approval_request + onDone(无 reasoning 闭合,因 reasoning 未开)
      expect(handlers.calls).toHaveLength(2);
      expect(handlers.calls[0].type).toBe('onApprovalRequest');
      expect(handlers.calls[1].type).toBe('onDone');
      expect(terminate).toBe(true);
    });
  });

  describe('createDispatcherState', () => {
    it('returns a fresh state with reasoningOpen=false', () => {
      const state = createDispatcherState();
      expect(state).toEqual({ reasoningOpen: false });
    });

    it('does not share state between instances', () => {
      const s1 = createDispatcherState();
      const s2 = createDispatcherState();
      s1.reasoningOpen = true;
      expect(s2.reasoningOpen).toBe(false);
    });
  });
});
