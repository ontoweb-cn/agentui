// Multi-Harness P5 (US1):Team 管理 Admin 页面。
// Constitution Principle I + V + VIII: 前端经 BFF 管理 intellect-team Team。
// 对齐实际契约:slug/display_name/created_by(BFF 自动注入),归档(软删除)。
// 提供 CRUD UI:列表 + 新增 Modal + 归档确认。

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
  archiveTeam,
  createTeam,
  listTeams,
  type Team,
} from '@/services/team-admin-service';
import { createFuzzySearchFn } from './utils';

// ---------------------------------------------------------------------------
// Types & validation
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<Team>();
const globalFilterFn = createFuzzySearchFn<Team>([
  'slug',
  'display_name',
  'id',
]);

interface TeamFormValues {
  slug: string;
  display_name: string;
}

const useTeamFormSchema = () => {
  const { t } = useTranslation();
  return useMemo(
    () =>
      z.object({
        slug: z
          .string()
          .min(1, t('admin.teams.slugRequired'))
          .regex(
            /^[a-z0-9]+(-[a-z0-9]+)*$/,
            t('admin.teams.slugHint'),
          ),
        display_name: z
          .string()
          .min(1, t('admin.teams.displayNameRequired')),
      }),
    [t],
  );
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const TeamsAdminPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = useTeamFormSchema();

  const [globalFilter, setGlobalFilter] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [itemToArchive, setItemToArchive] = useState<Team | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin/teams'],
    queryFn: async () => (await listTeams()).data,
  });

  const createForm = useForm<TeamFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { slug: '', display_name: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values: TeamFormValues) =>
      createTeam({
        slug: values.slug,
        display_name: values.display_name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin/teams'] });
      setCreateModalOpen(false);
      createForm.reset();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (ref: string) => archiveTeam(ref),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin/teams'] });
      setArchiveModalOpen(false);
      setItemToArchive(null);
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('slug', {
        header: t('admin.teams.slug'),
        cell: (info) => (
          <span className="font-mono text-sm">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('display_name', {
        header: t('admin.teams.displayName'),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('enabled', {
        header: t('admin.teams.status'),
        cell: (info) => (
          <Badge variant={info.getValue() === 1 ? 'default' : 'secondary'}>
            {info.getValue() === 1
              ? t('admin.teams.active')
              : t('admin.teams.archived')}
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
            {t('admin.teams.archive')}
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
        <CardTitle>{t('admin.teams.title')}</CardTitle>
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
            {t('admin.teams.create')}
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
            <DialogTitle>{t('admin.teams.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.teams.createDescription')}
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              id="team-create-form"
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
                    <FormLabel>{t('admin.teams.slug')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('admin.teams.slugHint')}
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
                    <FormLabel>{t('admin.teams.displayName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
              form="team-create-form"
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
            <DialogTitle>{t('admin.teams.archiveTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.teams.archiveDescription', {
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
                : t('admin.teams.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default TeamsAdminPage;
