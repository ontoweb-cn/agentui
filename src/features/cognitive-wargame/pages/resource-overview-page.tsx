import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spin } from '@/components/ui/spin';
import { TreeView, type TreeDataItem } from '@/components/ui/tree-view';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  FileCode2,
  FileText,
  FlaskConical,
  FolderOpen,
  FolderTree,
  RefreshCw,
  Search,
  Settings2,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import CodeViewer from '@/pages/skills/components/code-viewer';
import MarkdownViewer from '@/pages/skills/components/markdown-viewer';
import api, {
  type ResourceCategory,
  type SkillDetailResource,
  type SkillFileEntry,
  type SkillResource,
  type ToolDetailResource,
  type ToolResource,
} from '../api';
import WargameSectionLayout from '../components/section-menu';

type ResourceNode = {
  type: 'skills' | 'tools' | 'models';
  category?: string;
  label: string;
  count?: number;
};
const skillCategories: ResourceCategory[] = [
  'red-team',
  'blue-team',
  'gray-team',
  'group-agents',
  'person-agents',
  'rule-team',
];
const queryKeys = {
  skills: (category?: string) =>
    ['cognitive-wargame', 'resources', 'skills', category ?? 'all'] as const,
  tools: (category?: string) =>
    ['cognitive-wargame', 'resources', 'tools', category ?? 'all'] as const,
};
const boardPattern = /(dashboard|board|看板).*\.html$/i;
const boardContextPattern =
  /(tests\/|review|decision|results|group_decision|decision_cases|review_gate)/i;

