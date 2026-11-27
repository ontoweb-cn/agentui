// Resume route + dialect tests (p0p2-closeout B5 / plan §4.3).
//
// The BFF speaks two resume dialects:
//   - python (rag-python): re-POST chat/completions with the same session_id
//   - go (dsl-service):    carry resume_from + __resume_interrupt_id__ + __resume_data__

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { canvasRoutes } from './canvas';
import { CanvasService } from '../services/canvas-service';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { ICanvasAdapter } from '../types/adapter';
import { CanvasBackendNotBoundError } from '../services/adapter-registry-errors';

const ctx = { backendId: 'tenant-001', userId: 'user-001' };

function createApp() {
  const mockProxy = vi.fn().mockResolvedValue(
    new Response('data:[DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  );
  const mockAdapter = {
    backendId: 'intellect-rag-default',
    adapterKind: 'canvas' as const,
    listCanvas: vi.fn(),
    getCanvas: vi.fn(),
    createCanvas: vi.fn(),
    saveCanvas: vi.fn(),
    deleteCanvas: vi.fn(),
    resetCanvas: vi.fn(),
    request: vi.fn(),
    proxy: mockProxy,
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    healthCheck: vi.fn(),
    discoverCapabilities: vi.fn(),
  } as unknown as ICanvasAdapter;
  const registry = {
    getCanvasBackendForBackend: vi.fn().mockReturnValue(mockAdapter),
  } as unknown as IAdapterRegistry;

  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', async (c: any, next: any) => {
    c.set('canvasService', new CanvasService(registry));
    c.set('backendContext', ctx);
    await next();
  });
  app.route('/', canvasRoutes);
  return { app, mockProxy, registry };
}

/** Decode the body the adapter was asked to send (it is a ReadableStream). */
async function sentBody(mockProxy: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  const call = mockProxy.mock.calls[0];
  const req = call[2] as { body: ReadableStream<Uint8Array> };
  return JSON.parse(await new Response(req.body).text());
}

describe('POST /canvas/:id/resume', () => {
  it('speaks the python dialect by default (re-POST chat/completions)', async () => {
    const { app, mockProxy } = createApp();
    const res = await app.request('/canvas/e2e-pc-1/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-1', form: { jd: 'engineer' } }),
    });
    expect(res.status).toBe(200);
    expect(mockProxy).toHaveBeenCalledTimes(1);
    const [method, path] = mockProxy.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/agents/chat/completions');
    const body = await sentBody(mockProxy);
    expect(body.session_id).toBe('sess-1');
    expect(body.jd).toBe('engineer');
    // No go-only sentinels on the python path.
    expect(body.resume_from).toBeUndefined();
    expect(body.__resume_interrupt_id__).toBeUndefined();
  });

  it('speaks the go dialect when the caller asks for it', async () => {
    const { app, mockProxy } = createApp();
    const res = await app.request('/canvas/e2e-pc-1/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'sess-1',
        engine: 'go',
        form: { interrupt_id: 'fillup-1', inputs: { jd: 'engineer' } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await sentBody(mockProxy);
    expect(body.resume_from).toBe('sess-1');
    expect(body.__resume_interrupt_id__).toBe('fillup-1');
    expect(body.__resume_data__).toEqual({ jd: 'engineer' });
  });

  it('rejects a request without session_id', async () => {
    const { app, mockProxy } = createApp();
    const res = await app.request('/canvas/e2e-pc-1/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form: { jd: 'engineer' } }),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { message: string };
    expect(payload.message).toContain('session_id');
    expect(mockProxy).not.toHaveBeenCalled();
  });

  it('maps an unbound canvas backend to 503', async () => {
    const { app, registry } = createApp();
    (registry.getCanvasBackendForBackend as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new CanvasBackendNotBoundError('tenant-001');
    });
    const res = await app.request('/canvas/e2e-pc-1/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-1', form: {} }),
    });
    expect(res.status).toBe(503);
  });
});
