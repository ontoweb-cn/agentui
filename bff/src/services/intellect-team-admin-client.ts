// @see specs/007-team-project-management/spec.md (FR-001/FR-002)
// @see intellect-team/docs/agentui-integration/teams-projects-api.md (实际契约)
/**
 * Intellect-Team Admin Client — Team/Project CRUD 透传客户端。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端不直连 intellect-team,经 BFF 透传
 * - Principle V (Tenant Isolation): 管理操作按 X-Intellect-Team 隔离(若提供)
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract):
 *   管理操作用 API_SERVER_KEY 鉴权(部署级静态密钥,前端不接触)
 * - Principle VII (YAGNI): P5 仅封装 CRUD,不实现复杂业务逻辑
 *
 * 端点映射(对齐 intellect-team 实际实现):
 * - Team CRUD:    POST/GET/DELETE /api/teams[/{team_ref}](无 PUT,DELETE 软删除)
 * - Project CRUD: POST/GET/DELETE /api/projects[/{project_ref}](独立路径,非嵌套)
 *
 * 错误转换:HTTP 非 2xx → IntellectAdminError(保留 status code)
 */

import type {
  Team,
  Project,
  CreateTeamRequest,
  CreateProjectRequest,
} from '../types/team';

/** intellect-team 管理操作错误(保留 HTTP status)。 */
export class IntellectAdminError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'IntellectAdminError';
  }
}

/** intellect-team list 响应({data: [...]})。 */
interface ListResponse<T> {
  data: T[];
}

/** intellect-team archive(DELETE)响应。 */
interface ArchiveResponse {
  ok: boolean;
}

/**
 * intellect-team Admin Client。
 * 持有 baseUrl + apiServerKey,无状态,可在 BFF 路由层共享实例。
 */
export class IntellectTeamAdminClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiServerKey: string,
  ) {}

  // -------------------------------------------------------------------------
  // Team CRUD
  // -------------------------------------------------------------------------

  /** POST /api/teams — 创建 Team(creator 自动成为 team admin)。 */
  async createTeam(req: CreateTeamRequest, teamId?: string): Promise<Team> {
    return this.request<Team>('POST', '/api/teams', req, teamId);
  }

  /** GET /api/teams — 列出所有 Team(member token 仅见本人参与;profile key 见全部)。 */
  async listTeams(teamId?: string): Promise<Team[]> {
    const resp = await this.request<ListResponse<Team>>('GET', '/api/teams', undefined, teamId);
    // intellect-team 返回 {data: [...]},提取数组
    return resp?.data ?? [];
  }

  /** GET /api/teams/{team_ref} — 获取单个 Team(team_ref 为 slug 或内部 id)。 */
  async getTeam(teamRef: string, teamId?: string): Promise<Team> {
    return this.request<Team>('GET', `/api/teams/${encodeURIComponent(teamRef)}`, undefined, teamId);
  }

  /** DELETE /api/teams/{team_ref} — 归档 Team(软删除,enabled=0)。 */
  async deleteTeam(teamRef: string, teamId?: string): Promise<void> {
    await this.request<ArchiveResponse>('DELETE', `/api/teams/${encodeURIComponent(teamRef)}`, undefined, teamId);
  }

  // -------------------------------------------------------------------------
  // Project CRUD(独立路径 /api/projects,非嵌套;通过 team_ref 关联团队)
  // -------------------------------------------------------------------------

  /** POST /api/projects — 创建 Project(creator 自动成为 project_admin)。 */
  async createProject(req: CreateProjectRequest, teamId?: string): Promise<Project> {
    return this.request<Project>('POST', '/api/projects', req, teamId);
  }

  /** GET /api/projects — 列出所有 Project(可按 member 过滤)。 */
  async listProjects(teamId?: string): Promise<Project[]> {
    const resp = await this.request<ListResponse<Project>>('GET', '/api/projects', undefined, teamId);
    return resp?.data ?? [];
  }

  /** GET /api/projects/{project_ref} — 获取单个 Project(project_ref 为 slug 或内部 id)。 */
  async getProject(projectRef: string, teamId?: string): Promise<Project> {
    return this.request<Project>('GET', `/api/projects/${encodeURIComponent(projectRef)}`, undefined, teamId);
  }

  /** DELETE /api/projects/{project_ref} — 归档 Project(软删除,archived=1)。 */
  async deleteProject(projectRef: string, teamId?: string): Promise<void> {
    await this.request<ArchiveResponse>('DELETE', `/api/projects/${encodeURIComponent(projectRef)}`, undefined, teamId);
  }

  // -------------------------------------------------------------------------
  // 内部请求封装
  // -------------------------------------------------------------------------

  /**
   * 统一请求方法。
   * @param teamId 可选,注入 X-Intellect-Team 头(限定管理范围)
   */
  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    teamId?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiServerKey) {
      headers['Authorization'] = `Bearer ${this.apiServerKey}`;
    }
    // Principle V:管理操作可限定 team 范围(可选, intellect-team 全局管理员可不传)
    if (teamId) {
      headers['X-Intellect-Team'] = teamId;
    }

    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new IntellectAdminError(
        `${method} ${path} network error: ${(err as Error).message}`,
        502,
      );
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new IntellectAdminError(
        `${method} ${path} → ${resp.status}: ${text}`,
        resp.status,
      );
    }

    // 无 body 的成功响应(DELETE 可能 200 + {ok:true})
    if (resp.status === 204) {
      return undefined as T;
    }

    const json = await resp.json().catch(() => undefined);
    return json as T;
  }
}
