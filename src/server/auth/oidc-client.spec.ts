import {
  buildAuthorizationUrl,
  DiscoveryError,
  discoverIssuer,
  exchangeCodeForTokens,
  fetchUserinfo,
  IssuerMismatchError,
  TokenExchangeError,
  UserinfoError,
} from './oidc-client';

const ISSUER = 'https://auth.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function discoveryDocument(overrides: Partial<Record<string, string>> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize`,
    token_endpoint: `${ISSUER}/api/auth/oauth2/token`,
    userinfo_endpoint: `${ISSUER}/api/auth/oauth2/userinfo`,
    ...overrides,
  };
}

describe('discoverIssuer', () => {
  it('fetches and parses the discovery document', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(discoveryDocument()));

    const document = await discoverIssuer(ISSUER, fetchImpl);

    expect(document).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/api/auth/oauth2/authorize`,
      tokenEndpoint: `${ISSUER}/api/auth/oauth2/token`,
      userinfoEndpoint: `${ISSUER}/api/auth/oauth2/userinfo`,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ISSUER}/.well-known/openid-configuration`,
    );
  });

  it('caches the document and does not refetch within the TTL', async () => {
    const cacheTestIssuer = `${ISSUER}/cache-test`;
    const fetchImpl = vi.fn(async () =>
      jsonResponse(discoveryDocument({ issuer: cacheTestIssuer })),
    );

    await discoverIssuer(cacheTestIssuer, fetchImpl);
    await discoverIssuer(cacheTestIssuer, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws IssuerMismatchError when the document issuer differs', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(discoveryDocument({ issuer: 'https://not-devauth.test' })),
    );

    await expect(
      discoverIssuer('https://mismatch-test.example', fetchImpl),
    ).rejects.toThrow(IssuerMismatchError);
  });

  it('throws DiscoveryError when the endpoint is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      discoverIssuer('https://unreachable-test.example', fetchImpl),
    ).rejects.toThrow(DiscoveryError);
  });

  it('throws DiscoveryError on a non-200 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));

    await expect(
      discoverIssuer('https://error-status-test.example', fetchImpl),
    ).rejects.toThrow(DiscoveryError);
  });

  it('throws DiscoveryError when required fields are missing', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ issuer: 'https://incomplete-test.example' }),
    );

    await expect(
      discoverIssuer('https://incomplete-test.example', fetchImpl),
    ).rejects.toThrow(DiscoveryError);
  });
});

describe('buildAuthorizationUrl', () => {
  it('includes the required OIDC + PKCE parameters', () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: `${ISSUER}/api/auth/oauth2/authorize`,
        clientId: 'glossa-dev',
        redirectUri: 'http://localhost:5173/api/auth/sso/callback',
        state: 'state-value',
        nonce: 'nonce-value',
        codeChallenge: 'challenge-value',
      }),
    );

    expect(url.origin + url.pathname).toBe(
      `${ISSUER}/api/auth/oauth2/authorize`,
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('glossa-dev');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/auth/sso/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('exchangeCodeForTokens', () => {
  const params = {
    tokenEndpoint: `${ISSUER}/api/auth/oauth2/token`,
    clientId: 'glossa-dev',
    clientSecret: 'super-secret',
    code: 'auth-code',
    redirectUri: 'http://localhost:5173/api/auth/sso/callback',
    codeVerifier: 'verifier-value',
  };

  it('sends a client_secret_post form body with grant_type authorization_code', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body as URLSearchParams;
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('auth-code');
        expect(body.get('redirect_uri')).toBe(params.redirectUri);
        expect(body.get('client_id')).toBe('glossa-dev');
        expect(body.get('client_secret')).toBe('super-secret');
        expect(body.get('code_verifier')).toBe('verifier-value');
        expect(init?.headers).toMatchObject({
          'content-type': 'application/x-www-form-urlencoded',
        });

        return jsonResponse({
          access_token: 'access-token-value',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      },
    );

    const tokens = await exchangeCodeForTokens(params, fetchImpl);

    expect(tokens).toEqual({
      accessToken: 'access-token-value',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
  });

  it('does not request offline_access and tolerates no refresh token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'access-token-value',
        token_type: 'Bearer',
      }),
    );

    const tokens = await exchangeCodeForTokens(params, fetchImpl);

    expect(tokens.refreshToken).toBeUndefined();
  });

  it('throws TokenExchangeError with the provider error code on failure', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant' }, 400),
    );

    await expect(
      exchangeCodeForTokens(params, fetchImpl),
    ).rejects.toMatchObject({
      providerErrorCode: 'invalid_grant',
    });
  });

  it('throws TokenExchangeError when the response has no access token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ token_type: 'Bearer' }));

    await expect(exchangeCodeForTokens(params, fetchImpl)).rejects.toThrow(
      TokenExchangeError,
    );
  });

  it('throws TokenExchangeError when the endpoint is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(exchangeCodeForTokens(params, fetchImpl)).rejects.toThrow(
      TokenExchangeError,
    );
  });
});

describe('fetchUserinfo', () => {
  const userinfoEndpoint = `${ISSUER}/api/auth/oauth2/userinfo`;

  it('sends the access token as a Bearer credential and returns the parsed body', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          authorization: 'Bearer access-token-value',
        });
        return jsonResponse({ sub: 'user-123', email: 'user@example.com' });
      },
    );

    const userinfo = await fetchUserinfo(
      userinfoEndpoint,
      'access-token-value',
      fetchImpl,
    );

    expect(userinfo).toEqual({ sub: 'user-123', email: 'user@example.com' });
  });

  it('throws UserinfoError on a non-200 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));

    await expect(
      fetchUserinfo(userinfoEndpoint, 'bad-token', fetchImpl),
    ).rejects.toThrow(UserinfoError);
  });

  it('throws UserinfoError when the endpoint is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      fetchUserinfo(userinfoEndpoint, 'token', fetchImpl),
    ).rejects.toThrow(UserinfoError);
  });
});
