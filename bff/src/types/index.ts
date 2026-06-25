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
