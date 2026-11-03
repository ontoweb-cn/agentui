import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, errorMessage, type DictItem } from '@/services/hiedu/api';
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

const TEXTAREA_CLASS =
  'min-h-20 w-full rounded-md border-0.5 border-border-button bg-bg-input px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-disabled focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

interface FormState {
  dict_type: string;
  code: string;
  name: string;
  parent_code: string;
  attrs: string;
  sort: string;
  is_enabled: boolean;
}

const EMPTY_FORM: FormState = {
  dict_type: '',
  code: '',
  name: '',
  parent_code: '',
  attrs: '',
  sort: '0',
  is_enabled: true,
};

export default function DictsPage() {
  const me = useMe();
  const canRead = hasPermission(me.permissions, 'dict:read');
  const canWrite = hasPermission(me.permissions, 'dict:write');
  const isOrgScope = me.scopes.some((scope) => scope.all);

  const [dictType, setDictType] = useState('');
  const [dictTypes, setDictTypes] = useState<string[]>([]);
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<'create' | null>(null);
  const [editingDict, setEditingDict] = useState<DictItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
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
      const result = await api.dicts({ dict_type: dictType || undefined });
      const list = Array.isArray(result.data) ? result.data : [];
      setItems(list);
      if (!dictType) {
        setDictTypes([...new Set(list.map((item) => item.dict_type))].sort());
      }
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [canRead, dictType]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingDict(null);
    setForm({ ...EMPTY_FORM, dict_type: dictType || '' });
    setFormError(null);
    setDialog('create');
  }

  function openEdit(item: DictItem) {
    setEditingDict(item);
    setForm({
      dict_type: item.dict_type,
      code: item.code,
      name: item.name,
      parent_code: item.parent_code || '',
      attrs: item.attrs || '',
      sort: String(item.sort ?? 0),
      is_enabled: item.is_enabled,
    });
    setFormError(null);
    setDialog('create');
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setEditingDict(null);
    setFormError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const type = form.dict_type.trim();
    const code = form.code.trim();
    const name = form.name.trim();
    if (!type || !code || !name) {
      setFormError('字典类型、编码与名称为必填项');
      return;
    }
    if (form.attrs.trim()) {
      try {
        JSON.parse(form.attrs);
      } catch {
        setFormError('附加属性必须是合法 JSON');
        return;
      }
    }
    setBusy(true);
    try {
      await api.upsertDict({
        dict_type: type,
        code,
        name,
        parent_code: form.parent_code.trim() || undefined,
        attrs: form.attrs.trim() || undefined,
        sort: form.sort ? Number(form.sort) : undefined,
        is_enabled: form.is_enabled,
      });
      closeDialog();
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: DictItem) {
    setBusy(true);
    setError(null);
    try {
      await api.setDictEnabled(item.id, !item.is_enabled);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <ForbiddenState
        message="无权限查看数据字典"
        detail="需要 dict:read 权限。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="数据字典"
        description="统一维护 POSITION、TITLE 等代码；只停用不删除，停用项不参与新数据校验。"
        actions={
          canWrite ? (
            <Button size="sm" onClick={openCreate}>
              新增 / 更新字典项
            </Button>
          ) : null
        }
      />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border-button bg-bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Field label="字典类型" className="min-w-48 flex-1">
          <Input
            value={dictType}
            onChange={(event) => setDictType(event.target.value)}
            placeholder="留空查看全部，如 POSITION"
            list="dict-type-options"
          />
          <datalist id="dict-type-options">
            {dictTypes.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </Field>
        <Button type="submit" size="sm">
          查询
        </Button>
        {isOrgScope ? null : (
          <span className="pb-1.5 text-xs text-text-tertiary">仅校级范围可启停字典项</span>
        )}
      </form>

      {loading ? <LoadingState label="正在加载字典…" /> : null}
      {!loading && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}

      {!loading && !error ? (
        <Panel className="overflow-hidden" bodyClassName="p-0">
          {items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>父级</TableHead>
                  <TableHead>排序</TableHead>
                  <TableHead>附加属性</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                        {item.dict_type}
                      </code>
                    </TableCell>
                    <TableCell className="font-medium">{item.code}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="text-text-secondary">
                      {item.parent_code || '—'}
                    </TableCell>
                    <TableCell>{item.sort}</TableCell>
                    <TableCell className="text-text-secondary">
                      <code className="text-xs">{item.attrs || '—'}</code>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.is_enabled ? 'active' : 'disabled'} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => openEdit(item)}
                          >
                            编辑
                          </Button>
                        ) : null}
                        {canWrite && isOrgScope ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void toggle(item)}
                          >
                            {item.is_enabled ? '停用' : '启用'}
                          </Button>
                        ) : null}
                        {canWrite ? null : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="暂无字典项" description="请调整字典类型或新增字典项。" />
            </div>
          )}
        </Panel>
      ) : null}

      {dialog === 'create' ? (
        <AppModal
          title={editingDict ? `编辑字典项 · ${editingDict.code}` : '新增 / 更新字典项'}
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
              <Button type="submit" form="dict-form" size="sm" loading={busy}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <form
            id="dict-form"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(event) => void submit(event)}
          >
            <Field label="字典类型 *">
              <Input
                value={form.dict_type}
                onChange={(event) => setForm({ ...form, dict_type: event.target.value })}
                placeholder="如 POSITION"
                list="dict-type-options"
                disabled={Boolean(editingDict)}
                required
              />
            </Field>
            <Field label="编码 *">
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                placeholder="同一类型下唯一"
                disabled={Boolean(editingDict)}
                required
              />
            </Field>
            <Field label="名称 *">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </Field>
            <Field label="父级编码">
              <Input
                value={form.parent_code}
                onChange={(event) => setForm({ ...form, parent_code: event.target.value })}
              />
            </Field>
            <Field label="排序">
              <Input
                type="number"
                value={form.sort}
                onChange={(event) => setForm({ ...form, sort: event.target.value })}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Switch
                id="dict-enabled"
                checked={form.is_enabled}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_enabled: checked === true })
                }
              />
              <Label htmlFor="dict-enabled">启用</Label>
            </div>
            <Field label="附加属性（JSON）" className="sm:col-span-2">
              <textarea
                className={TEXTAREA_CLASS}
                value={form.attrs}
                onChange={(event) => setForm({ ...form, attrs: event.target.value })}
                placeholder='如 {"color":"blue"}'
              />
            </Field>
            <p className="text-xs text-text-secondary sm:col-span-2">
              相同类型与编码再次保存即为更新；已有引用不会被删除。
            </p>
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </form>
        </AppModal>
      ) : null}
    </div>
  );
}
