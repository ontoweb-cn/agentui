# Cognitive Wargame「资源总览」开发计划

> **关联文档**：
> - 后端接口设计：[cognitive-wargame/docs/skills-resources-api-design.md](../../cognitive-wargame/docs/skills-resources-api-design.md)（SKILL-01~06 + TOOL-01~04）
> - 管理服务架构：[cognitive-wargame/docs/phase3-architecture-design.md](../../cognitive-wargame/docs/phase3-architecture-design.md)
> - 管理服务 API 清单：[cognitive-wargame/admin_server/README.md](../../cognitive-wargame/admin_server/README.md)

## 1. 背景与目标

当前页面入口为：

- `http://localhost:9391/cognitive-wargame`
- 对应前端模块：`src/features/cognitive-wargame`

本次希望在 Cognitive Wargame 的导航首项「总览仪表盘」（`nav.dashboard`）旁新增一个 tab：

- 中文标签：`资源总览`
- 推荐路由：`/cognitive-wargame/resources`

> 注：`推演总览` 是 `dashboard.title`（页面标题），不是导航标签，避免混淆。

「资源总览」页面用于集中展示项目内的全部资源，按资源类型组织：

| 资源类型 | 位置 | 数量 | 性质 |
|---|---|---|---|
| **Skills** | `cognitive-wargame/skills/` | 23 个 | LLM 能力单元（SKILL.md 驱动，6 大分类） |
| **Tools** | `cognitive-wargame/tools/cognitive_tools/` | 12 个 | 核心算法引擎（ICM/LTM/SIR/贝叶斯等，注册到 registry） |
| **模型配置** | `cognitive-wargame/data/` | 多个 | 算法参数（cognitive_biases.json / kg_ontology.yaml 等） |

> 模型配置 API 第一版待开发，UI 预留入口但暂不实现。

页面核心能力：

1. **左侧资源类型树**：把资源总览拆成 Skills、Tools、模型配置三部分；Skills 下再展示 6 个分类，Tools 下展示功能分类，模型配置第一版预留入口。
2. 点击左侧资源类型树节点切换右侧内容区，三类资源不混在同一个列表中展示。
3. **Skills 列表**：展示 skill 名称、描述、版本、标签等，点击行查看 `SKILL.md` 等文件内容。
4. **Tools 列表**：展示 tool 名称、功能分类、描述、环境依赖等，点击行查看 schema 和源码预览。
5. 每个 skill / tool 右侧提供「测试」按钮，作为调试/执行入口。

## 2. 当前代码结构判断

Cognitive Wargame 模块主要文件：

```text
src/features/cognitive-wargame/routes.ts
src/features/cognitive-wargame/manifest.ts
src/features/cognitive-wargame/pages/DashboardPage.tsx
src/features/cognitive-wargame/locales/zh.ts
src/features/cognitive-wargame/locales/en.ts
src/features/cognitive-wargame/api.ts
src/features/cognitive-wargame/store.ts
```

已有 skills 页面与服务主要文件（agentui 通用 skills 体系，**本页面不复用其数据层**）：

```text
src/pages/skills/index.tsx
src/pages/skills/hooks.ts
src/pages/skills/types.ts
src/pages/skills/components/skill-detail.tsx      ← 仅复用此展示组件
src/pages/skills/components/skill-card.tsx
src/services/skill-space-service.ts               ← 不复用
src/services/file-manager-service.ts              ← 不复用
```

> ⚠️ **数据源决策（变更）**：
>
> 「资源总览」的数据**与「总览仪表盘」其它接口一致，从 Cognitive Wargame 管理网关（admin_server, 9385）获取**，而非复用 agentui 通用 skills 服务（`/api/v1/skills/search`、`skillSpaceService`）。
>
> 后端接口规范见：[cognitive-wargame/docs/skills-resources-api-design.md](../../cognitive-wargame/docs/skills-resources-api-design.md)（SKILL-01 ~ SKILL-06）
>
> 原因：
> 1. cognitive-wargame 的 skills 位于 `cognitive-wargame/skills/` 目录，按六大类组织，与 agentui 通用 skills 体系无关。
> 2. `useSkills` hook 为单 space 单例 state，挂载即清空，并发 `fetchSkills` 会互相覆盖（详见第 7 节）。
> 3. 保持与 DashboardPage / ScenarioListPage 等页面一致的调用方式（独立 axios 实例 `api.ts`，`baseURL = /api/v1/wargame`）。

已有 `src/pages/skills/components/skill-detail.tsx` 已经支持（**仅复用此展示组件**）：

- 展示 skill 文件树。
- 自动优先打开 `SKILL.md`、`README.md`、`index.md`。
- Markdown 文件使用 `MarkdownViewer` 展示。
- 非 Markdown 文件使用 `CodeViewer` 展示。
- 支持版本切换。

因此「资源总览」第一版**复用 `SkillDetail` 展示组件**，但数据层（列表、详情、文件内容）改为调用 cognitive-wargame 管理服务的新增接口。

## 3. 推荐实现方案

### 3.1 新增路由

修改：

```text
src/features/cognitive-wargame/routes.ts
```

新增路由常量：

```ts
Resources: '/cognitive-wargame/resources'
```

新增 lazy route：

```ts
{
  path: WargameRoutes.Resources,
  Component: () => import('./pages/ResourceOverviewPage'),
}
```

### 3.2 新增导航 tab

修改：

```text
src/features/cognitive-wargame/manifest.ts
```

建议把「资源总览」放在「总览仪表盘」（`WargameRoutes.Dashboard`）后面，使它和「总览仪表盘」同级：

