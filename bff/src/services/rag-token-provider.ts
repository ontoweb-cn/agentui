// 企业版 BFF 自动登录 intellect-rag,获取并维护有效的 JWT token。
//
// 机制:
// - BFF 启动时自动用配置的 admin 账号登录 intellect-rag
// - intellect-rag 要求密码先用 Base64 编码,再用 RSA 公钥加密(与前端 rsaPsw() 一致)
// - 登录成功后将 Authorization 响应头中的 token 缓存
// - proxy 调用时若遇到 401,自动重新登录刷新 token(并发安全:单 inflight promise)
//
// 环境变量:
//   INTELLECT_RAG_ADMIN_EMAIL    管理员邮箱(如 simon@ontoweb.cn)
//   INTELLECT_RAG_ADMIN_PASSWORD 管理员密码
//
// 替代原先手工维护的 HARNESS_INTELLECT_RAG_ADMIN_TOKEN,
// 不再依赖硬编码的过期 JWT。

import crypto from 'node:crypto';

const INTELLECT_RAG_HOST = process.env.INTELLECT_RAG_HOST || 'localhost';
const INTELLECT_PORT = process.env.PYTHON_API_PORT || '9380';
const BASE_URL = `http://${INTELLECT_RAG_HOST}:${INTELLECT_PORT}`;

// ---------------------------------------------------------------------------
// 密码加密 — 对齐前端 src/utils/index.ts:rsaPsw() 的 RSA + Base64 流程
// ---------------------------------------------------------------------------

/** intellect-rag 的 RSA 公钥(与 conf/public.pem 一致)。 */
const RAG_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/',
  'z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp',
  '2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOO',
  'UEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVK',
  'RNLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK',
  '6olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs',
  '2wIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');

/**
 * RSA-encrypt a plaintext password to match the frontend's `rsaPsw()` output.
 *
 * 前端流程: Base64.encode(password) → JSEncrypt.encrypt() (PKCS#1 v1.5)
 * BFF 等效用 Node.js crypto.publicEncrypt + PKCS1 padding。
 */
function encryptPassword(plaintext: string): string {
  // Step 1: Base64 encode (与前端 Base64.encode 一致)
  const base64 = Buffer.from(plaintext, 'utf8').toString('base64');
  // Step 2: RSA encrypt with PKCS#1 v1.5 padding
  const encrypted = crypto.publicEncrypt(
    {
      key: RAG_PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(base64, 'utf8'),
  );
  // Step 3: Base64 encode the encrypted buffer (JSEncrypt 默认输出 base64)
  return encrypted.toString('base64');
}

// ---------------------------------------------------------------------------
// RagTokenProvider
// ---------------------------------------------------------------------------

class RagTokenProvider {
  private token: string | null = null;
  private loginPromise: Promise<string> | null = null;

  /** 获取当前缓存的 token (可能为空,调用方应兜底)。 */
  getToken(): string | null {
    return this.token;
  }

  /**
   * 登录 intellect-rag,返回 JWT token。
   * 并发安全:多个并发调用共享同一个 inflight promise。
   */
  async login(): Promise<string> {
    // 复用已在进行中的登录
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = this.doLogin();
    try {
      const token = await this.loginPromise;
      return token;
    } finally {
      this.loginPromise = null;
    }
  }

  /** 标记当前 token 无效,下次 proxy 调用自动重新登录。 */
  invalidate(): void {
    this.token = null;
  }

  private async doLogin(): Promise<string> {
    const email = process.env.INTELLECT_RAG_ADMIN_EMAIL;
    const password = process.env.INTELLECT_RAG_ADMIN_PASSWORD;

    if (!email || !password) {
      console.warn(
        '[rag-token] INTELLECT_RAG_ADMIN_EMAIL or INTELLECT_RAG_ADMIN_PASSWORD not set, ' +
        'RAG proxy will fall back to HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
      );
      throw new Error('Missing RAG admin credentials');
    }

    console.log(`[rag-token] Logging into intellect-rag as ${email}...`);
    const encryptedPassword = encryptPassword(password);
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: encryptedPassword }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`RAG login failed: ${response.status} ${text}`);
    }

    // intellect-rag 将 JWT 放在 Authorization 响应头中
    const authHeader = response.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('RAG login response missing Authorization header');
    }

    this.token = authHeader;
    console.log('[rag-token] RAG login successful, token cached');
    return authHeader;
  }
}

/** 全局单例 */
export const ragTokenProvider = new RagTokenProvider();
