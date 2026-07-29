/**
 * AgentScopeAdapter — AgentScope Adapter。
 *
 * spec-010 v8 Phase C-P3(2026-07-30 实施,评审 Q1 修复后简化)。
 *
 * 来源(C-0 research R1):
 * - 项目: github.com/modelscope/agentscope
 * - 协议: OpenAI-compatible API Server
 * - 默认端口: 5000
 * - 鉴权: Bearer token(可选,本地开发默认无鉴权;apiKey 为空时基类 buildHeaders 不发送 Authorization 头,
 *   评审 S6 修复)
 * - 端点: POST /v1/chat/completions, GET /v1/models
 *
 * 能力矩阵(spec §3.2): { memory: true, mcp: true }(基于 OpenAI function calling)
 *
 * 评审 Q1 修复:doChat 上提到基类,子类仅需提供 modelId/protocolFamily getter。
 */

import { OpenAICompatibleBaseAdapter } from '../shared/openai-base-adapter';

export class AgentScopeAdapter extends OpenAICompatibleBaseAdapter {
  /** AgentScope 默认模型标识(上游忽略 model 字段,server-side 配置) */
  protected get modelId(): string {
    return 'agent-scope';
  }

  protected get protocolFamily(): string {
    return 'agent-scope';
  }
}
