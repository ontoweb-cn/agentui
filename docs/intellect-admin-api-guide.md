# Intellect 企业版 Admin API 接口指南

> 本文档供 Intellect 团队实现 Team/Project/Member 管理 HTTP API 时参考。
> AgentUI BFF 将通过这些 API 透传管理 Intellect 侧的多租户资源。

## 一、背景与目标

### 1.1 现状

Intellect 企业版（`intellect-team`）已实现：

- **OpenAI 兼容 API**（`plugins/platforms/api_server/adapter.py`）：
  - `POST /v1/chat/completions`（SSE 流式）
  - `POST /v1/responses`
  - `GET /v1/models`、`GET /v1/capabilities`
  - `/api/sessions/*`（会话管理）
- **认证**：Bearer token（`imt_*` member token / `imt_p_*` project token）+ `X-Intellect-Team` / `X-Intellect-Project` 头
- **DB 层**（`agent/membership.py` 的 `MembershipStore`）：Team/Project/Member 的 CRUD 方法已齐全

### 1.2 缺失

Team/Project/Member 的 **HTTP API 路由层**未实现，DB 方法无法通过 HTTP 暴露。

### 1.3 目标

在 `plugins/platforms/api_server/adapter.py` 中新增 Admin API 路由，将 `MembershipStore` 的 DB 方法通过 HTTP 暴露，供 AgentUI BFF 调用。

## 二、设计原则

1. **RESTful 风格**：与现有 `/api/sessions` 保持一致
2. **复用现有认证**：Bearer token（imt_*），管理操作要求 admin/owner 角色
3. **复用现有 DB 方法**：`MembershipStore` 已实现全部 CRUD，只需薄路由层
4. **响应格式**：与现有 api_server 一致，错误统一为 `{"error": {"code": "...", "message": "..."}}`
5. **分页**：列表接口支持 `?limit=20&offset=0`，返回 `{"items": [...], "total": N}`
6. **幂等性**：CREATE 操作遇到唯一约束冲突时返回 `409 Conflict`
7. **软删除优先**：Team/Project 使用 archive（软删除），Member 可硬删除

## 三、认证与授权

### 3.1 认证方式

复用现有 Bearer token 认证：

```
Authorization: Bearer imt_xxxxxxxxxxxx
```

- `imt_*`：member 级 token，scope_type=member
- `imt_p_*`：project 级 token，scope_type=project

### 3.2 角色矩阵

| 端点类别 | 认证 | 角色要求 |
|---------|------|---------|
| GET（列表/详情） | 任意有效 token | member 及以上 |
| POST（创建） | member token | admin 及以上 |
| PATCH（更新） | member token | admin 及以上 |
| DELETE（归档） | member token | owner 仅限 |
| DELETE（硬删除） | member token | owner 仅限 |
| Token 管理 | member token | 自身或 admin 及以上 |

### 3.3 多租户头

| 头 | 说明 |
|----|------|
| `X-Intellect-Team` | 团队 slug，用于 team 级操作 |
| `X-Intellect-Project` | 项目 slug，用于 project 级操作 |

## 四、Team 管理 API

### 4.1 端点清单

```
GET    /api/teams                                 列出团队
POST   /api/teams                                 创建团队
GET    /api/teams/{team_slug}                     获取团队详情
PATCH  /api/teams/{team_slug}                     更新团队
DELETE /api/teams/{team_slug}                     归档团队（软删除）

GET    /api/teams/{team_slug}/members             列出团队成员
POST   /api/teams/{team_slug}/members             添加团队成员
PATCH  /api/teams/{team_slug}/members/{member_id} 更改成员角色
DELETE /api/teams/{team_slug}/members/{member_id} 移除团队成员
```

### 4.2 数据模型

```python
# 对应 teams 表
{
  "id": "team_abc123",              # TEXT PRIMARY KEY
  "slug": "frontend",               # TEXT NOT NULL UNIQUE
  "display_name": "前端团队",        # TEXT NOT NULL
  "created_by": "member_xyz",       # TEXT REFERENCES members(id)
  "enabled": true,                  # INTEGER (0/1) → bool
  "created_at": 1719300000.0,       # REAL (unix timestamp)
  "updated_at": null                # REAL | null
}
```

