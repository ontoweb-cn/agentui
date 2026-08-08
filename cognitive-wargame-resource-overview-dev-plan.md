# Cognitive Wargame「资源总览」开发计划

## 1. 背景与目标

当前页面入口为：

- `http://localhost:9391/cognitive-wargame`
- 对应前端模块：`src/features/cognitive-wargame`

本次希望在 Cognitive Wargame 的「推演总览」旁边新增一个 tab：

- 中文标签：`资源总览`
- 推荐路由：`/cognitive-wargame/resources`

「资源总览」页面用于集中展示项目内已经制作的 skills。所有 skills 按六个固定大类组织：

- `blue-team`
- `gray-team`
- `group-agents`
- `person-agents`
- `red-team`
- `rule-team`

页面核心能力：

1. 顶部展示六个分类方框。
2. 点击分类方框后，查看对应大类下的 skills。
3. 分类方框下方展示 skills 列表，默认可查看全部 skills。
4. 点击单个 skill 后，直接查看 skill 内容。
5. 每个 skill 右侧提供「测试」按钮，作为 skill 调试/执行入口。

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

已有 skills 页面与服务主要文件：

```text
src/pages/skills/index.tsx
src/pages/skills/hooks.ts
src/pages/skills/types.ts
src/pages/skills/components/skill-detail.tsx
src/pages/skills/components/skill-card.tsx
src/services/skill-space-service.ts
src/services/file-manager-service.ts
```

已有 `src/pages/skills/hooks.ts` 中的 `useSkills` 已经提供这些能力：

- `fetchSpaces()`：获取 skill spaces。
- `fetchSkills(spaceName, spaceId, page, pageSize, sortBy, sortOrder)`：获取某个 space 下的 skills。
- `getSkillFileContent(skillId, filePath, version, skillObj)`：读取 skill 文件内容。
- `getSkillVersionFiles(skillId, version, skillObj)`：读取指定版本的 skill 文件列表。
- `getSkillDetails(folderId, folderName)`：补全 skill 详情、版本和文件信息。

已有 `src/pages/skills/components/skill-detail.tsx` 已经支持：

- 展示 skill 文件树。
- 自动优先打开 `SKILL.md`、`README.md`、`index.md`。
- Markdown 文件使用 `MarkdownViewer` 展示。
- 非 Markdown 文件使用 `CodeViewer` 展示。
- 支持版本切换。

因此「资源总览」第一版应优先复用已有 skills 能力，不建议重新实现文件读取和详情查看逻辑。

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

建议把「资源总览」放在「推演总览」后面，使它和「推演总览」同级：

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
```

建议第一版将页面逻辑集中在这一个文件中，避免过早拆分。后续如果页面变复杂，再拆出：

```text
src/features/cognitive-wargame/components/ResourceCategoryCards.tsx
src/features/cognitive-wargame/components/ResourceSkillList.tsx
src/features/cognitive-wargame/components/ResourceSkillTestPanel.tsx
```

## 4. 页面信息架构

推荐页面结构：

```text
资源总览

[ blue-team      N ] [ gray-team       N ] [ group-agents N ]
[ person-agents  N ] [ red-team        N ] [ rule-team    N ]

当前筛选：全部 / blue-team / gray-team / ...
搜索框（可选）    总数 N

Skill 列表
------------------------------------------------------------------
名称              分类             描述/标签/来源               操作
skill-a           blue-team        xxx                          查看 测试
skill-b           red-team         xxx                          查看 测试
```

交互：

- 页面首次进入时展示全部 skills。
- 点击任意分类方框后，仅展示该分类下的 skills。
- 再点击当前分类或点击「全部」可回到全部列表。
- 点击 skill 行或「查看」按钮，打开 `SkillDetail`。
- 点击「测试」按钮，打开测试面板或弹窗。

## 5. 六大类定义

建议在 `ResourceOverviewPage.tsx` 内先定义固定分类：

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

## 6. Skill 分类规则

分类来源建议按优先级判断：

1. `skill.metadata.category`
2. `skill.metadata.group`
3. `skill.metadata.tags`
4. `skill.source_ref` / `skill.central_path` / `skill.id` / `skill.name` / file path 中包含六大类名称
5. 无法识别时归入 `uncategorized`，但页面顶部仍只展示六个固定大类

推荐辅助函数：

```ts
type ResourceCategory =
  | 'blue-team'
  | 'gray-team'
  | 'group-agents'
  | 'person-agents'
  | 'red-team'
  | 'rule-team';

