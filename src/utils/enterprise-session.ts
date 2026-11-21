import { AuthMode, BackendId, UserInfo } from '@/constants/authorization';
import api from '@/utils/api';
import authorizationUtil, {
  redirectToLogin,
} from '@/utils/authorization-util';

/**
 * 企业版（intellect-enterprise）会话口径统一入口（B3）。
 *
 * 企业版 token 在 HttpOnly cookie 中，前端不可读：
 * - cookie-probe（页面挂载）与 401 拦截器必须用同一套复验逻辑；
 * - 业务 401 并不必然代表会话失效（如 /proxy/v1/* 无 Authorization 的透传 401），
 *   需复验 /auth/me 后再决定「忽略本次 401」还是「回登录页」。
 */

/** 静默重登节流：5 分钟内最多触发一次，避免探测/401 抖动造成重定向循环。 */
const SSO_RELOGIN_THROTTLE_MS = 5 * 60 * 1000;
const SSO_RELOGIN_STORAGE_KEY = 'sso_relogin_attempt';

export type EnterpriseSessionResult = 'valid' | 'invalid' | 'unknown';

export const isEnterpriseAuthMode = () =>
  localStorage.getItem(AuthMode) === 'intellect-enterprise';

const isLoginOrAdminPath = () => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname;
  return (
    path.startsWith(`${base}/login`) ||
    path.startsWith(`${base}/login-next`) ||
    path.startsWith(`${base}/admin`)
  );
};

/**
 * 触发一次 prompt=none 静默重登（spec-014 P2）。
 * 是否真正静默由 BFF 开关与 sso_provider Cookie 决定；登出后 BFF 会直接回登录页。
 * @returns 是否已发起跳转（节流命中时返回 false）
 */
export const attemptSilentRelogin = (): boolean => {
  try {
    const last = Number(sessionStorage.getItem(SSO_RELOGIN_STORAGE_KEY) || 0);
    if (Date.now() - last < SSO_RELOGIN_THROTTLE_MS) return false;
    sessionStorage.setItem(SSO_RELOGIN_STORAGE_KEY, String(Date.now()));
  } catch {
    // sessionStorage 不可用时仍允许一次跳转（由 BFF 兜底）
  }
  const tenantId = localStorage.getItem(BackendId) || '0';
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(
    `/api/bff/auth/sso/relogin?tenant=${encodeURIComponent(tenantId)}&returnTo=${encodeURIComponent(returnTo)}`,
  );
  return true;
};

/**
 * 复验企业版会话：
 * - valid：cookie 有效（写回登录标记与用户信息）
 * - invalid：cookie 失效（清除登录标记）
 * - unknown：网络错误/非预期响应（不清标记，避免误踢）
 */
export const validateEnterpriseSession =
  async (): Promise<EnterpriseSessionResult> => {
    try {
      const tenantId = localStorage.getItem(BackendId) || '0';
      const resp = await fetch(api.userInfo, {
        credentials: 'include',
        headers: { 'X-Backend-Id': tenantId },
      });
      if (!resp.ok) {
        if (resp.status === 401) {
          localStorage.removeItem(AuthMode);
          return 'invalid';
        }
        return 'unknown';
      }
      const json = await resp.json().catch(() => null);
      if (json?.code === 0 && json?.data) {
        const userInfo = {
          name: json.data.display_name,
          email: json.data.email,
          memberId: json.data.member_id,
          role: json.data.role,
        };
        authorizationUtil.setItems({
          [AuthMode]: 'intellect-enterprise',
          [BackendId]: '0',
          [UserInfo]: JSON.stringify(userInfo),
        });
        return 'valid';
      }
      localStorage.removeItem(AuthMode);
      return 'invalid';
    } catch {
      // 网络错误或 JSON 解析失败：视为 unknown，不清除标记（可能是暂时性网络问题）
      return 'unknown';
    }
  };

let inflightValidation: Promise<EnterpriseSessionResult> | null = null;

const validateSingleFlight = () => {
  if (!inflightValidation) {
    inflightValidation = validateEnterpriseSession().finally(() => {
      inflightValidation = null;
    });
  }
  return inflightValidation;
};

/**
 * 401 拦截器统一入口：复验会话；仅在确认会话失效时静默重登或回登录页。
 * 登录页/管理页不触发跳转（与 cookie-probe 的启用条件保持一致）。
 */
export const revalidateEnterpriseSession = async (): Promise<void> => {
  if (isLoginOrAdminPath()) {
    return;
  }
  const result = await validateSingleFlight();
  if (result !== 'invalid') {
    return;
  }
  if (attemptSilentRelogin()) {
    return;
  }
  authorizationUtil.removeAll();
  redirectToLogin();
};
