// Multi-Harness P2 (US3):Harness 后端配置 Admin 页面。
// Constitution Principle I + V (非租户隔离) + Token Security。
// 提供 CRUD UI:列表 + 新增/编辑 Modal + 删除确认。
// 不展示 adminToken 明文,只展示 adminTokenEnvVar 引用。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import {
  LucideArrowLeftRight,
  LucidePlus,
  LucideSearch,
  LucideTrash2,
  LucideUserPen,
  LucideWand2,
} from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
  createHarnessBackend,
  deleteHarnessBackend,
  getProtocolFamily,
  listHarnessBackends,
  switchHarnessBackend,
  updateHarnessBackend,
  type HarnessBackendWithStatus,
  type BackendType,
  type HarnessCapabilities,
  type ProtocolFamily,
} from '@/services/harness-admin-service';
import { createFuzzySearchFn } from './utils';
import { Routes } from '@/routes';

// ---------------------------------------------------------------------------
// Types & validation
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<HarnessBackendWithStatus>();
const globalFilterFn = createFuzzySearchFn<HarnessBackendWithStatus>([
  'id',
  'name',
  'type',
  'endpoint',
]);

interface HarnessBackendFormValues {
  id: string;
  name: string;
  type: BackendType;
  endpoint: string;
  capabilities: HarnessCapabilities;
  defaultForTenant?: boolean;
}

const useHarnessBackendFormSchema = () => {
  const { t } = useTranslation();
  return useMemo(
    () =>
      z.object({
        id: z
          .string()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, t('admin.harnessBackends.idHint')),
        name: z.string().min(1, t('admin.harnessBackends.nameRequired')),
        // spec-010 v8 A3-2: 支持 6 类后端表单录入(intellect-llm 不进表单)
        type: z.enum([
          'intellect-rag',
          'intellect-enterprise',
          'intellect-community',
          'hermes',
          'kag',
          'agent-scope',
        ]),
        endpoint: z.string().url(t('admin.harnessBackends.endpointHint')),
        // adminTokenEnvVar 不再进表单:BFF 始终自动生成 HARNESS_<ID>_TOKEN
        capabilities: z.object({
          canvas: z.boolean(),
          knowledgeBase: z.boolean(),
          memory: z.boolean(),
          mcp: z.boolean(),
          multiTenant: z.boolean(),
          modelManagement: z.boolean(),
        }),
        defaultForTenant: z.boolean().optional(),
      }),
    [t],
  );
};

const DEFAULT_FORM_VALUES: HarnessBackendFormValues = {
  id: '',
  name: '',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  capabilities: {
    canvas: true,
    knowledgeBase: true,
    memory: true,
    mcp: false,
    multiTenant: false,
    modelManagement: false,
  },
  defaultForTenant: false,
};

// ---------------------------------------------------------------------------
// Capability switch field helper
// ---------------------------------------------------------------------------

function CapabilitySwitch({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="pr-4">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-text-secondary">{description}</div>
        )}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