const inferSkillCategory = (skill: Skill): ResourceCategory | null => {
  const candidates = [
    skill.metadata?.category,
    skill.metadata?.group,
    ...(skill.metadata?.tags ?? []),
    skill.source_ref,
    skill.central_path,
    skill.id,
    skill.name,
    ...skill.files.map((file) => file.path),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return RESOURCE_CATEGORIES.find((category) =>
    candidates.some((value) => value.includes(category)),
  ) ?? null;
};
```

注意：如果 skills 实际是按 skill space 区分六大类，例如六个 space 名分别就是 `blue-team` 等，则页面可以直接遍历这六个 space 并分别调用 `fetchSkills`。如果不是，则采用上面的 metadata/path 推断策略。

## 7. 数据接入策略

推荐使用现有 `useSkills`，不要新写 API。

第一版有两种可选实现：

### 方案 A：六大类就是六个 skill space

适用条件：`fetchSpaces()` 返回的 space 里包含：

- `blue-team`
- `gray-team`
- `group-agents`
- `person-agents`
- `red-team`
- `rule-team`

实现方式：

1. 页面加载时调用 `fetchSpaces()`。
2. 找到六个目标 space。
3. 分别调用 `fetchSkills(space.name, space.id, 1, 200, 'update_time', 'desc')`。
4. 将结果合并成统一列表，并为每条 skill 附加 `resourceCategory`。

优点：分类准确，逻辑简单。

风险：当前 `useSkills` 内部维护的是单个 `skills` state，多次调用 `fetchSkills` 可能互相覆盖。若采用此方案，最好新增一个轻量数据函数或在页面内直接调用 service/search API，避免依赖单例 state。

### 方案 B：skills 在一个或多个 space 中，通过 metadata/path 推断分类

适用条件：skills 不一定分布在六个固定 space 下，但 metadata、tags、路径或名称里含有六大类信息。

实现方式：

1. 页面选择一个默认来源，例如全部 skill spaces 或某个 Cognitive Wargame 专用 space。
2. 拉取 skills 后调用 `inferSkillCategory(skill)`。
3. 按分类聚合和过滤。

优点：对现有数据结构侵入小。

风险：分类准确性依赖命名规范。

### 推荐取舍

如果当前团队已经约定六大类就是目录/space 名，优先采用方案 A。

如果还没有稳定目录规范，第一版采用方案 B，并在文档或页面空态中提示需要在 metadata/tags/path 中标注分类。

## 8. Skill 内容查看

推荐直接复用：

```text
src/pages/skills/components/skill-detail.tsx
```

页面内维护：

```ts
const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
const [detailOpen, setDetailOpen] = useState(false);
```

点击 skill 时：

1. 如果 skill 已经有 `versions` 和 `files`，直接打开详情。
2. 如果缺少 `versions/files` 但有 `_folderId`，调用 `getSkillDetails(_folderId, skill.name)` 补全。
3. 打开 `SkillDetail`：

```tsx
<SkillDetail
  skill={selectedSkill}
  open={detailOpen}
  onClose={handleCloseDetail}
  getFileContent={getSkillFileContent}
  getVersionFiles={getSkillVersionFiles}
/>
```

## 9. 「测试」按钮设计

当前代码里暂未看到明确的 skill 执行/测试接口。建议第一版先把「测试」按钮做成稳定入口，避免凭空定义后端协议。

第一阶段：前端测试面板

- 每个 skill 行右侧显示「测试」按钮。
- 点击后打开弹窗或侧边面板。
- 面板展示 skill 名称、分类、描述、版本。
- 提供输入框和运行按钮。
- 若无后端接口，运行按钮置灰或显示「测试接口待接入」。

第二阶段：接入真实执行

如果后端提供类似接口：

```text
POST /api/v1/skills/run
POST /api/v1/skills/test
POST /api/v1/skills/execute
```

再补充：

- 请求参数：`skill_id`、`space_id`、`version`、`input`。
- 返回内容：执行状态、stdout/stderr、结构化结果。
- UI 状态：running、success、failed、cancelled。

## 10. UI 组件建议

页面使用现有 UI 组件风格，优先复用项目里的：

```text
Button
Card
Badge
SearchInput
Spin
Table
Dialog / Sheet（如已有）
```

分类方框建议使用按钮化卡片：

- 固定 6 个。
- 每个显示分类名、数量、简短说明。
- active 状态使用已有 accent 色。
- 不使用过重的视觉装饰，保持与管理后台风格一致。

列表建议使用表格，而不是卡片瀑布流：

- 资源总览以查阅和操作为主，表格更适合扫描、比较和快速点击。
- 操作列放「查看」和「测试」。

## 11. 国际化文案

需要修改：

```text
src/features/cognitive-wargame/locales/zh.ts
src/features/cognitive-wargame/locales/en.ts
```

新增中文 key：

```ts
resources: '资源总览'
```

建议新增页面文案：

```ts
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
}
```

英文：

```ts
resources: 'Resources'
```

```ts
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
}
```

注意：当前 `zh.ts` / `en.ts` 文件输出中出现乱码显示，修改前建议确认文件实际编码，避免扩大编码问题。

## 12. 预计改动文件

必改：

```text
src/features/cognitive-wargame/routes.ts
src/features/cognitive-wargame/manifest.ts
src/features/cognitive-wargame/pages/ResourceOverviewPage.tsx
src/features/cognitive-wargame/locales/zh.ts
src/features/cognitive-wargame/locales/en.ts
```

可能新增：

```text
src/features/cognitive-wargame/components/ResourceSkillTestPanel.tsx
```

如果分类和推断逻辑需要复用，再新增：

```text
src/features/cognitive-wargame/constants.ts
src/features/cognitive-wargame/utils/resource-skills.ts
```

## 13. 实施步骤

1. 新增 `WargameRoutes.Resources` 和 lazy route。
2. 在 `manifest.ts` 的 dashboard 后新增 nav item。
3. 补充中英文 i18n 文案。
4. 创建 `ResourceOverviewPage.tsx`。
5. 接入 skills 数据源，优先复用 `useSkills`、`SkillDetail`。
6. 实现六个分类方框和数量统计。
7. 实现按分类过滤的 skills 表格。
8. 实现 skill 详情查看。
9. 实现「测试」按钮和测试面板占位。
10. 本地启动或复用 `localhost:9391` 验证页面。

## 14. 验收标准

完成后应满足：

1. 访问 `http://localhost:9391/cognitive-wargame` 时，导航中「推演总览」旁出现「资源总览」。
2. 点击「资源总览」进入 `/cognitive-wargame/resources`。
3. 页面顶部固定展示六个分类方框：
   - `blue-team`
   - `gray-team`
   - `group-agents`
   - `person-agents`
   - `red-team`
   - `rule-team`
