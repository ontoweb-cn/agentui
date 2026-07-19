// Canvas plugin types — re-exports from shared interfaces
// Incrementally migrate canvas-specific types here as the plugin becomes self-contained.
// Current: delegates to @/interfaces/database/agent (shared source of truth).

export type {
  BaseNode,
  BaseNodeData,
  DSL,
  DSLComponents,
  IFlow,
  IFlowTemplate,
  IGraph,
  IntellectNodeType,
  IOperator,
  IOperatorNode,
  IRagNode,
  ITraceData,
  IAgentLogResponse,
  IAgentLogsResponse,
  IAgentLogsRequest,
  IAgentLogMessage,
  GlobalVariableType,
  IWebhookTrace,
} from '@/interfaces/database/agent';

export type {
  IDebugSingleRequestBody,
  IAgentWebhookTraceRequest,
} from '@/interfaces/request/agent';
