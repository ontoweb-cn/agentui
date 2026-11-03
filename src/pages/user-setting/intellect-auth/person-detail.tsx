/**
 * 人员详情：基本信息、任职关系、字段变更历史，以及编辑/调岗/结束任职。
 *
 * 移植自 hiedu/web/src/pages/PersonDetail.tsx：
 * - 更新人员沿用 ETag/If-Match，409 冲突只在表单内提示，不自动重试；
 * - 历史邮箱按后端掩码展示，明文仅经 PersonPIIField 调 PII 接口。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router';

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
  type PersonChange,
  type PersonRelation,
  type Unit,
} from '@/services/hiedu/api';
import {
  formatDateTime,
  hasPermission,
  maskEmail,
  personTypeLabel,
} from '@/services/hiedu/format';
import { AppModal } from './components/modal';
import { PageHeader, Panel } from './components/page';
import { PersonPIIField } from './components/person-pii';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  email: '邮箱',
  title_code: '职称',
  status: '状态',
  person_no: '人员编号',
  staff_no: '工号',
  student_no: '学号',
  account_name: '账号名',
  person_type: '人员类型',
  unit_id: '部门',
  position_code: '职务',
  relation_status: '任职状态',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// 历史记录中的邮箱继续脱敏，其他字段原样展示。
function fieldValue(field: string, value: string): string {
  if (!value) return '—';
  if (field === 'email' || field.includes('email')) return maskEmail(value);
  return value;
}

type DialogState =
  | { kind: 'edit' }
  | { kind: 'transfer' }
  | { kind: 'end'; relation: PersonRelation };

interface EditForm {
  name: string;
  title_code: string;
  email: string;
}

interface TransferForm {
  old_relation: string;
  new_unit_id: string;
  position_code: string;
  end_date: string;
}

interface DetailError {
  message: string;
  status?: number;
}

const NONE_VALUE = 'none';
const PERSONS_BASE = `${Routes.UserSetting}${Routes.IntellectAuthPersons}`;
const today = () => new Date().toISOString().slice(0, 10);

/** 写操作失败提示：409 冲突需引导重新加载，不自动重试。 */
function writeErrorMessage(error: unknown): string {
  if (isApiError(error) && error.status === 409) {
    return `${errorMessage(error)}。数据已被其他用户修改，请关闭弹窗并重新加载后再试。`;
  }
  return errorMessage(error);
}

function InfoItem({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary">{children}</dd>
    </div>
  );
}

