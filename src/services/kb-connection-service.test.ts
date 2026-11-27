import { BackendId } from '@/constants/authorization';
import api from '@/utils/api';
import request from '@/utils/next-request';
import {
  getKbConnection,
  saveKbConnection,
  testKbConnection,
} from './kb-connection-service';

jest.mock('@/utils/next-request', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

jest.mock('@/utils/api', () => ({
  __esModule: true,
  default: {
    kbConnection: '/api/bff/settings/kb-connection',
    kbConnectionTest: '/api/bff/settings/kb-connection/test',
  },
}));

const mockedRequest = request as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
};

const sampleConnection = {
  configured: true,
  endpoint: 'https://kb.example.com',
  tokenConfigured: true,
  revision: 7,
  version: '1.2.3',
  versionError: null,
};

const expectedConfig = (backendId: string) => ({
  headers: { 'X-Backend-Id': backendId },
  skipErrorNotification: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('kb-connection-service', () => {
  it('GET 使用约定路径、后端请求头并跳过全局错误提示', async () => {
    localStorage.setItem(BackendId, 'tenant-7');
    mockedRequest.get.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: sampleConnection },
    });

    const response = await getKbConnection();

    expect(mockedRequest.get).toHaveBeenCalledWith(
      api.kbConnection,
      expectedConfig('tenant-7'),
    );
    expect(response.data.data).toEqual(sampleConnection);
  });

  it('BackendId 缺失时使用 0', async () => {
    mockedRequest.get.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: sampleConnection },
    });

    await getKbConnection();

    expect(mockedRequest.get).toHaveBeenCalledWith(
      api.kbConnection,
      expectedConfig('0'),
    );
  });

  it('PUT 规范化 URL，原样发送 revision 和非空 Token', async () => {
    localStorage.setItem(BackendId, 'tenant-8');
    mockedRequest.put.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: sampleConnection },
    });

    await saveKbConnection({
      endpoint: '  https://kb.example.com  ',
      serviceToken: 'service-secret',
      revision: 7,
    });

    expect(mockedRequest.put).toHaveBeenCalledWith(
      api.kbConnection,
      {
        endpoint: 'https://kb.example.com',
        serviceToken: 'service-secret',
        revision: 7,
      },
      expectedConfig('tenant-8'),
    );
  });

  it('PUT 留空 Token 时省略字段并保留 revision=0', async () => {
    mockedRequest.put.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: sampleConnection },
    });

    await saveKbConnection({
      endpoint: 'https://kb.example.com',
      serviceToken: '   ',
      revision: 0,
    });

    expect(mockedRequest.put).toHaveBeenCalledWith(
      api.kbConnection,
      { endpoint: 'https://kb.example.com', revision: 0 },
      expectedConfig('0'),
    );
  });

  it('POST /test 规范化 URL 并发送非空 Token', async () => {
    const result = {
      success: true,
      stage: 'version',
      message: 'ok',
      version: '1.2.3',
      upstreamStatus: 200,
    };
    mockedRequest.post.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: result },
    });

    const response = await testKbConnection({
      endpoint: ' https://kb.example.com ',
      serviceToken: 'service-secret',
    });

    expect(mockedRequest.post).toHaveBeenCalledWith(
      api.kbConnectionTest,
      {
        endpoint: 'https://kb.example.com',
        serviceToken: 'service-secret',
      },
      expectedConfig('0'),
    );
    expect(response.data.data).toEqual(result);
  });

  it('POST /test 留空 Token 时省略字段', async () => {
    mockedRequest.post.mockResolvedValueOnce({
      data: {
        code: 0,
        message: 'ok',
        data: {
          success: false,
          stage: 'authentication',
          message: 'unauthorized',
          version: null,
          upstreamStatus: 401,
        },
      },
    });

    await testKbConnection({
      endpoint: 'https://kb.example.com',
      serviceToken: '',
    });

    expect(mockedRequest.post).toHaveBeenCalledWith(
      api.kbConnectionTest,
      { endpoint: 'https://kb.example.com' },
      expectedConfig('0'),
    );
  });
});
