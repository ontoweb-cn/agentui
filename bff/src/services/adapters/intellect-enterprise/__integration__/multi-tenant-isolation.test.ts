/**
 * E2E Multi-Tenant Isolation Test — verifies the full header-propagation chain:
 *
 *   Request context → IntellectEnterpriseHttpClient.buildHeaders() →
 *   X-Intellect-Team / X-Intellect-Project / X-Intellect-User
 *
 * Uses the real IntellectEnterpriseHttpClient with a mock fetch that records
 * received headers.  Makes actual HTTP calls with different team/project
 * BackendContexts and verifies the mock Gateway sees the correct identity
 * headers on every request.
 *
 * Task: Phase 6.3 — BFF → Rust Gateway → Agent → IntellectRAGProvider
 *       in team/project dimension.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntellectEnterpriseHttpClient } from '../http-client';
import type { BackendContext } from '../../../../types/tenant';

// ── Shared test contexts ───────────────────────────────────────────────

const CTX_TEAM_A: BackendContext = {
  backendId: 'tenant-001',
  userId: 'user-001',
  intellectTenantId: 'tenant-001',
  intellectUserId: 'mem_alice',
  intellectTeamId: 'team-eng',
  intellectProjectId: 'proj-backend',
};

const CTX_TEAM_B: BackendContext = {
  backendId: 'tenant-002',
  userId: 'user-002',
  intellectTenantId: 'tenant-002',
  intellectUserId: 'mem_bob',
  intellectTeamId: 'team-ops',
  intellectProjectId: 'proj-frontend',
};

const CTX_MINIMAL: BackendContext = {
  backendId: 'tenant-default',
  userId: 'user-default',
  intellectTenantId: 'tenant-default',
};

// ── Helper: create a mock fetch that records headers ───────────────────

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function makeRecordingFetch(records: RecordedRequest[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    // tenant-info endpoint: echo back the tenant_id parsed from URL
    if (typeof url === 'string' && url.includes('/api/tenant/info')) {
      const m = url.match(/tenant-([^./]+)/);
      const tenantId = m ? `tenant-${m[1]}` : 'tenant-default';
      return new Response(JSON.stringify({ tenant_id: tenantId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Record all headers from this request
    const reqHeaders: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { reqHeaders[k] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) reqHeaders[k] = v;
      } else {
        Object.assign(reqHeaders, init.headers);
      }
    }

    records.push({
      url,
      method: init?.method ?? 'GET',
      headers: reqHeaders,
      body: init?.body as string | undefined,
    });

    return new Response(JSON.stringify({ code: 0, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('E2E — Multi-Tenant Header Propagation via IntellectEnterpriseHttpClient', () => {
  let records: RecordedRequest[] = [];
  let clientA: IntellectEnterpriseHttpClient;
  let clientB: IntellectEnterpriseHttpClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    records = [];
    fetchMock = makeRecordingFetch(records);
    vi.stubGlobal('fetch', fetchMock);
    clientA = new IntellectEnterpriseHttpClient('http://tenant-001.local:8642', 'sk-test');
    clientB = new IntellectEnterpriseHttpClient('http://tenant-002.local:8642', 'sk-test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Get the last non-tenant-info request's headers */
  function lastReq(): RecordedRequest {
    const appReqs = records.filter(r => !r.url.includes('/api/tenant/info'));
    if (appReqs.length === 0) throw new Error('No application request recorded');
    return appReqs[appReqs.length - 1];
  }

  function allAppReqs(): RecordedRequest[] {
    return records.filter(r => !r.url.includes('/api/tenant/info'));
  }

  it('forwards X-Intellect-Team, Project, User on POST request', async () => {
    await clientA.request('POST', '/api/sessions', CTX_TEAM_A, { title: 'Test' });

    const req = lastReq();
    expect(req.headers['X-Intellect-Team']).toBe('team-eng');
    expect(req.headers['X-Intellect-Project']).toBe('proj-backend');
    expect(req.headers['X-Intellect-User']).toBe('mem_alice');
    expect(req.headers['Authorization']).toBe('Bearer sk-test');
    expect(req.headers['Content-Type']).toBe('application/json');
  });

  it('forwards different headers for different teams', async () => {
    await clientA.request('POST', '/api/sessions', CTX_TEAM_A, { title: 'A' });
    await clientB.request('POST', '/api/sessions', CTX_TEAM_B, { title: 'B' });

    const reqs = allAppReqs();
    expect(reqs.length).toBe(2);
    expect(reqs[0].headers['X-Intellect-Team']).toBe('team-eng');
    expect(reqs[1].headers['X-Intellect-Team']).toBe('team-ops');
    expect(reqs[0].headers['X-Intellect-Team']).not.toBe(reqs[1].headers['X-Intellect-Team']);
  });

  it('omits team/project/user headers for minimal context', async () => {
    const clientDefault = new IntellectEnterpriseHttpClient('http://tenant-default.local:8642', 'sk-test');
    await clientDefault.request('POST', '/api/sessions', CTX_MINIMAL, { title: 'Default' });

    const req = lastReq();
    expect(req.headers['X-Intellect-Team']).toBeUndefined();
    expect(req.headers['X-Intellect-Project']).toBeUndefined();
    expect(req.headers['X-Intellect-User']).toBeUndefined();
    expect(req.headers['Authorization']).toBe('Bearer sk-test');
  });

  it('sends correct headers on GET request', async () => {
    await clientA.request('GET', '/api/sessions', CTX_TEAM_A);

    const req = lastReq();
    expect(req.method).toBe('GET');
    expect(req.headers['X-Intellect-Team']).toBe('team-eng');
    expect(req.headers['X-Intellect-Project']).toBe('proj-backend');
  });

  it('cross-tenant isolation: Team A cannot see Team B headers', async () => {
    // Team A posts
    await clientA.request('POST', '/api/sessions', CTX_TEAM_A, { title: 'A-secret' });
    // Team B posts
    await clientB.request('POST', '/api/sessions', CTX_TEAM_B, { title: 'B-secret' });

    const reqs = allAppReqs();
    expect(reqs[0].headers['X-Intellect-Team']).toBe('team-eng');
    expect(reqs[1].headers['X-Intellect-Team']).toBe('team-ops');
    // Isolation: headers must differ
    expect(reqs[0].headers['X-Intellect-Team']).not.toBe(reqs[1].headers['X-Intellect-Team']);
    expect(reqs[0].headers['X-Intellect-Project']).toBe('proj-backend');
    expect(reqs[1].headers['X-Intellect-Project']).toBe('proj-frontend');
  });

  it('session-id and session-key forwarded when present', async () => {
    const ctxWithSession: BackendContext = {
      ...CTX_TEAM_A,
      intellectSessionId: 'sess-abc-123',
      intellectSessionKey: 'key-xyz-456',
    };
    await clientA.request('POST', '/v1/chat/completions', ctxWithSession, { message: 'hello' });

    const req = lastReq();
    expect(req.headers['X-Intellect-Session-Id']).toBe('sess-abc-123');
    expect(req.headers['X-Intellect-Session-Key']).toBe('key-xyz-456');
  });

  it('all five identity headers present simultaneously for full context', async () => {
    const fullCtx: BackendContext = {
      backendId: 'tenant-full',
      userId: 'user-full',
      intellectTenantId: 'tenant-full',
      intellectUserId: 'mem_full',
      intellectTeamId: 'team-full',
      intellectProjectId: 'proj-full',
      intellectSessionId: 'sess-full',
      intellectSessionKey: 'key-full',
    };
    // Use a client that points to tenant-full to pass ensureTenantValid
    const clientFull = new IntellectEnterpriseHttpClient('http://tenant-full.local:8642', 'sk-full');
    await clientFull.request('POST', '/v1/rag/retrieval', fullCtx, { query: 'test' });

    const req = lastReq();
    expect(req.headers['X-Intellect-User']).toBe('mem_full');
    expect(req.headers['X-Intellect-Team']).toBe('team-full');
    expect(req.headers['X-Intellect-Project']).toBe('proj-full');
    expect(req.headers['X-Intellect-Session-Id']).toBe('sess-full');
    expect(req.headers['X-Intellect-Session-Key']).toBe('key-full');
    expect(req.headers['Authorization']).toBe('Bearer sk-full');
  });
});
