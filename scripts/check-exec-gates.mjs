#!/usr/bin/env node
/**
 * 执行三连闸门探测(只读):T4.2 secrets / D1 kubectl / Phase B Go SSE。
 * exit 0 = 全部可开;exit 1 = 任一未开(打印 L-*)。
 *
 * 用法: node scripts/check-exec-gates.mjs
 * 可选环境: GATEWAY_BASE_URL, GATEWAY_SESSION_ID, GATEWAY_AUTHORIZATION
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const intellectTeam = resolve(root, '../intellect-team');
const intellectRag = resolve(root, '../intellect-rag');

const results = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'OPEN ' : 'BLOCK'} ${id}: ${detail}`);
}

// --- L-T42-01: Gateway web_search_secrets ---
const gwSrc = resolve(intellectTeam, 'intellect-gateway');
let secretsInTree = false;
if (existsSync(gwSrc)) {
  const rg = spawnSync(
    'rg',
    ['-l', 'web_search_secret|web-search-secrets', gwSrc, '-g', '*.rs'],
    { encoding: 'utf8' },
  );
  secretsInTree = (rg.stdout || '').trim().length > 0;
}
record(
  'L-T42-01',
  secretsInTree,
  secretsInTree
    ? 'Gateway tree mentions web_search_secrets'
    : 'Gateway 无 web_search_secrets 实现(契约见 docs/web-search-secrets-gateway-api-contract.md)',
);

const base = process.env.GATEWAY_BASE_URL;
const sid = process.env.GATEWAY_SESSION_ID || 'probe-session';
const auth = process.env.GATEWAY_AUTHORIZATION;
if (base && auth && typeof fetch === 'function') {
  const url = `${base.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(sid)}/web-search-secrets`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: auth },
    });
    record(
      'L-T42-01-HTTP',
      res.ok,
      res.ok
        ? `GET secrets ${res.status}`
        : `GET secrets → ${res.status} (404=未合入)`,
    );
  } catch (err) {
    record('L-T42-01-HTTP', false, `probe failed: ${err.message}`);
  }
} else {
  console.log(
    'SKIP L-T42-01-HTTP: set GATEWAY_BASE_URL + GATEWAY_AUTHORIZATION to live-probe',
  );
}

// --- L-09: kubectl ---
const kubectl = spawnSync('which', ['kubectl'], { encoding: 'utf8' });
const hasKubectl = kubectl.status === 0 && (kubectl.stdout || '').trim();
record(
  'L-09',
  Boolean(hasKubectl),
  hasKubectl
    ? `kubectl at ${kubectl.stdout.trim()}`
    : 'kubectl not found — D1 不可执行',
);

// --- L-PHASEB-01: Go canvas SSE ---
const canvasDir = resolve(intellectRag, 'internal/agent/canvas');
const hasCanvas = existsSync(canvasDir);
let hasWaiting = false;
if (hasCanvas) {
  const rg = spawnSync(
    'rg',
    ['-l', 'waiting_for_user', canvasDir, '-g', '*.go'],
    { encoding: 'utf8' },
  );
  hasWaiting = (rg.stdout || '').trim().length > 0;
}
record(
  'L-PHASEB-01',
  hasCanvas && hasWaiting,
  hasCanvas && hasWaiting
    ? 'Go canvas emits waiting_for_user'
    : 'Go canvas SSE 未稳定(无 internal/agent/canvas 或无 waiting_for_user)',
);

const blocked = results.filter((r) => !r.ok);
console.log('');
if (blocked.length === 0) {
  console.log('All gates OPEN — proceed t42-m1-wire / prod-d1-exec / phase-b live.');
  process.exit(0);
}
console.log(
  `Blocked ${blocked.length}/${results.length}: ${blocked.map((b) => b.id).join(', ')}`,
);
console.log(
  'Do NOT wire sanitizePromptConfigWebSearchKeys or live SSE adapters until gates open.',
);
process.exit(1);
