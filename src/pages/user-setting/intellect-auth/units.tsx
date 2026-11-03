import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  api,
  errorMessage,
  isApiError,
  type Unit,
  type UnitImpact,
} from '@/services/hiedu/api';
import { formatCount, hasPermission } from '@/services/hiedu/format';
import { AppModal } from './components/modal';
import { Field, PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
} from './components/state';
import { buildTree, UnitTree } from './components/unit-tree';
import { useMe } from './hooks';

// 组织树需要完整层级，单次取上限内的数据；超过时在页头提示。
const UNIT_PAGE_SIZE = 500;

// Radix Select 不允许空字符串作为选项值，用哨兵表示“不变更上级”。
const KEEP_PARENT = '__keep_parent__';

const CATEGORY_OPTIONS = [
  { value: 'SCHOOL', label: '学校' },
  { value: 'COLLEGE', label: '学院' },
  { value: 'DEPT', label: '部门' },
  { value: 'TEACH', label: '教学单位' },
];

type DialogKind = 'create' | 'edit' | 'disable' | 'merge' | 'dissolve';

interface DialogState {
  kind: DialogKind;
  unit: Unit | null;
}

interface CreateForm {
  parent_id: string;
  unit_code: string;
  name: string;
  short_name: string;
  category_code: string;
  idp_projection: boolean;
}

interface EditForm {
  name: string;
  short_name: string;
  parent_id: string;
  idp_projection: boolean;
}

interface LoadError {
  message: string;
  status?: number;
}

const EMPTY_CREATE: CreateForm = {
  parent_id: '',
  unit_code: '',
  name: '',
  short_name: '',
  category_code: 'DEPT',
  idp_projection: false,
};