### 4.3 请求/响应示例

#### 创建团队

```http
POST /api/teams
Authorization: Bearer imt_xxx
Content-Type: application/json

{
  "slug": "frontend",
  "display_name": "前端团队"
}
```

**响应**：

```json
201 Created
{
  "id": "team_abc123",
  "slug": "frontend",
  "display_name": "前端团队",
  "created_by": "member_xyz",
  "enabled": true,
  "created_at": 1719300000.0,
  "updated_at": null
}
```

**错误**：

| 状态码 | 场景 |
|--------|------|
| 400 | slug 或 display_name 为空 |
| 401 | 未认证 |
| 403 | 非 admin/owner 角色 |
| 409 | slug 已存在 |

#### 列出团队

```http
GET /api/teams?limit=20&offset=0
Authorization: Bearer imt_xxx
```

**响应**：

```json
200 OK
{
  "items": [
    {
      "id": "team_abc123",
      "slug": "frontend",
      "display_name": "前端团队",
      "enabled": true,
      "member_count": 5,
      "created_at": 1719300000.0
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

**查询参数**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `limit` | 20 | 每页数量，最大 100 |
| `offset` | 0 | 偏移量 |
| `enabled` | - | 过滤启用状态（true/false） |

#### 获取团队详情

```http
GET /api/teams/frontend
Authorization: Bearer imt_xxx
```

**响应**：同创建团队响应体。

**错误**：`404` 团队不存在。

#### 更新团队

```http
PATCH /api/teams/frontend
Authorization: Bearer imt_xxx
Content-Type: application/json

{
  "display_name": "前端工程团队",
  "enabled": true
}
```

**响应**：返回更新后的团队对象。

#### 归档团队

```http
DELETE /api/teams/frontend
Authorization: Bearer imt_xxx
```

**响应**：`204 No Content`

**说明**：软删除，调用 `archive_team()`，将 `enabled` 设为 0。

#### 列出团队成员

```http
GET /api/teams/frontend/members
Authorization: Bearer imt_xxx
```

**响应**：

```json
200 OK
{
  "items": [
    {
      "id": "tm_xyz",
      "team_id": "team_abc123",
      "member_id": "member_xyz",
      "member_display_name": "张三",
      "member_email": "zhangsan@example.com",
      "role": "admin",
      "joined_at": 1719300000.0
    }
  ],
  "total": 1
}
```

#### 添加团队成员

```http
POST /api/teams/frontend/members
Authorization: Bearer imt_xxx
Content-Type: application/json

{
  "member_id": "member_xyz",
  "role": "member"
}
```

**role 可选值**：`owner` | `admin` | `member` | `viewer`

**错误**：

| 状态码 | 场景 |
|--------|------|
| 404 | member_id 不存在 |
| 409 | 成员已在团队中 |

#### 更改成员角色

```http
PATCH /api/teams/frontend/members/member_xyz
Authorization: Bearer imt_xxx
Content-Type: application/json

{
  "role": "admin"
}
```

#### 移除团队成员

```http
DELETE /api/teams/frontend/members/member_xyz
Authorization: Bearer imt_xxx
```

**响应**：`204 No Content`

### 4.4 对应 DB 方法

| API | DB 方法 |
|-----|--------|
| POST /api/teams | `create_team(slug, display_name, created_by)` |
| GET /api/teams | `list_teams(member_id=None)` |
| GET /api/teams/{slug} | `get_team_by_slug(slug)` |
| PATCH /api/teams/{slug} | **需新增** `update_team(team_id, display_name, enabled)` |
| DELETE /api/teams/{slug} | `archive_team(team_id)` |
| GET /api/teams/{slug}/members | `get_team_members(team_id)` |
| POST /api/teams/{slug}/members | `add_team_member(team_id, member_id, role, invited_by)` |
| PATCH /api/teams/{slug}/members/{member_id} | `set_member_role(team_id, member_id, role)` |
| DELETE /api/teams/{slug}/members/{member_id} | `remove_team_member(team_id, member_id)` |

## 五、Project 管理 API

### 5.1 端点清单

```
GET    /api/teams/{team_slug}/projects                    列出团队下的项目
POST   /api/teams/{team_slug}/projects                    创建项目
GET    /api/projects/{project_slug}                       获取项目详情
PATCH  /api/projects/{project_slug}                       更新项目
DELETE /api/projects/{project_slug}                       归档/删除项目

