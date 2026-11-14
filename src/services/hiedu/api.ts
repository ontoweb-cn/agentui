// AgentUI 宿主适配层:hiedu 契约/传输/资源方法位于 ./shared(经
// scripts/sync-hiedu-shared.mjs 从 intellect-auth hiedu/web/src/shared 同步,
// manifest.json 锁定一致性,check-hiedu-shared.mjs 门禁)。
// 本文件只做宿主注入:basePath = /api/bff/hiedu(BFF 断言代理,
// bff/src/routes/hiedu.ts 注入 X-Hiedu-Assertion);无租户头。
// 401/会话语义由 shared 派发 UNAUTHORIZED_EVENT,本模块 index 监听后引导重新登录。
// 门户侧对应适配层:intellect-auth hiedu/web/src/api.ts(同源 + X-Backend-Id)。

import { createHieduClient, createResources } from './shared';

export * from './shared';

const client = createHieduClient({
  basePath: '/api/bff/hiedu',
});

export const api = createResources(client);
