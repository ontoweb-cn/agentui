import { MessageType } from '@/constants/chat';
import { IAttachment } from '@/hooks/use-send-message';

export interface IDocumentDownloadInfo {
  doc_id: string;
  filename: string;
  mime_type: string;
  size?: number;
}

export interface PromptConfig {
  empty_response: string;
  parameters: Parameter[];
  prologue: string;
  system: string;
  tts?: boolean;
  quote: boolean;
  keyword: boolean;
  refine_multiturn: boolean;
  use_kg: boolean;
  reasoning?: boolean;
  cross_languages?: Array<string>;
  tavily_api_key?: string;
  toc_enhance?: boolean;
  reference_metadata?: {
    include?: boolean;
    fields?: string[];
  };
}

export interface Parameter {
  key: string;
  optional: boolean;
}

export interface LlmSetting {
  Creative: Variable;
  Custom: Variable;
  Evenly: Variable;
  Precise: Variable;
}

export interface Variable {
  frequency_penalty?: number;
  max_tokens?: number;
  presence_penalty?: number;
  temperature?: number;
  top_p?: number;
  tenant_llm_id?: string;
  model_type?: string;
}

export interface IDialog {
  create_date: string;
  create_time: number;
  description: string;
  icon: string;
  id: string;
  dialog_id?: string;
  dataset_ids: string[];
  kb_names: string[];
  language: string;
  llm_id: string;
  tenant_llm_id?: string;
  llm_setting: Variable;
  llm_setting_type?: string;
  name: string;
  prompt_config: PromptConfig;
  prompt_type: string;
  status: string;
  tenant_id: string;
  update_date: string;
  update_time: number;
  vector_similarity_weight: number;
  similarity_threshold: number;
  top_k: number;
  top_n: number;
  rerank_id?: string;
  meta_data_filter: MetaDataFilter;
  /**
   * Chat 来源标识（评审文档 chat-session-gateway-migration-review.md §3.2）。
   * - 'gateway': 纯 LLM 对话，走 intellect-team Gateway session
   * - 'rag'（默认/未设置）: RAG 增强对话，走 intellect-rag-app Dialog
   * 前端按此字段选择 API 路径（createSession/sendMessage/listSessions 等）。
   */
  source?: 'gateway' | 'rag';
}

interface MetaDataFilter {
  manual: Manual[];
  method: string;
}

interface Manual {
  key: string;
  op: string;
  value: string;
}

export interface IConversation {
  create_date: string;
  create_time: number;
  chat_id: string;
  id: string;
  avatar: string;
  messages: Message[];
  reference: IReference[];
  name: string;
  update_date: string;
  update_time: number;
  is_new: true;
}

export interface Message {
  content: string;
  role: MessageType;
  doc_ids?: string[];
  prompt?: string;
  id?: string;
  audio_binary?: string;
  data?: any;
  files?: (File | UploadResponseDataType)[];
  chatBoxId?: string;
  attachment?: IAttachment;
  downloads?: IDocumentDownloadInfo[];
}

export interface IReferenceChunk {
  id: string;
  content: null;
  document_id: string;
  document_name: string;
  dataset_id: string;
  image_id: string;
  similarity: number;
  vector_similarity: number;
  term_similarity: number;
  positions: number[];
  doc_type?: string;
  document_metadata?: Record<string, any>;
}

export interface IReference {
  chunks: IReferenceChunk[];
  doc_aggs: Docagg[];
  total: number;
}

export interface IReferenceObject {
  chunks: Record<string, IReferenceChunk>;
  doc_aggs: Record<string, Docagg>;
}

export interface IAnswer {
  answer: string;
  attachment?: IAttachment;
  downloads?: IDocumentDownloadInfo[];
  reference?: IReference;
  conversationId?: string;
  prompt?: string;
  id?: string;
  audio_binary?: string;
  data?: any;
  chatBoxId?: string;
}

export interface Docagg {
  count: number;
  doc_id: string;
  doc_name: string;
  url?: string;
}

// interface Chunk {
//   chunk_id: string;
//   content_ltks: string;
//   content_with_weight: string;
//   doc_id: string;
//   docnm_kwd: string;
//   img_id: string;
//   important_kwd: any[];
//   kb_id: string;
//   similarity: number;
//   term_similarity: number;
//   vector_similarity: number;
// }

export interface IToken {
  create_date: string;
  create_time: number;
  tenant_id: string;
  token: string;
  update_date?: any;
  update_time?: any;
  beta: string;
}

export interface IStats {
  pv: [string, number][];
  uv: [string, number][];
  speed: [string, number][];
  tokens: [string, number][];
  round: [string, number][];
  thumb_up: [string, number][];
}

export interface IExternalChatInfo {
  avatar?: string;
  title: string;
  prologue?: string;
  has_tavily_key?: boolean;
  llm_id?: string;
}

