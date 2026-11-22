import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchChatModels, streamChat } from '../../api';
import { AgentChat } from '../agent-chat';

jest.mock('../../api', () => ({
  fetchChatModels: jest.fn(),
  streamChat: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { message?: string }) =>
      options?.message ? `${key}:${options.message}` : key,
    i18n: { language: 'zh' },
  }),
}));

describe('AgentChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchChatModels as jest.Mock).mockResolvedValue({
      data: { items: [{ id: 'model-1' }] },
    });
  });

  it('streams assistant deltas into the message list', async () => {
    (streamChat as jest.Mock).mockImplementation(
      async ({ onDelta }: { onDelta: (text: string) => void }) => {
        onDelta('你');
        onDelta('好');
      },
    );
    render(<AgentChat assetId="agent-1" tips={['试试问答']} />);
    await waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveValue('model-1'),
    );

    const textbox = screen.getByRole('textbox');
    fireEvent.change(textbox, { target: { value: '介绍一下' } });
    fireEvent.click(screen.getByTestId('aihub-chat-send'));

    await waitFor(() =>
      expect(screen.getByText('你好')).toBeInTheDocument(),
    );
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'agent-1', model: 'model-1' }),
    );
  });

  it('shows an error when the backend is unreachable', async () => {
    (streamChat as jest.Mock).mockRejectedValue(new Error('CHAT_UPSTREAM_UNREACHABLE'));
    render(<AgentChat assetId="agent-1" />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByTestId('aihub-chat-send'));

    await waitFor(() =>
      expect(screen.getByTestId('aihub-chat-error')).toHaveTextContent(
        'CHAT_UPSTREAM_UNREACHABLE',
      ),
    );
  });

  it('fills the input from a tip without sending', () => {
    render(<AgentChat assetId="agent-1" tips={['你好，能做什么？']} />);
    fireEvent.click(screen.getByText('你好，能做什么？'));
    expect(screen.getByRole('textbox')).toHaveValue('你好，能做什么？');
    expect(streamChat).not.toHaveBeenCalled();
  });
});