export default function PersonDetailPage() {
  const me = useMe();
  const params = useParams<{ id: string }>();
  const personId = Number(params.id);
  const validId = Number.isInteger(personId) && personId > 0;
  const requestSeq = useRef(0);

  const canRead = hasPermission(me.permissions, 'person:read');
  const canWrite = hasPermission(me.permissions, 'person:write');
  const canWritePII = hasPermission(me.permissions, 'person:pii:write') && me.pii.write;
  const isOrgScope = me.scopes.some((scope) => scope.all);

  const [person, setPerson] = useState<Person | null>(null);
  const [history, setHistory] = useState<PersonChange[]>([]);
  const [relations, setRelations] = useState<PersonRelation[]>([]);
  const [personEtag, setPersonEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DetailError | null>(null);

  const [units, setUnits] = useState<Unit[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '',
    title_code: '',
    email: '',
  });
  const [transferForm, setTransferForm] = useState<TransferForm>({
    old_relation: '',
    new_unit_id: '',
    position_code: '',
    end_date: today(),
  });
  const [endDate, setEndDate] = useState(today());

  const load = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (!canRead) return;
    if (!validId) {
      setPerson(null);
      setHistory([]);
      setRelations([]);
      setLoading(false);
      setError({ message: '无效的人员 ID' });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [personResult, historyResult, relationResult] = await Promise.all([
        api.person(personId),
        api.personHistory(personId),
        api.personRelations(personId),
      ]);
      if (requestSeq.current !== seq) return;
      setPerson(personResult.data);
      setPersonEtag(personResult.etag);
      setHistory(historyResult.data);
      setRelations(
        Array.isArray(relationResult.data) ? relationResult.data : [],
      );
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError({
        message: errorMessage(err),
        status: isApiError(err) ? err.status : undefined,
      });
      setPerson(null);
      setHistory([]);
      setRelations([]);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [canRead, personId, validId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadUnits = useCallback(async () => {
    try {
      const result = await api.units({
        include_inactive: 'false',
        page: 1,
        page_size: 500,
      });
      setUnits(
        Array.isArray(result.data)
          ? result.data.filter((unit) => unit.status === 'active')
          : [],
      );
    } catch {
      setUnits([]);
    }
  }, []);

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setFormError(null);
  }

  function openEdit() {
    if (!person) return;
    setEditForm({
      name: person.name,
      title_code: person.title_code ?? '',
      email: '',
    });
    setFormError(null);
    setDialog({ kind: 'edit' });
  }

  async function openTransfer() {
    await loadUnits();
    setTransferForm({
      old_relation: '',
      new_unit_id: '',
      position_code: '',
      end_date: today(),
    });
    setFormError(null);
    setDialog({ kind: 'transfer' });
  }

  function openEnd(relation: PersonRelation) {
    setEndDate(today());
    setFormError(null);
    setDialog({ kind: 'end', relation });
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) return;
    const name = editForm.name.trim();
    if (!name) {
      setFormError('姓名为必填项');
      return;
    }
    const body: { name?: string; title_code?: string; email?: string } = {};
    if (name !== person.name) body.name = name;
    const title = editForm.title_code.trim();
    // 职称预填原值：留空即清空（后端允许空 code）。
    if (title !== (person.title_code ?? '')) body.title_code = title;
    if (canWritePII) {
      const email = editForm.email.trim();
      if (email) body.email = email;
    }
    if (Object.keys(body).length === 0) {
      setFormError('未检测到需要保存的变更');
      return;
    }
    setBusy(true);
    try {
      await api.updatePerson(person.id, body, personEtag ?? undefined);
      closeDialog();
      await load();
    } catch (err) {
      setFormError(writeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) return;
    if (!transferForm.old_relation && !transferForm.new_unit_id) {
      setFormError('请选择要结束的任职关系或目标部门');
      return;
    }
    setBusy(true);
    try {
      await api.transferPerson(person.id, {
        old_relation: transferForm.old_relation
          ? Number(transferForm.old_relation)
          : undefined,
        new_unit_id: transferForm.new_unit_id
          ? Number(transferForm.new_unit_id)
          : undefined,
        position_code: transferForm.position_code.trim() || undefined,
        end_date: transferForm.end_date || undefined,
      });
      closeDialog();
      await load();
    } catch (err) {
      setFormError(writeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEnd() {
    if (!person || dialog?.kind !== 'end') return;
    setBusy(true);
    try {
      await api.updatePersonRelation(person.id, dialog.relation.id, {
        status: 'ended',
        end_date: endDate || undefined,
      });
      closeDialog();
      await load();
    } catch (err) {
      setFormError(writeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="人员详情" />
        <ForbiddenState
          message="无权限查看人员"
          detail="当前账号缺少 person:read 权限，无法访问人员档案。"
        />
      </div>
    );
  }

  const activeRelations = relations.filter(
    (relation) => relation.status === 'active',
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={person?.name ?? '人员详情'}
        description={
          person
            ? `${person.person_no || '—'} · ${personTypeLabel(person.person_type)}`
            : '查看人员基本信息、任职关系与字段变更历史。'
        }
        actions={
          <>
            <Button asLink variant="ghost" to={PERSONS_BASE}>
              ← 返回人员列表
            </Button>
            {person ? <StatusBadge status={person.status} /> : null}
            {person && canWrite ? (
              <>
                <Button variant="outline" onClick={openEdit}>
                  编辑
                </Button>
                <Button variant="outline" onClick={() => void openTransfer()}>
                  调岗
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {loading ? <LoadingState label="正在加载人员详情…" /> : null}

      {!loading && error ? (
        error.status === 403 ? (
          <ForbiddenState
            message="无权限查看该人员"
            detail={error.message}
          />
        ) : (
          <ErrorState message={error.message} onRetry={() => void load()} />
        )
      ) : null}

      {!loading && !error && person ? (
        <>
          <Panel title="基本信息">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem label="姓名">{person.name}</InfoItem>
              <InfoItem label="人员编号">
                <code className="text-xs text-text-secondary">
                  {person.person_no || '—'}
                </code>
              </InfoItem>
              <InfoItem label="人员类型">
                {personTypeLabel(person.person_type)}
              </InfoItem>
              <InfoItem label="状态">
                <StatusBadge status={person.status} />
              </InfoItem>
              <InfoItem label="工号">{person.staff_no || '—'}</InfoItem>
              <InfoItem label="学号">{person.student_no || '—'}</InfoItem>
              <InfoItem label="账号名">{person.account_name || '—'}</InfoItem>
              <InfoItem label="职称">{person.title_code || '—'}</InfoItem>
              <InfoItem label="所属组织">{person.org_code || '—'}</InfoItem>
              <InfoItem label="IdP 统一身份">
                <code className="text-xs text-text-secondary">
                  {person.idp_unified_id || '—'}
                </code>
              </InfoItem>
              <InfoItem label="邮箱" wide>
                <PersonPIIField
                  personId={person.id}
                  email={person.email}
                  canRead={me.pii.read}
                />
              </InfoItem>
            </dl>
          </Panel>

          <Panel
            title="任职关系"
            extra={
              <span className="text-xs text-text-secondary">
                {activeRelations.length} 个在岗任职
              </span>
            }
          >
            {relations.length > 0 ? (
              <Table rootClassName="rounded-none bg-transparent">
                <TableHeader>
                  <TableRow>
                    <TableHead>部门</TableHead>
                    <TableHead>职务</TableHead>
                    <TableHead>主职</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>起始</TableHead>
                    <TableHead>结束</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relations.map((relation) => (
                    <TableRow key={relation.id}>
                      <TableCell className="font-medium">
                        {relation.unit_name || '—'}
                        <div className="text-xs text-text-secondary">
                          <code>#{relation.id}</code>
                        </div>
                      </TableCell>
                      <TableCell>{relation.position_code || '—'}</TableCell>
                      <TableCell>{relation.is_primary ? '是' : '否'}</TableCell>
                      <TableCell>
                        <StatusBadge status={relation.status} />
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {relation.start_date || '—'}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {relation.end_date || '—'}
                      </TableCell>
                      <TableCell>
                        {canWrite && relation.status === 'active' ? (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => openEnd(relation)}
                          >
                            结束任职
                          </Button>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="暂无任职关系"
                description="该人员尚未关联任何部门。"
              />
            )}
          </Panel>

          <Panel
            title="字段变更历史"
            extra={
              <span className="text-xs text-text-secondary">
                {history.length} 条记录
              </span>
            }
          >
            {history.length > 0 ? (
              <Table rootClassName="rounded-none bg-transparent">
                <TableHeader>
                  <TableRow>
                    <TableHead>字段</TableHead>
                    <TableHead>原值</TableHead>
                    <TableHead>新值</TableHead>
                    <TableHead>操作人</TableHead>
                    <TableHead>时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((change) => (
                    <TableRow key={change.id}>
                      <TableCell className="font-medium">
                        {fieldLabel(change.field)}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {fieldValue(change.field, change.old_value)}
                      </TableCell>
                      <TableCell>
                        {fieldValue(change.field, change.new_value)}
                      </TableCell>
                      <TableCell>{change.actor || '—'}</TableCell>
                      <TableCell className="text-text-secondary">
                        {formatDateTime(change.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="暂无变更记录"
                description="该人员的字段尚未发生变更。"
              />
            )}
          </Panel>
        </>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <AppModal
          title="编辑人员信息"
          onClose={closeDialog}
          footer={
            <>
              <Button variant="outline" onClick={closeDialog} disabled={busy}>
                取消
              </Button>
              <Button
                type="submit"
                form="person-edit-form"
                disabled={busy}
              >
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <form
            id="person-edit-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => void submitEdit(event)}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                姓名 *
              </span>
              <Input
                value={editForm.name}
                onChange={(event) =>
                  setEditForm({ ...editForm, name: event.target.value })
                }
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                职称代码
              </span>
              <Input
                value={editForm.title_code}
                onChange={(event) =>
                  setEditForm({ ...editForm, title_code: event.target.value })
                }
                placeholder="如 PROFESSOR"
              />
            </label>
            {canWritePII ? (
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-medium text-text-secondary">
                  新邮箱
                </span>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(event) =>
                    setEditForm({ ...editForm, email: event.target.value })
                  }
                  placeholder="留空表示不修改；改写邮箱需 person:pii:write"
                />
              </label>
            ) : null}
            <p className="text-xs text-text-secondary sm:col-span-2">
              保存时使用 ETag 做并发校验，冲突时会提示重新加载。
            </p>
            {formError ? (
              <p
                role="alert"
                className="text-sm text-state-error sm:col-span-2"
              >
                {formError}
              </p>
            ) : null}
          </form>
        </AppModal>
      ) : null}

      {dialog?.kind === 'transfer' ? (
        <AppModal
          title={`调岗 · ${person?.name ?? ''}`}
          onClose={closeDialog}
          footer={
            <>
              <Button variant="outline" onClick={closeDialog} disabled={busy}>
                取消
              </Button>
              <Button
                type="submit"
                form="person-transfer-form"
                disabled={busy}
              >
                {busy ? '提交中…' : '确认调岗'}
              </Button>
            </>
          }
        >
          <form
            id="person-transfer-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => void submitTransfer(event)}
          >
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-text-secondary">
                结束原任职关系
              </span>
              <Select
                value={transferForm.old_relation || NONE_VALUE}
                onValueChange={(value) =>
                  setTransferForm({
                    ...transferForm,
                    old_relation: value === NONE_VALUE ? '' : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>
                    不结束（仅新增任职）
                  </SelectItem>
                  {activeRelations.map((relation) => (
                    <SelectItem key={relation.id} value={String(relation.id)}>
                      {relation.unit_name || `部门 #${relation.unit_id}`}（#
                      {relation.id}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                目标部门
              </span>
              <Select
                value={transferForm.new_unit_id || NONE_VALUE}
                onValueChange={(value) =>
                  setTransferForm({
                    ...transferForm,
                    new_unit_id: value === NONE_VALUE ? '' : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>不新增</SelectItem>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={String(unit.id)}>
                      {unit.name}（{unit.unit_code}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                职务代码
              </span>
              <Input
                value={transferForm.position_code}
                onChange={(event) =>
                  setTransferForm({
                    ...transferForm,
                    position_code: event.target.value,
                  })
                }
                placeholder="如 LECTURER"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                原任职结束日期
              </span>
              <Input
                type="date"
                value={transferForm.end_date}
                onChange={(event) =>
                  setTransferForm({
                    ...transferForm,
                    end_date: event.target.value,
                  })
                }
              />
            </label>
            {!isOrgScope ? (
              <p className="text-xs text-text-secondary sm:col-span-2">
                仅可调入当前数据范围内的启用部门。
              </p>
            ) : null}
            {formError ? (
              <p
                role="alert"
                className="text-sm text-state-error sm:col-span-2"
              >
                {formError}
              </p>
            ) : null}
          </form>
        </AppModal>
      ) : null}

      {dialog?.kind === 'end' ? (
        <AppModal
          title={`结束任职 · ${
            dialog.relation.unit_name || `部门 #${dialog.relation.unit_id}`
          }`}
          onClose={closeDialog}
          footer={
            <>
              <Button variant="outline" onClick={closeDialog} disabled={busy}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => void submitEnd()}
                disabled={busy}
              >
                {busy ? '处理中…' : '确认结束'}
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">
              结束日期
            </span>
            <Input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <p className="mt-3 text-xs text-state-warning">
            结束任职不会删除记录，仅把状态置为已结束并写入历史。
          </p>
          {formError ? (
            <p role="alert" className="mt-2 text-sm text-state-error">
              {formError}
            </p>
          ) : null}
        </AppModal>
      ) : null}
    </div>
  );
}
