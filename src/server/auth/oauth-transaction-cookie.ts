import { parseCookieToken } from '@forge-cms/auth';

import { base64UrlDecode, base64UrlEncode } from './encoding';

/** Short-lived, HttpOnly cookie holding the in-flight OAuth transaction. Never sent to DevAuth. */
export const OAUTH_TX_COOKIE_NAME = 'glossa_oauth_tx';

const OAUTH_TX_MAX_AGE_SECONDS = 10 * 60;

export interface OAuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export interface TransactionCookieOptions {
  /** Omit the `Secure` attribute — only for local `http://` development. Defaults to `true`. */
  secure?: boolean;
}

/**
 * Builds the `Set-Cookie` header starting the OAuth transaction. `SameSite=Lax` (not `Strict`) is
 * required because DevAuth's redirect back to the callback is a top-level cross-site navigation —
 * `Strict` would drop the cookie exactly when the callback needs to read it.
 */
export function buildTransactionCookie(
  transaction: OAuthTransaction,
  options: TransactionCookieOptions = {},
): string {
  const secure = options.secure ?? true;
  const value = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(transaction)),
  );
  const attributes = [
    `${OAUTH_TX_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${OAUTH_TX_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** Builds the `Set-Cookie` header that clears the transaction cookie — used on every callback outcome. */
export function buildTransactionClearCookie(
  options: TransactionCookieOptions = {},
): string {
  const secure = options.secure ?? true;
  const attributes = [
    `${OAUTH_TX_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** Reads and parses the transaction cookie, or `null` if absent/expired/malformed. */
export function readTransactionCookie(
  request: Request,
): OAuthTransaction | null {
  const raw = parseCookieToken(request, OAUTH_TX_COOKIE_NAME);
  if (!raw) return null;

  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(raw));
    const parsed = JSON.parse(decoded) as Partial<OAuthTransaction>;

    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.returnTo !== 'string'
    ) {
      return null;
    }

    return {
      state: parsed.state,
      nonce: parsed.nonce,
      codeVerifier: parsed.codeVerifier,
      returnTo: parsed.returnTo,
    };
  } catch {
    return null;
  }
}

/**
 * Only an application-local path may be used as a post-login redirect. Rejects protocol-relative
 * (`//evil.com`), backslash-normalized (`/\evil.com`), scheme-based (`javascript:`, `data:`, any
 * absolute URL — none of these start with a single `/`), and control characters that could otherwise
 * smuggle a header injection into the redirect response.
 */
export function isSafeReturnTo(
  path: string | null | undefined,
): path is string {
  if (!path) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.startsWith('/\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(path)) return false;
  return true;
}
