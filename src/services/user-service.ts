import api from '@/utils/api';
import { BackendId } from '@/constants/authorization';
import registerServer from '@/utils/register-server';
import request, { post } from '@/utils/request';

const {
  login,
  logout,
  register,
  setting,
  userInfo,
  tenantInfo,
  getSystemVersion,
  getSystemTokenList,
  removeSystemToken,
  createSystemToken,
  getSystemConfig,
} = api;

const methods = {
  login: {
    url: login,
    method: 'post',
  },
  logout: {
    url: logout,
    method: 'post',
  },
  register: {
    url: register,
    method: 'post',
  },
  setting: {
    url: setting,
    method: 'patch',
  },
  userInfo: {
    url: userInfo,
    method: 'get',
  },
  getTenantInfo: {
    url: tenantInfo,
    method: 'get',
  },
  getSystemVersion: {
    url: getSystemVersion,
    method: 'get',
  },
  listToken: {
    url: getSystemTokenList,
    method: 'get',
  },
  createToken: {
    url: createSystemToken,
    method: 'post',
  },
  removeToken: {
    url: removeSystemToken,
    method: 'delete',
  },
  getSystemConfig: {
    url: getSystemConfig,
    method: 'get',
  },
} as const;

const userService = registerServer<keyof typeof methods>(methods, request);

export const getLoginChannels = (headers?: Record<string, string>) =>
  request.get(api.loginChannels, headers ? { headers } : undefined);

/**
 * 浏览器整页跳转无法携带 X-Backend-Id，租户经 query 传给 BFF（spec-014 P2）。
 */
export const loginWithChannel = (channel: string) => {
  const tenantId = localStorage.getItem(BackendId) || '0';
  const url = `${api.loginChannel(channel)}?tenant=${encodeURIComponent(tenantId)}`;
  return (window.location.href = url);
};

// T004:logout 支持传自定义 headers(X-Backend-Id),避免 BFF 严格 400
export const logoutWithHeaders = (headers: Record<string, string>) =>
  request.post(api.logout, { headers });

export const listTenantUser = (tenantId: string) =>
  request.get(api.listTenantUser(tenantId));

export const addTenantUser = (tenantId: string, email: string) =>
  post(api.addTenantUser(tenantId), { email });

export const deleteTenantUser = ({
  tenantId,
  userId,
}: {
  tenantId: string;
  userId: string;
}) =>
  request.delete(api.deleteTenantUser(tenantId), {
    data: { userId },
  });

export const listTenant = () => request.get(api.listTenant);

export const agreeTenant = (tenantId: string) =>
  request.patch(api.agreeTenant(tenantId));

export default userService;
