/**
 * useSendAgentMessageWithSse — Gateway 路径专用 SSE hook
 *
 * 仅服务 gateway 路径（BFF `/agents/chat/completions` → IntellectEnterpriseAdapter /
 * IntellectRagAdapter），按 `val.event` 路由到不同处理器，避免 tool/usage 事件污染 answer 状态。
 *
 * 其他调用方（use-send-shared-message.ts / use-send-single-message.ts / next-search/hooks.ts /
 * RAG 增强分支）走 intellect-rag-app envelope-wrapped 格式，继续使用 `useSendMessageWithSse`。
 *
 * 关键设计：
 * - `answer` 字段语义与 `useSendMessageWithSse` 保持一致，便于 use-send-chat-message.ts 无缝切换
 * - reasoning/toolCalls/usage 用 useRef 存储实时值，避免 useState 异步批处理问题
 * - `send()` 返回值结构 `{ data: await res, response }` 与 `useSendMessageWithSse` 一致
 * - 复用 `useSetDoneRecord` 逻辑（多 chat box 场景的 done 状态管理）
 * - `resetAnswer` 保留 1 秒延迟清空逻辑（避免 UI 闪烁）
 *
 * Constitution Principle IV v1.3.0: 消费 BFF serializeChunk 输出的 9 种 event:
 *   message / tool_start / tool_complete / tool_progress / message_end /
 *   workflow_finished / error / approval_request / approval_responded
 *
 * v1.3.0 审批支持:
 * - approval_request 事件触发 pendingApproval 状态(等待用户提交)
 * - submitApproval(choice) 方法调用 BFF /agents/:agentId/runs/:runId/approval 路由
 * - approval_responded 事件由 SSE 流回推时(可选),仅作状态同步兜底
 * - agentId 通过 send() body.agent_id 传入,保存到 ref 供 submitApproval 使用
 *
 * clarify 支持:
 * - clarify_request 事件触发 pendingClarify 状态(等待用户提交回答)
 * - submitClarify(answer) 方法调用 BFF /agents/:agentId/sessions/:sessionId/clarify 路由
 * - 流结束(onDone)时清理 pendingClarify,避免残留
 */

import { Authorization } from '@/constants/authorization';
import { ResponseType } from '@/interfaces/database/base';
import {
  IAnswer,
  IReference,
  PendingApproval,
  PendingClarify,
  TokenUsage,
  ToolCallRecord,
} from '@/interfaces/database/chat';
import api from '@/utils/api';
import { getAuthorization } from '@/utils/authorization-util';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { has, isEmpty, omit } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  createDispatcherState,
  dispatchSseFrame,
  type DispatcherState,
  type SseEventHandlers,
} from './logic-hooks/sse-event-dispatcher';

// ---------------------------------------------------------------------------
// 内部 doneRecord 逻辑（复刻 useSetDoneRecord，仅服务多 chat box 场景）
// ---------------------------------------------------------------------------
// 注：done 用独立 useState 管理（与 useSendMessageWithSse 一致），不混入 doneRecord。
// doneRecord 仅在 body 含 chatBoxId 时使用，避免单 chat box 场景下 setDone 被错误守卫阻塞。

function useDoneRecord() {
  const [doneRecord, setDoneRecord] = useState<Record<string, boolean>>({});

  const clearDoneRecord = useCallback(() => {
    setDoneRecord({});
  }, []);

  const setDoneRecordById = useCallback((id: string, val: boolean) => {
    setDoneRecord((prev) => ({ ...prev, [id]: val }));
  }, []);

  const allDone = useMemo(() => {
    return Object.values(doneRecord).every((val) => val);
  }, [doneRecord]);

  // 与 useSetDoneRecord 一致：allDone 后自动清理，避免 doneRecord 累积旧 chatBoxId
  useEffect(() => {
    if (!isEmpty(doneRecord) && allDone) {
      clearDoneRecord();
    }
  }, [allDone, clearDoneRecord, doneRecord]);

  return {
    doneRecord,
    setDoneRecordById,
    clearDoneRecord,
    allDone,
  };
}

