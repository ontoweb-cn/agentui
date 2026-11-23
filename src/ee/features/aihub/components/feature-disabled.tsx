import { useTranslation } from 'react-i18next';

/** 能力关闭时的整页占位；不发起任何业务请求。 */
export function FeatureDisabledState() {
  const { t } = useTranslation();

  return (
    <div
      className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center"
      data-testid="aihub-feature-disabled"
    >
      <p className="text-base font-medium text-text-primary">
        {t('aihub.disabled.title')}
      </p>
      <p className="max-w-md text-sm text-text-secondary">
        {t('aihub.disabled.description')}{' '}
        <code className="rounded bg-bg-secondary px-1">
          {t('aihub.disabled.flag')}
        </code>{' '}
        {t('aihub.disabled.descriptionSuffix')}
      </p>
    </div>
  );
}
