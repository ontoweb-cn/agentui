import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  api,
  errorMessage,
  isApiError,
  type ClassUnit,
  type Person,
  type Unit,
} from '@/services/hiedu/api';
import { hasPermission } from '@/services/hiedu/format';
import { AppModal } from './components/modal';
import { Field, PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const PAGE_SIZE = 20;
const OPTION_LIMIT = 300;

const SELECT_CLASS =
  'h-8 w-full rounded-md border-0.5 border-border-button bg-bg-input px-2 text-sm text-text-primary outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

const CLASS_STATUSES = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '在用' },
  { value: 'disabled', label: '停用' },
];

interface FormState {
  class_code: string;
  name: string;
  grade_year: string;
  unit_id: string;
  head_teacher_person_id: string;
  status: string;
}

const EMPTY_FORM: FormState = {
  class_code: '',
  name: '',
  grade_year: '',
  unit_id: '',
  head_teacher_person_id: '',
  status: 'active',
};

export default function ClassesPage() {
  const me = useMe();
  const canRead = hasPermission(me.permissions, 'class:read');
  const canWrite = hasPermission(me.permissions, 'class:write');
  const isOrgScope = me.scopes.some((scope) => scope.all);

  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [gradeYear, setGradeYear] = useState('');
  const [page, setPage] = useState(1);
  const [classes, setClasses] = useState<ClassUnit[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [units, setUnits] = useState<Unit[]>([]);
  const [staff, setStaff] = useState<Person[]>([]);

  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<ClassUnit | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editEtag, setEditEtag] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.classes({
        q: q || undefined,
        status: status === 'all' ? undefined : status,
        grade_year: gradeYear ? Number(gradeYear) : undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setClasses(Array.isArray(result.data) ? result.data : []);
      setTotal(result.total);
    } catch (err) {
      setError(errorMessage(err));
      setClasses([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [canRead, gradeYear, page, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canRead) return;
    api
      .units({ include_inactive: 'false', page: 1, page_size: 500 })
      .then((result) =>
        setUnits(
          Array.isArray(result.data)
            ? result.data.filter((unit) => unit.status === 'active')
            : [],
        ),
      )
      .catch(() => setUnits([]));
    api
      .persons({ page: 1, page_size: OPTION_LIMIT, status: 'active', type: 'STAFF' })
      .then((result) => setStaff(Array.isArray(result.data) ? result.data : []))
      .catch(() => setStaff([]));
  }, [canRead]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQ(qInput.trim());
  }

  function openCreate() {
    setCreateForm(EMPTY_FORM);
    setFormError(null);
    setDialog('create');
  }

  async function openEdit(item: ClassUnit) {
    setEditing(item);
    setFormError(null);
    setEditEtag(null);
    setDialog('edit');
    setBusy(true);
    try {
      const result = await api.class(item.id);
      setEditForm({
        class_code: result.data.class_code,
        name: result.data.name,
        grade_year: result.data.grade_year ? String(result.data.grade_year) : '',
        unit_id: result.data.unit_id ? String(result.data.unit_id) : '',
        head_teacher_person_id: result.data.head_teacher_person_id
          ? String(result.data.head_teacher_person_id)
          : '',
        status: result.data.status || 'active',
      });
      setEditEtag(result.etag);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setEditing(null);
    setEditEtag(null);
    setFormError(null);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const code = createForm.class_code.trim();
    const name = createForm.name.trim();
    if (!code || !name) {
      setFormError('班级编码与名称为必填项');
      return;
    }
    if (!createForm.unit_id && !isOrgScope) {
      setFormError('请选择所属部门');
      return;
    }
    setBusy(true);
    try {
      await api.createClass({
        class_code: code,
        name,
        grade_year: createForm.grade_year ? Number(createForm.grade_year) : undefined,
        unit_id: createForm.unit_id ? Number(createForm.unit_id) : undefined,
        head_teacher_person_id: createForm.head_teacher_person_id
          ? Number(createForm.head_teacher_person_id)
          : undefined,
        status: createForm.status,
      });
      closeDialog();
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setFormError(null);
    const name = editForm.name.trim();
    if (!name) {
      setFormError('班级名称为必填项');
      return;
    }
    setBusy(true);
    try {
      // ETag 原样透传；版本冲突由后端返回 409，不自动重试。
      await api.updateClass(
        editing.id,
        {
          name,
          // 编辑框预填原值；留空即视为清空，显式传 0 才能生效（后端指针字段语义）。
          grade_year: editForm.grade_year ? Number(editForm.grade_year) : 0,
          unit_id: editForm.unit_id ? Number(editForm.unit_id) : 0,
          head_teacher_person_id: editForm.head_teacher_person_id
            ? Number(editForm.head_teacher_person_id)
            : 0,
          status: editForm.status,
        },
        editEtag ?? undefined,
      );
      closeDialog();
      await load();
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setFormError('保存冲突：班级已被其他操作修改，请关闭弹窗后重新打开以获取最新版本。');
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <ForbiddenState
        message="无权限查看班级"
        detail="需要 class:read 权限。"
      />
    );
  }

  const hasMore = total !== null ? page * PAGE_SIZE < total : classes.length >= PAGE_SIZE;
  const unitName = (id?: number) =>
    units.find((unit) => unit.id === id)?.name || (id ? `#${id}` : '—');
  const teacherName = (id?: number) =>
    staff.find((person) => person.id === id)?.name || (id ? `#${id}` : '—');

  function formFields(
    form: FormState,
    setForm: (next: FormState) => void,
    isEdit: boolean,
  ): ReactNode {
    return (
      <>
        <Field label="班级编码 *">
          <Input
            value={form.class_code}
            onChange={(event) => setForm({ ...form, class_code: event.target.value })}
            disabled={isEdit}
            required={!isEdit}
          />
        </Field>
        <Field label="班级名称 *">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>
        <Field label="年级">
          <Input
            type="number"
            min={1}
            value={form.grade_year}
            onChange={(event) => setForm({ ...form, grade_year: event.target.value })}
            placeholder="如 2026"
          />
        </Field>
        <Field label={`所属部门 ${isOrgScope ? '' : '*'}`}>
          <select
            className={SELECT_CLASS}
            value={form.unit_id}
            onChange={(event) => setForm({ ...form, unit_id: event.target.value })}
          >
            <option value="">不指定</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}（{unit.unit_code}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="班主任">
          <select
            className={SELECT_CLASS}
            value={form.head_teacher_person_id}
            onChange={(event) =>
              setForm({ ...form, head_teacher_person_id: event.target.value })
            }
          >
            <option value="">不指定</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}（{person.person_no}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="状态">
          <select
            className={SELECT_CLASS}
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            <option value="active">在用</option>
            <option value="disabled">停用</option>
          </select>
        </Field>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="班级管理"
        description="班级为扁平登记，不进入组织树、不投影 IdP 组。"
        actions={
          canWrite ? (
            <Button size="sm" onClick={openCreate}>
              新建班级
            </Button>
          ) : null
        }
      />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border-button bg-bg-card p-3"
        onSubmit={handleSearch}
      >
        <Field label="搜索" className="min-w-48 flex-1">
          <Input
            type="search"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="班级名称或编码"
          />
        </Field>
        <Field label="状态" className="w-36">
          <select
            className={SELECT_CLASS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {CLASS_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="年级" className="w-32">
          <Input
            type="number"
            min={1}
            value={gradeYear}
            onChange={(event) => {
              setGradeYear(event.target.value);
              setPage(1);
            }}
            placeholder="如 2026"
          />
        </Field>
        <Button type="submit" size="sm">
          查询
        </Button>
      </form>

      {loading ? <LoadingState label="正在加载班级列表…" /> : null}
      {!loading && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}

      {!loading && !error ? (
        <Panel className="overflow-hidden" bodyClassName="p-0">
          {classes.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>班级</TableHead>
                    <TableHead>编码</TableHead>
                    <TableHead>年级</TableHead>
                    <TableHead>所属部门</TableHead>
                    <TableHead>班主任</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                          {item.class_code}
                        </code>
                      </TableCell>
                      <TableCell>{item.grade_year || '—'}</TableCell>
                      <TableCell>{unitName(item.unit_id)}</TableCell>
                      <TableCell>{teacherName(item.head_teacher_person_id)}</TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void openEdit(item)}
                          >
                            编辑
                          </Button>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-button px-4 py-3">
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
              </div>
            </>
          ) : (
            <div className="p-4">
              <EmptyState title="未找到班级" description="请调整筛选条件或新建班级。" />
            </div>
          )}
        </Panel>
      ) : null}

      {dialog === 'create' ? (
        <AppModal
          title="新建班级"
          className="sm:max-w-xl"
          onClose={closeDialog}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="submit" form="class-create-form" size="sm" loading={busy}>
                {busy ? '创建中…' : '创建'}
              </Button>
            </>
          }
        >
          <form
            id="class-create-form"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(event) => void submitCreate(event)}
          >
            {formFields(createForm, setCreateForm, false)}
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </form>
        </AppModal>
      ) : null}

      {dialog === 'edit' && editing ? (
        <AppModal
          title={`编辑班级 · ${editing.name}`}
          className="sm:max-w-xl"
          onClose={closeDialog}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="submit" form="class-edit-form" size="sm" loading={busy}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <form
            id="class-edit-form"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(event) => void submitEdit(event)}
          >
            {formFields(editForm, setEditForm, true)}
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </form>
        </AppModal>
      ) : null}
    </div>
  );
}
