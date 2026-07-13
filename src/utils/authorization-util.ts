import {
  Authorization,
  AuthMode,
  TenantId,
  Token,
  UserInfo,
} from '@/constants/authorization';
import { getSearchValue } from './common-util';
// P2 Cookie 模式:KeySet 含 authMode + tenantId 标记,removeAll 时一并清除,
// 避免 401 拦截或登出后企业版标记残留导致 isLogin 误判或状态不一致
const KeySet = [Authorization, Token, UserInfo, AuthMode, TenantId];

const storage = {
  getAuthorization: () => {
    return localStorage.getItem(Authorization);
  },
  getToken: () => {
    return localStorage.getItem(Token);
  },
  getUserInfo: () => {
    return localStorage.getItem(UserInfo);
  },
  getUserInfoObject: () => {
    const userInfoStr = localStorage.getItem(UserInfo);
    return userInfoStr ? JSON.parse(userInfoStr) : null;
  },
  setAuthorization: (value: string) => {
    localStorage.setItem(Authorization, value);
  },
  setToken: (value: string) => {
    localStorage.setItem(Token, value);
  },
  setUserInfo: (value: string | Record<string, unknown>) => {
    const valueStr = typeof value !== 'string' ? JSON.stringify(value) : value;
    localStorage.setItem(UserInfo, valueStr);
  },
  setItems: (pairs: Record<string, string>) => {
    Object.entries(pairs).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
  },
  removeAuthorization: () => {
    localStorage.removeItem(Authorization);
  },
  removeAll: () => {
    KeySet.forEach((x) => {
      localStorage.removeItem(x);
    });
  },
  setLanguage: (lng: string) => {
    localStorage.setItem('lng', lng);
  },
  getLanguage: (): string => {
    return localStorage.getItem('lng') as string;
  },
};

export const getAuthorization = () => {
  const auth = getSearchValue('auth');
  const authorization = auth
    ? 'Bearer ' + auth
    : storage.getAuthorization() || '';

  return authorization;
};

export default storage;

// Will not jump to the login page
export function redirectToLogin() {
  const currentPath = location.pathname;
  if (currentPath === '/login' || currentPath === '/login-next') {
    return;
  }
  window.location.href = location.origin + `/login`;
}