```ts
{
  path: WargameRoutes.Resources,
  labelKey: 'cognitiveWargame.nav.resources',
  pathMap: [WargameRoutes.Resources],
  testId: 'nav-cw-resources',
}
```

### 3.3 新增页面

新增：

```text
src/features/cognitive-wargame/pages/ResourceOverviewPage.tsx
src/features/cognitive-wargame/components/ResourceTree.tsx          # 左侧资源类型树
src/features/cognitive-wargame/components/SkillListPanel.tsx        # Skills 列表
src/features/cognitive-wargame/components/ToolListPanel.tsx         # Tools 列表
src/features/cognitive-wargame/components/ResourceSkillTestPanel.tsx # 测试面板
```

## 4. 页面信息架构

采用**左侧资源类型树 + 右侧独立内容区**布局。资源总览拆为 Skills、Tools、模型配置三部分；六个分类作为 Skills 的子节点出现：

```text
+--------------------+----------------------------------------------+
| 资源总览            |  [当前选中节点]              搜索框（可选）    |
|                    |                                              |
| v Skills (23)      |  Skills 列表 / Tools 列表 / 详情面板         |
|   blue-team (0)    |                                              |
|   gray-team (3)    |  名称        描述        版本/分类    操作    |
|   group-agents (2) |  skill-a     xxx         v1.0       查看 测试|
|   person-agents(6) |  skill-b     xxx         v1.2       查看 测试|
|   red-team (3)     |  ...                                         |
|   rule-team (9)    |                                              |
|                    |                                              |
| v Tools (12)       |                                              |
|   状态管理 (1)      |                                              |
|   认知加工 (1)      |                                              |
|   传播模拟 (1)      |                                              |
|   指标评估 (1)      |                                              |
|   叙事分析 (2)      |                                              |
|   数据导入 (1)      |                                              |
|   想定管理 (3)      |                                              |
|   评估报告 (1)      |                                              |
|   知识图谱 (1)      |                                              |
|                    |                                              |
| > 模型配置 (待开发) |                                              |
+--------------------+----------------------------------------------+
```

交互：

- 页面首次进入时默认选中「Skills」根节点，右侧展示全部 skills。
- 点击 Skills 下的分类节点（如 `red-team`），右侧仅展示该分类 skills。
- 点击「Tools」根节点，右侧展示全部 tools。
- 点击 Tools 下的分类节点（如 `传播模拟`），右侧仅展示该分类 tools。
- 点击「模型配置」节点时，第一版只展示待开发占位，不与 Skills / Tools 列表混排。
- 点击 skill 行的「查看」打开 `SkillDetail` 组件查看文件内容。
- 点击 tool 行的「查看」在右侧展示 tool 详情（schema + 源码预览）。
- 「模型配置」节点置灰，显示「待开发」tooltip。

## 5. Skills 六大类定义

六大类只属于「Skills」资源类型，是左侧资源类型树中 Skills 下的子分类。建议在 `ResourceOverviewPage.tsx` 内先定义固定分类：

```ts
const RESOURCE_CATEGORIES = [
  'blue-team',
  'gray-team',
  'group-agents',
  'person-agents',
  'red-team',
  'rule-team',
] as const;
```

如果后续多个页面复用，可抽到：

```text
src/features/cognitive-wargame/constants.ts
```

## 6. Skill 分类规则（已废弃 / 仅留作参考）

> ⚠️ **本节已废弃。**
>
> 分类由后端 SKILL-01 / SKILL-02 直接返回 `category` 字段（见第 7 节），前端无需推断。本节的 `inferSkillCategory` 辅助函数保留仅作参考，**第一版不需要实现**。
>
> 如果后续后端无法返回 `category` 字段，或需要客户端二次过滤，再启用本节逻辑。

分类来源建议按优先级判断：

1. `skill.metadata.category`
2. `skill.metadata.group`
3. `skill.metadata.tags`
4. `skill.id` / `skill.name` / file path 中包含六大类名称
5. 无法识别时归入 `uncategorized`；左侧资源类型树仍只在 Skills 下展示六个固定大类

> 注：`skill.source_ref` / `skill.central_path` 虽在 `types.ts` 中有定义，但当前数据源（`useSkills` 的 search 结果与文件系统回退）从未给这两个字段赋值，因此不列入可用分类来源。

推荐辅助函数：

```ts
type ResourceCategory =
  | 'blue-team'
  | 'gray-team'
  | 'group-agents'
  | 'person-agents'
  | 'red-team'
  | 'rule-team';

// 注意：避免使用裸 includes 子串匹配，否则 'red-team' 会误命中
// 'redirection.md'、'team-config.yaml' 等无关片段。
// 改为对路径段 / 单词做边界匹配。
const matchesCategory = (value: string, category: string): boolean => {
  const v = value.toLowerCase();
  const c = category.toLowerCase();
  // 1. 完全相等
  if (v === c) return true;
  // 2. 路径段匹配（按 / 分隔）
  if (v.split('/').some((seg) => seg === c)) return true;
  // 3. 单词边界匹配（用于 tags、name 等非路径字符串）
  const re = new RegExp(`(^|[^a-z])${c.replace('-', '\\-')}([^a-z]|$)`, 'i');
  return re.test(v);
};

const inferSkillCategory = (skill: Skill): ResourceCategory | null => {
  // 注意：source_ref / central_path 在当前数据源下从未被填充，不要依赖。
  const candidates = [
    skill.metadata?.category,
    skill.metadata?.group,
    ...(skill.metadata?.tags ?? []),
    skill.id,
    skill.name,
    ...skill.files.map((file) => file.path),
  ]
    .filter(Boolean)
    .map((value) => String(value));

  return RESOURCE_CATEGORIES.find((category) =>
    candidates.some((value) => matchesCategory(value, category)),
  ) ?? null;
};
```

