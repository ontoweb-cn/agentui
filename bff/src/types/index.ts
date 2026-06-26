// Barrel export for BFF types.
// Contract authority source: specs/001-multi-harness-p0/contracts/*.ts
// Runtime copies in this directory are synced from specs (see each file header).

// Multi-Harness P0 contracts
export type {
  BackendType,
  HarnessCapabilities,
  HarnessBackendConfig,
  HarnessBackend,
} from './harness';

export type {
  TokenUsage,
  StreamChunk,
  StreamDelta,
  StreamReasoning,
  StreamToolStart,
  StreamToolComplete,
  StreamToolProgress,
  StreamUsage,
  StreamDone,
  StreamError,
  StreamIterable,
} from './stream';
export { isTerminalChunk } from './stream';

export type {
  BffTenant,
  TenantContext,
} from './tenant';

export type {
  AgentSummary,
  Session,
  Team,
  Project,
  MemberRole,
  Member,
  TeamMember,
  ProjectMember,
  SendMessageRequest,
  SendMessageAttachment,
} from './domain';

export type {
  IHarnessAdapter,
  IMultiTenantAdapter,
  HarnessAdapterFactory,
} from './adapter';
export { isMultiTenantAdapter } from './adapter';

export type {
  HarnessStore,
  TenantStore,
  StoreFactory,
} from './stores';

// Legacy BFF context types (pre-multi-harness, retained for backward compat)
export interface BffContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
}

export interface AgentSession {
  id: string;
  agentId: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  createdAt: string;
  updatedAt: string;
}
