/**
 * @deprecated This file will be deprecated. Please use `@web/src/utils/next-request.ts` instead.
 */

import message from '@/components/ui/message';
import { Authorization } from '@/constants/authorization';
import { ResponseType } from '@/interfaces/database/base';
import i18n from '@/locales/config';
import authorizationUtil, {
  getAuthorization,
  redirectToLogin,
} from '@/utils/authorization-util';
import notification from '@/utils/notification';
import { RequestMethod, extend } from 'umi-request';
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

const request: RequestMethod = extend({
  errorHandler,
  timeout: 300000,
  getResponse: true,
  // P2 Cookie 模式适配:企业版认证 token 存 HttpOnly cookie,需浏览器自动携带。
  // 同源策略限制下,跨域请求不会携带 cookie,无安全风险。社区版无 cookie 时行为不变。
  credentials: 'include',
});

// avoid duplicate 401 redirects
let isRedirecting = false;

request.interceptors.request.use((url: string, options: any) => {
  const data = convertTheKeysOfTheObjectToSnake(options.data);
  const params = convertTheKeysOfTheObjectToSnake(options.params);

  // Add tenant parameters to data
  const dataWithTenantParams = isFormData(data)
    ? data
    : addTenantParams(data, url);

  return {
    url,
    options: {
      ...options,
      data: dataWithTenantParams,
      params,
      headers: {
        ...(options.skipToken
          ? undefined
          : { [Authorization]: getAuthorization() }),
        ...options.headers,
      },
      interceptors: true,
    },
  };
});

request.interceptors.response.use(async (response: Response, options) => {
  if (response?.status === 413 || response?.status === 504) {
    message.error(RetcodeMessage[response?.status as ResultCode]);
  }

  // Handle HTTP 401
  if (response?.status === 401) {
    // 企业版 cookie 模式:/proxy/v1/* 透传路由无 Authorization header 会返回 401,
    // 但 cookie 仍有效(企业版 token 在 HttpOnly cookie 中,JS 不可读)。
    // 此时不应清除登录态/跳登录页,否则会与 useEnterpriseCookieProbe 形成循环:
    // 401 → removeAll → 跳登录页 → probe /auth/me 200 → 写回标记 → 跳首页 → 401 → ...
    // 企业版登出仅由显式 /auth/logout 或 /auth/me 真实 401(由 probe 处理)触发。
    const isEnterpriseMode =
      localStorage.getItem('authMode') === 'intellect-enterprise';
    if (isEnterpriseMode) {
      return response;
    }

    if (!isRedirecting) {
      isRedirecting = true;

      const data = await response
        .clone()
        .json()
        .catch(() => ({}));

      const messageText = data?.message || RetcodeMessage[401];
      notification.error({
        message: messageText,
        description: messageText,
        duration: 3,
      });
      authorizationUtil.removeAll();
      redirectToLogin();
    }

    return response;
  }

  if (options.responseType === 'blob') {
    return response;
  }

  const data: ResponseType = await response?.clone()?.json();

  // Update LLM list cache when fetching my_llm or llm_list
  if (data?.code === 0 && data?.data) {
    const url = response?.url || '';
    if (url.includes('/v1/llm/my_llms') || url.includes('/v1/llm/list')) {
      setCachedLlmList(data.data);
    }
  }

  if (data?.code === 100) {
    message.error(data?.message);
  } else if (data?.code === 401) {
    // 企业版 cookie 模式同 HTTP 401 处理:跳过自动登出(避免与 probe 循环)
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
  } else if (data?.code !== undefined && data?.code !== 0) {
    // 仅当响应显式包含非零 code 时才视为错误。
    // BFF 路由(如 /api/bff/canvas/*)可能返回无 {code,data,message} 信封的原始响应,
    // 此时 data.code 为 undefined,不应触发错误通知(否则会显示 "hint : undefined")。
    notification.error({
      message: `${i18n.t('message.hint')} : ${data?.code}`,
      description: data?.message,
      duration: 3,
    });
  }
  return response;
});

export default request;

export const get = (url: string) => {
  return request.get(url);
};

export const post = (url: string, body: any) => {
  return request.post(url, { data: body });
};

export const drop = () => {};

export const put = () => {};
