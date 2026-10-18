import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';

import TaskList from '../task-list';

const mockUseFetchChatList = jest.fn();

jest.mock('@/hooks/use-chat-request', () => ({
  useFetchChatList: () => mockUseFetchChatList(),
}));

jest.mock('@/hooks/logic-hooks/navigate-hooks', () => ({
  useNavigatePage: () => ({ navigateToChat: jest.fn(() => jest.fn()) }),
}));

jest.mock('@/components/ui/intellect-pagination', () => ({
  IntellectPagination: () => <div data-testid="pagination" />,
}));

jest.mock('@/components/trae-work', () => ({
  TaskCard: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <div data-testid="task-card">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}));

function makeChat(overrides: Record<string, unknown>) {
  return {
    id: 's1',
    name: 'Task 1',
    create_date: dayjs().subtract(5, 'minute').toISOString(),
    update_date: dayjs().toISOString(),
    ...overrides,
  };
}

describe('TaskList', () => {
  beforeEach(() => {
    mockUseFetchChatList.mockReturnValue({
      data: { chats: [], total: 0 },
      loading: false,
      searchString: '',
      handleInputChange: jest.fn(),
      pagination: {
        current: 1,
        pageSize: 50,
        total: 0,
        onChange: jest.fn(),
      },
    });
  });

  it('按今天/昨天分组并展示会话时长', () => {
    mockUseFetchChatList.mockReturnValue({
      data: {
        chats: [
          makeChat({ id: 'today', name: 'Today Task' }),
          makeChat({
            id: 'yesterday',
            name: 'Yesterday Task',
            create_date: dayjs().subtract(1, 'day').subtract(3, 'minute').toISOString(),
            update_date: dayjs().subtract(1, 'day').toISOString(),
          }),
        ],
        total: 2,
      },
      loading: false,
      searchString: '',
      handleInputChange: jest.fn(),
      pagination: {
        current: 1,
        pageSize: 50,
        total: 2,
        onChange: jest.fn(),
      },
    });

    render(<TaskList />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('Today Task')).toBeInTheDocument();
    expect(screen.getByText('Yesterday Task')).toBeInTheDocument();
    expect(screen.getAllByText(/Duration/)).toHaveLength(2);
  });

  it('空态展示', () => {
    render(<TaskList />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
  });
});