export default function UnitsPage() {
  const me = useMe();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tree, setTree] = useState<ReturnType<typeof buildTree>>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [impact, setImpact] = useState<UnitImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '',
    short_name: '',
    parent_id: '',
    idp_projection: false,
  });
  const [editEtag, setEditEtag] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  // 仅校级范围可见“显示停用”开关与“学校根”父级选项（后端也会按范围二次校验）。
  const isOrgScope = me.scopes.some((scope) => scope.all);
  const canRead = hasPermission(me.permissions, 'unit:read');
  const canWrite = canRead && hasPermission(me.permissions, 'unit:write');

  // 快速切换筛选时，过期响应不得覆盖新数据（评审 R-race）
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    if (!canRead) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.units({
        include_inactive: includeInactive ? 'true' : 'false',
        q: q || undefined,
        page: 1,
        page_size: UNIT_PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return;
      const list = Array.isArray(result.data) ? result.data : [];
      setUnits(list);
      const nextTree = buildTree(list);
      setTree(nextTree);
      setTotal(result.total);
      setExpanded(new Set(nextTree.map((node) => node.id)));
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError({
        message: errorMessage(err),
        status: isApiError(err) ? err.status : undefined,
      });
      setUnits([]);
      setTree([]);
      setTotal(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [canRead, includeInactive, q]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = qInput.trim();
    if (next === q) {
      void load();
      return;
    }
    setQ(next);
  }

  const toggle = useCallback((id: number) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setImpact(null);
    setImpactLoading(false);
    setFormError(null);
    setMergeTarget('');
  }

  function openCreate() {
    setCreateForm(EMPTY_CREATE);
    setFormError(null);
    setDialog({ kind: 'create', unit: null });
  }

  async function openEdit(unit: Unit) {
    setDialog({ kind: 'edit', unit });
    setFormError(null);
    setBusy(true);
    try {
      const result = await api.unit(unit.id);
      setEditForm({
        name: result.data.name,
        short_name: result.data.short_name ?? '',
        parent_id: result.data.parent_id ? String(result.data.parent_id) : '',
        idp_projection: result.data.idp_projection,
      });
      setEditEtag(result.etag);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openLifecycle(
    kind: 'disable' | 'merge' | 'dissolve',
    unit: Unit,
  ) {
    setDialog({ kind, unit });
    setFormError(null);
    setImpact(null);
    setMergeTarget('');
    setImpactLoading(true);
    try {
      const result = await api.unitImpact(unit.id);
      setImpact(result.data);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setImpactLoading(false);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const name = createForm.name.trim();
    const code = createForm.unit_code.trim();
    if (!name || !code) {
      setFormError('部门名称与编码为必填项');
      return;
    }
    setBusy(true);
    try {
      await api.createUnit({
        parent_id: createForm.parent_id
          ? Number(createForm.parent_id)
          : undefined,
        unit_code: code,
        name,
        short_name: createForm.short_name.trim() || undefined,
        category_code: createForm.category_code,
        idp_projection: createForm.idp_projection,
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
    if (!dialog?.unit) return;
    setFormError(null);
    const name = editForm.name.trim();
    if (!name) {
      setFormError('部门名称为必填项');
      return;
    }
    setBusy(true);
    try {
      // 透传编辑前 GET 拿到的 ETag 作为 If-Match，由后端做并发校验。
      await api.updateUnit(
        dialog.unit.id,
        {
          name,
          short_name: editForm.short_name.trim(),
          idp_projection: editForm.idp_projection,
          parent_id:
            editForm.parent_id === ''
              ? undefined
              : Number(editForm.parent_id),
        },
        editEtag ?? undefined,
      );
      closeDialog();
      await load();
    } catch (err) {
      // 409 表示数据已被他人修改；只在对话框内提示，不做自动重试。
      setFormError(
        isApiError(err) && err.status === 409
          ? '该部门已被其他人修改（409 冲突），请关闭对话框后重新打开再保存。'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitLifecycle() {
    if (!dialog?.unit) return;
    setFormError(null);
    if (dialog.kind === 'merge' && !mergeTarget) {
      setFormError('请选择撤并后的目标部门');
      return;
    }
    setBusy(true);
    try {
      if (dialog.kind === 'disable') {
        await api.disableUnit(dialog.unit.id);
      } else if (dialog.kind === 'dissolve') {
        await api.dissolveUnit(dialog.unit.id);
      } else if (dialog.kind === 'merge') {
        await api.mergeUnit(dialog.unit.id, Number(mergeTarget));
      }
      closeDialog();
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // 撤并目标：同组织、启用、非自身且不在自身子树内。
  const mergeTargets = units.filter((unit) => {
    if (!dialog?.unit) return false;
    if (unit.status !== 'active' || unit.id === dialog.unit.id) return false;
    return !unit.path.startsWith(`${dialog.unit.path}/`);
  });

  const activeUnits = units.filter((unit) => unit.status === 'active');

  if (!canRead) {
    return (
      <ForbiddenState
        message="无权限查看组织架构"
        detail="当前账号缺少 unit:read 权限。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="组织架构"
        description={
          total !== null
            ? `共 ${total} 个单元${
                total > units.length
                  ? `（受分页上限限制，树中展示 ${units.length} 个）`
                  : ''
              }`
            : `已加载 ${units.length} 个单元`
        }
        actions={
          canWrite ? (
            <Button size="sm" onClick={openCreate}>
              新建部门
            </Button>
          ) : null
        }
      />

      <form className="flex flex-wrap items-end gap-2" onSubmit={handleSearch}>
        <Field label="搜索" className="min-w-[16rem] flex-1">
          <Input
            type="search"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="部门名称或编码"
          />
        </Field>
        <Button type="submit" size="sm">
          搜索
        </Button>
        {isOrgScope ? (
          <div className="flex h-8 items-center gap-2">
            <Switch
              id="units-include-inactive"
              checked={includeInactive}
              onCheckedChange={(checked) => setIncludeInactive(checked === true)}
            />
            <label
              htmlFor="units-include-inactive"
              className="text-sm text-text-secondary"
            >
              显示停用
            </label>
          </div>
        ) : null}
      </form>

      {loading ? <LoadingState label="正在加载组织树…" /> : null}
      {!loading && error ? (
        error.status === 403 ? (
          <ForbiddenState
            message="无权限查看组织架构"
            detail={error.message}
          />
        ) : (
          <ErrorState message={error.message} onRetry={() => void load()} />
        )
      ) : null}

      {!loading && !error ? (
        <Panel>
          {tree.length > 0 ? (
            <UnitTree
              nodes={tree}
              expanded={expanded}
              onToggle={toggle}
              actions={
                canWrite
                  ? (node) => (
                      <>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void openEdit(node)}
                        >
                          编辑
                        </Button>
                        {node.status === 'active' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                void openLifecycle('disable', node)
                              }
                            >
                              停用
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                void openLifecycle('merge', node)
                              }
                            >
                              撤并
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-state-error hover:text-state-error"
                              onClick={() =>
                                void openLifecycle('dissolve', node)
                              }
                            >
                              解散
                            </Button>
                          </>
                        ) : null}
                      </>
                    )
                  : undefined
              }
            />
          ) : (
            <EmptyState
              title="未找到组织单元"
              description={
                q ? '请调整搜索关键词后重试。' : '当前数据范围内没有可展示的部门。'
              }
            />
          )}
        </Panel>
      ) : null}

      {dialog?.kind === 'create' ? (
        <AppModal
          title="新建部门"
          onClose={closeDialog}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="unit-create-form"
                size="sm"
                disabled={busy}
              >
                {busy ? '提交中…' : '创建'}
              </Button>
            </>
          }
        >
          <form
            id="unit-create-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => void submitCreate(event)}
          >
            <Field label="上级部门">
              <Select
                value={createForm.parent_id || undefined}
                onValueChange={(value) =>
                  setCreateForm({ ...createForm, parent_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {isOrgScope ? (
                    <SelectItem value="0">学校根</SelectItem>
                  ) : null}
                  {activeUnits.map((unit) => (
                    <SelectItem key={unit.id} value={String(unit.id)}>
                      {'　'.repeat(Math.max(0, unit.level - 1))}
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="部门编码 *">
              <Input
                value={createForm.unit_code}
                onChange={(event) =>
                  setCreateForm({ ...createForm, unit_code: event.target.value })
                }
                placeholder="如 CS"
                required
              />
            </Field>
            <Field label="名称 *">
              <Input
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm({ ...createForm, name: event.target.value })
                }
                required
              />
            </Field>
            <Field label="简称">
              <Input
                value={createForm.short_name}
                onChange={(event) =>
                  setCreateForm({
                    ...createForm,
                    short_name: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="类型">
              <Select
                value={createForm.category_code}
                onValueChange={(value) =>
                  setCreateForm({ ...createForm, category_code: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-center gap-2">
              <Switch
                id="unit-create-idp"
                checked={createForm.idp_projection}
                onCheckedChange={(checked) =>
                  setCreateForm({
                    ...createForm,
                    idp_projection: checked === true,
                  })
                }
              />
              <label
                htmlFor="unit-create-idp"
                className="text-sm text-text-secondary"
              >
                投影到 IdP 组
              </label>
            </div>
            {formError ? (
              <p className="text-xs text-state-error">{formError}</p>
            ) : null}
          </form>
        </AppModal>
      ) : null}

      {dialog?.kind === 'edit' && dialog.unit ? (
        <AppModal
          title={`编辑部门 · ${dialog.unit.name}`}
          onClose={closeDialog}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="unit-edit-form"
                size="sm"
                disabled={busy}
              >
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <form
            id="unit-edit-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => void submitEdit(event)}
          >
            <Field label="名称 *">
              <Input
                value={editForm.name}
                onChange={(event) =>
                  setEditForm({ ...editForm, name: event.target.value })
                }
                required
              />
            </Field>
            <Field label="简称">
              <Input
                value={editForm.short_name}
                onChange={(event) =>
                  setEditForm({ ...editForm, short_name: event.target.value })
                }
              />
            </Field>
            <Field label="上级部门">
              <Select
                value={
                  editForm.parent_id === '' ? KEEP_PARENT : editForm.parent_id
                }
                onValueChange={(value) =>
                  setEditForm({
                    ...editForm,
                    parent_id: value === KEEP_PARENT ? '' : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_PARENT}>不变更</SelectItem>
                  {isOrgScope ? (
                    <SelectItem value="0">学校根</SelectItem>
                  ) : null}
                  {activeUnits
                    .filter((unit) => {
                      const editingPath = dialog.unit?.path;
                      if (unit.id === dialog.unit?.id) return false;
                      // 排除自身子树，避免提出会被后端拒绝的成环请求。
                      return (
                        !editingPath || !unit.path.startsWith(editingPath + '/')
                      );
                    })
                    .map((unit) => (
                      <SelectItem key={unit.id} value={String(unit.id)}>
                        {unit.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-center gap-2">
              <Switch
                id="unit-edit-idp"
                checked={editForm.idp_projection}
                onCheckedChange={(checked) =>
                  setEditForm({
                    ...editForm,
                    idp_projection: checked === true,
                  })
                }
              />
              <label
                htmlFor="unit-edit-idp"
                className="text-sm text-text-secondary"
              >
                投影到 IdP 组
              </label>
            </div>
            <p className="text-xs text-text-secondary">
              编码不可修改；调整上级会级联子树路径。保存时使用 ETag
              做并发校验。
            </p>
            {formError ? (
              <p className="text-xs text-state-error">{formError}</p>
            ) : null}
          </form>
        </AppModal>
      ) : null}

      {dialog &&
      (dialog.kind === 'disable' ||
        dialog.kind === 'merge' ||
        dialog.kind === 'dissolve') ? (
        <AppModal
          title={
            dialog.kind === 'disable'
              ? `停用部门 · ${dialog.unit?.name ?? ''}`
              : dialog.kind === 'merge'
                ? `撤并部门 · ${dialog.unit?.name ?? ''}`
                : `解散部门 · ${dialog.unit?.name ?? ''}`
          }
          onClose={closeDialog}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => void submitLifecycle()}
                disabled={
                  busy ||
                  impactLoading ||
                  (dialog.kind === 'merge' && !mergeTarget)
                }
              >
                {busy ? '处理中…' : '确认执行'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {impactLoading ? (
              <LoadingState label="正在计算影响范围…" />
            ) : null}
            {!impactLoading && impact ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <span className="block text-xs text-text-secondary">
                    直属人员
                  </span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {formatCount(impact.persons_direct)}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-text-secondary">
                    含子树人员
                  </span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {formatCount(impact.persons_total)}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-text-secondary">
                    项目
                  </span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {formatCount(impact.projects)}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-text-secondary">
                    班级
                  </span>
                  <strong className="mt-1 block text-sm text-text-primary">
                    {formatCount(impact.classes)}
                  </strong>
                </div>
              </div>
            ) : null}
            {impact && impact.groups.length > 0 ? (
              <p className="text-xs text-text-secondary">
                受影响 IdP 组：{impact.groups.join('、')}
              </p>
            ) : null}
            {dialog.kind === 'merge' ? (
              <Field label="目标部门 *">
                <Select
                  value={mergeTarget || undefined}
                  onValueChange={(value) => setMergeTarget(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {mergeTargets.map((unit) => (
                      <SelectItem key={unit.id} value={String(unit.id)}>
                        {unit.name}（{unit.unit_code}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <p className="text-xs text-state-warning">
              {dialog.kind === 'disable'
                ? '停用后该部门不再参与投影与范围判定，人员任职需另行调整。'
                : dialog.kind === 'merge'
                  ? '撤并会迁移人员、项目与角色分配，并逐层停用下属单元，操作不可撤销。'
                  : '解散要求部门无在岗人员与在办项目，操作不可撤销。'}
            </p>
            {formError ? (
              <p className="text-xs text-state-error">{formError}</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
