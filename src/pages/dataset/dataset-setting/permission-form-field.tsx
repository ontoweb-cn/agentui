import { SelectWithSearch } from '@/components/originui/select-with-search';
import { IntellectFormItem } from '@/components/intellect-form';
import { PermissionRole } from '@/constants/permission';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function PermissionFormField() {
  const { t } = useTranslation();
  const teamOptions = useMemo(() => {
    // D1.3 A: Until Plan A (identity-sync) lands, membership tables are empty
    // and non-private visibility is non-functional for non-owner users.
    // Only `private` is selectable; `tenant`/`team`/`project` are shown but
    // disabled so users are aware of the options without being able to pick
    // a non-working value.
    return Object.values(PermissionRole).map((x) => ({
      label: t('knowledgeConfiguration.' + x),
      value: x,
      disabled: x !== PermissionRole.Private,
    }));
  }, [t]);

  return (
    <IntellectFormItem
      name="visibility"
      label={t('knowledgeConfiguration.permissions')}
      tooltip={t('knowledgeConfiguration.permissionsTip')}
      horizontal
    >
      <SelectWithSearch
        options={teamOptions}
        triggerClassName="w-full"
        testId="ds-settings-basic-permissions-select"
      ></SelectWithSearch>
    </IntellectFormItem>
  );
}