注意：如果 skills 实际是按 skill space 区分六大类，例如六个 space 名分别就是 `blue-team` 等，则页面可以直接遍历这六个 space 并分别调用 `fetchSkills`。如果不是，则采用上面的 metadata/path 推断策略。当前新结构下，无论分类来源如何，六大类都只出现在左侧资源类型树的 Skills 分组内。

## 7. 数据接入策略

> ✅ **数据源已确定：从 Cognitive Wargame 管理网关（admin_server, 9385）获取。**
>
> 与「总览仪表盘」其它接口（`getScenarios` / `getMetrics` / `getKGRelations` 等）一致，通过 cognitive-wargame plugin 自有的独立 axios 实例（`api.ts`，`baseURL = /api/v1/wargame`）调用，经 Vite proxy rewrite 到 9385 的 `/api/v1/*`。
>
> **不复用 agentui 通用 skills 服务**（`skillSpaceService` / `file-manager-service` / `useSkills` hook 的有状态部分）。原因：
>
> 1. cognitive-wargame 的 skills 位于 `cognitive-wargame/skills/` 目录，按六大类组织，与 agentui 通用 skills 体系无关。
> 2. `useSkills`（见 `src/pages/skills/hooks.ts:159`）内部为单 space 单例 state，挂载即清空，并发 `fetchSkills` 会互相覆盖。
> 3. `getSkillFileContent` / `getSkillVersionFiles` 内部回退逻辑是 `skillObj || skills.find(...)`，当 `skills` 为空且未透传 `skillObj` 时，文件读取必失败。
>
> 后端接口规范见：[cognitive-wargame/docs/skills-resources-api-design.md](../../cognitive-wargame/docs/skills-resources-api-design.md)（SKILL-01~06 + TOOL-01~04）

### 7.1 后端接口清单

**Skills API**：

| 编号 | Method | 前端路径（经 proxy） | 用途 |
|---|---|---|---|
| SKILL-01 | GET | `/api/v1/wargame/skills/categories` | 获取六大分类及数量 |
| SKILL-02 | GET | `/api/v1/wargame/skills` | 获取 skills 列表（支持分类过滤、分页、排序） |
| SKILL-03 | GET | `/api/v1/wargame/skills/{category}/{skill_id}` | 获取单个 skill 详情（含文件树） |
| SKILL-04 | GET | `/api/v1/wargame/skills/{category}/{skill_id}/files` | 获取 skill 文件树（第二阶段） |
| SKILL-05 | GET | `/api/v1/wargame/skills/{category}/{skill_id}/files/{file_path:path}` | 获取文件内容 |
| SKILL-06 | POST | `/api/v1/wargame/skills/{category}/{skill_id}/test` | 测试执行 skill（第一版占位） |

**Tools API**：

| 编号 | Method | 前端路径（经 proxy） | 用途 |
|---|---|---|---|
| TOOL-01 | GET | `/api/v1/wargame/tools` | 获取 tools 列表（含分类统计，支持分类过滤） |
| TOOL-02 | GET | `/api/v1/wargame/tools/{tool_name}` | 获取 tool 详情（含 schema/源码预览） |
| TOOL-03 | GET | `/api/v1/wargame/tools/{tool_name}/status` | 检查 tool 可用性 |
| TOOL-04 | POST | `/api/v1/wargame/tools/{tool_name}/invoke` | 调用 tool（第一版占位） |

### 7.2 前端 api.ts 新增方法

在 `src/features/cognitive-wargame/api.ts` 中新增，与现有 `getScenarios` / `getMetrics` 同一 axios 实例（`client`）：

```ts
// SKILL-01：获取六大分类及数量
export const getSkillCategories = () =>
  client.get('/skills/categories').then(unwrap<SkillCategoriesResponse>);

// SKILL-02：获取 skills 列表
export const getSkills = (params: {
  category?: ResourceCategory;
  page?: number;
  page_size?: number;
  sort_by?: 'name' | 'update_time';
  sort_order?: 'asc' | 'desc';
}) => client.get('/skills', { params }).then(unwrap<SkillListResponse>);

// SKILL-03：获取 skill 详情（含文件树）
// 注意：skill_id 可能含空格（如 rule-team 的 "Information Perception Model-skill"），需 encodeURIComponent
export const getSkillDetail = (category: string, skillId: string) =>
  client
    .get(`/skills/${category}/${encodeURIComponent(skillId)}`)
    .then(unwrap<SkillDetailResponse>);

// SKILL-05：获取文件内容（纯文本，不走 unwrap，返回 string）
// 注意：SKILL-05 返回纯文本而非 {code, data, message} 包装。
// 用 responseType: 'text' 阻止 axios 自动 JSON 解析（否则合法 JSON 文件内容会被解析成 object）。
// 用 transformResponse 阻止 axios 对响应做默认转换。
// 调用方取 .data 得到 string。
export const getSkillFileContent = (
  category: string,
  skillId: string,
  filePath: string,
): Promise<string> =>
  client
    .get(`/skills/${category}/${encodeURIComponent(skillId)}/files/${filePath}`, {
      responseType: 'text',
      transformResponse: [(data) => data],
    })
    .then((res) => res.data as string);

// SKILL-06：测试执行 skill（占位）
export const testSkill = (category: string, skillId: string, input: string) =>
  client
    .post(`/skills/${category}/${encodeURIComponent(skillId)}/test`, { input })
    .then(unwrap<SkillTestResponse>);

// === Tools API ===

// TOOL-01：获取 tools 列表（含分类统计）
export const getTools = (category?: string) =>
  client
    .get('/tools', { params: { category } })
    .then(unwrap<ToolListResponse>);

// TOOL-02：获取 tool 详情（含 schema/源码预览）
export const getToolDetail = (toolName: string) =>
  client
    .get(`/tools/${encodeURIComponent(toolName)}`)
    .then(unwrap<ToolDetailResponse>);

// TOOL-03：检查 tool 可用性
export const getToolStatus = (toolName: string) =>
  client
    .get(`/tools/${encodeURIComponent(toolName)}/status`)
    .then(unwrap<ToolStatusResponse>);

// TOOL-04：调用 tool（占位）
export const invokeTool = (toolName: string, action: string, params: Record<string, unknown>) =>
  client
    .post(`/tools/${encodeURIComponent(toolName)}/invoke`, { action, params })
    .then(unwrap<ToolInvokeResponse>);
```

