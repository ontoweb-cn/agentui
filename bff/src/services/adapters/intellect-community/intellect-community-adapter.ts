/**
 * IntellectCommunityAdapter — intellect-agent 社区版 Adapter。
 *
 * spec-010 v8 Phase C-P1(2026-07-30 实施,评审 Q1 修复后简化)。
 *
 * 来源(C-0 research R3):
 * - 项目: intellect-agent 社区版(/Users/simon/project/intellect-team 同一仓库)
 * - 协议: OpenAI-compatible API Server(gateway/platforms/api_server.py)
 * - 默认端口: 8642(与 intellect-enterprise 同源,不会同时部署)
 * - 鉴权: Bearer token via API_SERVER_KEY env var
 * - 端点: POST /v1/chat/completions, GET /v1/models, GET /health
 *
 * 能力矩阵(spec §3.2): 全 false(社区版无 canvas/KB/multiTenant)
 *
 * 评审 Q1 修复:doChat 上提到基类,子类仅需提供 modelId/protocolFamily getter。
 */

import { OpenAICompatibleBaseAdapter } from '../shared/openai-base-adapter';

export class IntellectCommunityAdapter extends OpenAICompatibleBaseAdapter {
  /** 社区版默认模型标识(实际上游忽略 model 字段,server-side 配置) */
  protected get modelId(): string {
    return 'intellect-agent';
  }

  protected get protocolFamily(): string {
    return 'intellect-community';
  }
}
