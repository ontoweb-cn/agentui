import type { Meta, StoryObj } from '@storybook/react-webpack5';

import { fn } from 'storybook/test';

import { IntellectPagination } from '@/components/ui/intellect-pagination';

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: 'Example/IntellectPagination',
  component: IntellectPagination,
  parameters: {
    // Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
    layout: 'centered',
    docs: {
      description: {
        component: `
## Component Description

IntellectPagination is a pagination component that helps navigate through large datasets by dividing them into pages. It provides intuitive controls for users to move between pages, adjust page size, and view their current position within the dataset.`,
      },
    },
  },
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ['autodocs'],
  // More on argTypes: https://storybook.js.org/docs/api/argtypes
  argTypes: {
    current: { control: 'number' },
    pageSize: { control: 'number' },
    total: { control: 'number' },
  },
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onChange: fn() },
} satisfies Meta<typeof IntellectPagination>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const WithLoading: Story = {
  args: {
    current: 1,
    pageSize: 10,
    total: 100,
    showSizeChanger: true,
  },
  parameters: {
    docs: {
      description: {
        story: `
### Usage Examples

\`\`\`tsx
import { IntellectPagination } from '@/components/ui/intellect-pagination';

  <IntellectPagination
    {...pick(pagination, 'current', 'pageSize')}
    total={pagination.total}
    onChange={(page, pageSize) => {
      setPagination({ page, pageSize });
    }}>
  </IntellectPagination>
\`\`\`
        `,
      },
    },
  },
  tags: ['!dev'],
};
