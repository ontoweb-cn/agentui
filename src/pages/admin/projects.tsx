// Multi-Harness P5 (US2):Project 管理 Admin 页面。
// Constitution Principle I + V + VIII: 前端经 BFF 管理 intellect-team Project。
// 对齐实际契约:独立 /api/projects 路径,slug/display_name/team_ref/repo_url,归档(软删除)。

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import { LucideArchive, LucidePlus, LucideSearch } from 'lucide-react';

import { TableEmpty } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  archiveProject,
  createProject,
  listProjects,
  listTeams,
  type Project,
} from '@/services/team-admin-service';
import { createFuzzySearchFn } from './utils';

const columnHelper = createColumnHelper<Project>();
const globalFilterFn = createFuzzySearchFn<Project>([
  'slug',
  'display_name',
  'team_id',
]);

interface ProjectFormValues {
  slug: string;
  display_name: string;
  team_ref: string;
  repo_url: string;
}

const useProjectFormSchema = () => {
  const { t } = useTranslation();
  return useMemo(
    () =>
      z.object({
        slug: z
          .string()
          .min(1, t('admin.projects.slugRequired'))
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, t('admin.projects.slugHint')),
        display_name: z
          .string()
          .min(1, t('admin.projects.displayNameRequired')),
        team_ref: z.string().optional(),
        repo_url: z
          .string()
          .url(t('admin.projects.repoUrlHint'))
          .optional()
          .or(z.literal('')),
      }),
    [t],
  );
};

const ProjectsAdminPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = useProjectFormSchema();

  const [globalFilter, setGlobalFilter] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [itemToArchive, setItemToArchive] = useState<Project | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin/projects'],
    queryFn: async () => (await listProjects()).data,
  });

  // 加载 Team 列表用于下拉选择(team_ref)
  const { data: teamsData } = useQuery({
    queryKey: ['admin/teams'],
    queryFn: async () => (await listTeams()).data,
  });

  const createForm = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { slug: '', display_name: '', team_ref: '', repo_url: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      createProject({
        slug: values.slug,
        display_name: values.display_name,
        team_ref: values.team_ref || undefined,
        repo_url: values.repo_url || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin/projects'] });
      setCreateModalOpen(false);
      createForm.reset();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (ref: string) => archiveProject(ref),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin/projects'] });
      setArchiveModalOpen(false);
      setItemToArchive(null);
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('slug', {
        header: t('admin.projects.slug'),
        cell: (info) => (
          <span className="font-mono text-sm">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('display_name', {
        header: t('admin.projects.displayName'),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('team_id', {
        header: t('admin.projects.team'),
        cell: (info) => (
          <span className="font-mono text-xs text-text-secondary">
            {info.getValue() || '-'}
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        header: t('admin.projects.status'),
        cell: (info) => (
          <Badge
            variant={info.getValue() === 'active' ? 'default' : 'secondary'}
          >
            {info.getValue() === 'active'
              ? t('admin.projects.active')
              : t('admin.projects.archived')}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: t('common.action'),
        cell: (info) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setItemToArchive(info.row.original);
              setArchiveModalOpen(true);
            }}
          >
            <LucideArchive className="size-4 mr-1" />
            {t('admin.projects.archive')}
          </Button>
        ),
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('admin.projects.title')}</CardTitle>
        <div className="flex items-center gap-2">
          <div className="relative">
            <LucideSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-text-secondary" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={t('common.search')}
              className="pl-8 w-48"
            />
          </div>
          <Button onClick={() => setCreateModalOpen(true)}>
            <LucidePlus className="size-4 mr-1" />
            {t('admin.projects.create')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center py-8"
                >
                  {isLoading ? t('common.loading') : <TableEmpty columnsLength={columns.length} />}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter />

      {/* Create Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.projects.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.projects.createDescription')}
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              id="project-create-form"
              onSubmit={createForm.handleSubmit((v) =>
                createMutation.mutate(v),
              )}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('admin.projects.slug')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('admin.projects.slugHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('admin.projects.displayName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="team_ref"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('admin.projects.team')}</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t('admin.projects.teamPlaceholder')}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {teamsData?.data?.map((team) => (
                          <SelectItem key={team.slug} value={team.slug}>
                            {team.display_name} ({team.slug})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {t('admin.projects.teamHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="repo_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('admin.projects.repoUrl')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="project-create-form"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? t('common.submitting')
                : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation */}
      <Dialog open={archiveModalOpen} onOpenChange={setArchiveModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.projects.archiveTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.projects.archiveDescription', {
                name: itemToArchive?.display_name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (itemToArchive) {
                  archiveMutation.mutate(itemToArchive.slug);
                }
              }}
            >
              {archiveMutation.isPending
                ? t('common.submitting')
                : t('admin.projects.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ProjectsAdminPage;