### 7.3 类型定义与 `created_at` 类型说明

后端 SKILL-02 / SKILL-03 返回的 `created_at` / `updated_at` 为 epoch 秒（`number`），与 agentui 通用 `Skill.created_at: number` 一致，但与 cognitive-wargame 的 `Scenario.created_at: string`（ISO 字符串）不同。资源总览页面使用自定义类型（建议放 `types/resource.ts`），**不与 `Scenario` 类型混用**，避免类型冲突。

建议类型定义（`src/features/cognitive-wargame/types/resource.ts`）：

```ts
export type ResourceCategory =
  | 'blue-team'
  | 'gray-team'
  | 'group-agents'
  | 'person-agents'
  | 'red-team'
  | 'rule-team';

export interface SkillCategoryInfo {
  name: ResourceCategory;
  label: string;
  count: number;
  description: string;
}

export interface SkillCategoriesResponse {
  categories: SkillCategoryInfo[];
  total: number;
}

export interface SkillSummary {
  id: string;
  name: string;
  category: ResourceCategory;
  description: string;
  version: string;
  author: string;
  tags: string[];
  directory: string;
  file_count: number;
  created_at: number;  // epoch 秒
  updated_at: number;  // epoch 秒
}

export interface SkillFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface SkillDetailResponse extends SkillSummary {
  files: SkillFileEntry[];
  metadata: Record<string, unknown>;
}

export interface SkillListResponse {
  skills: SkillSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface SkillTestResponse {
  status: 'not_implemented' | 'running' | 'success' | 'failed';
  message?: string;
  skill_id?: string;
  stdout?: string;
  stderr?: string;
  result?: unknown;
  elapsed_ms?: number;
}

// === Tools 类型 ===

export type ToolCategory =
  | 'state-management'
  | 'cognitive-processing'
  | 'propagation-simulation'
  | 'metrics-evaluation'
  | 'narrative-analysis'
  | 'data-ingestion'
  | 'scenario-management'
  | 'report-generation'
  | 'knowledge-graph';

export interface ToolCategoryInfo {
  name: string;
  label: string;
  count: number;
}

export interface ToolSummary {
  name: string;
  toolset: string;
  category: string;
  category_label: string;
  description: string;
  actions: string[];
  requires_env: string[];
  source_file: string;
}

export interface ToolListResponse {
  tools: ToolSummary[];
  total: number;
  categories: ToolCategoryInfo[];
}

export interface ToolDetailResponse extends ToolSummary {
  schema: Record<string, unknown>;
  source_code_preview: string;
}

export interface ToolStatusResponse {
  name: string;
  available: boolean;
  requires_env: string[];
  env_status: Record<string, string>;
  message: string;
}

export interface ToolInvokeResponse {
  status: 'not_implemented' | 'running' | 'success' | 'failed';
  message?: string;
  tool_name?: string;
  result?: unknown;
  elapsed_ms?: number;
}

// === 左侧资源类型树节点类型 ===

export type ResourceType = 'skills' | 'tools' | 'models';

export interface ResourceTreeNode {
  key: string;              // 唯一标识，如 'skills' / 'skills:red-team' / 'tools' / 'tools:propagation-simulation'
  label: string;            // 显示名称
  count?: number;           // 数量
  resourceType: ResourceType;
  category?: string;        // 分类名（叶节点有值）
  isRoot?: boolean;         // 是否资源类型根节点
  disabled?: boolean;       // 是否禁用（如模型配置）
}
```

### 7.4 推荐数据加载骨架

页面内用本地 `useState` 维护，直接调用上述 `api.ts` 方法：

