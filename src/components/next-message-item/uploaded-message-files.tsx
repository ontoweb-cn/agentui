import { UploadResponseDataType } from '@/interfaces/database/chat';
import { IDocumentInfo } from '@/interfaces/database/document';
import { getExtension } from '@/utils/document-util';
import { formatBytes } from '@/utils/file-util';
import { useEffect, useMemo, memo } from 'react';
import FileIcon from '../file-icon';
import SvgIcon from '../svg-icon';

type UploadedFile = File | IDocumentInfo | UploadResponseDataType;

interface IProps {
  files?: UploadedFile[];
}

/** 本地图片预览:创建/释放 blob URL,避免每次 render 泄漏 object URL。 */
function LocalImagePreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return <img src={url} alt={file.name} className="size-10 object-cover" />;
}

type NameWidgetType = {
  name: string;
  size: number;
  id?: string;
};
function NameWidget({ name, size }: NameWidgetType) {
  return (
    <div className="text-xs max-w-20">
      {/* {id ? (
        <NewDocumentLink documentId={id} documentName={name} resource="document">
          {name}
        </NewDocumentLink>
      ) : (
      )} */}
      <div className="truncate">{name}</div>
      <p className="text-text-secondary pt-1">{formatBytes(size)}</p>
    </div>
  );
}
export function InnerUploadedMessageFiles({ files = [] }: IProps) {
  return (
    <section className="flex gap-2 pt-2">
      {files?.map((file, idx) => {
        const name = file.name;
        const isFile = file instanceof File;

        return (
          <div key={idx} className="flex gap-1 border rounded-md p-1.5">
            {!isFile ? (
              <FileIcon id={file.id} name={name}></FileIcon>
            ) : file.type.startsWith('image/') ? (
              <LocalImagePreview file={file} />
            ) : (
              <SvgIcon
                name={`file-icon/${getExtension(name)}`}
                width={24}
              ></SvgIcon>
            )}
            <NameWidget
              name={name}
              size={file.size}
              id={isFile ? undefined : file.id}
            ></NameWidget>
          </div>
        );
      })}
    </section>
  );
}

export const UploadedMessageFiles = memo(InnerUploadedMessageFiles);
