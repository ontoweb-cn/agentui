import message from '@/components/ui/message';
import { Authorization } from '@/constants/authorization';
import i18n from '@/locales/config';
import authorizationUtil, {
  getAuthorization,
  redirectToLogin,
} from '@/utils/authorization-util';
import notification from '@/utils/notification';
import axios from 'axios';
import { convertTheKeysOfTheObjectToSnake, isFormData } from './common-util';
import { setCachedLlmList } from './llm-cache';
import { addTenantParams } from './llm-util';

const FAILED_TO_FETCH = 'Failed to fetch';

export const RetcodeMessage = {
  200: i18n.t('message.200'),
  201: i18n.t('message.201'),
  202: i18n.t('message.202'),
  204: i18n.t('message.204'),
  400: i18n.t('message.400'),
  401: i18n.t('message.401'),
  403: i18n.t('message.403'),
  404: i18n.t('message.404'),
  406: i18n.t('message.406'),
  410: i18n.t('message.410'),
  413: i18n.t('message.413'),
  422: i18n.t('message.422'),
  500: i18n.t('message.500'),
  502: i18n.t('message.502'),
  503: i18n.t('message.503'),
  504: i18n.t('message.504'),
};
export type ResultCode =
  | 200
  | 201
  | 202
  | 204
  | 400
  | 401
  | 403
  | 404
  | 406
  | 410
  | 413
  | 422
  | 500
  | 502
  | 503
  | 504;

const errorHandler = (error: {
  response: Response;
  message: string;
}): Response => {
  const { response } = error;
  if (error.message === FAILED_TO_FETCH) {
    notification.error({
      description: i18n.t('message.networkAnomalyDescription'),
      message: i18n.t('message.networkAnomaly'),
    });
  } else {
    if (response && response.status) {
      const errorText =
        RetcodeMessage[response.status as ResultCode] || response.statusText;
      const { status, url } = response;
      notification.error({
        message: `${i18n.t('message.requestError')} ${status}: ${url}`,
        description: errorText,
      });
    }
  }
  return response ?? { data: { code: 1999 } };
};

// avoid duplicate 401 redirects
let isRedirecting = false;

const request = axios.create({
  //   errorHandler,
  timeout: 300000,
  //   getResponse: true,
});

request.interceptors.request.use(
  (config) => {
    const data = convertTheKeysOfTheObjectToSnake(config.data);
    const params = convertTheKeysOfTheObjectToSnake(config.params);

    // Add tenant parameters to data
    const dataWithTenantParams = isFormData(data)
      ? data
      : addTenantParams(data, config.url);

    const newConfig = { ...config, data: dataWithTenantParams, params };

    // Skip token if explicitly requested, or if no token available (enterprise mode)
    if (!(newConfig as any).skipToken) {
      const auth = getAuthorization();
      if (auth) {
        newConfig.headers.set(Authorization, auth);
      }
    }

    return newConfig;
  },
  function (error) {
    return Promise.reject(error);
  },
);

request.interceptors.response.use(
  async (response) => {
    if (response?.status === 413 || response?.status === 504) {
      message.error(RetcodeMessage[response?.status as ResultCode]);
    }

    if (response.config.responseType === 'blob') {
      return response;
    }
    const data = response?.data;

    // Update LLM list cache when fetching my_llm or llm_list
    if (data?.code === 0 && data?.data) {
      const url = response?.config?.url || '';
      if (url.includes('/v1/llm/my_llms') || url.includes('/v1/llm/list')) {
        setCachedLlmList(data.data);
      }
    }

    if (data?.code === 100) {
      message.error(data?.message);
    } else if (data?.code === 401) {
      // 企业版 cookie 模式:跳过自动登出与跳转(避免与 useEnterpriseCookieProbe 循环)
      const isEnterpriseMode =
        localStorage.getItem('authMode') === 'intellect-enterprise';
      if (!isEnterpriseMode && !isRedirecting) {
        isRedirecting = true;
        notification.error({
          message: data?.message,
          description: data?.message,
          duration: 3,
        });
        authorizationUtil.removeAll();
        redirectToLogin();
      }
    } else if (data?.code !== 0) {
      notification.error({
        message: `${i18n.t('message.hint')} : ${data?.code}`,
        description: data?.message,
        duration: 3,
      });
    }
    return response;
  },
  function (error) {
    // Handle HTTP 401 (token expired / invalid)
    const status = error?.response?.status;
    if (status === 401) {
      // 企业版 cookie 模式:/proxy/v1/* 透传路由无 Authorization header 会返回 401,
      // 但 cookie 仍有效(企业版 token 在 HttpOnly cookie 中,JS 不可读)。
      // 此时不应清除登录态/跳登录页,否则会与 useEnterpriseCookieProbe 形成循环:
      // 401 → removeAll → 跳登录页 → probe /auth/me 200 → 写回标记 → 跳首页 → 401 → ...
      // 企业版登出仅由显式 /auth/logout 或 /auth/me 真实 401(由 probe 处理)触发。
      const isEnterpriseMode =
        localStorage.getItem('authMode') === 'intellect-enterprise';
      if (!isEnterpriseMode && !isRedirecting) {
        isRedirecting = true;
        const messageText =
          error?.response?.data?.message || RetcodeMessage[401];
        notification.error({
          message: messageText,
          description: messageText,
          duration: 3,
        });
        authorizationUtil.removeAll();
        redirectToLogin();
      }

      return Promise.reject(error);
    }

    errorHandler(error);
    return Promise.reject(error);
  },
);

export default request;

export const get = (url: string) => {
  return request.get(url);
};

export const post = (url: string, body: any) => {
  return request.post(url, { data: body });
};

export const drop = () => {};

export const put = () => {};
