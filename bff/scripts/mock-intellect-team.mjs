#!/usr/bin/env node
/**
 * Intellect Enterprise Mock Server(P3 冒烟测试用)。
 * 模拟 intellect-team 关键端点,验证 BFF IntellectEnterpriseAdapter 端到端集成。
 *
 * 覆盖端点(Constitution Principle VIII):
 * - GET  /health
 * - GET  /v1/models
 * - GET  /v1/capabilities
 * - POST /api/sessions, GET/PATCH/DELETE /api/sessions/{id}
 * - GET  /api/sessions/{id}/messages
 * - POST /api/sessions/{id}/chat/stream (SSE,assistant.delta/tool.progress/run.completed/done)
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = 8642;
const API_SERVER_KEY = 'test-api-server-key-smoke';

const sessions = new Map();

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
  // 鉴权校验(Principle VIII)
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${API_SERVER_KEY}`) {
    sendJson(res, 401, { message: 'invalid API_SERVER_KEY' });
    return;
  }

  // 记录多租户头(Principle V,场景 7 验证)
  const teamHeader = req.headers['x-intellect-team'];
  const projectHeader = req.headers['x-intellect-project'];
  if (teamHeader) {
    console.log(`[mock] X-Intellect-Team=${teamHeader} X-Intellect-Project=${projectHeader || '(none)'}`);
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

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
