import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { IntellectSelect } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  api,
  errorMessage,
  type ExportJob,
  type ImportJob,
  type ImportPreview,
  type ImportRowError,
} from '@/services/hiedu/api';
import {
  formatCount,
  formatDateTime,
  hasPermission,
  statusLabel,
} from '@/services/hiedu/format';
import { Field, MutedText, PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_ROWS = 50;

const IMPORT_KINDS = [
  { value: 'persons', label: '人员（persons）' },
  { value: 'units', label: '部门（units）' },
];

const EXPORT_KINDS = ['persons', 'projects', 'units', 'classes', 'audit'];

const EXPORT_OPTIONS = EXPORT_KINDS.map((kind) => ({
  value: kind,
  label: kind,
}));

const PERSON_HEADER =
  'person_no,person_type,name,staff_no,student_no,email,title_code,department_id,position_code';
const UNIT_HEADER =
  'unit_code,name,short_name,category_code,parent_id,idp_projection';

function ImportErrorsTable({ errors }: { errors: ImportRowError[] }) {
  const visible = errors.slice(0, MAX_ERROR_ROWS);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>行号</TableHead>
            <TableHead>字段</TableHead>
            <TableHead>错误</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row, index) => (
            <TableRow key={`${row.row}-${row.field ?? ''}-${index}`}>
              <TableCell>{row.row}</TableCell>
              <TableCell>{row.field || '—'}</TableCell>
              <TableCell className="text-state-error">{row.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {errors.length > MAX_ERROR_ROWS ? (
        <p className="mt-2 text-xs text-text-tertiary">
          仅展示前 {MAX_ERROR_ROWS} 条，共 {errors.length} 条错误。
        </p>
      ) : null}
    </>
  );
}

export default function ImportsPage() {
  const me = useMe();
  const canImport = hasPermission(me.permissions, 'system:import');
  const canExport = hasPermission(me.permissions, 'system:export');
  const canExportPII = hasPermission(me.permissions, 'person:pii:read');

  const [kind, setKind] = useState('persons');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [jobId, setJobId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exportKind, setExportKind] = useState('persons');
  const [exportPII, setExportPII] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportLookupId, setExportLookupId] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!canImport) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="导入与导出"
          description="导入先预检再提交；非 PII 导出即时生成 CSV，PII 导出需审批后下载。"
        />
        <ForbiddenState
          message="无权限访问导入导出"
          detail="当前账号缺少 system:import 权限。"
        />
      </div>
    );
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setError('文件超过 8MB 上限');
      return;
    }
    try {
      setCsv(await file.text());
      setFileName(file.name);
      setPreview(null);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function doPreview() {
    if (!csv.trim()) {
      setError('请粘贴 CSV 内容或选择文件');
      return;
    }
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const result = await api.importPreview(kind, csv);
      setPreview(result.data);
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    if (!csv.trim()) {
      setError('请粘贴 CSV 内容或选择文件');
      return;
    }
    if (!preview) {
      setError('请先预检 CSV，确认预览结果后再提交');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.importCommit(kind, csv);
      setJob(result.data);
      setJobId(result.data.id);
      setPreview(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function lookupJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.getImport(jobId.trim());
      setJob(result.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setExportBusy(true);
    setExportError(null);
    try {
      const result = await api.createExport(
        exportKind,
        canExportPII && exportPII,
      );
      setExportJob(result.data);
      setExportLookupId(result.data.id);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExportBusy(false);
    }
  }

  async function lookupExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exportLookupId.trim()) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const result = await api.getExport(exportLookupId.trim());
      setExportJob(result.data);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExportBusy(false);
    }
  }

  async function decideExport(decision: 'approve' | 'reject') {
    if (!exportJob) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const result =
        decision === 'approve'
          ? await api.approveExport(exportJob.id)
          : await api.rejectExport(exportJob.id);
      setExportJob(result.data);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExportBusy(false);
    }
  }

  async function downloadExport(id: string) {
    setExportBusy(true);
    setExportError(null);
    try {
      await api.downloadExport(id);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExportBusy(false);
    }
  }

  function insertSample() {
    setCsv(`${kind === 'persons' ? PERSON_HEADER : UNIT_HEADER}\n`);
    setFileName('');
    setPreview(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="导入与导出"
        description="导入先预检再提交（单文件 ≤8MB、≤5000 行）；非 PII 导出即时生成 CSV，PII 导出需审批后下载。"
      />

      <Panel
        title="CSV 导入"
        extra={
          <Button variant="ghost" size="sm" onClick={insertSample}>
            插入表头模板
          </Button>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void doPreview();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="导入类型">
              <IntellectSelect
                value={kind}
                onChange={(value) => {
                  setKind(String(value ?? ''));
                  setPreview(null);
                  setJob(null);
                }}
                options={IMPORT_KINDS}
              />
            </Field>
            <Field label="CSV 文件">
              <input
                type="file"
                accept=".csv,text/csv"
                className="block w-full rounded-md border border-border-button bg-bg-input px-3 py-1.5 text-sm text-text-secondary file:mr-2 file:rounded file:border-0 file:bg-bg-secondary file:px-2 file:py-1 file:text-sm file:text-text-primary hover:file:bg-border-button"
                onChange={(event) => void readFile(event.target.files?.[0])}
              />
            </Field>
          </div>
          <Field label={`CSV 内容${fileName ? `（${fileName}）` : ''}`}>
            <Textarea
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                setPreview(null);
              }}
              placeholder="首行为表头，支持 UTF-8 BOM"
              spellCheck={false}
              rows={8}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" disabled={busy}>
              {busy ? '处理中…' : '预检'}
            </Button>
            <Button
              type="button"
              disabled={busy || !preview}
              onClick={() => void doCommit()}
            >
              提交导入
            </Button>
            {!preview ? (
              <MutedText>请先预检，确认预览结果后再提交。</MutedText>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-state-error">
              {error}
            </p>
          ) : null}
        </form>
      </Panel>

      {preview ? (
        <Panel
          title="预检结果"
          extra={
            <MutedText>
              共 {preview.total} 行 · 通过 {preview.valid} · 失败{' '}
              {preview.invalid}
            </MutedText>
          }
        >
          {preview.errors.length > 0 ? (
            <ImportErrorsTable errors={preview.errors} />
          ) : (
            <EmptyState
              title="预检通过"
              description="所有行均通过校验，可提交导入。"
            />
          )}
        </Panel>
      ) : null}

      {job ? (
        <Panel
          title={`导入任务 #${job.id}`}
          extra={<StatusBadge status={job.status} />}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <span className="text-xs text-text-secondary">类型</span>
                <strong className="mt-1 block text-sm text-text-primary">
                  {job.kind}
                </strong>
              </div>
              <div>
                <span className="text-xs text-text-secondary">总行数</span>
                <strong className="mt-1 block text-sm text-text-primary">
                  {formatCount(job.total)}
                </strong>
              </div>
              <div>
                <span className="text-xs text-text-secondary">成功</span>
                <strong className="mt-1 block text-sm text-text-primary">
                  {formatCount(job.valid)}
                </strong>
              </div>
              <div>
                <span className="text-xs text-text-secondary">失败</span>
                <strong className="mt-1 block text-sm text-text-primary">
                  {formatCount(job.invalid)}
                </strong>
              </div>
              <div>
                <span className="text-xs text-text-secondary">创建时间</span>
                <strong className="mt-1 block text-sm text-text-primary">
                  {formatDateTime(job.created_at)}
                </strong>
              </div>
            </div>
            {job.errors.length > 0 ? (
              <ImportErrorsTable errors={job.errors} />
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="查询导入任务">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={lookupJob}
        >
          <Field label="任务 ID" className="sm:flex-1">
            <Input
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              placeholder="导入返回的任务 ID"
            />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>
            查询
          </Button>
        </form>
      </Panel>

      {canExport ? (
        <Panel title="导出任务">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="导出类型">
                <IntellectSelect
                  value={exportKind}
                  onChange={(value) => setExportKind(String(value ?? ''))}
                  options={EXPORT_OPTIONS}
                />
              </Field>
              {canExportPII ? (
                <div className="flex items-end gap-2 pb-1">
                  <Checkbox
                    id="export-pii"
                    checked={exportPII}
                    onCheckedChange={(checked) =>
                      setExportPII(checked === true)
                    }
                  />
                  <label
                    htmlFor="export-pii"
                    className="text-sm text-text-secondary"
                  >
                    包含 PII（需审批后生成）
                  </label>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={exportBusy}
                onClick={() => void doExport()}
              >
                {exportBusy ? '处理中…' : '创建导出'}
              </Button>
            </div>
            {exportError ? (
              <p role="alert" className="text-sm text-state-error">
                {exportError}
              </p>
            ) : null}
            {exportJob ? (
              <div className="flex flex-col gap-3 rounded-md bg-bg-secondary p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-text-secondary">
                    任务 #{exportJob.id}
                  </span>
                  <StatusBadge status={exportJob.status} />
                  <span className="text-text-primary">
                    类型 {exportJob.kind}
                    {exportJob.pii ? ' · 含 PII' : ''}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">
                  状态 {statusLabel(exportJob.status)}
                  {exportJob.approved_by
                    ? ` · 审批人 ${exportJob.approved_by}`
                    : ''}
                  {exportJob.approved_at
                    ? ` · ${formatDateTime(exportJob.approved_at)}`
                    : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {exportJob.status === 'completed' ? (
                    <Button
                      disabled={exportBusy}
                      onClick={() => void downloadExport(exportJob.id)}
                    >
                      下载 CSV
                    </Button>
                  ) : null}
                  {exportJob.status === 'pending_approval' &&
                  (!exportJob.pii || canExportPII) ? (
                    <>
                      <Button
                        disabled={exportBusy}
                        onClick={() => void decideExport('approve')}
                      >
                        审批通过并生成
                      </Button>
                      <Button
                        variant="outline"
                        disabled={exportBusy}
                        onClick={() => void decideExport('reject')}
                      >
                        驳回
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {canExport ? (
        <Panel title="查询导出任务">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={lookupExport}
          >
            <Field label="导出任务 ID" className="sm:flex-1">
              <Input
                value={exportLookupId}
                onChange={(event) => setExportLookupId(event.target.value)}
                placeholder="导出返回的任务 ID"
              />
            </Field>
            <Button type="submit" variant="outline" disabled={exportBusy}>
              查询
            </Button>
          </form>
        </Panel>
      ) : null}

      {busy ? <LoadingState label="正在处理…" /> : null}
      {error && !preview && !job ? (
        <ErrorState message={error} />
      ) : null}
    </div>
  );
}
