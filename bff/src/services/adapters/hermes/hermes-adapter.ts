/**
 * HermesAdapter — Nous Research Hermes Agent Adapter。
 *
 * spec-010 v8 Phase C-P2(2026-07-30 实施,评审 Q1 修复后简化)。
 *
 * 来源(C-0 research R1):
 * - 项目: github.com/NousResearch/hermes-agent
 * - 协议: OpenAI-compatible API Server
 * - 默认端口: 8642(与 intellect-enterprise 冲突,部署时需修改)
 * - 鉴权: Bearer token
 * - 端点: POST /v1/chat/completions, GET /v1/models, GET /health
 *
 * 能力矩阵(spec §3.2): { memory: true, mcp: true }(基于 OpenAI function calling)
 *
 * 评审 Q1 修复:doChat 上提到基类,子类仅需提供 modelId/protocolFamily getter。
 */

import { OpenAICompatibleBaseAdapter } from '../shared/openai-base-adapter';

export class HermesAdapter extends OpenAICompatibleBaseAdapter {
  /** Hermes 默认模型标识(上游忽略 model 字段,server-side 配置) */
  protected get modelId(): string {
    return 'hermes';
  }

  protected get protocolFamily(): string {
    return 'hermes';
  }
}