GET    /api/projects/{project_slug}/members               列出项目成员
POST   /api/projects/{project_slug}/members               添加项目成员
PATCH  /api/projects/{project_slug}/members/{member_id}   更改成员角色
DELETE /api/projects/{project_slug}/members/{member_id}   移除项目成员

GET    /api/projects/{project_slug}/teams                 列出项目关联的团队
POST   /api/projects/{project_slug}/teams                 关联团队到项目
DELETE /api/projects/{project_slug}/teams/{team_slug}     取消关联

POST   /api/projects/{project_slug}/tokens                创建项目 token
GET    /api/projects/{project_slug}/tokens                列出项目 token
DELETE /api/projects/{project_slug}/tokens/{token_id}     撤销项目 token
```

### 5.2 数据模型

```python
# 对应 projects 表
{
  "id": "proj_def456",
  "slug": "website-redesign",
  "display_name": "官网重构",
  "team_id": "team_abc123",
  "owner_member_id": "member_xyz",
  "enabled": true,
  "archived": false,
  "repo_url": "git@gitee.com:example/website.git",
  "default_branch": "main",
  "created_at": 1719300000.0,
  "updated_at": null
}
```

### 5.3 请求/响应示例

#### 创建项目

```http
POST /api/teams/frontend/projects
Authorization: Bearer imt_xxx
X-Intellect-Team: frontend
Content-Type: application/json

{
  "slug": "website-redesign",
  "display_name": "官网重构",
  "repo_url": "git@gitee.com:example/website.git",
  "default_branch": "main"
}
```

**响应**：

```json
201 Created
{
  "id": "proj_def456",
  "slug": "website-redesign",
  "display_name": "官网重构",
  "team_id": "team_abc123",
  "owner_member_id": "member_xyz",
  "enabled": true,
  "archived": false,
  "repo_url": "git@gitee.com:example/website.git",
  "default_branch": "main",
  "created_at": 1719300000.0,
  "updated_at": null
}
```

**说明**：`owner_member_id` 取自认证 token 对应的 member。

**错误**：

| 状态码 | 场景 |
|--------|------|
| 400 | slug 或 display_name 为空 |
| 404 | team_slug 不存在 |
| 409 | 同一 team 下 slug 已存在 |

#### 列出项目

```http
GET /api/teams/frontend/projects?limit=20&offset=0
Authorization: Bearer imt_xxx
```

**查询参数**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `limit` | 20 | 每页数量 |
| `offset` | 0 | 偏移量 |
| `archived` | false | 是否包含已归档项目 |

#### 删除项目

```http
DELETE /api/projects/website-redesign?action=delete
Authorization: Bearer imt_xxx
X-Intellect-Project: website-redesign
```

**查询参数 `action`**：

| 值 | 行为 | DB 方法 |
|----|------|--------|
| `archive`（默认） | 软删除，archived=1 | `archive_project(project_id)` |
| `delete` | 硬删除 | `delete_project(project_id)` |

#### 创建项目 token

```http
POST /api/projects/website-redesign/tokens
Authorization: Bearer imt_xxx
X-Intellect-Project: website-redesign
Content-Type: application/json

