// Multi-Harness P5 (US3):Tenant 绑定管理 Admin 页面。
// Constitution Principle I + V: 前端经 BFF 管理 BffTenant ↔ Team/Project 绑定。
// 绑定真实 team_id 后启用实例内 Team 数据隔离;"0"/空 → 回退缺省(向后兼容)。
// 真正的租户隔离通过多实例:不同 BffTenant 绑定不同 intellectBackendId(intellect-team 实例)。
// tenantId 从 URL query param ?tenant=xxx 获取(Admin 页面入口传入)。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  getTenantBinding,
  listProjects,
  listTeams,
  updateTenantBinding,
} from '@/services/team-admin-service';

interface BindingFormValues {
  intellect_tenant_id: string;
  intellect_project_id: string;
}

const useBindingFormSchema = () => {
  const { t } = useTranslation();
  return useMemo(
    () =>
      z.object({
        intellect_tenant_id: z.string(),
        intellect_project_id: z.string(),
      }),
    [t],
  );
};

const TenantBindingsPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = useBindingFormSchema();
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') || '';

  const { data: bindingData, isLoading } = useQuery({
    queryKey: ['admin/tenant-binding', tenantId],
    queryFn: async () => (await getTenantBinding(tenantId)).data,
    enabled: !!tenantId,
  });

  const { data: teamsData } = useQuery({
    queryKey: ['admin/teams'],
    queryFn: async () => (await listTeams()).data,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['admin/projects'],
    queryFn: async () => (await listProjects()).data,
  });

  const form = useForm<BindingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      intellect_tenant_id: '0',
      intellect_project_id: '',
    },
    values: bindingData
      ? {
          intellect_tenant_id: bindingData.data.intellect_tenant_id || '0',
          intellect_project_id: bindingData.data.intellect_project_id || '',
        }
      : undefined,
  });

  // 监听 team 选择,过滤 project 下拉(仅显示选中 team 下的 project)
  const selectedTeamId = form.watch('intellect_tenant_id');
  const filteredProjects = useMemo(() => {
    if (!projectsData?.data || !selectedTeamId || selectedTeamId === '0') {
      return [];
    }
    return projectsData.data.filter((p) => p.team_id === selectedTeamId);
  }, [projectsData, selectedTeamId]);

  const updateMutation = useMutation({
    mutationFn: (values: BindingFormValues) =>
      updateTenantBinding(tenantId, {
        intellect_tenant_id:
          values.intellect_tenant_id === '0'
            ? undefined
            : values.intellect_tenant_id,
        intellect_project_id: values.intellect_project_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin/tenant-binding', tenantId],
      });
    },
  });

  if (!tenantId) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-48 text-text-secondary">
          {t('admin.tenantBinding.selectTenantHint')}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-48">
          {t('common.loading')}
        </CardContent>
      </Card>
    );
  }

  const binding = bindingData?.data;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader>
        <CardTitle>{t('admin.tenantBinding.title')}</CardTitle>
        <CardDescription>
          {t('admin.tenantBinding.description', {
            tenant: binding?.tenant_name || tenantId,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {binding && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-text-secondary">
              {t('admin.tenantBinding.currentStatus')}:
            </span>
            <Badge variant={binding.is_default ? 'secondary' : 'default'}>
              {binding.is_default
                ? t('admin.tenantBinding.default')
                : t('admin.tenantBinding.isolated')}
            </Badge>
            {!binding.is_default && (
              <span className="text-xs font-mono text-text-secondary">
                team={binding.intellect_tenant_id}
                {binding.intellect_project_id
                  ? ` / project=${binding.intellect_project_id}`
                  : ''}
              </span>
            )}
          </div>
        )}
        <Form {...form}>
          <form
            id="tenant-binding-form"
            onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))}
            className="space-y-4 max-w-md"
          >
            <FormField
              control={form.control}
              name="intellect_tenant_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('admin.tenantBinding.team')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t('admin.tenantBinding.teamPlaceholder')}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="0">
                        {t('admin.tenantBinding.defaultTeam')}
                      </SelectItem>
                      {teamsData?.data?.map((team) => (
                        <SelectItem key={team.slug} value={team.slug}>
                          {team.display_name} ({team.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('admin.tenantBinding.teamHint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="intellect_project_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('admin.tenantBinding.project')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t('admin.tenantBinding.projectPlaceholder')}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">
                        {t('admin.tenantBinding.noProject')}
                      </SelectItem>
                      {filteredProjects.map((project) => (
                        <SelectItem key={project.slug} value={project.slug}>
                          {project.display_name} ({project.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('admin.tenantBinding.projectHint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <Button
          type="submit"
          form="tenant-binding-form"
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending
            ? t('common.submitting')
            : t('common.save')}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default TenantBindingsPage;
