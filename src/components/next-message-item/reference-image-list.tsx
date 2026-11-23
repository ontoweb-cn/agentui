import Image, { useDocumentImageUrl } from '@/components/image';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IReferenceChunk } from '@/interfaces/database/chat';
import { isPlainObject } from 'lodash';
import { ExternalLink, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { extractNumbersFromMessageContent } from './utils';

type IProps = {
  referenceChunks?: IReferenceChunk[] | Record<string, IReferenceChunk>;
  messageContent: string;
};

type ImageItem = {
  id: string;
  index: number;
  documentId?: string;
  datasetId?: string;
  documentName?: string;
};

const getButtonVisibilityClass = (imageCount: number) => {
  const map: Record<number, string> = {
    1: 'hidden',
    2: '@sm:hidden',
    3: '@md:hidden',
    4: '@lg:hidden',
    5: '@lg:hidden',
  };
  return map[imageCount] || (imageCount >= 6 ? '@2xl:hidden' : '');
};

function ImagePhotoView({
  id,
  index,
  documentId,
  datasetId,
  documentName,
}: ImageItem) {
  const src = useDocumentImageUrl(id);
  const { t } = useTranslation();
  const { navigateToChunkParsedResult } = useNavigatePage();

  const openSourceDocument = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!documentId) return;
    navigateToChunkParsedResult(documentId, datasetId)();
  };

  return (
    <div className="relative group">
      <PhotoView src={src}>
        <Image
          id={id}
          className="h-40 w-full"
          label={`Fig. ${(index + 1).toString()}`}
        />
      </PhotoView>
      {documentId ? (
        <button
          type="button"
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-trae-xs text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          onClick={openSourceDocument}
          title={documentName || t('chat.openSourceDocument')}
          data-testid="reference-image-source-doc"
        >
          <ExternalLink className="size-3" />
          <span>{t('chat.openSourceDocument')}</span>
        </button>
      ) : null}
    </div>
  );
}

function ImageCarousel({ images }: { images: ImageItem[] }) {
  const buttonVisibilityClass = getButtonVisibilityClass(images.length);

  return (
    <PhotoProvider
      toolbarRender={({ rotate, onRotate, scale, onScale }) => {
        return (
          <>
            <RotateCw
              className="mr-4 cursor-pointer text-text-disabled hover:text-text-primary"
              onClick={() => onRotate(rotate + 90)}
            />
            <ZoomIn
              className="mr-4 cursor-pointer text-text-disabled hover:text-text-primary"
              onClick={() => onScale(scale + 1)}
            />
            <ZoomOut
              className="cursor-pointer text-text-disabled hover:text-text-primary"
              onClick={() => onScale(scale - 1)}
            />
          </>
        );
      }}
    >
      <Carousel
        className="w-full"
        opts={{
          align: 'start',
        }}
      >
        <CarouselContent>
          {images.map((item) => (
            <CarouselItem
              key={item.index}
              className="
              basis-full
              @sm:basis-1/2
              @md:basis-1/3
              @lg:basis-1/4
              @2xl:basis-1/6
              "
            >
              <ImagePhotoView {...item} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className={buttonVisibilityClass} />
        <CarouselNext className={buttonVisibilityClass} />
      </Carousel>
    </PhotoProvider>
  );
}

export function ReferenceImageList({
  referenceChunks,
  messageContent,
}: IProps) {
  const allChunkIndexes = extractNumbersFromMessageContent(messageContent);
  const images = useMemo(() => {
    if (Array.isArray(referenceChunks)) {
      return referenceChunks
        .map((chunk, idx) => ({
          id: chunk.image_id,
          index: idx,
          documentId: chunk.document_id,
          datasetId: chunk.dataset_id,
          documentName: chunk.document_name,
        }))
        .filter((item, idx) => allChunkIndexes.includes(idx) && item.id);
    }

    if (isPlainObject(referenceChunks)) {
      return Object.entries(referenceChunks || {}).reduce<ImageItem[]>(
        (pre, [idx, chunk]) => {
          if (allChunkIndexes.includes(Number(idx)) && chunk.image_id) {
            return pre.concat({
              id: chunk.image_id,
              index: Number(idx),
              documentId: chunk.document_id,
              datasetId: chunk.dataset_id,
              documentName: chunk.document_name,
            });
          }
          return pre;
        },
        [],
      );
    }

    return [];
  }, [allChunkIndexes, referenceChunks]);

  const imageCount = images?.length || 0;

  if (imageCount === 0) {
    return <></>;
  }

  return (
    <section className="@container w-full">
      <ImageCarousel images={images} />
    </section>
  );
}
