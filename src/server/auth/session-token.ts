import { randomBase64Url, sha256Base64Url } from './encoding';

/**
 * Discriminates a Glossa SSO opaque session token from a Forge password-auth signed token
 * (`payload.signature`) so `CompositeAuthAdapter.canHandleToken` can route cheaply without a DB
 * round-trip or signature verification — see `GlossaSsoAuthAdapter.canHandleToken`.
 */
export const SSO_TOKEN_PREFIX = 'glossa_sso_';

/** Local application session TTL for DevAuth-originated sessions. */
export const SSO_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** A fresh, high-entropy opaque session token. Returned to the browser once; never persisted raw. */
export function createOpaqueSsoToken(): string {
  return `${SSO_TOKEN_PREFIX}${randomBase64Url(32)}`;
}

/** SHA-256 digest of a session token, as stored in `sso_sessions.tokenHash`. */
export function hashSsoToken(token: string): Promise<string> {
  return sha256Base64Url(token);
}