// ---------------------------------------------------------------------------
// Hook 主逻辑
// ---------------------------------------------------------------------------

export const useSendAgentMessageWithSse = () => {
  const [answer, setAnswer] = useState<IAnswer>({} as IAnswer);
  // done 用独立 useState（方案 A），与原 useSendMessageWithSse 一致。
  // useDoneRecord 仅服务多 chat box 场景（body 含 chatBoxId 时）。
  const [done, setDone] = useState(true);
  const { doneRecord, setDoneRecordById, clearDoneRecord, allDone } =
    useDoneRecord();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const sseRef = useRef<AbortController>();

  // reasoning/toolCalls/usage/error 实时状态（useRef 避免异步批处理问题）
  // 双字符串语义（参考 webui reasoningText + liveReasoningText）：
  // - reasoningRef：整 turn 累积，不重置（用于持久化与历史回看）
  // - liveReasoningRef：工具调用后重置（用于实时显示，避免跨工具污染）
  const reasoningRef = useRef('');
  const liveReasoningRef = useRef('');
  const toolCallsRef = useRef<ToolCallRecord[]>([]);
  const usageRef = useRef<TokenUsage | null>(null);
  const errorRef = useRef<string | null>(null);
  // P3: Provider 错误详情（独立 ref，避免改动 errorRef 类型影响多处调用方）
  const errorDetailsRef = useRef<unknown>(undefined);
  // v1.3.0: 当前 pending 的工具审批请求(由 approval_request 事件触发)
  // null 表示无 pending 审批;非 null 表示等待用户提交。
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  // clarify: 当前 pending 的澄清请求(由 clarify_request 事件触发)
  // null 表示无 pending 澄清;非 null 表示等待用户提交回答。
  const pendingClarifyRef = useRef<PendingClarify | null>(null);
  // v1.3.0: 当前 turn 的 agentId,用于 submitApproval 构造 BFF URL。
  // 从 send() body.agent_id 提取并保存到 ref(避免 submitApproval 闭包捕获旧值)。
  const agentIdRef = useRef<string>('');
  // P2-Q4: i18n 翻译函数,用于 submitApproval 错误提示
  const { t } = useTranslation();
  // 触发渲染的版本号（ref 更新后递增）
  const [, setRenderVersion] = useState(0);
  const forceRender = useCallback(() => setRenderVersion((v) => v + 1), []);

  const initializeSseRef = useCallback(() => {
    sseRef.current = new AbortController();
  }, []);

  const resetAnswer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      setAnswer({} as IAnswer);
      clearTimeout(timer.current);
    }, 1000);
  }, []);

  const setDoneValue = useCallback(
    (body: { chatBoxId?: string }, value: boolean) => {
      if (has(body, 'chatBoxId')) {
        setDoneRecordById(body.chatBoxId!, value);
      } else {
        setDone(value);
      }
    },
    [setDone, setDoneRecordById],
  );

  /**
   * 重置实时状态（切换会话或开始新流时调用）
   */
  const resetRealtimeState = useCallback(() => {
    reasoningRef.current = '';
    liveReasoningRef.current = '';
    toolCallsRef.current = [];
    usageRef.current = null;
    errorRef.current = null;
    errorDetailsRef.current = undefined;
    // v1.3.0: 重置 pending 审批状态(新 turn 开始时清理上一 turn 的残留)
    pendingApprovalRef.current = null;
    // clarify: 重置 pending 澄清状态(新 turn 开始时清理上一 turn 的残留)
    pendingClarifyRef.current = null;
    forceRender();
  }, [forceRender]);

  const send = useCallback(
    async (
      url: string,
      body: { chatBoxId?: string; session_id?: string; conversation_id?: string } & Record<string, unknown>,
      controller?: AbortController,
    ): Promise<{ response: Response; data: ResponseType } | undefined> => {
      // M3 修复:发送新流前中止前一个流,避免 reader 并发运行导致 answer 被旧流污染。
      // 原 initializeSseRef() 直接覆盖 sseRef.current,旧 controller 仍可继续读取,
      // 其 onDelta 回调会向新流的 answer 追加内容。
      if (sseRef.current) {
        sseRef.current.abort();
      }
      initializeSseRef();
      resetRealtimeState();

      // v1.3.0: 提取 agentId 保存到 ref,供 submitApproval 构造 BFF URL。
      // 兼容 agent_id / agentId 两种命名,缺省为 'chat'(Gateway chat 占位)。
      const agentIdValue =
        (typeof body.agent_id === 'string' && body.agent_id) ||
        (typeof body.agentId === 'string' && body.agentId) ||
        '';
      agentIdRef.current = agentIdValue;

      try {
        setDoneValue(body, false);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            [Authorization]: getAuthorization(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(omit(body, 'chatBoxId')),
          signal: controller?.signal || sseRef.current?.signal,
        });

        // SSE 响应体是 text/event-stream（data: {...}\n\n），不是合法 JSON。
        // clone().json() 仅对非流式错误响应有意义（如 4xx/5xx JSON 错误体）。
        // 用 catch 兜底，SSE 流时返回 null，避免流结束后 await res 抛出
        // "Unexpected token 'd'" 覆盖已正确显示的流式内容。
        const res = response.clone().json().catch(() => null);

        const reader = response?.body
          ?.pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream())
          .getReader();

        // 防御：response.body 为 null（如 204/错误响应）时直接退出，避免无限循环
        if (!reader) {
          setDoneValue(body, true);
          resetAnswer();
          return { data: await res, response };
        }

        // 每个流创建独立的分发器状态
        const dispatcherState: DispatcherState = createDispatcherState();

        const handlers: SseEventHandlers = {
          onDelta: (content: string, metadata?: { reference?: unknown }) => {
            setAnswer((prev) => {
              const prevAnswer = prev.answer || '';
              const newAnswer = prevAnswer + content;
              return {
                ...prev,
                answer: newAnswer,
                conversationId: body?.session_id ?? body?.conversation_id,
                chatBoxId: body.chatBoxId,
                ...(metadata?.reference
                  ? { reference: metadata.reference as IReference }
                  : {}),
              };
            });
          },
          onReasoning: (
            content: string,
            _isStart: boolean,
            _isEnd?: boolean,
          ) => {
            // 累积到 reasoning（整 turn 不重置）和 liveReasoning（工具后重置）
            reasoningRef.current += content;
            liveReasoningRef.current += content;
            forceRender();
          },
          onToolStart: (data) => {
            // 工具调用开始：重置 liveReasoning，避免跨工具污染（保留 reasoning 累积）
            liveReasoningRef.current = '';
            const record: ToolCallRecord = {
              toolCallId: data.toolCallId,
              toolName: data.toolName,
              args: data.args,
              status: 'running',
              startedAt: Date.now(),
            };
            toolCallsRef.current = [...toolCallsRef.current, record];
            forceRender();
          },
          onToolComplete: (data) => {
            // 工具完成同样重置 liveReasoning（保险，防 onToolStart 漏触发）
            liveReasoningRef.current = '';
            // 兼容乱序：tool_start 未到达时补建 record，避免 result 静默丢失
            const existing = toolCallsRef.current.find(
              (tc) => tc.toolCallId === data.toolCallId,
            );
            if (!existing) {
              toolCallsRef.current = [
                ...toolCallsRef.current,
                {
                  toolCallId: data.toolCallId,
                  toolName: '(unknown)',
                  result: data.result,
                  status: 'completed' as const,
                  startedAt: Date.now(),
                  durationMs: 0,
                },
              ];
            } else {
              toolCallsRef.current = toolCallsRef.current.map((tc) =>
                tc.toolCallId === data.toolCallId
                  ? {
                      ...tc,
                      result: data.result,
                      status: 'completed' as const,
                      durationMs: Date.now() - tc.startedAt,
                    }
                  : tc,
              );
            }
            forceRender();
          },
          onToolProgress: (data) => {
            // preview 累积加上限（2000 字符），避免长流式输出导致内存+性能问题
            const MAX_PREVIEW_LENGTH = 2000;
            // M1 修复:仅按 toolCallId 精确匹配,避免同名工具并发时 progress 误更新到错误记录。
            // BFF 在 tool_progress 事件中应填充 tool_call_id,缺失时跳过避免误匹配。
            if (!data.toolCallId) {
              console.warn(
                '[useSendAgentMessageWithSse] tool_progress 缺少 toolCallId,跳过更新',
                { toolName: data.toolName },
              );
              return;
            }
            let matched = false;
            toolCallsRef.current = toolCallsRef.current.map((tc) => {
              if (tc.toolCallId === data.toolCallId) {
                matched = true;
                const newPreview = (tc.preview ?? '') + data.content;
                return {
                  ...tc,
                  preview: newPreview.slice(-MAX_PREVIEW_LENGTH),
                };
              }
              return tc;
            });
            if (!matched) {
              // tool_start 未到达但收到 progress:补建一条 record,避免 progress 静默丢失
              toolCallsRef.current = [
                ...toolCallsRef.current,
                {
                  toolCallId: data.toolCallId,
                  toolName: data.toolName,
                  preview: data.content.slice(-MAX_PREVIEW_LENGTH),
                  status: 'running' as const,
                  startedAt: Date.now(),
                },
              ];
            }
            forceRender();
          },
          onUsage: (usage: TokenUsage) => {
            usageRef.current = usage;
            forceRender();
          },
          onError: (message: string, toolCallId?: string, errorDetails?: unknown) => {
            errorRef.current = message;
            // P3: 透传 errorDetails 到 ref，供前端 ProviderErrorDetails 渲染
            errorDetailsRef.current = errorDetails;
            if (toolCallId) {
              toolCallsRef.current = toolCallsRef.current.map((tc) =>
                tc.toolCallId === toolCallId
                  ? { ...tc, status: 'failed' as const }
                  : tc,
              );
            }
            // P2：离线时不写入错误到 answer，由 OfflineBanner 统一处理，避免误导用户
            if (!navigator.onLine) {
              forceRender();
              return;
            }
            // 错误信息也写入 answer，保持与 useSendMessageWithSse error 事件行为一致
            setAnswer((prev) => ({
              ...prev,
              answer: `**ERROR**: ${message}`,
              conversationId: body?.session_id ?? body?.conversation_id,
              chatBoxId: body.chatBoxId,
            }));
            forceRender();
          },
          onDone: () => {
            // P0-Q1 修复:流完成时清理 pendingApproval,避免残留显示。
            // 场景:用户已提交审批(deny)后 run 完成,或未提交审批时流中断,
            // 若不清理,下一 turn 的 useEffect 会把上一 turn 的 pending/submitted
            // 状态写入新消息,造成 UI 残留。
            if (pendingApprovalRef.current) {
              pendingApprovalRef.current = null;
              forceRender();
            }
            // clarify: 同理清理 pendingClarify,避免残留显示。
            if (pendingClarifyRef.current) {
              pendingClarifyRef.current = null;
              forceRender();
            }
          },
          onApprovalRequest: (data) => {
            // v1.3.0: 收到 approval_request 事件,记录 pending 审批状态。
            // ApprovalCard 组件据此渲染按钮组(once/session/always/deny)。
            // BFF streamChunksAsSSE 已在 approval_request 后过滤 tool_* 事件,
            // 前端不会同时收到 tool_start 与 approval_request。
            pendingApprovalRef.current = {
              toolName: data.toolName,
              arguments: data.arguments,
              choices: data.choices,
              runId: data.runId,
              status: 'pending',
            };
            forceRender();
          },
          onClarifyRequest: (data) => {
            // 收到 clarify_request 事件,记录 pending 澄清状态。
            // ClarifyCard 组件据此渲染问题与输入框。
            pendingClarifyRef.current = {
              question: data.question,
              choices: data.choices,
              clarifyId: data.clarifyId,
              sessionId: data.sessionId,
              status: 'pending',
            };
            forceRender();
          },
          onApprovalResponded: (data) => {
            // v1.3.0: SSE 流主动回推 approval_responded(intellect-team 可选行为)。
            // 主要状态同步路径是 submitApproval fetch 调用,此处仅作兜底:
            // 若 pendingApproval 仍存在且 runId 匹配,标记为 submitted。
            //
            // P1-Q2 修复:若 pendingApproval 已是 'submitted' 状态,跳过 SSE 兜底,
            // 避免 submitApproval fetch 与 SSE 事件竞态导致 UI 闪烁/状态覆盖。
            // SSE 仅在 pending 状态(未提交)时作兜底,处理 intellect-team 主动回推
            // 而前端尚未提交的极端场景(如超时自动 deny)。
            //
            // P2-Q6 修复:choice 为 null 时(非法 choice)跳过状态更新,
            // 保留 pending 状态等待用户手动操作,避免误显示"已拒绝"。
            if (data.choice === null) {
              console.warn(
                '[useSendAgentMessageWithSse] onApprovalResponded: received null choice (invalid data), skip update',
              );
              return;
            }
            const pending = pendingApprovalRef.current;
            if (
              pending &&
              pending.status === 'pending' &&
              pending.runId === data.runId
            ) {
              pendingApprovalRef.current = {
                ...pending,
                status: 'submitted',
                submittedChoice: data.choice,
                submittedAt: Date.now(),
              };
              forceRender();
            }
          },
        };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            const x = await reader.read();
            if (x) {
              const { done, value } = x;
              if (done) {
                resetAnswer();
                break;
              }
              // 使用分发器处理每帧
              const shouldTerminate = dispatchSseFrame(
                value?.data ?? '',
                handlers,
                dispatcherState,
              );
              if (shouldTerminate) {
                resetAnswer();
                break;
              }
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              break;
            }
            // 其他错误 break，避免无限循环（如 reader 已释放）
            break;
          }
        }
        setDoneValue(body, true);
        resetAnswer();
        return { data: await res, response };
      } catch (err) {
        setDoneValue(body, true);
        resetAnswer();
        // P2 评审 S3：catch 块不再静默吞掉错误。
        // - 离线/网络错误/CORS/5xx 都会走到这里（fetch reject 或 reader 异常）
        // - 写入 errorRef 供 UI 展示，避免 done=true 后用户无任何反馈
        // - 离线时不写入 answer，由 OfflineBanner 统一处理（与 onError 行为一致）
        const message = err instanceof Error ? err.message : String(err);
        errorRef.current = message;
        // navigator.onLine 单点依赖已知限制（Q12）：captive portal 场景下可能误判
        if (!navigator.onLine) {
          forceRender();
          return;
        }
        setAnswer((prev) => ({
          ...prev,
          answer: `**ERROR**: ${message}`,
          conversationId: body?.session_id ?? body?.conversation_id,
          chatBoxId: body.chatBoxId,
        }));
        forceRender();
      }
    },
    [initializeSseRef, setDoneValue, resetAnswer, resetRealtimeState, forceRender],
  );

  const stopOutputMessage = useCallback(() => {
    sseRef.current?.abort();
  }, []);

  /**
   * v1.3.0 提交工具审批。
   *
   * 调用 BFF POST /api/bff/agents/:agentId/runs/:runId/approval 路由,
   * 携带 { choice: 'once' | 'session' | 'always' | 'deny' } body。
   *
   * 成功后更新 pendingApproval 状态为 'submitted',ApprovalCard 据此切换 UI。
   * 失败时保留 'pending' 状态,允许用户重试(网络错误/上游 409 等场景)。
   *
   * P1-Q8 修复:fetch 返回后校验 pendingApprovalRef.current === pending(引用相等),
   * 若不等说明已被 reset(abort/流结束/下一 turn 重置),直接返回 false 不更新。
   *
   * P1-S3 修复:BFF 已校验响应 resolved>=1,前端额外校验响应非空。
   *
   * P2-Q4 修复:agentId 缺失时通过 toast 提示用户,而非静默失败。
   *
   * @param choice 审批选项
   * @returns true 提交成功,false 提交失败(无 pending 审批/网络错误/上游错误)
   */
  const submitApproval = useCallback(
    async (
      choice: 'once' | 'session' | 'always' | 'deny',
    ): Promise<boolean> => {
      const pending = pendingApprovalRef.current;
      if (!pending || pending.status !== 'pending') {
        // 无 pending 审批或已提交,忽略(防止重复提交)
        return false;
      }
      const agentId = agentIdRef.current;
      if (!agentId) {
        // P2-Q4 修复:RAG 路径或异常情况下 agentId 缺失,toast 提示而非静默失败
        console.warn(
          '[useSendAgentMessageWithSse] submitApproval: agentId missing, cannot construct BFF URL',
        );
        toast.error(t('approval.notSupported'));
        return false;
      }

      const url = api.agentRunApproval(agentId, pending.runId);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            [Authorization]: getAuthorization(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ choice }),
        });

        if (!response.ok) {
          console.warn(
            '[useSendAgentMessageWithSse] submitApproval failed:',
            response.status,
            await response.text().catch(() => ''),
          );
          // P2-Q4 修复:网络/上游错误时 toast 提示用户
          if (response.status === 403) {
            toast.error(t('approval.forbidden'));
          } else if (response.status === 409) {
            toast.error(t('approval.alreadyResolved'));
          } else {
            toast.error(t('approval.submitFailed'));
          }
          return false;
        }

        // 校验响应(可选):BFF 返回 {runId, choice, resolved}
        const data = (await response.json().catch(() => null)) as {
          runId?: string;
          choice?: string;
          resolved?: number;
        } | null;

        // P1-S3 修复:BFF 已校验 resolved>=1,前端额外校验响应非空
        // (BFF 返回 409 时已拦截,此处仅兜底)
        if (!data || typeof data.resolved !== 'number' || data.resolved < 1) {
          console.warn(
            '[useSendAgentMessageWithSse] submitApproval: invalid response, resolved<1',
            data,
          );
          toast.error(t('approval.submitFailed'));
          return false;
        }

        // 若响应含 choice 且与提交值不一致,警告但不阻塞(可能是 BFF 转换问题)
        if (
          data?.choice &&
          data.choice !== choice &&
          (data.choice === 'once' ||
            data.choice === 'session' ||
            data.choice === 'always' ||
            data.choice === 'deny')
        ) {
          console.warn(
            '[useSendAgentMessageWithSse] submitApproval: BFF returned different choice:',
            data.choice,
            'expected:',
            choice,
          );
        }

        // P1-Q8 修复:fetch 返回后校验 pendingApprovalRef.current === pending(引用相等)。
        // 若不等说明已被 reset:
        //   - 用户点击"停止生成"触发 abort → send() 重新调用 resetRealtimeState → ref 被置 null
        //   - 流式 onDone 回调清理 → ref 被置 null
        //   - 下一 turn 的 onApprovalRequest 覆盖 → ref 是新对象
        // 此时不应再更新 ref,避免跨 turn 状态污染。
        if (pendingApprovalRef.current !== pending) {
          console.warn(
            '[useSendAgentMessageWithSse] submitApproval: pendingApproval ref changed during fetch, skip update',
          );
          return true; // fetch 已成功,只是 UI 状态由其他路径管理
        }

        // 标记为 submitted,ApprovalCard 切换 UI
        pendingApprovalRef.current = {
          ...pending,
          status: 'submitted',
          submittedChoice: choice,
          submittedAt: Date.now(),
        };
        forceRender();
        return true;
      } catch (err) {
        console.warn(
          '[useSendAgentMessageWithSse] submitApproval network error:',
          err,
        );
        toast.error(t('approval.submitFailed'));
        return false;
      }
    },
    [forceRender, t],
  );

  /**
   * 提交 clarify 澄清回答。
   *
   * 调用 BFF POST /api/bff/agents/:agentId/sessions/:sessionId/clarify 路由,
   * 携带 { clarify_id, answer } body。
   *
   * 成功后更新 pendingClarify 状态为 'submitted',ClarifyCard 据此切换 UI。
   * 失败时保留 'pending' 状态,允许用户重试。
   *
   * @param answer 用户输入的回答(或点击的 choice)
   * @returns true 提交成功,false 提交失败(无 pending 澄清/网络错误/上游错误)
   */
  const submitClarify = useCallback(
    async (answer: string): Promise<boolean> => {
      const pending = pendingClarifyRef.current;
      if (!pending || pending.status !== 'pending') {
        // 无 pending 澄清或已提交,忽略(防止重复提交)
        return false;
      }
      const agentId = agentIdRef.current;
      if (!agentId) {
        console.warn(
          '[useSendAgentMessageWithSse] submitClarify: agentId missing, cannot construct BFF URL',
        );
        toast.error(t('clarify.notSupported'));
        return false;
      }

      const url = api.agentSessionClarify(agentId, pending.sessionId);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            [Authorization]: getAuthorization(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clarify_id: pending.clarifyId,
            answer,
          }),
        });

        if (!response.ok) {
          console.warn(
            '[useSendAgentMessageWithSse] submitClarify failed:',
            response.status,
            await response.text().catch(() => ''),
          );
          toast.error(t('clarify.submitFailed'));
          return false;
        }

        // 校验响应:BFF 返回 { code: 0, data: { status: 'ok' } } 或 { code: 400, message }
        const data = (await response.json().catch(() => null)) as {
          code?: number;
          message?: string;
          data?: { status?: string };
        } | null;

        if (!data || data.code !== 0) {
          console.warn(
            '[useSendAgentMessageWithSse] submitClarify: invalid response, code!=0',
            data,
          );
          toast.error(data?.message || t('clarify.submitFailed'));
          return false;
        }

        // fetch 返回后校验 pendingClarifyRef.current === pending(引用相等)。
        // 若不等说明已被 reset(abort/流结束/下一 turn 重置),不更新 ref 避免跨 turn 污染。
        if (pendingClarifyRef.current !== pending) {
          console.warn(
            '[useSendAgentMessageWithSse] submitClarify: pendingClarify ref changed during fetch, skip update',
          );
          return true; // fetch 已成功,只是 UI 状态由其他路径管理
        }

        // 标记为 submitted,ClarifyCard 切换 UI
        pendingClarifyRef.current = {
          ...pending,
          status: 'submitted',
          submittedAnswer: answer,
          submittedAt: Date.now(),
        };
        forceRender();
        return true;
      } catch (err) {
        console.warn(
          '[useSendAgentMessageWithSse] submitClarify network error:',
          err,
        );
        toast.error(t('clarify.submitFailed'));
        return false;
      }
    },
    [forceRender, t],
  );

  const reset = useCallback(() => {
    resetRealtimeState();
    setAnswer({} as IAnswer);
  }, [resetRealtimeState]);

  return {
    send,
    answer,
    done,
    doneRecord,
    allDone,
    setDone,
    resetAnswer,
    stopOutputMessage,
    clearDoneRecord,
    reset,
    // P1 启用渲染字段
    reasoning: reasoningRef.current,
    liveReasoning: liveReasoningRef.current,
    toolCalls: toolCallsRef.current,
    usage: usageRef.current,
    error: errorRef.current,
    // P3: Provider 错误详情（BFF 透传的上游原始 JSON）
    errorDetails: errorDetailsRef.current,
    // v1.3.0: 当前 pending 的工具审批请求(null 表示无 pending 审批)
    pendingApproval: pendingApprovalRef.current,
    // v1.3.0: 提交工具审批,ApprovalCard 按钮组 onClick 调用
    submitApproval,
    // clarify: 当前 pending 的澄清请求(null 表示无 pending 澄清)
    pendingClarify: pendingClarifyRef.current,
    // clarify: 提交澄清回答,ClarifyCard onSubmit 调用
    submitClarify,
    // isStreaming：done 为 false 表示流式进行中
    isStreaming: !done,
  };
};