export interface IMessage extends Message {
  id: string;
  reference?: IReference; // the latest news has reference
  conversationId?: string; // To distinguish which conversation the message belongs to
  toolCalls?: ToolCallRecord[]; // tool call 列表（gateway 路径，P1 启用渲染）
  reasoning?: string; // reasoning 累积内容（gateway 路径，P1 启用渲染）
  usage?: TokenUsage; // 本 turn 的 token 用量（gateway 路径，P2 启用 Context ring）
  contentSegments?: ContentSegment[]; // 有序内容片段（穿插渲染，P1 启用）
  /**
   * 标记当前消息为"流式 live 消息"（P2 INFLIGHT 状态恢复用）。
   * - true: 表示该消息是 inflight 中正在流式生成的 assistant 消息
   * - undefined/false: 表示是已持久化的历史消息
   * 仅在前端 inflight 状态中使用，不持久化到 server。
   */
  _live?: boolean;
  /**
   * Provider 错误详情（P3 启用）。
   * 上游 provider 返回的原始 JSON 错误信息，用于渲染折叠区块。
   * 当前 BFF 未透传此字段，前端预留；BFF 后续扩展 serializeChunk error 分支后自动启用。
   */
  errorDetails?: unknown;
  /**
   * v1.3.0 工具审批请求状态（来自 BFF approval_request 事件）。
   * 仅 gateway 路径(IntellectEnterpriseAdapter /v1/runs)产出,IntellectRagAdapter 不产出。
   * ApprovalCard 组件据此渲染按钮组,用户提交后调用 submitApproval。
   */
  pendingApproval?: PendingApproval;
  /**
   * clarify 澄清请求状态（来自 BFF clarify_request 事件）。
   * ClarifyCard 组件据此渲染问题与输入框,用户提交回答后调用 submitClarify。
   */
  pendingClarify?: PendingClarify;
}

/** Tool call 记录（来自 BFF tool_start/tool_complete/tool_progress 事件） */
export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  preview?: string; // progress 累积
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  durationMs?: number;
}

/**
 * v1.3.0 工具审批请求状态（来自 BFF approval_request 事件）。
 *
 * Constitution Principle IV v1.3.0:
 * - 当 intellect-team /v1/runs 主通道需要工具人工审批时,BFF 透传 approval_request 事件
 * - 前端 ApprovalCard 组件据此渲染按钮组(once/session/always/deny)
 * - 用户提交审批后,通过 submitApproval fetch 调用 BFF /runs/:runId/approval 路由
 * - 状态流转:pending(等待用户提交) → submitted(已提交,等待 run 继续执行)
 *
 * 注:BFF 在 approval_request 后过滤 tool_* 事件,前端不会同时收到
 * tool_start 与 approval_request。ApprovalCard 独立渲染,不与 ToolCallCard 重复。
 */
export interface PendingApproval {
  /** 工具名称 */
  toolName: string;
  /**
   * 原始 JSON 字符串(intellect-team 透传)。
   * ApprovalCard 按需 JSON.parse 展示参数。
   */
  arguments: string;
  /** 审批选项(默认 4 个: once/session/always/deny) */
  choices: Array<'once' | 'session' | 'always' | 'deny'>;
  /** 关联的 run ID(提交审批时回传到 BFF) */
  runId: string;
  /**
   * 审批状态:
   * - 'pending': 等待用户选择并提交
   * - 'submitted': 已提交(choice 字段记录用户选择),等待 run 继续执行
   */
  status: 'pending' | 'submitted';
  /** 用户已提交的 choice(status='submitted' 时填充) */
  submittedChoice?: 'once' | 'session' | 'always' | 'deny';
  /** 提交时间戳(status='submitted' 时填充) */
  submittedAt?: number;
}

/**
 * clarify 澄清请求状态（来自 BFF clarify_request 事件）。
 *
 * - BFF 转发 intellect-team clarify SSE 事件,前端 ClarifyCard 渲染问题与输入框
 * - 用户提交回答后,通过 submitClarify fetch 调用 BFF
 *   POST /agents/:agentId/sessions/:sessionId/clarify 路由
 * - 状态流转:pending(等待用户提交) → submitted(已提交,等待 run 继续执行)
 */
export interface PendingClarify {
  /** 澄清问题文本 */
  question: string;
  /** 候选答案列表(可为空,空时仅允许自由输入) */
  choices: string[];
  /** clarify ID(提交回答时回传到 BFF,格式 session_id:timestamp_ms) */
  clarifyId: string;
  /** 关联的 session ID(提交回答时构造 BFF URL) */
  sessionId: string;
  /**
   * 澄清状态:
   * - 'pending': 等待用户输入并提交
   * - 'submitted': 已提交(submittedAnswer 记录用户回答),等待 run 继续
   */
  status: 'pending' | 'submitted';
  /** 用户已提交的回答(status='submitted' 时填充) */
  submittedAnswer?: string;
  /** 提交时间戳(status='submitted' 时填充) */
  submittedAt?: number;
}

/** Token 用量（来自 BFF usage 事件） */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /**
   * 模型 context window 长度（Q4 修复：BFF usage chunk 可选透传）。
   * 当前 BFF 未透传，前端使用 ContextRing 默认值 128000。
   * 后续 BFF 扩展透传此字段后，ContextRing 将自动使用真实值。
   */
  contextLength?: number;
}

/** 有序内容片段（穿插渲染 text 段和 tool call 段） */
export type ContentSegment =
  | { type: 'text'; content: string; key: string }
  | { type: 'tool'; toolCallId: string; key: string };

export interface IClientConversation extends IConversation {
  messages: IMessage[];
}

export interface UploadResponseDataType {
  created_at: number;
  created_by: string;
  extension: string;
  id: string;
  mime_type: string;
  name: string;
  preview_url: null;
  size: number;
}