function AdminHarnessBackends() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [itemToAction, setItemToAction] =
    useState<HarnessBackendWithStatus | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // spec-010 v8 B-8: 切换 backend 时需要 tenantId + role
  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [switchRole, setSwitchRole] = useState<'primary' | 'canvas'>('primary');
  const [switchTenantId, setSwitchTenantId] = useState('');

  const schema = useHarnessBackendFormSchema();
  const createForm = useForm<HarnessBackendFormValues>({
    defaultValues: DEFAULT_FORM_VALUES,
    resolver: zodResolver(schema),
  });
  const editForm = useForm<HarnessBackendFormValues>({
    defaultValues: DEFAULT_FORM_VALUES,
    resolver: zodResolver(schema),
  });

  // ----- List query -----
  const { data: backends = [], isLoading } = useQuery({
    queryKey: ['admin/listHarnessBackends'],
    queryFn: async () => (await listHarnessBackends())?.data?.data ?? [],
    retry: false,
  });

  // ----- Mutations -----
  const createMutation = useMutation({
    mutationFn: (values: HarnessBackendFormValues) =>
      createHarnessBackend(values),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin/listHarnessBackends'],
      });
      setCreateModalOpen(false);
      createForm.reset(DEFAULT_FORM_VALUES);
    },
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Omit<HarnessBackendFormValues, 'id'>;
    }) => updateHarnessBackend(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin/listHarnessBackends'],
      });
      setEditModalOpen(false);
    },
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHarnessBackend(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin/listHarnessBackends'],
      });
      setDeleteModalOpen(false);
      setItemToAction(null);
    },
    retry: false,
  });

  // spec-010 v8 B-8 (D2 软阻断): 切换 backend 为租户的主/画布后端
  // P3-m5/m6 修复:清理空分支,统一处理所有非零 code
  const switchMutation = useMutation({
    mutationFn: ({
      id,
      tenantId,
      role,
    }: {
      id: string;
      tenantId: string;
      role: 'primary' | 'canvas';
    }) => switchHarnessBackend(id, tenantId, role),
    onSuccess: (resp) => {
      const code = resp?.data?.code;
      if (code === 0) {
        // 成功:刷新列表,关闭 modal
        queryClient.invalidateQueries({
          queryKey: ['admin/listHarnessBackends'],
        });
        setSwitchModalOpen(false);
        setItemToAction(null);
        setSwitchTenantId('');
      }
      // code === 409:软阻断,保持 modal 打开,错误消息由下方 inline 渲染
      // 其他非零 code:同样保持 modal 打开,错误消息由下方 inline 渲染
      // (m6 修复:不再静默吞掉非 0/409 的错误)
    },
    onError: (err: unknown) => {
      // 网络错误/超时等(请求未到达 BFF 或 BFF 未返回 JSON 信封)
      // 由 next-request 拦截器统一 toast,此处仅 log
      console.error('[switchHarnessBackend] request failed:', err);
    },
    retry: false,
  });

  // Edit form: load values when modal opens
  useEffect(() => {
    if (itemToAction && editModalOpen) {
      editForm.reset({
        id: itemToAction.id, // 只读,展示
        name: itemToAction.name,
        type: itemToAction.type,
        endpoint: itemToAction.endpoint,
        // 注:adminTokenEnvVar 由 BFF 自动生成,编辑表单不再展示/提交
        capabilities: itemToAction.capabilities,
        defaultForTenant: itemToAction.defaultForTenant,
      });
    }
  }, [itemToAction, editModalOpen, editForm]);

  // ----- Table -----
  const columns = useMemo(
    () => [
      columnHelper.accessor('id', {
        header: () => t('admin.harnessBackends.id'),
        cell: (info) => (
          <code className="text-xs px-1.5 py-0.5 rounded bg-bg-muted">
            {info.getValue()}
          </code>
        ),
      }),
      columnHelper.accessor('name', {
        header: () => t('admin.harnessBackends.name'),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('type', {
        header: () => t('admin.harnessBackends.type'),
        cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
      }),
      // spec-010 v8 D-1: 协议族展示列(BackendType → ProtocolFamily 映射)
      columnHelper.accessor('type', {
        id: 'protocolFamily',
        header: () =>
          t('admin.harnessBackends.protocolFamily', {
            defaultValue: 'Protocol Family',
          }),
        cell: (info) => {
          const family: ProtocolFamily = getProtocolFamily(info.getValue());
          return (
            <Badge variant="secondary" className="text-xs">
              {family}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('endpoint', {
        header: () => t('admin.harnessBackends.endpoint'),
        cell: (info) => (
          <code className="text-xs text-text-secondary">
            {info.getValue()}
          </code>
        ),
      }),
      columnHelper.accessor('adminTokenEnvVar', {
        header: () => t('admin.harnessBackends.adminTokenEnvVar'),
        cell: (info) => (
          <code className="text-xs text-text-secondary">
            {info.getValue()}
          </code>
        ),
      }),
      columnHelper.accessor('ready', {
        header: () => t('admin.harnessBackends.status'),
        cell: (info) => (
          <Badge variant={info.getValue() ? 'default' : 'secondary'}>
            {info.getValue()
              ? t('admin.harnessBackends.ready')
              : t('admin.harnessBackends.notReady')}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: () => t('admin.harnessBackends.actions'),
        cell: (info) => (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setItemToAction(info.row.original);
                setEditModalOpen(true);
              }}
            >
              <LucideUserPen className="size-4 mr-1" />
              {t('admin.harnessBackends.edit')}
            </Button>
            {/* spec-010 v8 B-8: 切换为主/画布后端(D2 软阻断) */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setItemToAction(info.row.original);
                setSwitchRole('primary');
                setSwitchTenantId('');
                setSwitchModalOpen(true);
              }}
            >
              <LucideArrowLeftRight className="size-4 mr-1" />
              {t('admin.harnessBackends.switchPrimary', {
                defaultValue: 'Switch as Primary',
              })}
            </Button>
            {info.row.original.type === 'intellect-rag' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setItemToAction(info.row.original);
                  setSwitchRole('canvas');
                  setSwitchTenantId('');
                  setSwitchModalOpen(true);
                }}
              >
                <LucideArrowLeftRight className="size-4 mr-1" />
                {t('admin.harnessBackends.switchCanvas', {
                  defaultValue: 'Switch as Canvas',
                })}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setItemToAction(info.row.original);
                setDeleteModalOpen(true);
              }}
            >
              <LucideTrash2 className="size-4 mr-1" />
              {t('admin.harnessBackends.delete')}
            </Button>
          </div>
        ),
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: backends,
    columns,
    state: {},
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn,
  });

  // ----- Form render helper -----
  const renderFormFields = (
    form: ReturnType<typeof useForm<HarnessBackendFormValues>>,
    isEdit: boolean,
  ) => (
    <Form {...form}>
      <form
        id={isEdit ? 'harness-backend-edit-form' : 'harness-backend-create-form'}
        onSubmit={form.handleSubmit((values) => {
          if (isEdit && itemToAction) {
            const { id: _omit, ...rest } = values;
            void _omit;
            updateMutation.mutate({ id: itemToAction.id, values: rest });
          } else {
            createMutation.mutate(values);
          }
        })}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.harnessBackends.id')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={isEdit}
                  placeholder="intellect-rag-default"
                  className="bg-bg-input border-border-button"
                />
              </FormControl>
              <FormDescription>
                {t('admin.harnessBackends.idHint')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.harnessBackends.name')}</FormLabel>
              <FormControl>
                <Input {...field} className="bg-bg-input border-border-button" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.harnessBackends.type')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="bg-bg-input border-border-button">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="intellect-rag">intellect-rag</SelectItem>
                  <SelectItem value="intellect-enterprise">
                    intellect-enterprise
                  </SelectItem>
                  <SelectItem value="intellect-community">
                    intellect-community
                  </SelectItem>
                  <SelectItem value="hermes">hermes</SelectItem>
                  <SelectItem value="kag">kag</SelectItem>
                  <SelectItem value="agent-scope">agent-scope</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="endpoint"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.harnessBackends.endpoint')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="http://localhost:9380"
                  className="bg-bg-input border-border-button"
                />
              </FormControl>
              <FormDescription>
                {t('admin.harnessBackends.endpointHint')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div>
          <FormLabel className="text-sm font-medium mb-2">
            {t('admin.harnessBackends.capabilities')}
          </FormLabel>
          <div className="rounded-md border border-border-button p-3 space-y-1">
            {(
              [
                ['canvas', t('admin.harnessBackends.capCanvas')],
                ['knowledgeBase', t('admin.harnessBackends.capKnowledgeBase')],
                ['memory', t('admin.harnessBackends.capMemory')],
                ['mcp', t('admin.harnessBackends.capMcp')],
                ['multiTenant', t('admin.harnessBackends.capMultiTenant')],
                [
                  'modelManagement',
                  t('admin.harnessBackends.capModelManagement'),
                ],
              ] as const
            ).map(([key, label]) => (
              <FormField
                key={key}
                control={form.control}
                name={`capabilities.${key}` as const}
                render={({ field }) => (
                  <FormItem>
                    <CapabilitySwitch
                      label={label}
                      value={field.value as boolean}
                      onChange={field.onChange}
                    />
                  </FormItem>
                )}
              />
            ))}
          </div>
        </div>
        <FormField
          control={form.control}
          name="defaultForTenant"
          render={({ field }) => (
            <FormItem>
              <CapabilitySwitch
                label={t('admin.harnessBackends.defaultForTenant')}
                value={!!field.value}
                onChange={field.onChange}
                description={t('admin.harnessBackends.defaultForTenantHint')}
              />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('admin.harnessBackends.title')}</CardTitle>
        <div className="flex items-center gap-2">
          {/* spec-010 v8 D-2: "Add Backend (Wizard)" 按钮跳转向导 */}
          <Button
            variant="outline"
            onClick={() => navigate(`${Routes.Wizard}?mode=add`)}
          >
            <LucideWand2 className="size-4 mr-1" />
            {t('admin.harnessBackends.addWizard', {
              defaultValue: 'Add Backend (Wizard)',
            })}
          </Button>
          <Button
            onClick={() => {
              createForm.reset(DEFAULT_FORM_VALUES);
              setCreateModalOpen(true);
            }}
          >
            <LucidePlus className="size-4 mr-1" />
            {t('admin.harnessBackends.create')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <LucideSearch className="size-4 text-text-secondary" />
          <Input
            placeholder={t('admin.harnessBackends.searchPlaceholder')}
            value={(table.getState().globalFilter as string) ?? ''}
            onChange={(e) => table.setGlobalFilter(e.target.value)}
            className="bg-bg-input border-border-button"
          />
        </div>
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
                  {isLoading ? (
                    t('common.loading')
                  ) : (
                    <TableEmpty columnsLength={columns.length} />
                  )}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.harnessBackends.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.harnessBackends.createDescription')}
            </DialogDescription>
          </DialogHeader>
          {renderFormFields(createForm, false)}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="harness-backend-create-form"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? t('common.submitting')
                : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.harnessBackends.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.harnessBackends.editDescription')}
            </DialogDescription>
          </DialogHeader>
          {renderFormFields(editForm, true)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="harness-backend-edit-form"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? t('common.submitting')
                : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.harnessBackends.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.harnessBackends.deleteDescription', {
                name: itemToAction?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (itemToAction) {
                  deleteMutation.mutate(itemToAction.id);
                }
              }}
            >
              {deleteMutation.isPending
                ? t('common.submitting')
                : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* spec-010 v8 B-8: Switch Backend Modal(D2 软阻断) */}
      <Dialog open={switchModalOpen} onOpenChange={setSwitchModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {switchRole === 'primary'
                ? t('admin.harnessBackends.switchPrimaryTitle', {
                    defaultValue: 'Switch as Primary Backend',
                  })
                : t('admin.harnessBackends.switchCanvasTitle', {
                    defaultValue: 'Switch as Canvas Backend',
                  })}
            </DialogTitle>
            <DialogDescription>
              {t('admin.harnessBackends.switchDescription', {
                defaultValue:
                  '将 backend "{{name}}" 绑定到指定租户(存在活跃 run 时将被软阻断)。',
                name: itemToAction?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="switch-tenant-id">
                {t('admin.harnessBackends.tenantId', {
                  defaultValue: 'Tenant ID',
                })}
              </Label>
              <Input
                id="switch-tenant-id"
                value={switchTenantId}
                onChange={(e) => setSwitchTenantId(e.target.value)}
                placeholder="tenant-1"
              />
              <p className="text-xs text-text-secondary">
                {t('admin.harnessBackends.tenantIdHint', {
                  defaultValue:
                    'BffTenant.id,如 "default" 或具体租户 id',
                })}
              </p>
            </div>
            {/* P3-m5/m6 修复:统一渲染所有非零 code 的错误(含 409 软阻断) */}
            {switchMutation.data?.data?.code !== undefined &&
              switchMutation.data.data.code !== 0 && (
                <p className="text-sm text-destructive">
                  {switchMutation.data.data.message ||
                    t('admin.harnessBackends.switchFailed', {
                      defaultValue: 'Switch failed (code={{code}})',
                      code: switchMutation.data.data.code,
                    })}
                </p>
              )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSwitchModalOpen(false)}
              disabled={switchMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                switchMutation.isPending || !switchTenantId.trim()
              }
              onClick={() => {
                if (itemToAction && switchTenantId.trim()) {
                  switchMutation.mutate({
                    id: itemToAction.id,
                    tenantId: switchTenantId.trim(),
                    role: switchRole,
                  });
                }
              }}
            >
              {switchMutation.isPending
                ? t('common.submitting')
                : t('admin.harnessBackends.switchConfirm', {
                    defaultValue: 'Switch',
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default AdminHarnessBackends;
