/**
 * 新建人员：建立人员主档，有账号时投递 IdP 建号任务。
 *
 * 移植自 hiedu/web/src/pages/PersonCreate.tsx：保留必填校验、账号名实时预检
 * （300ms 防抖、先清旧结论）与 PII 写权限口径。
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Routes } from '@/constants/routes';
import {
  api,
  errorMessage,
  type AccountPreview,
  type Unit,
} from '@/services/hiedu/api';
import { hasPermission } from '@/services/hiedu/format';
import { Field, PageHeader, Panel } from './components/page';
import {
  ErrorState,
  ForbiddenState,
  LoadingState,
} from './components/state';
import { useMe } from './hooks';

interface FormState {
  person_no: string;
  person_type: string;
  name: string;
  staff_no: string;
  student_no: string;
  email: string;
  department_id: string;
  position_code: string;
  title_code: string;
  no_account: boolean;
}

const EMPTY_FORM: FormState = {
  person_no: '',
  person_type: 'STAFF',
  name: '',
  staff_no: '',
  student_no: '',
  email: '',
  department_id: '',
  position_code: '',
  title_code: '',
  no_account: false,
};

const NONE_VALUE = 'none';

const PERSONS_BASE = `${Routes.UserSetting}${Routes.IntellectAuthPersons}`;

export default function PersonCreatePage() {
  const me = useMe();
  const navigate = useNavigate();
  const canWrite = hasPermission(me.permissions, 'person:write');
  const canWritePII = hasPermission(me.permissions, 'person:pii:write') && me.pii.write;
  const isOrgScope = me.scopes.some((scope) => scope.all);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canWrite) return;
    setUnitsLoading(true);
    api
      .units({ include_inactive: 'false', page: 1, page_size: 500 })
      .then((result) => {
        setUnits(
          Array.isArray(result.data)
            ? result.data.filter((unit) => unit.status === 'active')
            : [],
        );
        setUnitsError(null);
      })
      .catch((err) => setUnitsError(errorMessage(err)))
      .finally(() => setUnitsLoading(false));
  }, [canWrite]);

  const accountNo =
    form.person_type === 'STUDENT' ? form.student_no.trim() : form.staff_no.trim();

  // 账号可用性实时预检（仅在有账号模式下）。
  useEffect(() => {
    if (!canWrite || form.no_account || !accountNo) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    // 先清空旧结论，避免节流窗口内提交使用过期结果。
    setPreview(null);
    setPreviewLoading(true);
    setPreviewError(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .accountPreview(form.person_type, accountNo)
        .then((result) => {
          if (!cancelled) setPreview(result.data);
        })
        .catch((err) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError(errorMessage(err));
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountNo, canWrite, form.no_account, form.person_type]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const personNo = form.person_no.trim();
    const name = form.name.trim();
    if (!personNo || !name) {
      setFormError('人员编号与姓名为必填项');
      return;
    }
    if (!form.no_account && !accountNo) {
      setFormError(form.person_type === 'STUDENT' ? '请填写学号' : '请填写工号');
      return;
    }
    if (preview && !preview.available) {
      setFormError(preview.reason || '账号名不可用，请调整工号/学号');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createPerson({
        person_no: personNo,
        person_type: form.person_type,
        name,
        staff_no: form.staff_no.trim() || undefined,
        student_no: form.student_no.trim() || undefined,
        title_code: form.title_code.trim() || undefined,
        email: form.email.trim() || undefined,
        department_id: form.department_id ? Number(form.department_id) : undefined,
        position_code: form.position_code.trim() || undefined,
        no_account: form.no_account,
      });
      navigate(`${PERSONS_BASE}/${result.data.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="新建人员" />
        <ForbiddenState
          message="无权限新建人员"
          detail="当前账号缺少 person:write 权限，无法建立人员档案。"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="新建人员"
        description="建立人员主档；有账号的人员会投递 IdP 建号任务，无账号仅建业务档案。"
        actions={
          <Button
            asLink
            variant="outline"
            to={PERSONS_BASE}
          >
            ← 返回人员列表
          </Button>
        }
      />

      {unitsLoading ? <LoadingState label="正在加载部门列表…" /> : null}
      {!unitsLoading && unitsError ? <ErrorState message={unitsError} /> : null}

      {!unitsLoading && !unitsError ? (
        <Panel>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => void submit(event)}
          >
            <Field label="人员编号 *">
              <Input
                value={form.person_no}
                onChange={(event) => update('person_no', event.target.value)}
                placeholder="如 20260001"
                required
              />
            </Field>
            <Field label="人员类型 *">
              <Select
                value={form.person_type}
                onValueChange={(value) => update('person_type', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STAFF">教职工</SelectItem>
                  <SelectItem value="STUDENT">学生</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="姓名 *">
              <Input
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                required
              />
            </Field>
            <Field label="职称代码">
              <Input
                value={form.title_code}
                onChange={(event) => update('title_code', event.target.value)}
                placeholder="如 PROFESSOR"
              />
            </Field>

            {form.person_type === 'STUDENT' ? (
              <Field label={`学号 ${form.no_account ? '' : '*'}`}>
                <Input
                  value={form.student_no}
                  onChange={(event) => update('student_no', event.target.value)}
                  disabled={form.no_account}
                />
              </Field>
            ) : (
              <Field label={`工号 ${form.no_account ? '' : '*'}`}>
                <Input
                  value={form.staff_no}
                  onChange={(event) => update('staff_no', event.target.value)}
                  disabled={form.no_account}
                />
              </Field>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="person-no-account"
                checked={form.no_account}
                onCheckedChange={(checked) => update('no_account', checked === true)}
              />
              <label
                htmlFor="person-no-account"
                className="cursor-pointer text-sm text-text-primary"
              >
                无统一身份（仅建业务档案）
              </label>
            </div>

            <Field label={`所属部门 ${isOrgScope ? '' : '*'}`}>
              <Select
                value={form.department_id || NONE_VALUE}
                onValueChange={(value) =>
                  update('department_id', value === NONE_VALUE ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>请选择</SelectItem>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={String(unit.id)}>
                      {unit.name}（{unit.unit_code}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="职务代码">
              <Input
                value={form.position_code}
                onChange={(event) => update('position_code', event.target.value)}
                placeholder="如 LECTURER"
              />
            </Field>

            {canWritePII ? (
              <Field
                label="邮箱"
                className="sm:col-span-2"
                hint="仅具备 person:pii:write 时可填写"
              >
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="仅具备 person:pii:write 时可填写"
                />
              </Field>
            ) : null}

            {!form.no_account && accountNo ? (
              <div className="sm:col-span-2">
                {previewLoading ? (
                  <p className="text-xs text-text-secondary">
                    正在校验账号名 {accountNo}…
                  </p>
                ) : null}
                {!previewLoading && preview ? (
                  <p
                    className={
                      preview.available
                        ? 'text-xs text-text-secondary'
                        : 'text-xs text-state-error'
                    }
                  >
                    账号名 {preview.account}：
                    {preview.available ? '可用' : preview.reason || '不可用'}
                  </p>
                ) : null}
                {!previewLoading && previewError ? (
                  <p role="alert" className="text-xs text-state-error">
                    {previewError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {formError ? (
              <p role="alert" className="text-sm text-state-error sm:col-span-2">
                {formError}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <Button asLink variant="outline" to={PERSONS_BASE}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? '创建中…' : '创建人员'}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
