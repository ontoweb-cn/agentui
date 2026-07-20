// Canvas plugin service — canvas-specific API endpoints
// Uses bffCanvas constants (spec-008) for all canvas operations.
// Delegates to shared registerNextServer/request utilities from main app.

import type { IAgentLogsRequest, IPipeLineListRequest } from '@/interfaces/database/agent';
import type { IAgentWebhookTraceRequest } from '@/interfaces/request/agent';
import api from '@/utils/api';
import { registerNextServer } from '@/utils/register-server';
import request from '@/utils/request';

const {
  createAgent,
  updateAgent: updateAgentApi,
  deleteAgent,
  agentChatCompletion,
  resetAgent,
  listAgentTemplate,
  testDbConnect,
  trace,
  fetchVersionList,
  fetchVersion,
  getAgent,
  fetchAgentSessions,
  fetchExternalAgentInputs,
  prompt,
  cancelDataflow,
  cancelCanvas,
} = api;

const methods = {
  getAgent:         { url: getAgent,         method: 'get'  },
  createAgent:      { url: createAgent,      method: 'post' },
  fetchVersionList: { url: fetchVersionList, method: 'get'  },
  fetchVersion:     { url: (c: { agentId: string; versionId: string }) => fetchVersion(c.agentId, c.versionId), method: 'get' },
  resetAgent:       { url: resetAgent,       method: 'post' },
  deleteAgent:      { url: deleteAgent,      method: 'delete' },
  agentChatCompletion: { url: agentChatCompletion, method: 'post' },
  listAgentTemplate:   { url: listAgentTemplate,   method: 'get'  },
  testDbConnect:    { url: testDbConnect,    method: 'post' },
  debugSingle:      { url: (c: { agentId: string; componentId: string }) => api.debug(c.agentId, c.componentId), method: 'post' },
  uploadAgentFile:  { url: (c: { agentId: string }) => api.uploadAgentFile(c.agentId), method: 'post' },
  trace:            { url: (c: { agentId: string; messageId: string }) => trace(c.agentId, c.messageId), method: 'get' },
  inputForm:        { url: (c: { agentId: string; componentId: string }) => api.inputForm(c.agentId, c.componentId), method: 'get' },
  fetchAgentLogs:   { url: fetchAgentSessions, method: 'get' },
  fetchExternalAgentInputs: { url: fetchExternalAgentInputs, method: 'get' },
  fetchPrompt:      { url: prompt,           method: 'get'  },
  cancelDataflow:   { url: cancelDataflow,   method: 'post' },
  cancelCanvas:     { url: cancelCanvas,     method: 'post' },
  createAgentSession: { url: api.createAgentSession, method: 'post' },
} as const;

const canvasService = registerNextServer<keyof typeof methods>(methods);

// Direct-request helpers (non-standard patterns from agent-service.ts)

export const updateAgent = (agentId: string, params: {
  title?: string; dsl?: Record<string, any>; avatar?: string;
  description?: string | null; permission?: string; release?: string;
}) => request(updateAgentApi(agentId), { method: 'put', data: params });

export const fetchTrace = (data: { canvas_id: string; message_id: string }) =>
  request.get(methods.trace.url({ agentId: data.canvas_id, messageId: data.message_id }));

export const fetchAgentLogsByCanvasId = (canvasId: string, params: IAgentLogsRequest) =>
  request.get(methods.fetchAgentLogs.url(canvasId), { params });

export const fetchAgentLogsById = (canvasId: string, sessionId: string) =>
  request.get(api.fetchAgentSessionById(canvasId, sessionId));

export const fetchPipeLineList = (params: IPipeLineListRequest) =>
  request.get(api.listAgents, { params });

export const fetchWebhookTrace = (id: string, params: IAgentWebhookTraceRequest) =>
  request.get(api.fetchWebhookTrace(id), { params });

export const createAgentSession = ({ id, name }: { id: string; name: string }) =>
  request.post(api.createAgentSession(id), { data: { name } });

export const deleteAgentSession = (canvasId: string, sessionId: string) =>
  request.delete(api.fetchAgentSessionById(canvasId, sessionId));

export const uploadAgentFile = (agentId: string, data: FormData) =>
  request(api.uploadAgentFile(agentId), { method: 'post', data });

export default canvasService;
