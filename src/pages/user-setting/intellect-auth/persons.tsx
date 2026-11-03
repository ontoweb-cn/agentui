/**
 * 人员管理列表：按姓名/编号/状态/类型检索范围内的档案。
 *
 * 移植自 hiedu/web/src/pages/Persons.tsx：保留分页、筛选、过期响应丢弃与
 * 权限口径；邮箱一律掩码展示，明文只能经 PersonPIIField 走后端 PII 接口。
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
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
import { Routes } from '@/constants/routes';
import {
  api,
  errorMessage,
  isApiError,
  type Person,
} from '@/services/hiedu/api';
import {
  hasPermission,
  maskEmail,
  personTypeLabel,
} from '@/services/hiedu/format';
import { PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'pending_account', label: '待开通' },
  { value: 'draft', label: '草稿' },
  { value: 'suspended', label: '暂停' },
  { value: 'left', label: '离职' },
  { value: 'graduated', label: '毕业' },
  { value: 'no_account', label: '无账号' },
];

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'STAFF', label: '教职工' },
  { value: 'STUDENT', label: '学生' },
];

const DETAIL_BASE = `${Routes.UserSetting}${Routes.IntellectAuthPersons}`;

interface ListError {
  message: string;
  forbidden: boolean;
}

export default function PersonsPage() {
  const me = useMe();
  const canRead = hasPermission(me.permissions, 'person:read');
  const canWrite = hasPermission(me.permissions, 'person:write');

  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [persons, setPersons] = useState<Person[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ListError | null>(null);

  // 快速切换筛选/页码时，过期响应不得覆盖新数据（沿用源页面 R-race 处理）。
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!canRead) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.persons({
        q: q || undefined,
        status: status === 'all' ? undefined : status,
        type: type === 'all' ? undefined : type,
        page,
        page_size: PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return;
      setPersons(Array.isArray(result.data) ? result.data : []);
      setTotal(result.total);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError({
        message: errorMessage(err),
        forbidden: isApiError(err) && err.status === 403,
      });
      setPersons([]);
      setTotal(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [canRead, page, q, status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = qInput.trim();
    if (next === q) {
      if (page === 1) {
        void load();
      } else {
        setPage(1);
      }
      return;
    }
    setPage(1);
    setQ(next);
  }

  if (!canRead) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="人员管理" />
        <ForbiddenState
          message="无权限查看人员"
          detail="当前账号缺少 person:read 权限，无法访问人员档案。"
        />
      </div>
    );
  }

  const hasMore =
    total !== null ? page * PAGE_SIZE < total : persons.length >= PAGE_SIZE;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="人员管理"
        description="按姓名、编号、状态与类型检索范围内的人员档案。"
        actions={
          canWrite ? (
            <Button asLink to={`${Routes.UserSetting}${Routes.IntellectAuthPersonCreate}`}>
              新建人员
            </Button>
          ) : null
        }
      />

      <Panel>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={handleSearch}
        >
          <label className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">搜索</span>
            <Input
              type="search"
              value={qInput}
              onChange={(event) => setQInput(event.target.value)}
              placeholder="姓名、人员编号或工号/学号"
            />
          </label>
          <label className="flex w-36 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">状态</span>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex w-32 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">类型</span>
            <Select
              value={type}
              onValueChange={(value) => {
                setType(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button type="submit">查询</Button>
        </form>
      </Panel>

      {loading ? <LoadingState label="正在加载人员列表…" /> : null}

      {!loading && error ? (
        error.forbidden ? (
          <ForbiddenState
            message="无权限查看人员"
            detail={error.message}
          />
        ) : (
          <ErrorState message={error.message} onRetry={() => void load()} />
        )
      ) : null}

      {!loading && !error ? (
        <Panel bodyClassName="p-0">
          {persons.length > 0 ? (
            <>
              <Table rootClassName="rounded-none bg-transparent">
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>人员编号</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>工号 / 学号</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {persons.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">{person.name}</TableCell>
                      <TableCell>
                        <code className="text-xs text-text-secondary">
                          {person.person_no || '—'}
                        </code>
                      </TableCell>
                      <TableCell>{personTypeLabel(person.person_type)}</TableCell>
                      <TableCell>
                        {person.staff_no || person.student_no || '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={person.status} />
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {maskEmail(person.email)}
                      </TableCell>
                      <TableCell>
                        <Link
                          className="text-sm font-medium text-accent-primary hover:underline"
                          to={`${DETAIL_BASE}/${person.id}`}
                        >
                          详情
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-button px-6 py-3">
                <span className="text-xs text-text-secondary">
                  第 {page} 页 · 共 {total === null ? '—' : total} 条
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || loading}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!hasMore || loading}
                  >
                    下一页
                  </Button>
                </div>
              </footer>
            </>
          ) : (
            <div className="p-4">
              <EmptyState
                title="未找到人员"
                description="请调整搜索条件或确认当前数据范围内有人员档案。"
              />
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
