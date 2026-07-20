// Canvas plugin constants — re-exports from shared constants
// Keep delegate to @/constants/agent (shared source of truth) until
// canvas-specific constants can be fully extracted.

export {
  AgentGlobals,
  AgentStructuredOutputField,
  CodeTemplateStrMap,
  ComparisonOperator,
  DataflowOperator,
  EmptyDsl,
  JsonSchemaDataType,
  Operator,
  ProgrammingLanguage,
  SwitchLogicOperator,
  SwitchOperatorOptions,
  WebhookJWTAlgorithmList,
} from '@/constants/agent';

// Shared enums (not canvas-specific — re-export for convenience)
export { AgentCategory, AgentQuery } from '@/constants/agent';
