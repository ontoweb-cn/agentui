// Gateway chat service — 纯 LLM 对话场景(评审文档 §3.2 方案 A)。
//
// intellect-rag chat 功能已全部迁移到 intellect-team Rust Gateway,
// 前端所有 chat 调用统一通过本 service 经 BFF /api/bff/agents/* 路由
// 对接 Gateway 的 /api/sessions/* 端点。
//
// Gateway session 模型:session = chat(一对一),无 intellect-rag 的
// chat → sessions 嵌套概念。conversation 切换在前端用 session 本身模拟。
//
// 调用约定:
// - 静态 URL 方法(create/list/send):直接调用
// - 动态 URL 方法(get/delete/patch/messages):调用时传
//   `{ url: api.xxx(agentId, sessionId) }` 并 useAxiosNativeConfig=true
import api from '@/utils/api';
import { registerNextServer } from '@/utils/register-server';

/** Gateway session 路径占位 agentId(BFF 路由要求,adapter 层忽略)。 */
export const GATEWAY_CHAT_AGENT_ID = 'chat';

const {
  createAgentSession,
  fetchAgentSessions,
  fetchAgentSessionById,
  deleteAgentSession,
  patchAgentSession,
  fetchAgentSessionMessages,
  agentChatCompletion,
} = api;

const methods = {
  // 创建 Gateway session。POST /agents/chat/sessions
  createGatewayChat: {
    url: createAgentSession(GATEWAY_CHAT_AGENT_ID),
    method: 'post',
  },
  // 列出 Gateway sessions。GET /agents/chat/sessions
  listGatewayChats: {
    url: fetchAgentSessions(GATEWAY_CHAT_AGENT_ID),
    method: 'get',
  },
  // 获取单个 Gateway session。URL 含 sessionId,调用时传 { url: api.fetchAgentSessionById(agentId, sessionId) }
  getGatewayChat: {
    url: fetchAgentSessionById,
    method: 'get',
  },
  // 删除 Gateway session。URL 含 sessionId,调用时传 { url: api.deleteAgentSession(agentId, sessionId) }
  deleteGatewayChat: {
    url: deleteAgentSession,
    method: 'delete',
  },
  // 重命名 Gateway session(PATCH /api/sessions/{id} 仅支持 title)。
  // 调用时传 { url: api.patchAgentSession(agentId, sessionId), data: { name } }
  patchGatewayChat: {
    url: patchAgentSession,
    method: 'patch',
  },
  // 获取 session 消息历史。URL 含 sessionId,调用时传 { url: api.fetchAgentSessionMessages(agentId, sessionId) }
  getGatewaySessionMessages: {
    url: fetchAgentSessionMessages,
    method: 'get',
  },
  // 发送消息(SSE 流式)。POST /agents/chat/completions
  sendGatewayMessage: {
    url: agentChatCompletion,
    method: 'post',
  },
} as const;

const gatewayChatService = registerNextServer<keyof typeof methods>(methods);

export default gatewayChatService;
