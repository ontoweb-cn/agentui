import message from '@/components/ui/message';
import {
  Authorization,
  AuthMode,
  TenantId,
  UserInfo,
} from '@/constants/authorization';
import userService, {
  getLoginChannels,
  loginWithChannel,
  logoutWithHeaders,
} from '@/services/user-service';
import {
  default as authorizationUtil,
  redirectToLogin,
  default as storage,
} from '@/utils/authorization-util';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSaveSetting } from './use-user-setting-request';

import api from '@/utils/api';
import request from '@/utils/request';

export interface ILoginRequestBody {
  email?: string;
  login_name?: string;
  password: string;
}

export interface IRegisterRequestBody extends ILoginRequestBody {
  nickname?: string;
  display_name?: string;
}

export interface ILoginChannel {
  channel: string;
  display_name: string;
  icon: string;
}

export const useLoginChannels = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['loginChannels'],
    queryFn: async () => {
      const { data: res = {} } = await getLoginChannels();
      return res.data || [];
    },
  });

  return { channels: data as ILoginChannel[], loading: isLoading };
};

export const useLoginWithChannel = () => {
  const { isPending: loading, mutateAsync } = useMutation({
    mutationKey: ['loginWithChannel'],
    mutationFn: async (channel: string) => {
      loginWithChannel(channel);
      return Promise.resolve();
    },
  });

  return { loading, login: mutateAsync };
};

export const useLogin = () => {
  const { saveSetting } = useSaveSetting(true);
  const { authMode } = useAuthMode(); // T002:顶层调用,闭包传递给 mutationFn
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['login'],
    mutationFn: async (params: { email?: string; login_name?: string; password: string }) => {
      const { data: res = {}, response } = await userService.login(params);
      if (res?.code === 0) {
        saveSetting({ language: storage.getLanguage() });
        const { data } = res;

        if (authMode === 'intellect-enterprise') {
          // T002 企业版 cookie 模式:token 在 HttpOnly cookie 中,前端 JS 不可读。
          // localStorage 只存非敏感标记(authMode + tenantId + userInfo),用于前端状态判断。
          // 真实有效性由后续 /auth/me 请求验证。
          // 注意:BFF /auth/login 企业版响应不返回 email,此处不写 email 字段,
          // 后续 useEnterpriseCookieProbe 通过 /auth/me 补全 email。
          const userInfo = {
            name: data.display_name,
            memberId: data.member_id,
            role: data.role,
          };
          authorizationUtil.setItems({
            [AuthMode]: 'intellect-enterprise',
            [TenantId]: '0', // 当前阶段固定缺省租户,P5 多租户阶段扩展
            [UserInfo]: JSON.stringify(userInfo),
          });
        } else {
          // 社区版模式:从 body/header 取 token 存 localStorage(现有逻辑)
          let authorization = response.headers.get(Authorization);
          let token = data.access_token;
          if (authorization && authorization.startsWith('Bearer ')) {
            token = authorization.substring(7);
          } else if (token && !token.startsWith('Bearer ')) {
            authorization = `Bearer ${token}`;
          }
          const userInfo = {
            avatar: data.avatar,
            name: data.nickname,
            email: data.email,
          };
          authorizationUtil.setItems({
            Authorization: authorization || '',
            userInfo: JSON.stringify(userInfo),
            Token: token || '',
          });
        }
      }
      return res.code;
    },
  });

  return { data, loading, login: mutateAsync };
};

export const useRegister = () => {
  const { t } = useTranslation();
  const { authMode } = useAuthMode(); // T005:企业版响应差异处理

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['register'],
    mutationFn: async (params: {
      email?: string;
      login_name?: string;
      password: string;
      nickname?: string;
      display_name?: string;
    }) => {
      const { data = {} } = await userService.register(params);
      if (data?.code === 0) {
        // T005:企业版响应含 registration_pending,区分提示
        if (authMode === 'intellect-enterprise') {
          const regData = data.data as { member_id?: string; registration_pending?: number };
          if (regData?.registration_pending === 1) {
            message.success(t('message.registerPending') || 'Registration successful, pending admin approval');
          } else {
            message.success(t('message.registered'));
          }
        } else {
          message.success(t('message.registered'));
        }
      } else if (
        data.message &&
        data.message.includes('registration is disabled')
      ) {
        message.error(
          t('message.registerDisabled') || 'User registration is disabled',
        );
      }
      return data?.code;
    },
  });

  return { data, loading, register: mutateAsync };
};

export const useLogout = () => {
  const { t } = useTranslation();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['logout'],
    mutationFn: async () => {
      // T004:从 localStorage 读取 tenantId,防御性用 '0' 兜底(避免 BFF 400 阻塞登出)。
      // 使用 logoutWithHeaders 直接调 request.post,因为 userService.logout 基于
      // registerServer,无法透传自定义 headers(BFF /auth/logout 严格校验 X-Tenant-Id)。
      // P2-A 修复:用户主动登出意图明确,即使 BFF 失败也清除前端标记(防御性),
      // 避免登出失败后用户卡在已登录状态。
      const tenantId = localStorage.getItem(TenantId) || '0';
      let code: number | undefined;
      try {
        const { data = {} } = await logoutWithHeaders({
          'X-Tenant-Id': tenantId,
        });
        code = data?.code;
        if (code === 0) {
          message.success(t('message.logout'));
        }
      } finally {
        // 无论 BFF 响应如何,用户主动登出都应清除前端登录态
        authorizationUtil.removeAll();
        redirectToLogin();
      }
      return code;
    },
  });

  return { data, loading, logout: mutateAsync };
};

export type AuthMode = 'intellect-rag' | 'intellect-enterprise';

/**
 * 获取当前 tenant 的认证模式(公开端点,无需登录)。
 * 登录页根据 authMode 动态切换表单字段(email ↔ login_name)。
 */
export const useAuthMode = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['authConfig'],
    queryFn: async () => {
      const { data: res = {} } = await request.get(api.authConfig);
      return (res?.data?.authMode as AuthMode) ?? 'intellect-rag';
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  return { authMode: (data ?? 'intellect-rag') as AuthMode, loading: isLoading };
};
