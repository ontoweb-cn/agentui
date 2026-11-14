import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { publishDataset } from '../../api';
import { DatasetPublish } from '../dataset-publish';

jest.mock('../../api', () => ({
  publishDataset: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { message?: string }) =>
      options?.message ? `${key}:${options.message}` : key,
    i18n: { language: 'zh' },
  }),
}));

const fields = [
  {
    key: 'vision',
    label: { zh: '机器视觉', en: 'Machine Vision' },
    count: 1,
    synthetic: false,
    order: 1,
  },
];
const domains = [
  {
    key: 'medical',
    label: { zh: '医药', en: 'Healthcare' },
    count: 1,
    synthetic: false,
    order: 1,
  },
];

describe('DatasetPublish', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires name and storage uri before publishing', async () => {
    const onPublished = jest.fn();
    (publishDataset as jest.Mock).mockResolvedValue({ data: {} });
    render(
      <DatasetPublish
        fields={fields}
        domains={domains}
        onPublished={onPublished}
      />,
    );

    fireEvent.click(screen.getByTestId('aihub-dataset-publish-open'));
    fireEvent.click(screen.getByTestId('aihub-dataset-submit'));
    expect(screen.getByTestId('aihub-dataset-error')).toBeInTheDocument();
    expect(publishDataset).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('aihub-dataset-name'), {
      target: { value: 'e2e-dataset-1' },
    });
    fireEvent.change(screen.getByTestId('aihub-dataset-storage-uri'), {
      target: { value: 's3://bucket/e2e/data.parquet' },
    });
    fireEvent.click(screen.getByTestId('aihub-dataset-submit'));

    await waitFor(() => expect(onPublished).toHaveBeenCalled());
    expect(publishDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'e2e-dataset-1',
        field: 'vision',
        storageUri: 's3://bucket/e2e/data.parquet',
      }),
    );
  });

  it('shows server error when publish fails', async () => {
    (publishDataset as jest.Mock).mockRejectedValue(
      new Error('INVALID_STORAGE_URI'),
    );
    render(
      <DatasetPublish fields={fields} domains={domains} onPublished={jest.fn()} />,
    );
    fireEvent.click(screen.getByTestId('aihub-dataset-publish-open'));
    fireEvent.change(screen.getByTestId('aihub-dataset-name'), {
      target: { value: 'e2e-dataset-2' },
    });
    fireEvent.change(screen.getByTestId('aihub-dataset-storage-uri'), {
      target: { value: 'http://example.com/a' },
    });
    fireEvent.click(screen.getByTestId('aihub-dataset-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('aihub-dataset-error')).toHaveTextContent(
        'INVALID_STORAGE_URI',
      ),
    );
  });
});
