import { Card, CardContent } from '@/components/ui/card';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import WargameSectionLayout from '../components/section-menu';

export default function SettingsPage() {
  const { t } = useTranslation();
  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-xl font-medium text-text-primary">
          {t('cognitiveWargame.sectionMenu.settings')}
        </h1>
        <Card>
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-text-secondary">
            <Settings className="size-8" />
            <p>{t('cognitiveWargame.resource.pending')}</p>
          </CardContent>
        </Card>
      </div>
    </WargameSectionLayout>
  );
}
