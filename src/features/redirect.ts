import { redirect } from 'react-router';

/**
 * 列表页并入 hub 后的旧路由重定向 loader:跳转目标为编译期常量,
 * 仅透传原 query(如 ?isCreate=true 打开创建弹窗)。
 * 注意:hash 不保留(列表页无 hash 用例)。
 */
export const redirectPreservingSearch =
  (target: string) =>
  ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    return redirect(`${target}${url.search}`);
  };
