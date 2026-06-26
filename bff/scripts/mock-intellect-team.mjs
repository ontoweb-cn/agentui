#!/usr/bin/env node
/**
 * Intellect Enterprise Mock Server(P3+P4b 冒烟测试用)。
 * 模拟 intellect-team 关键端点,验证 BFF IntellectEnterpriseAdapter 端到端集成。
 *
 * 覆盖端点(Constitution Principle VIII):
 * - GET  /health
 * - GET  /v1/models
 * - GET  /v1/capabilities
 * - POST /api/sessions, GET/PATCH/DELETE /api/sessions/{id}
 * - GET  /api/sessions/{id}/messages
 * - POST /api/sessions/{id}/chat/stream (SSE,assistant.delta/tool.progress/run.completed/done)
 *
 * P4b 认证端点(Constitution Principle I + V + VIII):
 * - POST /api/members/register(公开)
 * - POST /api/members/login(公开,返回 member token)
 * - POST /api/members/logout(member token 鉴权)
 * - GET  /api/members/me(member token 鉴权)
 * - POST /api/members/{id}/token(API_SERVER_KEY 鉴权,BFF 内部签发)
 * - GET  /api/oauth/providers(公开)
 * - POST /api/oauth/authorize(公开,返回 redirect_uri)
 * - GET  /api/oauth/callback(公开,返回 member_id)
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = 8642;
const API_SERVER_KEY = 'test-api-server-key-smoke';

const sessions = new Map();
const members = new Map(); // login_name → { member_id, display_name, password, role }
const tokens = new Map();  // token → member_id(已签发的 member token)

// 预置测试用户
members.set('alice', {
  member_id: 'm-alice',
  login_name: 'alice',
  display_name: 'Alice',
  password: 'secret',
  role: 'member',
  email: 'alice@enterprise.com',
});

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendSSE(res, frames) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  let i = 0;
  const timer = setInterval(() => {
    if (i >= frames.length) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(frames[i]);
    i++;
  }, 50);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;
  const auth = req.headers['authorization'];

  // 记录多租户头(Principle V,场景 7 验证)
  const teamHeader = req.headers['x-intellect-team'];
  const projectHeader = req.headers['x-intellect-project'];
  if (teamHeader) {
    console.log(`[mock] X-Intellect-Team=${teamHeader} X-Intellect-Project=${projectHeader || '(none)'}`);
  }

  // -------------------------------------------------------------------------
  // P4b 认证端点(公开,无需鉴权)
  // -------------------------------------------------------------------------

  // POST /api/members/register
  if (method === 'POST' && path === '/api/members/register') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { login_name, password, display_name, email } = JSON.parse(body || '{}');
      if (members.has(login_name)) {
        sendJson(res, 409, { error: 'login_name already in use' });
        return;
      }
      const member = {
        member_id: `m-${randomUUID().slice(0, 8)}`,
        login_name,
        display_name,
        password,
        role: 'member',
        email: email || '',
      };
      members.set(login_name, member);
      sendJson(res, 201, { member_id: member.member_id, registration_pending: 0 });
    });
    return;
  }

  // POST /api/members/login
  if (method === 'POST' && path === '/api/members/login') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { login_name, password } = JSON.parse(body || '{}');
      const member = members.get(login_name);
      if (!member || member.password !== password) {
        sendJson(res, 401, { error: 'invalid credentials' });
        return;
      }
      const token = `imt_${randomUUID().replace(/-/g, '')}`;
      tokens.set(token, member.member_id);
      sendJson(res, 200, {
        member_id: member.member_id,
        display_name: member.display_name,
        role: member.role,
        token,
        permissions: ['chat', 'read'],
      });
    });
    return;
  }

  // POST /api/members/logout(member token 鉴权)
  if (method === 'POST' && path === '/api/members/logout') {
    const token = (auth || '').replace('Bearer ', '');
    if (!tokens.has(token)) {
      sendJson(res, 401, { error: 'invalid token' });
      return;
    }
    tokens.delete(token);
    sendJson(res, 200, { ok: true });
    return;
  }

  // GET /api/members/me(member token 鉴权)
  if (method === 'GET' && path === '/api/members/me') {
    const token = (auth || '').replace('Bearer ', '');
    const memberId = tokens.get(token);
    if (!memberId) {
      sendJson(res, 401, { error: 'invalid token' });
      return;
    }
    const member = Array.from(members.values()).find((m) => m.member_id === memberId);
    if (!member) {
      sendJson(res, 404, { error: 'member not found' });
      return;
    }
    sendJson(res, 200, {
      member_id: member.member_id,
      display_name: member.display_name,
      role: member.role,
      email: member.email,
    });
    return;
  }

  // POST /api/members/{id}/token(API_SERVER_KEY 鉴权,BFF 内部签发)
  const tokenIssueMatch = path.match(/^\/api\/members\/([^/]+)\/token$/);
  if (method === 'POST' && tokenIssueMatch) {
    if (auth !== `Bearer ${API_SERVER_KEY}`) {
      sendJson(res, 403, { error: 'invalid API_SERVER_KEY' });
      return;
    }
    const memberId = tokenIssueMatch[1];
    const member = Array.from(members.values()).find((m) => m.member_id === memberId);
    if (!member) {
      sendJson(res, 404, { error: 'member not found' });
      return;
    }
    const newToken = `imt_${randomUUID().replace(/-/g, '')}`;
    tokens.set(newToken, memberId);
    sendJson(res, 201, { token_id: `tk-${randomUUID().slice(0, 8)}`, token: newToken });
    return;
  }

  // GET /api/oauth/providers(公开)
  if (method === 'GET' && path === '/api/oauth/providers') {
    sendJson(res, 200, [
      {
        id: 'github',
        name: 'GitHub',
        usage: 'login,bind',
        auth_flow: 'oauth2',
        enabled: true,
        logo_svg: '<svg>gh</svg>',
        is_builtin: true,
        display_order: 1,
      },
      {
        id: 'google',
        name: 'Google',
        usage: 'login',
        auth_flow: 'oauth2',
        enabled: true,
        logo_svg: '',
        is_builtin: true,
        display_order: 2,
      },
    ]);
    return;
  }

  // POST /api/oauth/authorize(公开)
  if (method === 'POST' && path === '/api/oauth/authorize') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { provider_id, usage } = JSON.parse(body || '{}');
      const state = randomUUID().slice(0, 8);
      const redirect_uri = `https://oauth.example.com/${provider_id}/authorize?client_id=mock&state=${state}&redirect_uri=http://localhost:3000/api/bff/auth/oauth/callback`;
      sendJson(res, 200, { redirect_uri, state });
    });
    return;
  }

  // GET /api/oauth/callback(公开)
  if (method === 'GET' && path === '/api/oauth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      sendJson(res, 400, { error: 'missing code or state' });
      return;
    }
    // 模拟 OAuth 回调:返回预置 alice 的 member_id(或新建)
    sendJson(res, 200, {
      ok: true,
      provider_id: 'github',
      member_id: 'm-alice',
      claims: { sub: 'gh:12345' },
    });
    return;
  }

  // -------------------------------------------------------------------------
  // 以下端点需要 API_SERVER_KEY 鉴权(Principle VIII)
  // -------------------------------------------------------------------------
  if (auth !== `Bearer ${API_SERVER_KEY}`) {
    sendJson(res, 401, { message: 'invalid API_SERVER_KEY' });
    return;
  }

  // GET /health
  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // GET /v1/models
  if (method === 'GET' && path === '/v1/models') {
    sendJson(res, 200, {
      data: [
        { id: 'coder-agent', name: 'Coder Agent', description: '编码助手' },
        { id: 'analyst-agent', name: 'Analyst', description: '分析助手' },
      ],
    });
    return;
  }

  // GET /v1/capabilities
  if (method === 'GET' && path === '/v1/capabilities') {
    sendJson(res, 200, {
      canvas: false,
      knowledgeBase: false,
      memory: true,
      mcp: true,
      multiTenant: true,
      modelManagement: false,
    });
    return;
  }

  // POST /api/sessions
  if (method === 'POST' && path === '/api/sessions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      const id = `sess-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const session = {
        id,
        title: parsed.title || null,
        created_at: now,
        updated_at: now,
      };
      sessions.set(id, session);
      sendJson(res, 200, session);
    });
    return;
  }

  // GET /api/sessions (list)
  if (method === 'GET' && path === '/api/sessions') {
    sendJson(res, 200, { data: Array.from(sessions.values()) });
    return;
  }

  // /api/sessions/{id} ...
  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(.*)$/);
  if (sessionMatch) {
    const [, sid, rest] = sessionMatch;

    // GET /api/sessions/{id}
    if (method === 'GET' && rest === '') {
      if (!sessions.has(sid)) {
        sendJson(res, 404, { message: 'session not found' });
        return;
      }
      sendJson(res, 200, sessions.get(sid));
      return;
    }

    // DELETE /api/sessions/{id}
    if (method === 'DELETE' && rest === '') {
      if (!sessions.has(sid)) {
        sendJson(res, 404, { message: 'session not found' });
        return;
      }
      sessions.delete(sid);
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /api/sessions/{id}/messages
    if (method === 'GET' && rest === '/messages') {
      if (!sessions.has(sid)) {
        sendJson(res, 404, { message: 'session not found' });
        return;
      }
      sendJson(res, 200, { data: [] });
      return;
    }

    // POST /api/sessions/{id}/chat/stream (SSE 主通道)
    if (method === 'POST' && rest === '/chat/stream') {
      if (!sessions.has(sid)) {
        sendJson(res, 404, { message: 'session not found' });
        return;
      }
      const sseFrames = [
        'event: run.started\ndata: {"user_message":{"role":"user","content":"hi"}}\n\n',
        'event: message.started\ndata: {"message":{"id":"msg-1","role":"assistant"}}\n\n',
        'event: tool.progress\ndata: {"message_id":"msg-1","tool_name":"_thinking","delta":"正在思考"}\n\n',
        'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"你好"}\n\n',
        'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"!"}\n\n',
        'event: run.completed\ndata: {"session_id":"' + sid + '","message_id":"msg-1","completed":true,"messages":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'event: done\ndata: {}\n\n',
      ];
      sendSSE(res, sseFrames);
      return;
    }
  }

  sendJson(res, 404, { message: `not found: ${method} ${path}` });
});

server.listen(PORT, () => {
  console.log(`[mock] intellect-team mock server listening on :${PORT}`);
  console.log(`[mock] API_SERVER_KEY=${API_SERVER_KEY}`);
});
