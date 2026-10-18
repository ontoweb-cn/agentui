import { Button } from '@/components/ui/button';
import { IDocumentDownloadInfo } from '@/interfaces/database/chat';
import { downloadAgentFile } from '@/services/file-manager-service';
import { downloadFileFromBlob } from '@/utils/file-util';
import { Download, FileText } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export type DocumentDownloadInfo = IDocumentDownloadInfo;

interface DocumentDownloadButtonProps {
  downloadInfo: DocumentDownloadInfo;
  className?: string;
}

export function DocumentDownloadButton({
  downloadInfo,
  className,
}: DocumentDownloadButtonProps) {
  const { t } = useTranslation();
  const handleDownload = useCallback(async () => {
    try {
      const ext =
        downloadInfo.filename.split('.').pop()?.toLowerCase() || 'bin';
      const response = await downloadAgentFile({
        docId: downloadInfo.doc_id,
        ext,
      });
      const blob = new Blob([response.data], {
        type: downloadInfo.mime_type || response.data.type,
      });
      downloadFileFromBlob(blob, downloadInfo.filename);
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error(t('common.downloadFailed'));
    }
  }, [downloadInfo, t]);

  const getDocumentType = () => {
    const ext = downloadInfo.filename.split('.').pop()?.toUpperCase();
    return ext || 'FILE';
  };

  return (
    <div
      className={`flex items-center gap-3 p-4 border rounded-lg bg-background-card ${className || ''}`}
    >
      <div className="flex-shrink-0">
        <div className="p-2 bg-accent-primary/10 rounded-lg">
          <FileText className="w-6 h-6 text-accent-primary-text" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">
          {downloadInfo.filename}
        </div>
        <div className="text-xs text-muted-foreground">{getDocumentType()}</div>
      </div>
      <Button
        onClick={handleDownload}
        size="sm"
        className="flex items-center gap-2"
      >
        <Download className="w-4 h-4" />
        {t('common.download')}
      </Button>
    </div>
  );
}
