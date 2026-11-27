import { BackendId } from '@/constants/authorization';
import api from '@/utils/api';
import request from '@/utils/next-request';
import type { AxiosRequestConfig } from 'axios';

export interface KbConnection {
  configured: boolean;
  endpoint: string;
  tokenConfigured: boolean;
  revision: number;
  version: string | null;
  versionError: string | null;
}

export interface KbConnectionTestResult {
  success: boolean;
  stage: 'version' | 'authentication' | null;
  message: string;
  version: string | null;
  upstreamStatus: number | null;
}

export interface SaveKbConnectionPayload {
  endpoint: string;
  serviceToken?: string;
  revision: number;
}

export interface TestKbConnectionPayload {
  endpoint: string;
  serviceToken?: string;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

type KbRequestConfig = AxiosRequestConfig & {
  skipErrorNotification: boolean;
};

const getRequestConfig = (): KbRequestConfig => ({
  headers: {
    'X-Backend-Id': localStorage.getItem(BackendId) || '0',
  },
  skipErrorNotification: true,
});

export const getKbConnection = () =>
  request.get<ApiResponse<KbConnection>>(api.kbConnection, getRequestConfig());

export const saveKbConnection = ({
  endpoint,
  serviceToken,
  revision,
}: SaveKbConnectionPayload) => {
  const body: SaveKbConnectionPayload = {
    endpoint: endpoint.trim(),
    revision,
    ...(serviceToken?.trim() ? { serviceToken } : {}),
  };

  // next-request serializes serviceToken as service_token on the wire; the BFF
  // accepts both spellings, so no global key-conversion exception is needed.
  return request.put<ApiResponse<KbConnection>>(
    api.kbConnection,
    body,
    getRequestConfig(),
  );
};

export const testKbConnection = ({
  endpoint,
  serviceToken,
}: TestKbConnectionPayload) => {
  const body: TestKbConnectionPayload = {
    endpoint: endpoint.trim(),
    ...(serviceToken?.trim() ? { serviceToken } : {}),
  };

  return request.post<ApiResponse<KbConnectionTestResult>>(
    api.kbConnectionTest,
    body,
    getRequestConfig(),
  );
};
