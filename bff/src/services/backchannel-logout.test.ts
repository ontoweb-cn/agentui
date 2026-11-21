import { describe, expect, it } from 'vitest';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { __resetBackchannelJwksCacheForTest, verifyLogoutToken } from './backchannel-logout';

const ISSUER = 'http://127.0.0.1:8000';
const AUDIENCE = 'ia-intellect-team';
const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

async function makeJwks() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  return { jwks: createLocalJWKSet({ keys: [jwk] }), privateKey };
}

async function signLogoutToken(
  privateKey: CryptoKey,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return await new SignJWT({
    events: { [BACKCHANNEL_EVENT]: {} },
    ...(overrides as object),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject('e2epwd001')
    .setIssuedAt()
    .sign(privateKey);
}

describe('back-channel logout 令牌验签（A1）', () => {
  it('合法登出令牌 → 通过并返回 claims', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signLogoutToken(privateKey, { sid: 'sid-hash-1' });
    const claims = await verifyLogoutToken(token, { issuer: ISSUER, audience: AUDIENCE, jwks });
    expect(claims.sub).toBe('e2epwd001');
    expect(claims.sid).toBe('sid-hash-1');
  });

  it('缺 backchannel-logout event → 拒绝', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('e2epwd001')
      .setIssuedAt()
      .sign(privateKey);
    await expect(
      verifyLogoutToken(token, { issuer: ISSUER, audience: AUDIENCE, jwks }),
    ).rejects.toThrow(/missing backchannel-logout event/);
  });

  it('携带 nonce → 拒绝（OIDC §2.4）', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signLogoutToken(privateKey, { nonce: 'must-not-exist' });
    await expect(
      verifyLogoutToken(token, { issuer: ISSUER, audience: AUDIENCE, jwks }),
    ).rejects.toThrow(/nonce must not be present/);
  });

  it('aud 不匹配 → 拒绝', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signLogoutToken(privateKey);
    await expect(
      verifyLogoutToken(token, { issuer: ISSUER, audience: 'other-client', jwks }),
    ).rejects.toThrow();
  });

  it('iss 不匹配 → 拒绝', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signLogoutToken(privateKey);
    await expect(
      verifyLogoutToken(token, { issuer: 'http://evil.example', audience: AUDIENCE, jwks }),
    ).rejects.toThrow();
  });

  it('签名不匹配 → 拒绝', async () => {
    const { privateKey: otherKey } = await makeJwks();
    const { jwks } = await makeJwks();
    const token = await new SignJWT({ events: { [BACKCHANNEL_EVENT]: {} } })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('e2epwd001')
      .setIssuedAt()
      .sign(otherKey);
    await expect(
      verifyLogoutToken(token, { issuer: ISSUER, audience: AUDIENCE, jwks }),
    ).rejects.toThrow();
  });

  it('缺 sub → 拒绝（本实现按 sub 定位会话）', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await new SignJWT({ events: { [BACKCHANNEL_EVENT]: {} }, sid: 'sid-1' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .sign(privateKey);
    await expect(
      verifyLogoutToken(token, { issuer: ISSUER, audience: AUDIENCE, jwks }),
    ).rejects.toThrow(/sub required/);
    __resetBackchannelJwksCacheForTest();
  });
});