{
  "name": "BFF Service Token",
  "permissions": "read,write"
}
```

**响应**：

```json
201 Created
{
  "id": "tok_ghi789",
  "name": "BFF Service Token",
  "token": "imt_p_xxxxxxxxxxxx",
  "scope_type": "project",
  "scope_id": "proj_def456",
  "permissions": "read,write",
  "created_at": 1719300000.0,
  "expires_at": null
}
```

**重要**：`token` 字段仅在创建时返回一次明文，后续查询不返回。

### 5.4 对应 DB 方法

| API | DB 方法 |
|-----|--------|
| POST /api/teams/{slug}/projects | `create_project(slug, display_name, team_id, owner_member_id, repo_url, default_branch)` |
| GET /api/teams/{slug}/projects | `list_projects(team_id, include_archived)` |
| GET /api/projects/{slug} | `get_project_by_slug(team_slug, project_slug)` |
| PATCH /api/projects/{slug} | **需新增** `update_project(project_id, display_name, enabled, repo_url, default_branch)` |
| DELETE /api/projects/{slug}?action=archive | `archive_project(project_id)` |
| DELETE /api/projects/{slug}?action=delete | `delete_project(project_id)` |
| GET /api/projects/{slug}/members | `get_project_members(project_id)` |
| POST /api/projects/{slug}/members | `add_project_member(project_id, member_id, role, invited_by)` |
| DELETE /api/projects/{slug}/members/{member_id} | `remove_project_member(project_id, member_id)` |
| GET /api/projects/{slug}/teams | `get_project_teams(project_id)` |
| POST /api/projects/{slug}/teams | `link_project_team(project_id, team_id, role)` |
| DELETE /api/projects/{slug}/teams/{team_slug} | `unlink_project_team(project_id, team_id)` |
| POST /api/projects/{slug}/tokens | `create_project_token(project_id, name, permissions)` |
| GET /api/projects/{slug}/tokens | `list_project_tokens(project_id)` |
| DELETE /api/projects/{slug}/tokens/{token_id} | `revoke_project_token(token_id)` |

## 六、Member 管理 API（可选）

### 6.1 端点清单

```
GET    /api/members                                 列出成员
GET    /api/members/{member_id}                     获取成员详情
POST   /api/members                                 创建成员（管理员操作）
PATCH  /api/members/{member_id}                     更新成员
DELETE /api/members/{member_id}                     删除成员

POST   /api/members/{member_id}/tokens              创建成员 API token
GET    /api/members/{member_id}/tokens              列出成员 token
DELETE /api/members/{member_id}/tokens/{token_id}   撤销 token
```

### 6.2 数据模型（脱敏）

```python
{
  "id": "member_xyz",
  "display_name": "张三",
  "login_name": "zhangsan",
  "email": "zhangsan@example.com",
  "role": "admin",                  # owner/admin/member/viewer
  "enabled": true,
  "platform": "cli",
  "last_active_at": 1719300000.0,
  "online_status": "online",
  "created_at": 1719300000.0
}
```

**注意**：`password_hash`、`password_salt`、`password_reset_code` 等敏感字段永不返回。

## 七、需新增的 DB 方法

### 7.1 `update_team`

```python
# agent/teams.py — TeamDB 类新增