const pickSkillTestBoardFile = (files: SkillFileEntry[]) =>
  files
    .filter(
      (file) => !file.is_dir && file.path.toLowerCase().endsWith('.html'),
    )
    .map((file) => ({
      file,
      score:
        (boardPattern.test(file.name) ? 40 : 0) +
        (boardPattern.test(file.path) ? 20 : 0) +
        (file.path.toLowerCase().startsWith('tests/') ? 16 : 0) +
        (file.path.toLowerCase().includes('/tests/') ? 12 : 0) +
        (boardContextPattern.test(file.path) ? 8 : 0) -
        Math.min(file.path.split('/').length, 8),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.file;

export default function ResourceOverviewPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const deepLinkSkillId = searchParams.get('skill');
  const deepLinkCategory = searchParams.get('category');
  const [selected, setSelected] = useState<ResourceNode>({
    type: 'skills',
    category: isResourceCategory(deepLinkCategory)
      ? deepLinkCategory
      : undefined,
    label: t('cognitiveWargame.resource.skills'),
  });
  const [expanded, setExpanded] = useState({ skills: true, tools: true });
  const [search, setSearch] = useState('');
  const [skillDetail, setSkillDetail] = useState<SkillDetailResource | null>(
    null,
  );
  const [openingSkillId, setOpeningSkillId] = useState<string | null>(null);
  const [openingTestSkillId, setOpeningTestSkillId] = useState<string | null>(
    null,
  );
  const [toolDetail, setToolDetail] = useState<ToolDetailResource | null>(null);
  const [testTarget, setTestTarget] = useState<ToolResource | null>(null);
  const [skillTestPage, setSkillTestPage] = useState<{
    skill: SkillResource;
    filePath: string;
    html: string;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('{}');
  const openedDeepLink = useRef<string | null>(null);
  const skillCategoriesQuery = useQuery({
    queryKey: ['cognitive-wargame', 'resources', 'skill-categories'],
    queryFn: () => api.getSkillCategories(),
    staleTime: 60_000,
    retry: 1,
  });
  const toolsAllQuery = useQuery({
    queryKey: queryKeys.tools(),
    queryFn: () => api.getTools(),
    staleTime: 60_000,
    retry: 1,
  });
  const skillsQuery = useQuery({
    queryKey: queryKeys.skills(
      selected.type === 'skills' ? selected.category : undefined,
    ),
    queryFn: () =>
      api.getSkills({
        category:
          selected.type === 'skills'
            ? (selected.category as ResourceCategory | undefined)
            : undefined,
        page_size: 100,
      }),
    enabled: selected.type === 'skills',
    retry: 1,
  });
  const toolsQuery = useQuery({
    queryKey: queryKeys.tools(
      selected.type === 'tools' ? selected.category : undefined,
    ),
    queryFn: () =>
      api.getTools(selected.type === 'tools' ? selected.category : undefined),
    enabled: selected.type === 'tools',
    retry: 1,
  });
  const testMutation = useMutation({
    mutationFn: async () => {
      if (!testTarget) return {};
      const parsed = JSON.parse(testInput) as Record<string, unknown>;
      return api.invokeTool(
        testTarget.name,
        testTarget.actions?.[0] ?? testTarget.name,
        parsed,
      );
    },
  });
  const nodes = useMemo(() => {
    const skillCounts = new Map(
      skillCategoriesQuery.data?.categories.map((item) => [
        item.name,
        item.count,
      ]),
    );
    const toolCategories = toolsAllQuery.data?.categories ?? [];
    return {
      skills: skillCategories.map((category) => ({
          type: 'skills' as const,
          category,
          label: category,
          count: skillCounts.get(category) ?? 0,
        })),
      tools: toolCategories.map((item) => ({
          type: 'tools' as const,
          category: item.name,
          label: item.label ?? item.name,
          count: item.count,
        })),
    };
  }, [skillCategoriesQuery.data, toolsAllQuery.data]);
  const filteredSkills = (skillsQuery.data?.skills ?? []).filter((item) =>
    `${item.name} ${item.description ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredTools = (toolsQuery.data?.tools ?? []).filter((item) =>
    `${item.name} ${item.description ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selectNode = (node: ResourceNode) => {
    if (node.type !== 'models') setSelected(node);
  };
  const openSkill = async (skill: SkillResource) => {
    setOpeningSkillId(skill.id);
    try {
      setSkillDetail(await api.getSkillDetail(skill.category, skill.id));
    } finally {
      setOpeningSkillId(null);
    }
  };

  useEffect(() => {
    if (
      !deepLinkSkillId ||
      !skillsQuery.data?.skills ||
      skillsQuery.isFetching
    ) {
      return;
    }
    const key = `${deepLinkCategory ?? 'all'}:${deepLinkSkillId}`;
    if (openedDeepLink.current === key) return;
    const skill = skillsQuery.data.skills.find(
      (item) => item.id === deepLinkSkillId,
    );
    if (!skill) return;
    openedDeepLink.current = key;
    void openSkill(skill);
  }, [
    deepLinkCategory,
    deepLinkSkillId,
    skillsQuery.data?.skills,
    skillsQuery.isFetching,
  ]);
  const openTool = async (tool: ToolResource) =>
    setToolDetail(await api.getToolDetail(tool.name));
  const openSkillTestPage = async (skill: SkillResource) => {
    setOpeningTestSkillId(skill.id);
    setTestError(null);
    try {
      const detail = await api.getSkillDetail(skill.category, skill.id);
      const htmlFile = pickSkillTestBoardFile(detail.files);
      if (!htmlFile) {
        setTestError(`未在 ${skill.name} 的 tests 目录下找到 HTML 测试页面`);
        return;
      }
      const html = await api.getSkillFileContent(
        skill.category,
        skill.id,
        htmlFile.path,
      );
      setSkillTestPage({ skill, filePath: htmlFile.path, html });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningTestSkillId(null);
    }
  };
  const refreshResources = () => {
    void Promise.all([
      skillCategoriesQuery.refetch(),
      toolsAllQuery.refetch(),
      selected.type === 'skills' ? skillsQuery.refetch() : toolsQuery.refetch(),
    ]);
  };

  if (skillDetail) {
    return (
      <WargameSectionLayout>
        <SkillDetailView
          skill={skillDetail}
          onBack={() => setSkillDetail(null)}
        />
      </WargameSectionLayout>
    );
  }

  const renderNode = (node: ResourceNode) => (
    <button
      key={`${node.type}-${node.category ?? 'all'}`}
      type="button"
      onClick={() => selectNode(node)}
      className={cn(
        'flex min-h-10 w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors',
        selected.type === node.type && selected.category === node.category
          ? 'bg-bg-input font-medium text-text-primary'
          : 'text-text-secondary hover:bg-bg-input/70 hover:text-text-primary',
      )}
    >
      <span className="truncate">{node.label}</span>
      <span className="ml-3 min-w-6 rounded bg-bg-input px-1.5 py-0.5 text-center text-xs text-text-disabled">
        {node.count ?? '-'}
      </span>
    </button>
  );
  const renderRows = (
    items: Array<SkillResource | ToolResource>,
    kind: 'skill' | 'tool',
  ) =>
    items.length ? (
      <div className="divide-y divide-border-button">
        {items.map((item) => {
          const skill = kind === 'skill' ? (item as SkillResource) : null;
          const tool = kind === 'tool' ? (item as ToolResource) : null;
          const category = skill
            ? skill.category
            : tool?.category_label || tool?.category;
          const source = skill?.directory || tool?.source_file;
          return (
            <div
              key={'id' in item ? item.id : item.name}
              className="grid min-h-[76px] min-w-[760px] items-center gap-5 px-5 py-3 text-sm hover:bg-bg-input/30"
              style={{
                gridTemplateColumns:
                  'minmax(180px, 1.2fr) 120px minmax(240px, 2fr) 156px',
              }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-text-primary">
                  {skill ? (
                    <FileCode2 className="size-4 shrink-0 text-accent-primary" />
                  ) : (
                    <Wrench className="size-4 shrink-0 text-accent-primary" />
                  )}
                  <span className="truncate">{item.name}</span>
                </div>
                {source && (
                  <p className="mt-1 truncate pl-6 text-xs text-text-disabled">
                    {source}
                  </p>
                )}
              </div>
              <div>
                <span className="inline-flex max-w-full rounded bg-bg-input px-2 py-1 text-xs text-text-secondary">
                  <span className="truncate">{category || '-'}</span>
                </span>
              </div>
              <p className="line-clamp-2 leading-5 text-text-secondary">
                {item.description || '-'}
              </p>
              <div className="flex justify-start gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={skill?.id === openingSkillId}
                  onClick={() =>
                    skill ? void openSkill(skill) : void openTool(tool!)
                  }
                >
                  <Eye className="size-3.5" />
                  {t('cognitiveWargame.resource.view')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={skill?.id === openingTestSkillId}
                  onClick={() => {
                    if (skill) {
                      void openSkillTestPage(skill);
                    } else {
                      setTestTarget(tool!);
                      setTestInput('{}');
                      testMutation.reset();
                    }
                  }}
                >
                  <FlaskConical className="size-3.5" />
                  {t('cognitiveWargame.resource.test')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="px-4 py-16 text-center text-sm text-text-secondary">
        {t('cognitiveWargame.resource.noItems')}
      </div>
    );
  const isSkills = selected.type === 'skills';
  const isModels = selected.type === 'models';
  const isRefreshing =
    skillCategoriesQuery.isFetching ||
    toolsAllQuery.isFetching ||
    skillsQuery.isFetching ||
    toolsQuery.isFetching;
  return (
    <WargameSectionLayout>
      <div className="flex h-full min-h-0 flex-col gap-5 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-text-primary">
            {t('cognitiveWargame.resource.title')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('cognitiveWargame.resource.subtitle')}
          </p>
        </div>
        <Button
          variant="outline"
          loading={isRefreshing}
          onClick={refreshResources}
        >
          <RefreshCw className="size-4" />
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-5">
        <aside className="w-72 shrink-0 overflow-y-auto rounded border border-border-button bg-bg-card p-4">
          <div className="mb-4 flex items-center gap-2 px-2 text-sm font-medium text-text-primary">
            <FolderTree className="size-4 text-text-secondary" />
            {t('cognitiveWargame.resource.resourceType')}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              className={cn(
                'flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors hover:bg-bg-input/70',
                selected.type === 'skills' && !selected.category
                  ? 'bg-bg-input text-text-primary'
                  : 'text-text-secondary',
              )}
              onClick={() => {
                setSelected({
                  type: 'skills',
                  label: t('cognitiveWargame.resource.skills'),
                });
                setExpanded((v) => ({ ...v, skills: !v.skills }));
              }}
            >
              {expanded.skills ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <FileCode2 className="size-4" />
              {t('cognitiveWargame.resource.skills')}
              <span className="ml-auto min-w-6 rounded bg-bg-input px-1.5 py-0.5 text-center text-xs text-text-disabled">
                {skillCategoriesQuery.data?.total ?? '-'}
              </span>
            </button>
            {expanded.skills && (
              <div className="ml-5 space-y-1 border-l border-border-button pl-3">
                {nodes.skills.map(renderNode)}
              </div>
            )}
            <button
              type="button"
              className={cn(
                'flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors hover:bg-bg-input/70',
                selected.type === 'tools' && !selected.category
                  ? 'bg-bg-input text-text-primary'
                  : 'text-text-secondary',
              )}
              onClick={() => {
                setSelected({
                  type: 'tools',
                  label: t('cognitiveWargame.resource.tools'),
                });
                setExpanded((v) => ({ ...v, tools: !v.tools }));
              }}
            >
              {expanded.tools ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <Wrench className="size-4" />
              {t('cognitiveWargame.resource.tools')}
              <span className="ml-auto min-w-6 rounded bg-bg-input px-1.5 py-0.5 text-center text-xs text-text-disabled">
                {toolsAllQuery.data?.total ?? '-'}
              </span>
            </button>
            {expanded.tools && (
              <div className="ml-5 space-y-1 border-l border-border-button pl-3">
                {nodes.tools.map(renderNode)}
              </div>
            )}
            <button
              type="button"
              disabled
              title={t('cognitiveWargame.resource.pending')}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-text-disabled"
            >
              <Settings2 className="size-4" />
              {t('cognitiveWargame.resource.modelConfig')}
              <span className="ml-auto text-xs">
                {t('cognitiveWargame.resource.pending')}
              </span>
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mb-4">
            <h2 className="text-lg font-medium text-text-primary">
              {selected.label}
            </h2>
            {!isModels && (
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('cognitiveWargame.resource.searchPlaceholder')}
                prefix={<Search className="ms-2 me-1 size-4" />}
                rootClassName="mt-3 w-full"
              />
            )}
          </div>
          {isModels ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-text-secondary">
                {t('cognitiveWargame.resource.pending')}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="border-b border-border-button px-5 py-3">
                <span className="text-sm text-text-secondary">
                  {isSkills
                    ? `${t('cognitiveWargame.resource.skills')} · ${skillsQuery.data?.total ?? '-'}`
                    : `${t('cognitiveWargame.resource.tools')} · ${toolsQuery.data?.total ?? '-'}`}
                </span>
              </div>
              <CardContent className="overflow-x-auto p-0">
                {(isSkills ? skillsQuery.isLoading : toolsQuery.isLoading) ? (
                  <div className="flex justify-center py-16">
                    <Spin size="large" />
                  </div>
                ) : (isSkills ? skillsQuery.isError : toolsQuery.isError) ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-secondary">
                    <p>{t('cognitiveWargame.resource.loadFailed')}</p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void (isSkills
                          ? skillsQuery.refetch()
                          : toolsQuery.refetch())
                      }
                    >
                      {t('cognitiveWargame.common.retry')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div
                      className="grid min-w-[760px] gap-5 border-b border-border-button bg-bg-input/50 px-5 py-3 text-xs text-text-secondary"
                      style={{
                        gridTemplateColumns:
                          'minmax(180px, 1.2fr) 120px minmax(240px, 2fr) 156px',
                      }}
                    >
                      <span>{t('cognitiveWargame.resource.name')}</span>
                      <span>{t('cognitiveWargame.resource.category')}</span>
                      <span>
                        {t('cognitiveWargame.resource.description')}
                      </span>
                      <span>
                        {t('cognitiveWargame.common.actions')}
                      </span>
                    </div>
                    {isSkills
                      ? renderRows(filteredSkills, 'skill')
                      : renderRows(filteredTools, 'tool')}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </main>
      </div>
      <ToolDetailDialog tool={toolDetail} onClose={() => setToolDetail(null)} />
      {testError && (
        <p className="text-sm text-state-error">{testError}</p>
      )}
      <Dialog
        open={!!skillTestPage}
        onOpenChange={(open) => !open && setSkillTestPage(null)}
      >
        <DialogContent
          className="flex max-w-none flex-col p-4"
          style={{
            width: 'calc(100vw - 24px)',
            height: 'calc(100vh - 24px)',
            maxWidth: 'none',
            maxHeight: 'none',
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{skillTestPage?.skill.name}</DialogTitle>
            <DialogDescription>{skillTestPage?.filePath}</DialogDescription>
          </DialogHeader>
          <iframe
            title={skillTestPage?.skill.name ?? 'skill-test-page'}
            srcDoc={skillTestPage?.html ?? ''}
            sandbox="allow-scripts allow-same-origin"
            className="min-h-0 flex-1 rounded border border-border-button bg-bg-base"
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!testTarget}
        onOpenChange={(open) => !open && setTestTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('cognitiveWargame.resource.testTitle')}
            </DialogTitle>
            <DialogDescription>{testTarget?.name}</DialogDescription>
          </DialogHeader>
          <textarea
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            className="min-h-32 w-full rounded border border-border-button bg-bg-input p-3 font-mono text-xs text-text-primary"
            placeholder={t('cognitiveWargame.resource.testInput')}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                try {
                  JSON.parse(testInput);
                  testMutation.mutate();
                } catch {
                  /* input validation is intentionally local */
                }
              }}
              loading={testMutation.isPending}
            >
              <FlaskConical className="size-4" />
              {t('cognitiveWargame.resource.run')}
            </Button>
          </DialogFooter>
          {testMutation.isError && (
            <p className="text-sm text-state-error">
              {t('cognitiveWargame.resource.loadFailed')}
            </p>
          )}
          {testMutation.data && (
            <pre className="max-h-48 overflow-auto rounded bg-bg-input p-3 text-xs text-text-secondary">
              {JSON.stringify(testMutation.data, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </WargameSectionLayout>
  );
}

function buildFileTree(files: SkillFileEntry[]): TreeDataItem[] {
  const nodes = new Map<string, TreeDataItem>();
  const roots: TreeDataItem[] = [];
  const sorted = [...files].sort((a, b) => {
    const depthDiff = a.path.split('/').length - b.path.split('/').length;
    if (depthDiff !== 0) return depthDiff;
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach((file) => {
    const node: TreeDataItem = {
      id: file.path,
      name: file.name,
      icon: file.is_dir ? FolderOpen : FileText,
      ...(file.is_dir ? { children: [] } : {}),
    };
    nodes.set(file.path, node);
    const parentPath = file.path.split('/').slice(0, -1).join('/');
    const parent = nodes.get(parentPath);
    if (parent?.children) parent.children.push(node);
    else roots.push(node);
  });

  return roots;
}

function isResourceCategory(value?: string | null): value is ResourceCategory {
  return Boolean(value && skillCategories.includes(value as ResourceCategory));
}

function SkillDetailView({
  skill,
  onBack,
}: {
  skill: SkillDetailResource;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const defaultFile =
    skill.files.find(
      (file) => !file.is_dir && file.name.toLowerCase() === 'skill.md',
    ) ?? skill.files.find((file) => !file.is_dir);
  const [selectedFile, setSelectedFile] = useState(defaultFile?.path ?? null);
  const fileTree = useMemo(() => buildFileTree(skill.files), [skill.files]);
  const fileCount = skill.files.filter((file) => !file.is_dir).length;
  const fileContentQuery = useQuery({
    queryKey: [
      'cognitive-wargame',
      'resources',
      'skill-file',
      skill.category,
      skill.id,
      selectedFile,
    ],
    queryFn: () =>
      api.getSkillFileContent(skill.category, skill.id, selectedFile!),
    enabled: !!selectedFile,
    retry: 1,
  });
  const selectedEntry = skill.files.find(
    (file) => file.path === selectedFile,
  );
  const isMarkdown = selectedEntry?.name.toLowerCase().endsWith('.md');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <div>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t('common.back')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded border border-border-button bg-bg-card">
        <aside className="flex w-80 shrink-0 flex-col border-r border-border-button">
          <div className="border-b border-border-button p-5">
            <h1 className="break-words text-lg font-semibold text-text-primary">
              {skill.name}
            </h1>
            <p className="mt-3 text-sm leading-5 text-text-secondary">
              {skill.description || '-'}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-2 px-2 text-xs font-medium text-text-secondary">
              {t('cognitiveWargame.resource.files')} ({fileCount})
            </div>
            <TreeView
              data={fileTree}
              expandAll
              initialSelectedItemId={selectedFile ?? undefined}
              onSelectChange={(item) => {
                const entry = skill.files.find(
                  (file) => file.path === item?.id,
                );
                if (entry && !entry.is_dir) setSelectedFile(entry.path);
              }}
              defaultNodeIcon={FolderOpen}
              defaultLeafIcon={FileText}
            />
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto bg-bg-base p-6">
          {!selectedEntry ? (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              {t('cognitiveWargame.resource.selectFile')}
            </div>
          ) : fileContentQuery.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spin size="large" />
            </div>
          ) : fileContentQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-secondary">
              <p>{t('cognitiveWargame.resource.fileLoadFailed')}</p>
              <Button
                variant="outline"
                onClick={() => void fileContentQuery.refetch()}
              >
                {t('cognitiveWargame.common.retry')}
              </Button>
            </div>
          ) : isMarkdown ? (
            <MarkdownViewer content={fileContentQuery.data ?? ''} />
          ) : (
            <CodeViewer
              content={fileContentQuery.data ?? ''}
              filename={selectedEntry.name}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ToolDetailDialog({
  tool,
  onClose,
}: {
  tool: ToolDetailResource | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!tool} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{tool?.name}</DialogTitle>
          <DialogDescription>{tool?.description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-auto">
          <section>
            <h3 className="mb-2 text-sm font-medium text-text-primary">
              {t('cognitiveWargame.resource.schema')}
            </h3>
            <pre className="overflow-auto rounded bg-bg-input p-3 text-xs text-text-secondary">
              {JSON.stringify(tool?.schema ?? {}, null, 2)}
            </pre>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-medium text-text-primary">
              {t('cognitiveWargame.resource.sourcePreview')}
            </h3>
            <pre className="overflow-auto rounded bg-bg-input p-3 font-mono text-xs text-text-secondary">
              {tool?.source_code_preview || '-'}
            </pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
