/**
 * KagAdapter — KAG 后端 Adapter(spec-012 Phase 1)。
 *
 * 来源(C-0 research R2 / spec-012):
 * - 项目: github.com/OpenSPG/KAG(v0.8.0)
 * - 协议: MCP(Model Context Protocol),非 OpenAI 兼容
 * - 默认端口: MCP SSE 3000;product UI 8887
 * - 鉴权: 默认无(本地开发);生产可经 Bearer token
 * - 工具: qa-pipeline(query) / kb-retrieve(query)
 *
 * 继承关系(v8.3 修订):
 * - 旧(v8.2): extends OpenAICompatibleBaseAdapter implements IKnowledgeBaseAdapter
 * - 新(v8.3): extends MCPBaseAdapter implements IMCPAdapter
 *
 * 能力矩阵(spec §3.2 v8.3):
 * - knowledgeBase: false(无 REST KB CRUD API,仅有 kb_retrieve 检索工具)
 * - mcp: true(全面拥抱 MCP 协议)
 *
 * Constitution Principle II: 路由层经 AdapterRegistry 获取 IHarnessAdapter,
 * 不感知 KAG 走 MCP 协议。
 */

import type { IMCPAdapter, MCPTool } from '../../../types/adapter';
import type { BackendType, HarnessCapabilities } from '../../../types/harness';
import type { BackendContext } from '../../../types/tenant';
import { MCPBaseAdapter } from '../shared/mcp-base-adapter';

export class KagAdapter extends MCPBaseAdapter implements IMCPAdapter {
  readonly backendType: BackendType = 'kag';

  protected readonly defaultCapabilities: HarnessCapabilities = {
    canvas: false,
    knowledgeBase: false, // v8.3:无 REST KB CRUD,不走 IKnowledgeBaseAdapter
    memory: false,
    mcp: true, // v8.3:KAG 0.8.0 全面拥抱 MCP
    multiTenant: false,
    modelManagement: false,
  };

  // ── IMCPAdapter 方法 ──

  /**
   * 列出 MCP Server 暴露的所有工具。
   * 复用基类 listAgents(已实现 MCP listTools 调用),映射为 MCPTool 结构。
   */
  async listTools(ctx: BackendContext): Promise<MCPTool[]> {
    const agents = await this.listAgents(ctx);
    return agents.map((a) => ({
      name: a.id,
      description: a.description ?? '',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query text' },
        },
        required: ['query'],
      },
    }));
  }

  /**
   * 通用 MCP 工具调用。
   * 复用基类 callMCPTool(已含 30s 超时 + SSRF 防护)。
   *
   * 评审 Q1 修复:保留 ctx 参数(非 _ctx),未来 KAG 多租户时用于权限隔离。
   * 当前 KAG 单租户,ctx 不参与调用逻辑。
   */
  async callTool(
    ctx: BackendContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    // ctx 预留:KAG 多租户化后用于注入租户隔离参数
    void ctx;
    return this.callMCPTool(name, args);
  }

  /**
   * KAG 专用:QA 问答管道。
   * 调用 MCP 工具 `qa-pipeline`,返回 LLM 生成的答案文本。
   */
  async qaPipeline(_ctx: BackendContext, query: string): Promise<string> {
    return this.callMCPTool('qa-pipeline', { query });
  }

  /**
   * KAG 专用:知识库检索。
   * 调用 MCP 工具 `kb-retrieve`,返回 JSON:
   * { summary: string, references: Array<{ spo: [s,p,o], chunks: string[] }> }
   */
  async kbRetrieve(_ctx: BackendContext, query: string): Promise<string> {
    return this.callMCPTool('kb-retrieve', { query });
  }
}