def update_team(
    self,
    team_id: str,
    display_name: str | None = None,
    enabled: int | None = None,
) -> dict | None:
    """更新团队信息（display_name 和 enabled）。

    Args:
        team_id: 团队 ID
        display_name: 新的显示名称（可选）
        enabled: 启用状态 0/1（可选）

    Returns:
        更新后的团队 dict，或 None（团队不存在）
    """
    def _update(cursor):
        sets = []
        params: list = []
        if display_name is not None:
            sets.append("display_name = ?")
            params.append(display_name)
        if enabled is not None:
            sets.append("enabled = ?")
            params.append(int(enabled))
        if not sets:
            return self.get_team(team_id)
        sets.append("updated_at = ?")
        params.append(time.time())
        params.append(team_id)
        cursor.execute(
            f"UPDATE teams SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        return self.get_team(team_id)
    return self._execute_write(_update)
```

### 7.2 `update_project`

```python
# agent/projects.py — ProjectDB 类新增

def update_project(
    self,
    project_id: str,
    display_name: str | None = None,
    enabled: int | None = None,
    repo_url: str | None = None,
    default_branch: str | None = None,
) -> dict | None:
    """更新项目信息。

    Args:
        project_id: 项目 ID
        display_name: 显示名称（可选）
        enabled: 启用状态 0/1（可选）
        repo_url: 仓库 URL（可选）
        default_branch: 默认分支（可选）

    Returns:
        更新后的项目 dict，或 None
    """
    def _update(cursor):
        sets = []
        params: list = []
        if display_name is not None:
            sets.append("display_name = ?")
            params.append(display_name)
        if enabled is not None:
            sets.append("enabled = ?")
            params.append(int(enabled))
        if repo_url is not None:
            sets.append("repo_url = ?")
            params.append(repo_url)
        if default_branch is not None:
            sets.append("default_branch = ?")
            params.append(default_branch)
        if not sets:
            return self.get_project(project_id)
        sets.append("updated_at = ?")
        params.append(time.time())
        params.append(project_id)
        cursor.execute(
            f"UPDATE projects SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        return self.get_project(project_id)
    return self._execute_write(_update)
```

### 7.3 `update_member`

```python
# agent/membership.py — MembershipDB 类新增

def update_member(
    self,
    member_id: str,
    display_name: str | None = None,
    role: str | None = None,
    enabled: int | None = None,
    email: str | None = None,
) -> dict | None:
    """更新成员信息。

    注意：password_hash 不通过此方法更新，使用专用密码重置流程。
    """
    def _update(cursor):
        sets = []
        params: list = []
        if display_name is not None:
            sets.append("display_name = ?")
            params.append(display_name)
        if role is not None:
            sets.append("role = ?")
            params.append(role)
        if enabled is not None:
            sets.append("enabled = ?")
            params.append(int(enabled))
        if email is not None:
            sets.append("email = ?")
            params.append(email)
        if not sets:
            return self.get_member(member_id)
        sets.append("updated_at = ?")
        params.append(time.time())
        params.append(member_id)
        cursor.execute(
            f"UPDATE members SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        return self.get_member(member_id)
    return self._execute_write(_update)
```

## 八、实现建议

### 8.1 路由注册

在 `plugins/platforms/api_server/adapter.py` 中新增路由注册，参考现有 `/api/sessions` 的模式：

```python
# plugins/platforms/api_server/adapter.py

def _register_admin_routes(self, app: web.Application) -> None:
    """注册 Team/Project/Member 管理 API 路由。"""
    # ── Team routes ──
    app.router.add_get("/api/teams", self._handle_list_teams)
    app.router.add_post("/api/teams", self._handle_create_team)
    app.router.add_get("/api/teams/{team_slug}", self._handle_get_team)
    app.router.add_patch("/api/teams/{team_slug}", self._handle_update_team)
    app.router.add_delete("/api/teams/{team_slug}", self._handle_archive_team)
    app.router.add_get("/api/teams/{team_slug}/members", self._handle_list_team_members)
    app.router.add_post("/api/teams/{team_slug}/members", self._handle_add_team_member)
    app.router.add_patch("/api/teams/{team_slug}/members/{member_id}", self._handle_set_team_member_role)
    app.router.add_delete("/api/teams/{team_slug}/members/{member_id}", self._handle_remove_team_member)

    # ── Project routes ──
    app.router.add_get("/api/teams/{team_slug}/projects", self._handle_list_projects)
    app.router.add_post("/api/teams/{team_slug}/projects", self._handle_create_project)
    app.router.add_get("/api/projects/{project_slug}", self._handle_get_project)
    app.router.add_patch("/api/projects/{project_slug}", self._handle_update_project)
    app.router.add_delete("/api/projects/{project_slug}", self._handle_delete_project)
    app.router.add_get("/api/projects/{project_slug}/members", self._handle_list_project_members)
    app.router.add_post("/api/projects/{project_slug}/members", self._handle_add_project_member)
    app.router.add_patch("/api/projects/{project_slug}/members/{member_id}", self._handle_set_project_member_role)
    app.router.add_delete("/api/projects/{project_slug}/members/{member_id}", self._handle_remove_project_member)
    app.router.add_get("/api/projects/{project_slug}/teams", self._handle_list_project_teams)
    app.router.add_post("/api/projects/{project_slug}/teams", self._handle_link_project_team)
    app.router.add_delete("/api/projects/{project_slug}/teams/{team_slug}", self._handle_unlink_project_team)
    app.router.add_post("/api/projects/{project_slug}/tokens", self._handle_create_project_token)
    app.router.add_get("/api/projects/{project_slug}/tokens", self._handle_list_project_tokens)
    app.router.add_delete("/api/projects/{project_slug}/tokens/{token_id}", self._handle_revoke_project_token)

    # ── Member routes（可选）──
    app.router.add_get("/api/members", self._handle_list_members)
    app.router.add_get("/api/members/{member_id}", self._handle_get_member)
    app.router.add_post("/api/members", self._handle_create_member)
    app.router.add_patch("/api/members/{member_id}", self._handle_update_member)
    app.router.add_delete("/api/members/{member_id}", self._handle_delete_member)
```

### 8.2 Handler 实现示例

每个 handler 是薄包装，调用 `MembershipStore` 方法并格式化响应：

```python
async def _handle_create_team(self, request: web.Request) -> web.Response:
    # 1. 认证 + 授权（复用现有方法）
    member = await self._require_admin(request)
    if member is None:
        return web.json_response(
            {"error": {"code": "UNAUTHORIZED", "message": "Admin role required"}},
            status=403,
        )

    # 2. 解析请求体
    try:
        body = await request.json()
    except Exception:
        return web.json_response(
            {"error": {"code": "BAD_REQUEST", "message": "Invalid JSON"}},
            status=400,
        )

    slug = body.get("slug", "").strip()
    display_name = body.get("display_name", "").strip()
    if not slug or not display_name:
        return web.json_response(
            {"error": {"code": "BAD_REQUEST", "message": "slug and display_name are required"}},
            status=400,
        )

    # 3. 调用 DB 方法
    try:
        team = self.membership.create_team(
            slug=slug,
            display_name=display_name,
            created_by=member["id"],
        )
    except Exception as e:
        if "UNIQUE" in str(e):
            return web.json_response(
                {"error": {"code": "CONFLICT", "message": f"Team slug '{slug}' already exists"}},
                status=409,
            )
        raise

    # 4. 返回响应
    return web.json_response(_format_team(team), status=201)


def _format_team(self, team: dict) -> dict:
    """格式化团队响应，转换 enabled 为 bool。"""
    return {
        "id": team["id"],
        "slug": team["slug"],
        "display_name": team["display_name"],
        "created_by": team.get("created_by"),
        "enabled": bool(team.get("enabled", 0)),
        "created_at": team.get("created_at"),
        "updated_at": team.get("updated_at"),
    }


async def _require_admin(self, request: web.Request) -> dict | None:
    """要求 admin 或 owner 角色，返回 member dict 或 None。"""
    member = await self._verify_bearer_token(request)
    if member is None:
        return None
    if member.get("role") not in ("admin", "owner"):
        return None
    return member
```

### 8.3 分页辅助函数

```python
def _paginate(items: list, limit: int, offset: int) -> dict:
    """通用分页响应。"""
    total = len(items)
    paged = items[offset:offset + limit]
    return {
        "items": paged,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _parse_pagination(request: web.Request) -> tuple[int, int]:
    """解析分页参数。"""
    limit = min(int(request.query.get("limit", 20)), 100)
    offset = max(int(request.query.get("offset", 0)), 0)
    return limit, offset
```

## 九、错误响应规范

所有错误响应统一格式：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

### 错误码清单

| HTTP 状态码 | code | 场景 |
|------------|------|------|
| 400 | `BAD_REQUEST` | 请求体格式错误、必填字段缺失 |
| 401 | `UNAUTHORIZED` | 未提供 token 或 token 无效 |
| 403 | `FORBIDDEN` | 角色权限不足 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 唯一约束冲突（slug 重复等） |
| 422 | `VALIDATION_ERROR` | 字段值不合法（role 不在枚举内等） |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

## 十、能力发现端点增强

建议在现有 `GET /v1/capabilities` 响应中增加 admin API 能力声明：

```json
{
  "models": [...],
  "members": {
    "enabled": true,
    "teams": true,
    "projects": true
  },
  "admin_api": {
    "version": "1.0",
    "endpoints": [
      "/api/teams",
      "/api/projects",
      "/api/members"
    ]
  }
}
```

BFF 可通过 `admin_api` 字段判断是否可调用管理 API，避免对旧版本 Intellect 发起无效请求。

## 十一、实施优先级

| 优先级 | 端点 | 说明 |
|--------|------|------|
| **P0** | Team CRUD + Team 成员管理 | BFF 多租户管理基础 |
| **P0** | Project CRUD | BFF 项目管理基础 |
| **P1** | Project 成员管理 | 项目级权限控制 |
| **P1** | Project token 管理 | BFF 调用项目级 API 的凭证 |
| **P2** | Member 管理 | 成员管理（BFF 可只读） |
| **P2** | Project-Team 关联 | 跨团队协作 |
| **P3** | 能力发现增强 | BFF 自动探测管理 API 可用性 |

## 十二、测试建议

### 12.1 单元测试

- 每个 handler 测试认证、授权、请求解析、DB 调用、响应格式
- DB 方法测试新增的 `update_team`、`update_project`、`update_member`

### 12.2 集成测试

```python
# 测试 Team 生命周期
async def test_team_lifecycle(api_client, admin_token):
    # 1. 创建团队
    resp = await api_client.post("/api/teams", json={
        "slug": "test-team",
        "display_name": "Test Team",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status == 201
    team = await resp.json()
    assert team["slug"] == "test-team"

    # 2. 获取详情
    resp = await api_client.get(f"/api/teams/test-team", headers=...)
    assert resp.status == 200

    # 3. 更新
    resp = await api_client.patch(f"/api/teams/test-team", json={
        "display_name": "Updated Team",
    }, headers=...)
    assert resp.status == 200
    assert (await resp.json())["display_name"] == "Updated Team"

    # 4. 归档
    resp = await api_client.delete(f"/api/teams/test-team", headers=...)
    assert resp.status == 204

    # 5. 确认已归档（列表不返回）
    resp = await api_client.get("/api/teams", headers=...)
    items = (await resp.json())["items"]
    assert not any(t["slug"] == "test-team" for t in items)
```

## 十三、与 AgentUI BFF 的对接关系

```
┌─────────────────────────────────────────────────┐
│  AgentUI BFF (:9390)                            │
│  ├── IntellectEnterpriseAdapter                 │
│  │   ├── 核心层：调用 /v1/* 和 /api/sessions/*  │
│  │   └── 多租户层：调用 /api/teams/* 和         │
│  │       /api/projects/*（本文档定义的 API）    │
│  │                                               │
│  └── Admin 页面（Team/Project 管理）            │
│      └── 透传 BFF → Intellect Admin API         │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  Intellect 企业版 (:8642)                       │
│  └── plugins/platforms/api_server/adapter.py    │
│      ├── 已有：/v1/*, /api/sessions/*           │
│      └── 新增：/api/teams/*, /api/projects/*    │
│          └── 调用 MembershipStore DB 方法       │
└─────────────────────────────────────────────────┘
```

BFF 调用 Admin API 时使用 admin 级别的 member token（`imt_*`），运行时 Agent 调用使用项目级 token（`imt_p_*`）。

## 附录：相关文件

- Intellect API Server：`plugins/platforms/api_server/adapter.py`
- Intellect DB 层：`agent/membership.py`（`MembershipStore` 类）
- Intellect Schema：`intellect_state.py`（`SCHEMA_SQL`）
- BFF Adapter：`bff/src/services/adapters/intellect/adapter.ts`（待实现）
- BFF 多租户路由：`bff/src/routes/team.ts`、`bff/src/routes/project.ts`（待实现）