4. 默认列表展示全部可识别 skills。
5. 点击分类方框后，列表只展示该分类下 skills。
6. 点击 skill 行或「查看」按钮后，可以查看 `SKILL.md` / `README.md` / `index.md` 等内容。
7. 每个 skill 右侧都有「测试」按钮。
8. 无测试接口时，测试入口有明确占位状态，不报错。
9. 原有「推演总览」和其他 Cognitive Wargame 页面不受影响。

## 15. 风险与待确认点

1. 六大类是 skill space、目录、metadata 还是 tags，需要结合当前数据实际确认。
2. `useSkills` 当前偏向单 space 页面状态管理，如果要一次加载多个 space，可能需要抽出更纯的数据加载函数。
3. 「测试」按钮是否要真实执行 skill，取决于后端是否已有执行接口。
4. i18n 文件目前显示疑似编码异常，修改前需要确认编码，避免中文文案继续乱码。
5. 如果 search API 返回的 skill 缺少 `_folderId`，详情页无法读取文件，需要提示用户 reindex 或从文件系统补全。

## 16. 推荐第一版范围

建议第一版先做到：

- 新增 `资源总览` tab 和独立路由。
- 显示六个固定分类方框。
- 加载并展示 skills 列表。
- 支持分类筛选。
- 复用 `SkillDetail` 查看内容。
- 「测试」按钮先打开占位测试面板。

待确认后端执行接口后，再把测试按钮接成真实运行能力。
