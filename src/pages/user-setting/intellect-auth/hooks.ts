import { useOutletContext } from 'react-router';

import type { Me } from '@/services/hiedu/api';

/** 读取统一认证布局注入的 /api/me 结果。 */
export function useMe(): Me {
  return useOutletContext<Me>();
}
