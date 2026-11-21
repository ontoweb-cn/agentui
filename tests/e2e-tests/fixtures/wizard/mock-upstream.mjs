// 夹具:mock-upstream — 向导探测/SSO 渠道拉取的本地替身(spec-010 probe 契约)。
// 用法:node tests/e2e-tests/fixtures/wizard/mock-upstream.mjs  (端口 9399,Ctrl+C 停止)
// 端点:
//   GET /v1/models                    → 200 OpenAI 兼容列表(community/hermes/agent-scope probe)
//   GET /api/tenant/info              → 200 { tenant_id } 32 位 hex(enterprise probe)
//   GET /api/members/oauth/providers  → 200 渠道数组(含 misconfigured/disabled 样本)
import { createServer } from 'node:http';

const TENANT_ID = 'e2e00000000000000000000000000001'; // 32 位 hex

const PROVIDERS = [
  {
    id: 'intellect-auth',
    name: '统一认证',
    usage: 'login',
    enabled: true,
    logo_svg: '',
    pkce: 'S256',
    client_id: 'e2e-client-id',
    authorize_url: 'http://localhost:9399/authorize',
    scopes: 'openid profile email',
  },
  { id: 'broken-provider', name: '坏渠道', usage: 'login', enabled: true }, // 缺 client_id/authorize_url → misconfigured
  { id: 'disabled-provider', name: '停用渠道', usage: 'login', enabled: false },
  { id: 'other-usage', name: '非登录用途', usage: 'sync', enabled: true, client_id: 'x', authorize_url: 'http://localhost:9399/authorize' },
];

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return json(res, 404, { error: 'not found' });
  switch (url.pathname.replace(/\/+$/, '')) {
    case '/v1/models':
      return json(res, 200, { object: 'list', data: [{ id: 'e2e-mock-model', object: 'model' }] });
    case '/api/tenant/info':
      return json(res, 200, { tenant_id: TENANT_ID });
    case '/api/members/oauth/providers':
      return json(res, 200, PROVIDERS);
    default:
      return json(res, 404, { error: 'not found' });
  }
}).listen(9399, () => console.log('[mock-upstream] listening on http://localhost:9399'));
