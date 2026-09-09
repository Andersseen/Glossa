import {
  buildTransactionClearCookie,
  buildTransactionCookie,
  isSafeReturnTo,
  OAUTH_TX_COOKIE_NAME,
  readTransactionCookie,
  type OAuthTransaction,
} from './oauth-transaction-cookie';

function requestWithSetCookie(setCookieHeader: string): Request {
  const [cookiePair] = setCookieHeader.split(';');
  return new Request('https://glossa.example/api/auth/sso/callback', {
    headers: { cookie: cookiePair ?? '' },
  });
}

describe('isSafeReturnTo', () => {
  it('accepts application-local paths', () => {
    expect(isSafeReturnTo('/projects')).toBe(true);
    expect(isSafeReturnTo('/projects/my-project/catalogs/en')).toBe(true);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isSafeReturnTo('//evil.example.com')).toBe(false);
  });

  it('rejects absolute URLs with a scheme', () => {
    expect(isSafeReturnTo('https://evil.example.com')).toBe(false);
    expect(isSafeReturnTo('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnTo('data:text/html,evil')).toBe(false);
  });

  it('rejects backslash-based protocol-relative tricks', () => {
    expect(isSafeReturnTo('/\\evil.example.com')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isSafeReturnTo('/projects\n\rSet-Cookie: evil=1')).toBe(false);
  });

  it('rejects empty or missing values', () => {
    expect(isSafeReturnTo('')).toBe(false);
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
  });
});

describe('transaction cookie', () => {
  const transaction: OAuthTransaction = {
    state: 'state-value',
    nonce: 'nonce-value',
    codeVerifier: 'verifier-value',
    returnTo: '/projects',
  };

  it('round-trips through build and read', () => {
    const setCookie = buildTransactionCookie(transaction, { secure: false });
    const request = requestWithSetCookie(setCookie);

    expect(readTransactionCookie(request)).toEqual(transaction);
  });

  it('sets the expected cookie attributes', () => {
    const setCookie = buildTransactionCookie(transaction, { secure: true });

    expect(setCookie).toContain(`${OAUTH_TX_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
  });

  it('omits Secure for local http development', () => {
    const setCookie = buildTransactionCookie(transaction, { secure: false });

    expect(setCookie).not.toContain('Secure');
  });

  it('returns null when the cookie is absent', () => {
    const request = new Request('https://glossa.example/api/auth/sso/callback');

    expect(readTransactionCookie(request)).toBeNull();
  });

  it('returns null for a malformed cookie value', () => {
    const request = new Request(
      'https://glossa.example/api/auth/sso/callback',
      {
        headers: { cookie: `${OAUTH_TX_COOKIE_NAME}=not-valid-base64url-json` },
      },
    );

    expect(readTransactionCookie(request)).toBeNull();
  });

  it('clears the cookie with Max-Age=0', () => {
    const cleared = buildTransactionClearCookie({ secure: false });

    expect(cleared).toContain(`${OAUTH_TX_COOKIE_NAME}=`);
    expect(cleared).toContain('Max-Age=0');
  });
});
