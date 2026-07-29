// Multi-Harness P2 (US3):harness-admin-service 单元测试。
// Constitution Principle V (Token Security) + I (BFF-Mediated)。
// 验证 CRUD API 调用路径、请求体、响应解析,Mock request 层,不发真实网络请求。

import request from '@/utils/next-request';
import api from '@/utils/api';
import {
  createHarnessBackend,
  deleteHarnessBackend,
  fetchHarnessCapabilities,
  getProtocolFamily,
  listHarnessBackends,
  switchHarnessBackend,
  updateHarnessBackend,
} from './harness-admin-service';

// 本地定义表单类型,避免跨模块 type-only import 触发 esbuild-jest 限制。
type HarnessBackendForm = {
  id: string;
  name: string;
  type: 'intellect-rag' | 'intellect-enterprise';
  endpoint: string;
  adminTokenEnvVar: string;
  capabilities: {
    canvas: boolean;
    knowledgeBase: boolean;
    memory: boolean;
    mcp: boolean;
    multiTenant: boolean;
    modelManagement: boolean;
  };
  defaultForTenant?: boolean;
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// 工厂 mock:返回 axios-like 对象,避免加载真实 next-request(其依赖链含
// import.meta.glob,Jest jsdom 环境不可用)。工厂内创建 jest.fn,测试中通过
// imported `request` 直接访问(mock 后 default 即此对象)。
jest.mock('@/utils/next-request', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('@/utils/api', () => ({
  __esModule: true,
  default: {
    listHarnessBackends: '/api/bff/admin/harness-backends',
    createHarnessBackend: '/api/bff/admin/harness-backends',
    updateHarnessBackend: (id: string) => `/api/bff/admin/harness-backends/${id}`,
    deleteHarnessBackend: (id: string) => `/api/bff/admin/harness-backends/${id}`,
    switchHarnessBackend: (id: string) => `/api/bff/admin/harness-backends/${id}/switch`,
    harnessCapabilities: '/api/bff/capabilities',
  },
}));

// request 已被 mock,default 即工厂返回的对象。
const mockedRequest = request as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const sampleForm: HarnessBackendForm = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG Default',
  type: 'intellect-rag',
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: {
    canvas: true,
    knowledgeBase: true,
    memory: true,
    mcp: false,
    multiTenant: false,
    modelManagement: false,
  },
  defaultForTenant: true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listHarnessBackends
// ---------------------------------------------------------------------------

describe('listHarnessBackends', () => {
  it('GET 正确路径并解析响应', async () => {
    const payload = {
      code: 0,
      message: 'ok',
      data: [
        {
          ...sampleForm,
          ready: true,
        },
      ],
    };
    mockedRequest.get.mockResolvedValueOnce({ data: payload });

    const res = await listHarnessBackends();

    expect(mockedRequest.get).toHaveBeenCalledWith(
      api.listHarnessBackends,
    );
    expect(mockedRequest.get).toHaveBeenCalledTimes(1);
    expect(res?.data).toEqual(payload);
    expect(res?.data?.data[0].ready).toBe(true);
  });

  it('空列表响应正常解析', async () => {
    mockedRequest.get.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: [] },
    });
    const res = await listHarnessBackends();
    expect(res?.data?.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createHarnessBackend
// ---------------------------------------------------------------------------

describe('createHarnessBackend', () => {
  it('POST 正确路径 + 请求体', async () => {
    const created = { ...sampleForm, ready: true };
    mockedRequest.post.mockResolvedValueOnce({
      data: { code: 0, message: 'created', data: created },
    });

    const res = await createHarnessBackend(sampleForm);

    expect(mockedRequest.post).toHaveBeenCalledWith(
      api.createHarnessBackend,
      sampleForm,
    );
    expect(mockedRequest.post).toHaveBeenCalledTimes(1);
    expect(res?.data?.data).toEqual(created);
  });

  it('请求体包含 adminTokenEnvVar(非明文 token)', async () => {
    mockedRequest.post.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: { ...sampleForm, ready: true } },
    });
    await createHarnessBackend(sampleForm);
    const [, body] = mockedRequest.post.mock.calls[0] as [
      string,
      HarnessBackendForm,
    ];
    // Token Security:只传 env var 名,不传明文 token
    expect(body).toHaveProperty('adminTokenEnvVar');
    expect(body).not.toHaveProperty('adminToken');
    expect(body.adminTokenEnvVar).toBe('HARNESS_INTELLECT_RAG_ADMIN_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// updateHarnessBackend
// ---------------------------------------------------------------------------

describe('updateHarnessBackend', () => {
  it('PUT 正确路径(id 在 URL,不在 body)', async () => {
    const updated = { ...sampleForm, name: 'Updated', ready: true };
    mockedRequest.put.mockResolvedValueOnce({
      data: { code: 0, message: 'updated', data: updated },
    });

    const { id: _omitId, ...rest } = sampleForm;
    void _omitId;
    const res = await updateHarnessBackend(sampleForm.id, rest);

    expect(mockedRequest.put).toHaveBeenCalledWith(
      api.updateHarnessBackend(sampleForm.id),
      rest,
    );
    expect(mockedRequest.put).toHaveBeenCalledTimes(1);
    expect(res?.data?.data.name).toBe('Updated');
  });
});

// ---------------------------------------------------------------------------
// deleteHarnessBackend
// ---------------------------------------------------------------------------

describe('deleteHarnessBackend', () => {
  it('DELETE 正确路径', async () => {
    mockedRequest.delete.mockResolvedValueOnce({
      data: { code: 0, message: 'deleted', data: null },
    });

    const res = await deleteHarnessBackend(sampleForm.id);

    expect(mockedRequest.delete).toHaveBeenCalledWith(
      api.deleteHarnessBackend(sampleForm.id),
    );
    expect(mockedRequest.delete).toHaveBeenCalledTimes(1);
    expect(res?.data?.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchHarnessCapabilities (US2)
// ---------------------------------------------------------------------------

describe('fetchHarnessCapabilities', () => {
  it('GET capabilities 路径 + 携带 tenant/user header', async () => {
    const caps = {
      code: 0,
      message: 'ok',
      data: {
        backendId: 'intellect-rag-default',
        backendName: 'Intellect RAG Default',
        backendType: 'intellect-rag',
        capabilities: {
          canvas: true,
          knowledgeBase: true,
          memory: true,
          mcp: false,
          multiTenant: false,
          modelManagement: false,
        },
      },
    };
    mockedRequest.get.mockResolvedValueOnce({ data: caps });

    const headers = {
      'X-Backend-Id': 'tenant-1',
      'X-User-Id': 'user-1',
    };
    const res = await fetchHarnessCapabilities(headers);

    expect(mockedRequest.get).toHaveBeenCalledWith(api.harnessCapabilities, {
      headers,
    });
    expect(mockedRequest.get).toHaveBeenCalledTimes(1);
    expect(res?.data?.data.backendType).toBe('intellect-rag');
  });

  it('缺失 header 时仍按调用方传入值发送(由 BFF 返回 400)', async () => {
    mockedRequest.get.mockResolvedValueOnce({
      data: { code: 400, message: 'Missing header', data: null },
    });
    // 调用方未传 header(空对象)— service 不做校验,透传
    await fetchHarnessCapabilities({} as never);
    const [, config] = mockedRequest.get.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(config).toEqual({ headers: {} });
  });
});

// ---------------------------------------------------------------------------
// switchHarnessBackend (spec-010 v8 B-8 D2 软阻断)
// ---------------------------------------------------------------------------

describe('switchHarnessBackend', () => {
  it('POST 正确路径 + 请求体(tenantId + role=primary)', async () => {
    mockedRequest.post.mockResolvedValueOnce({
      data: { code: 0, message: '切换成功', data: null },
    });

    const res = await switchHarnessBackend(
      'intellect-rag-default',
      'tenant-1',
      'primary',
    );

    expect(mockedRequest.post).toHaveBeenCalledWith(
      api.switchHarnessBackend('intellect-rag-default'),
      { tenantId: 'tenant-1', role: 'primary' },
    );
    expect(mockedRequest.post).toHaveBeenCalledTimes(1);
    expect(res?.data?.code).toBe(0);
  });

  it('role=canvas 时请求体正确(canvasBackendId 切换)', async () => {
    mockedRequest.post.mockResolvedValueOnce({
      data: { code: 0, message: '切换成功', data: null },
    });

    await switchHarnessBackend('intellect-rag-default', 'tenant-1', 'canvas');

    const [url, body] = mockedRequest.post.mock.calls[0] as [
      string,
      { tenantId: string; role: string },
    ];
    expect(url).toBe(api.switchHarnessBackend('intellect-rag-default'));
    expect(body).toEqual({ tenantId: 'tenant-1', role: 'canvas' });
  });

  it('后端返回 409(活跃 run 软阻断)时透传错误码', async () => {
    mockedRequest.post.mockResolvedValueOnce({
      data: {
        code: 409,
        message: '租户有 2 个活跃 run,请等待完成或强制取消后再切换 backend',
        data: null,
      },
    });

    const res = await switchHarnessBackend(
      'intellect-rag-default',
      'tenant-1',
      'primary',
    );

    expect(res?.data?.code).toBe(409);
    expect(res?.data?.message).toContain('活跃 run');
  });
});

// ---------------------------------------------------------------------------
// getProtocolFamily (spec-010 v8 D-1 协议族展示列)
// ---------------------------------------------------------------------------

describe('getProtocolFamily', () => {
  it('intellect-rag → canvas-workflow', () => {
    expect(getProtocolFamily('intellect-rag')).toBe('canvas-workflow');
  });

  it('intellect-enterprise → intellect-enterprise', () => {
    expect(getProtocolFamily('intellect-enterprise')).toBe('intellect-enterprise');
  });

  it('OpenAI 兼容后端 → openai-compatible', () => {
    expect(getProtocolFamily('intellect-community')).toBe('openai-compatible');
    expect(getProtocolFamily('hermes')).toBe('openai-compatible');
    expect(getProtocolFamily('kag')).toBe('openai-compatible');
    expect(getProtocolFamily('agent-scope')).toBe('openai-compatible');
  });

  it('intellect-llm (legacy) → openai-compatible', () => {
    expect(getProtocolFamily('intellect-llm')).toBe('openai-compatible');
  });
});