```ts
// === 左侧资源类型树数据 ===
const [treeNodes, setTreeNodes] = useState<ResourceTreeNode[]>([]);
// === 右侧列表数据 ===
const [skills, setSkills] = useState<SkillSummary[]>([]);
const [tools, setTools] = useState<ToolSummary[]>([]);
const [activeResourceType, setActiveResourceType] = useState<ResourceType>('skills');
const [activeCategory, setActiveCategory] = useState<string | null>(null);
const [loading, setLoading] = useState(false);

// 加载左侧资源类型树（并发拉取 Skills 分类 + Tools 分类）
const loadTree = useCallback(async () => {
  try {
    const [skillCats, toolList] = await Promise.all([
      api.getSkillCategories().catch(() => ({ categories: [], total: 0 })),
      api.getTools().catch(() => ({ tools: [], total: 0, categories: [] })),
    ]);

    const nodes: ResourceTreeNode[] = [
      // Skills 根节点 + 分类子节点
      {
        key: 'skills', label: 'Skills', count: skillCats.total,
        resourceType: 'skills', isRoot: true,
      },
      ...skillCats.categories.map((c) => ({
        key: `skills:${c.name}`, label: c.label, count: c.count,
        resourceType: 'skills' as const, category: c.name,
      })),
      // Tools 根节点 + 分类子节点
      {
        key: 'tools', label: 'Tools', count: toolList.total,
        resourceType: 'tools', isRoot: true,
      },
      ...toolList.categories.map((c) => ({
        key: `tools:${c.name}`, label: c.label, count: c.count,
        resourceType: 'tools' as const, category: c.name,
      })),
      // 模型配置（待开发，置灰）
      {
        key: 'models', label: '模型配置', count: 0,
        resourceType: 'models' as const, isRoot: true, disabled: true,
      },
    ];
    setTreeNodes(nodes);
  } catch (e) {
    console.error('Failed to load resource tree:', e);
  }
}, []);

// 加载 skills 列表
const loadSkills = useCallback(async (category?: string) => {
  setLoading(true);
  try {
    const resp = await api.getSkills({ category: category || undefined, page: 1, page_size: 200 });
    setSkills(resp.skills);
  } catch { setSkills([]); } finally { setLoading(false); }
}, []);

// 加载 tools 列表
const loadTools = useCallback(async (category?: string) => {
  setLoading(true);
  try {
    const resp = await api.getTools(category || undefined);
    setTools(resp.tools);
  } catch { setTools([]); } finally { setLoading(false); }
}, []);

// 首次加载：左侧资源类型树 + 默认 skills 列表
useEffect(() => {
  loadTree();
  loadSkills(null);
}, [loadTree, loadSkills]);

// 点击资源类型树节点
const handleTreeNodeClick = (node: ResourceTreeNode) => {
  if (node.disabled) return;
  setActiveResourceType(node.resourceType);
  setActiveCategory(node.category || null);
  if (node.resourceType === 'skills') {
    loadSkills(node.category);
  } else if (node.resourceType === 'tools') {
    loadTools(node.category);
  }
};
```

### 7.5 数据流

```
页面挂载
  │
  ├─ api.getSkillCategories() ─┐
  │                            ├─ Promise.all → 构建 treeNodes（左侧资源类型树）
  └─ api.getTools() ───────────┘
  └─ api.getSkills({}) → SKILL-02 → setSkills（默认右侧列表）

点击资源类型树节点
  ├─ Skills 节点 → loadSkills(category)  → SKILL-02 → setSkills
  └─ Tools 节点  → loadTools(category)   → TOOL-01  → setTools

点击 skill 行/「查看」
  ├─ api.getSkillDetail(cat, id) → SKILL-03 → setSelectedSkill（含 files）
  └─ 打开 SkillDetail 组件
       └─ getFileContent(cat, id, path) → SKILL-05 → 文件内容

点击 tool 行/「查看」
  └─ api.getToolDetail(name) → TOOL-02 → setSelectedTool（含 schema + 源码预览）
       └─ 右侧展示 ToolDetail 面板（schema JSON + source_code_preview）
```

### 7.6 与原方案 A/B 的关系

原方案 A（六大类 = 六个 skill space）和方案 B（metadata/path 推断分类）**已不再适用**——分类由后端 SKILL-01 / SKILL-02 直接返回 `category` 字段，前端无需推断。第 6 节的 `inferSkillCategory` 辅助函数已标注为「已废弃」，第一版不需要实现。

### 7.7 错误处理

- SKILL-01 失败：左侧 Skills 分类节点显示「加载失败」或空数量，skills 列表仍尝试加载。
- SKILL-02 失败：列表显示空状态 + 重试按钮。
- SKILL-03 失败：详情弹窗显示错误提示。
- SKILL-05 失败：文件内容区显示「文件读取失败」。
- 网络错误：复用 `api.ts` 现有的 axios 拦截器错误处理。

## 8. Skill 内容查看

> Skills 详情查看复用 `SkillDetail` 组件；Tools 详情查看见 §8.5。

推荐直接复用展示组件：

```text
src/pages/skills/components/skill-detail.tsx
```

页面内维护：

```ts
const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
const [detailOpen, setDetailOpen] = useState(false);
```

点击 skill 时：

1. 调用 `api.getSkillDetail(category, skillId)`（SKILL-03）获取详情（含 `files` 文件树）。
2. 将后端返回的 skill 对象**适配为 `SkillDetail` 组件所需的 `Skill` 类型**（见下方「类型映射」）。
3. 打开 `SkillDetail`。

### 8.1 后端响应 → `Skill` 类型映射

