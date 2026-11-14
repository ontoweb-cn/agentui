import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { publishDataset, type TaxonomyItem } from '../api';

interface FormState {
  name: string;
  label: string;
  field: string;
  domains: string[];
  format: string;
  sizeBytes: string;
  license: string;
  checksum: string;
  storageUri: string;
  description: string;
}

const EMPTY: FormState = {
  name: '',
  label: '',
  field: '',
  domains: [],
  format: '',
  sizeBytes: '',
  license: '',
  checksum: '',
  storageUri: '',
  description: '',
};

/**
 * 发布本地数据集（M2）。
 *
 * 服务端校验 storage_uri 的 scheme/凭据/签名参数；前端只做必填提示，
 * 不复制后端口径，避免两套规则漂移。
 */
export function DatasetPublish({
  fields,
  domains,
  onPublished,
}: {
  fields: TaxonomyItem[];
  domains: TaxonomyItem[];
  onPublished: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const isZh = i18n.language?.toLowerCase().startsWith('zh');
  const labelOf = (item: TaxonomyItem) =>
    (isZh ? item.label.zh : item.label.en || item.label.zh) || item.key;
  const fieldOptions = fields.filter((item) => !item.synthetic);
  const domainOptions = domains.filter((item) => !item.synthetic);

  const patch = (next: Partial<FormState>) =>
    setForm((previous) => ({ ...previous, ...next }));

  const reset = () => {
    setForm(EMPTY);
    setError('');
    setDone(false);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.storageUri.trim()) {
      setError(t('aihub.dataset.invalid'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await publishDataset({
        name: form.name.trim(),
        label: form.label.trim() || undefined,
        field: form.field || fieldOptions[0]?.key || 'general',
        domains: form.domains,
        description: form.description.trim(),
        format: form.format.trim() || undefined,
        sizeBytes: form.sizeBytes ? Number(form.sizeBytes) : undefined,
        license: form.license.trim() || undefined,
        checksum: form.checksum.trim() || undefined,
        storageUri: form.storageUri.trim(),
      });
      setDone(true);
      setForm(EMPTY);
      onPublished();
    } catch (err) {
      setError(
        t('aihub.dataset.error', {
          message: (err as Error).message,
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          data-testid="aihub-dataset-publish-open"
        >
          {t('aihub.dataset.publish')}
        </Button>
        {done && (
          <span className="text-xs text-text-secondary">
            {t('aihub.dataset.published')}
          </span>
        )}
      </div>
    );
  }

  const inputClass =
    'h-8 w-full rounded border border-border bg-bg-input px-2 text-sm text-text-primary outline-none focus:border-border-button';

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      data-testid="aihub-dataset-publish"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-primary">
          {t('aihub.dataset.publishTitle')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          {t('aihub.dataset.cancel')}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('aihub.dataset.name')}
          <input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            className={inputClass}
            data-testid="aihub-dataset-name"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('aihub.dataset.label')}
          <input
            value={form.label}
            onChange={(event) => patch({ label: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('aihub.dataset.field')}
          <select
            value={form.field || fieldOptions[0]?.key || 'general'}
            onChange={(event) => patch({ field: event.target.value })}
            className={inputClass}
          >
            {fieldOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {labelOf(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('aihub.dataset.format')}
          <input
            value={form.format}
            onChange={(event) => patch({ format: event.target.value })}
            placeholder="parquet / csv / jsonl"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('aihub.dataset.size')}
          <input
            value={form.sizeBytes}
            onChange={(event) =>
              patch({ sizeBytes: event.target.value.replace(/[^\d]/g, '') })
            }
            inputMode="numeric"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('aihub.dataset.license')}
          <input
            value={form.license}
            onChange={(event) => patch({ license: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary md:col-span-2">
          {t('aihub.dataset.checksum')}
          <input
            value={form.checksum}
            onChange={(event) => patch({ checksum: event.target.value })}
            placeholder="sha256:…"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary md:col-span-2">
          {t('aihub.dataset.storageUri')}
          <input
            value={form.storageUri}
            onChange={(event) => patch({ storageUri: event.target.value })}
            placeholder="s3://bucket/path/data.parquet"
            className={inputClass}
            data-testid="aihub-dataset-storage-uri"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary md:col-span-2">
          {t('aihub.dataset.description')}
          <textarea
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            rows={2}
            className="w-full resize-none rounded border border-border bg-bg-input px-2 py-1 text-sm text-text-primary outline-none focus:border-border-button"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-secondary">
          {t('aihub.dataset.domains')}
        </span>
        {domainOptions.map((item) => {
          const active = form.domains.includes(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() =>
                patch({
                  domains: active
                    ? form.domains.filter((key) => key !== item.key)
                    : [...form.domains, item.key],
                })
              }
              className={
                active
                  ? 'rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary'
                  : 'rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-secondary'
              }
            >
              {labelOf(item)}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-text-secondary" data-testid="aihub-dataset-error">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={submitting}
          onClick={() => void submit()}
          data-testid="aihub-dataset-submit"
        >
          {submitting ? t('aihub.dataset.submitting') : t('aihub.dataset.submit')}
        </Button>
      </div>
    </section>
  );
}
