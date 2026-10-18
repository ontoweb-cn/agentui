import { fireEvent, render, screen } from '@testing-library/react';

import { MessageType } from '@/constants/chat';
import type { IMessage } from '@/interfaces/database/chat';
import { WorkspacePanel } from '../workspace-panel';

jest.mock('@/components/next-message-item/uploaded-message-files', () => ({
  UploadedMessageFiles: ({ files }: { files: Array<{ name: string }> }) => (
    <div data-testid="uploads">{files.map((file) => file.name).join(',')}</div>
  ),
}));

jest.mock('@/components/document-download-button', () => ({
  DocumentDownloadButton: ({
    downloadInfo,
  }: {
    downloadInfo: { filename: string };
  }) => <div data-testid="download">{downloadInfo.filename}</div>,
}));

jest.mock('@/components/next-message-item/reference-document-list', () => ({
  ReferenceDocumentList: ({
    list,
  }: {
    list: Array<{ doc_name: string }>;
  }) => (
    <div data-testid="references">
      {list.map((doc) => doc.doc_name).join(',')}
    </div>
  ),
}));

function makeMessage(overrides: Partial<IMessage> = {}): IMessage {
  return {
    id: 'm1',
    content: '',
    role: MessageType.User,
    ...overrides,
  } as IMessage;
}

function makeFile(name: string) {
  return new File(['content'], name, { type: 'application/pdf' });
}

describe('WorkspacePanel', () => {
  it('visible=false 时不渲染内容', () => {
    render(
      <WorkspacePanel visible={false} onClose={jest.fn()} messages={[]} />,
    );
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('展示上传文件、下载产物与引用文档', () => {
    render(
      <WorkspacePanel
        visible
        onClose={jest.fn()}
        messages={[
          makeMessage({
            files: [makeFile('a.pdf')],
            downloads: [
              { doc_id: 'd1', filename: 'b.pdf', mime_type: 'application/pdf' },
            ],
            reference: {
              chunks: [],
              doc_aggs: [{ count: 1, doc_id: 'r1', doc_name: 'c.pdf' }],
              total: 1,
            },
          } as Partial<IMessage>),
        ]}
      />,
    );

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByTestId('uploads')).toHaveTextContent('a.pdf');
    expect(screen.getByTestId('download')).toHaveTextContent('b.pdf');

    fireEvent.click(screen.getByRole('tab', { name: /References/ }));
    expect(screen.getByTestId('references')).toHaveTextContent('c.pdf');
  });

  it('去重重复的文件/下载/引用', () => {
    const message = makeMessage({
      files: [makeFile('a.pdf')],
      downloads: [
        { doc_id: 'd1', filename: 'b.pdf', mime_type: 'application/pdf' },
      ],
      reference: {
        chunks: [],
        doc_aggs: [{ count: 1, doc_id: 'r1', doc_name: 'c.pdf' }],
        total: 1,
      },
    } as Partial<IMessage>);

    render(
      <WorkspacePanel visible onClose={jest.fn()} messages={[message, message]} />,
    );

    expect(screen.getByTestId('uploads')).toHaveTextContent(/^a\.pdf$/);
    expect(screen.getAllByTestId('download')).toHaveLength(1);

    fireEvent.click(screen.getByRole('tab', { name: /References/ }));
    expect(screen.getAllByTestId('references')).toHaveLength(1);
  });

  it('服务端文件按稳定 id 去重(同名同大小不合并)', () => {
    const serverFile = (id: string) => ({
      id,
      name: 'a.pdf',
      size: 1,
      mime_type: 'application/pdf',
      extension: 'pdf',
      created_at: 0,
      created_by: '',
      preview_url: null,
    });

    render(
      <WorkspacePanel
        visible
        onClose={jest.fn()}
        messages={[
          makeMessage({
            files: [serverFile('f1'), serverFile('f2')] as any,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('uploads')).toHaveTextContent('a.pdf,a.pdf');
  });

  it('方向键在 Files/References 间切换并聚焦', () => {
    render(
      <WorkspacePanel
        visible
        onClose={jest.fn()}
        messages={[
          makeMessage({
            reference: {
              chunks: [],
              doc_aggs: [{ count: 1, doc_id: 'r1', doc_name: 'c.pdf' }],
              total: 1,
            },
          } as Partial<IMessage>),
        ]}
      />,
    );

    const filesTab = screen.getByRole('tab', { name: /Files/ });
    filesTab.focus();
    fireEvent.keyDown(filesTab, { key: 'ArrowRight' });

    const referencesTab = screen.getByRole('tab', { name: /References/ });
    expect(referencesTab).toHaveAttribute('aria-selected', 'true');
    expect(referencesTab).toHaveAttribute('aria-controls', 'workspace-panel-references');
    expect(filesTab).not.toHaveAttribute('aria-controls');
    expect(referencesTab).toHaveFocus();
  });

  it('空态与关闭回调', () => {
    const onClose = jest.fn();
    render(
      <WorkspacePanel visible onClose={onClose} messages={[]} />,
    );

    expect(
      screen.getByText('No files in this conversation'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /References/ }));
    expect(
      screen.getByText('No referenced documents in this conversation'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-workspace-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