`SkillDetail` 组件依赖 `Skill` 类型（[types.ts:7-20](file:///Users/simon/project/agentui/src/pages/skills/types.ts#L7)）。后端 SKILL-03 返回的对象需做如下映射：

```ts
import type { Skill, SkillFileEntry } from '@/pages/skills/types';
import type { SkillDetailResponse } from '../types/resource';

function adaptSkill(resp: SkillDetailResponse, category: string): Skill {
  return {
    id: resp.id,
    name: resp.name,
    description: resp.description,
    source_type: 'local',           // cognitive-wargame skills 均为本地目录
    created_at: resp.created_at,
    updated_at: resp.updated_at,
    files: resp.files as SkillFileEntry[],  // 直接复用，结构一致
    metadata: {
      version: resp.version,
      author: resp.author,
      tags: resp.tags,
      ...resp.metadata,
    },
    // ⚠️ _folderId 必须设为非空占位值，否则组件内部会跳过文件加载（见 8.2）
    _folderId: `cw-${category}-${resp.id}`,
    // 附加 category 供 handleGetFileContent 使用（非 Skill 类型字段，用 as any 读取）
    ...(({ __category: category }) as object),
  } as Skill;
}
```

### 8.2 `_folderId` 检查的应对

`SkillDetail` 组件在 `loadVersionFiles`（[skill-detail.tsx:156-166](file:///Users/simon/project/agentui/src/pages/skills/components/skill-detail.tsx#L156)）中检查 `skill._folderId`，若为空则 `console.warn` 并直接返回，导致文件树为空：

```tsx
if (!(skill as any)._folderId) {
  console.warn(`[Skill Detail] Skill "${skill.name}" has no folder_id. ...`);
  setVersionFiles([]);
  setVersionLoading(false);
  return;
}
```

本页面不使用 `_folderId` 做实际文件操作（文件读取走 SKILL-05），但必须设为非空占位值（如 `cw-${category}-${id}`），否则组件不会渲染文件树。

### 8.3 `getFileContent` 回调实现

> ⚠️ **关键约束：`getFileContent` 回调需改为调用 SKILL-05。**
>
> 本页面不复用 `useSkills` 的 `getSkillFileContent`（该函数依赖 `useSkills` 内部 `skills` state 和 `_folderId`，会落空）。应在页面内自行实现 `getFileContent` 回调，调用 `api.getSkillFileContent(category, skillId, filePath)`（SKILL-05）。

`skill-detail.tsx` 的实际组件 props（[skill-detail.tsx:27-42](file:///Users/simon/project/agentui/src/pages/skills/components/skill-detail.tsx#L27)）已支持 `skillObj?` 参数：

```ts
getFileContent: (skillId, filePath, version?, skillObj?) => Promise<string | null>;
getVersionFiles?: (skillId, version, skillObj?) => Promise<SkillFileEntry[]>;
```

### 8.4 `SkillDetailProps` 类型缺陷（既有问题）

[src/pages/skills/types.ts:101-114](file:///Users/simon/project/agentui/src/pages/skills/types.ts#L101) 的 `SkillDetailProps` 类型定义**漏了 `skillObj` 参数**：

```ts
// types.ts 中的定义（3 个参数，缺 skillObj）
getFileContent: (skillId, filePath, version?) => Promise<string | null>;
// skill-detail.tsx 实际实现（4 个参数，含 skillObj）
getFileContent: (skillId, filePath, version?, skillObj?) => Promise<string | null>;
```

组件内部 [第 234 行](file:///Users/simon/project/agentui/src/pages/skills/components/skill-detail.tsx#L234) 传入了第 4 个参数 `skill`，**TypeScript 编译会报错**「Expected 3 arguments, but got 4」。

实施时有两种处理方式：
1. **修复类型定义**（推荐）：在 `types.ts` 的 `SkillDetailProps.getFileContent` 和 `getVersionFiles` 签名中补上 `skillObj?: Skill` 参数。
2. **临时绕过**：页面内定义 `handleGetFileContent` 时类型签名与 `types.ts` 对齐（3 参数），运行时通过 `arguments` 或展开接收第 4 个参数；或用 `as any` 强转。

页面内实现示例（假设已修复类型定义）：

```tsx
const handleGetFileContent = useCallback(
  async (skillId: string, filePath: string, version?: string, skillObj?: Skill) => {
    const skill = skillObj || selectedSkill;
    if (!skill) return null;
    // 从 skill 对象上获取 category（由 adaptSkill 时附加，或从 metadata 读取）
    const category = (skill as any).__category as string | undefined;
    if (!category) return null;
    try {
      return await api.getSkillFileContent(category, skillId, filePath);
    } catch (e) {
      console.error('Failed to read file:', e);
      return null;
    }
  },
  [selectedSkill],
);
```

推荐调用方式：

```tsx
<SkillDetail
  skill={selectedSkill}
  open={detailOpen}
  onClose={handleCloseDetail}
  getFileContent={handleGetFileContent}
/>
```

`getVersionFiles` 可不传（cognitive-wargame skills 无版本目录结构，文件树已由 SKILL-03 的 `files` 字段返回，组件会直接使用 `skill.files`）。

### 8.5 Tool 详情查看

Tool 详情不复用 `SkillDetail` 组件（数据结构不同），使用独立的 `ToolDetailPanel.tsx` 组件。

点击 tool 行「查看」时：

1. 调用 `api.getToolDetail(toolName)`（TOOL-02）获取详情（含 `schema` + `source_code_preview`）。
2. 右侧面板展示：
   - **基本信息**：name、category_label、description、actions、requires_env。
   - **参数 Schema**：以 JSON 格式化展示各 action 的参数定义（可用 `CodeViewer` 组件，语言选 `json`）。
   - **源码预览**：展示 `source_code_preview`（前 2000 字符），用 `CodeViewer` 组件，语言选 `python`。
   - **环境依赖**：列出 `requires_env`，可选调用 TOOL-03 展示各环境变量配置状态。

```tsx
<ToolDetailPanel
  tool={selectedTool}
  onClose={handleCloseToolDetail}
/>
```

> Tool 详情不涉及文件树浏览（Tool 源码通过 `source_code_preview` 预览，不支持查看完整文件树）。如需查看完整源码，可提供 `source_file` 路径的 Git 链接。

## 9. 「测试」按钮设计

### 9.1 Skills 测试

后端已规划 SKILL-06（详见 [后端文档](../../cognitive-wargame/docs/skills-resources-api-design.md) §SKILL-06）。第一版后端返回占位响应。

- 每个 skill 行右侧显示「测试」按钮。
- 点击后打开测试面板，展示 skill 名称、分类、描述、版本。
- 点击运行后调用 `api.testSkill(category, skillId, input)`（SKILL-06）。
- 后端返回 `{"status":"not_implemented"}` 时，面板显示占位提示。

### 9.2 Tools 测试

后端已规划 TOOL-04（详见 [后端文档](../../cognitive-wargame/docs/skills-resources-api-design.md) §TOOL-04）。第一版后端返回占位响应。

- 每个 tool 行右侧显示「测试」按钮。
- 点击后打开测试面板，展示 tool 名称、分类、schema（参数定义）。
- 根据 TOOL-02 返回的 `schema` 动态生成参数输入表单。
- 点击运行后调用 `api.invokeTool(toolName, action, params)`（TOOL-04）。
- 后端返回 `{"status":"not_implemented"}` 时，面板显示占位提示。
- 可选：先调用 `api.getToolStatus(toolName)`（TOOL-03）检查 tool 可用性，不可用时禁用运行按钮。

### 9.3 第二阶段：接入真实执行

SKILL-06 / TOOL-04 落地后：

- 返回内容：`status`（running/success/failed）、`stdout` / `stderr` / `result` / `elapsed_ms`。
- UI 状态：running（加载中）、success（展示结果）、failed（展示错误）、not_implemented（占位提示）。

## 10. UI 组件建议

页面使用现有 UI 组件风格，优先复用项目里的：

```text
Button
Card
Badge
SearchInput
Spin
Table
Tree / TreeView（左侧资源类型树）
Dialog / Sheet（测试面板、Tool 详情）
CodeViewer（Tool 源码预览）
```

左侧资源类型树建议：

- 使用 shadcn/ui 的 Tree 或自定义树组件。
- 两层结构为主：资源类型根节点 > 分类节点；根节点包括 Skills、Tools、模型配置。
- 根节点显示资源类型名 + 总数（如 `Skills (23)`）。
- 分类节点显示分类名 + 数量（如 `red-team (3)`）。
- 当前选中节点高亮。
- 模型配置节点置灰 + tooltip「待开发」。

右侧列表建议使用表格：

- Skills 列表列：名称、分类、描述、版本、操作（查看/测试）。
- Tools 列表列：名称、功能分类、描述、环境依赖、操作（查看/测试）。
- 操作列放「查看」和「测试」。

## 11. 国际化文案

需要修改：

```text
src/features/cognitive-wargame/locales/zh.ts
src/features/cognitive-wargame/locales/en.ts
```

所有 key 必须嵌套在 `cognitiveWargame` 命名空间下（与现有 `cognitiveWargame.nav.*`、`cognitiveWargame.dashboard.*` 同级）。

中文（`zh.ts`）在 `cognitiveWargame` 对象内新增：

```ts
nav: {
  // ... 现有 key
  resources: '资源总览',
},
resource: {
  title: '资源总览',
  all: '全部',
  category: '分类',
  skills: 'Skills',
  skillName: 'Skill 名称',
  description: '描述',
  test: '测试',
  view: '查看',
  noSkills: '暂无 Skills',
  testPending: '测试接口待接入',
},
```

英文（`en.ts`）对应：

```ts
nav: {
  // ... existing keys
  resources: 'Resources',
},
resource: {
  title: 'Resources',
  all: 'All',
  category: 'Category',
  skills: 'Skills',
  skillName: 'Skill Name',
  description: 'Description',
  test: 'Test',
  view: 'View',
  noSkills: 'No skills',
  testPending: 'Test API is not connected yet',
},
```

> 注：`zh.ts` / `en.ts` 实际编码正常，无需做编码排查。导航项使用 `labelKey: 'cognitiveWargame.nav.resources'`，页面文案使用 `t('cognitiveWargame.resource.title')` 等。

## 12. 预计改动文件

必改：

```text
src/features/cognitive-wargame/routes.ts
src/features/cognitive-wargame/manifest.ts
src/features/cognitive-wargame/api.ts                          ← 新增 SKILL-01~06 + TOOL-01~04 方法
src/features/cognitive-wargame/pages/ResourceOverviewPage.tsx
src/features/cognitive-wargame/locales/zh.ts
src/features/cognitive-wargame/locales/en.ts
```

新增组件：

```text
src/features/cognitive-wargame/components/ResourceTree.tsx           ← 左侧资源类型树
src/features/cognitive-wargame/components/SkillListPanel.tsx         ← Skills 列表
src/features/cognitive-wargame/components/ToolListPanel.tsx          ← Tools 列表
src/features/cognitive-wargame/components/ToolDetailPanel.tsx        ← Tool 详情（schema + 源码预览）
src/features/cognitive-wargame/components/ResourceTestPanel.tsx      ← 测试面板（Skills + Tools 通用）
src/features/cognitive-wargame/types/resource.ts                    ← 资源总览相关 TS 类型
```

> 后端改动文件（cognitive-wargame 项目）见 [skills-resources-api-design.md](../../cognitive-wargame/docs/skills-resources-api-design.md) §七。

## 13. 实施步骤

1. **后端先行**：在 cognitive-wargame `admin_server` 新增 `skills_api.py`（SKILL-01~06）和 `tools_api.py`（TOOL-01~04），注册 router。
2. 新增 `WargameRoutes.Resources` 和 lazy route。
3. 在 `manifest.ts` 的 dashboard 后新增 nav item。
4. 补充中英文 i18n 文案（Skills + Tools + 模型配置）。
5. 在 `api.ts` 新增 Skills（`getSkillCategories` / `getSkills` / `getSkillDetail` / `getSkillFileContent` / `testSkill`）和 Tools（`getTools` / `getToolDetail` / `getToolStatus` / `invokeTool`）方法。
6. 在 `types/resource.ts` 定义 Skills + Tools + 资源类型树节点类型。
7. 创建 `ResourceOverviewPage.tsx`，实现左侧资源类型树 + 右侧独立内容区布局。
8. 创建 `ResourceTree.tsx`，并发加载 SKILL-01 + TOOL-01 构建资源类型树节点。
9. 创建 `SkillListPanel.tsx`，调用 SKILL-02 展示 skills 列表。
10. 创建 `ToolListPanel.tsx`，调用 TOOL-01 展示 tools 列表。
11. 实现 skill 详情查看（SKILL-03 + 复用 `SkillDetail` 组件 + SKILL-05 读文件）。
12. 创建 `ToolDetailPanel.tsx`，调用 TOOL-02 展示 schema + 源码预览。
13. 创建 `ResourceTestPanel.tsx`，Skills 调用 SKILL-06、Tools 调用 TOOL-04，展示占位响应。
14. 本地启动或复用 `localhost:9391` 验证页面。

## 14. 验收标准

完成后应满足：

1. 访问 `http://localhost:9391/cognitive-wargame` 时，导航中「总览仪表盘」旁出现「资源总览」。
2. 点击「资源总览」进入 `/cognitive-wargame/resources`。
3. 页面左侧展示资源类型树：Skills（6 分类）、Tools（9 分类）、模型配置（置灰）。
4. 资源类型树节点上的数量来自后端 SKILL-01 和 TOOL-01。
5. 默认选中 Skills 根节点，右侧展示全部 skills 列表。
6. 点击 Skills 分类节点，右侧仅展示该分类 skills。
7. 点击 Tools 根节点，右侧展示全部 tools 列表。
8. 点击 Tools 分类节点，右侧仅展示该分类 tools。
9. 点击 skill 行「查看」打开 `SkillDetail`，可查看 `SKILL.md` 等文件内容。
10. 点击 tool 行「查看」展示 tool 详情（schema + 源码预览）。
11. 每个 skill / tool 右侧都有「测试」按钮，点击后展示占位响应。
12. 模型配置节点置灰，tooltip 显示「待开发」。
13. 原有「总览仪表盘」和其他 Cognitive Wargame 页面不受影响。
14. 后端 `admin_server` 启动后，`/docs` Swagger UI 中可见 SKILL-01~06 和 TOOL-01~04 接口。

## 15. 风险与待确认点

1. **后端接口需先行实现**（前置依赖）：SKILL-01~03、SKILL-05~06、TOOL-01~04 需在 cognitive-wargame `admin_server` 落地。SKILL-04 第一版不实现。接口文档见 [skills-resources-api-design.md](../../cognitive-wargame/docs/skills-resources-api-design.md)。
2. **`blue-team` 目录缺失**：SKILL-01 返回 `count: 0`，是否创建空目录占位见后端文档待确认点。
3. **`rule-team` 目录结构特殊**：skills 在 `general rules/` 下（含空格），后端用 `CATEGORY_SUBDIR_OVERRIDE` 兼容。
4. **`useSkills` 不复用**（已明确）：数据层走 cognitive-wargame 管理服务，不用 `useSkills` hook 有状态部分（见第 7 节）。
5. **`SkillDetail` 组件复用需处理三个问题**（已明确，见第 8 节）：`_folderId` 占位、`files` 映射、`SkillDetailProps` 类型缺陷。
6. **SKILL-06 / TOOL-04 测试执行**（第二阶段）：第一版占位响应，真实执行后续接入。
7. **`skill_id` 含空格**：前端 `api.ts` 已加 `encodeURIComponent(skillId)`。
8. **SKILL-05 纯文本响应**：`getSkillFileContent` 返回 `Promise<string>`，不走 `unwrap`。
9. **Tool schema 格式**（待确认）：`_ToolRecord.schema` 的实际结构需在实现时验证，当前假设为 `{action: json_schema}` 字典。
10. **Tool 分类映射维护**（待确认）：`TOOL_CATEGORY_MAP` 为后端硬编码，新增 Tool 时需同步更新。
11. **模型配置 API**（待开发）：MODEL-01/02 第一版不实现，UI 预留置灰入口。

## 16. 推荐第一版范围

建议第一版先做到：

- **后端**：
  - `skills_api.py`：SKILL-01~03、SKILL-05（目录扫描 + 文件读取），SKILL-06 占位。
  - `tools_api.py`：TOOL-01~03（registry 查询 + 状态检查），TOOL-04 占位。
- **前端**：
  - 新增 `资源总览` tab 和独立路由。
  - 左侧资源类型树（Skills 6 分类 + Tools 9 分类 + 模型配置置灰）。
  - 右侧 Skills 列表 + Tools 列表，支持分类过滤。
  - Skill 详情复用 `SkillDetail` 组件（SKILL-03 + SKILL-05）。
  - Tool 详情展示 schema + 源码预览（TOOL-02）。
  - 测试按钮调用 SKILL-06 / TOOL-04，展示占位响应。

待后端真实执行能力落地后，再把测试按钮接成真实运行。模型配置 API 待开发后再接入。
