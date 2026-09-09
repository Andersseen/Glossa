import type { DevAuthUserinfo } from './identity';

type FetchLike = typeof fetch;

export interface DiscoveryDocument {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  idToken?: string;
  refreshToken?: string;
  scope?: string;
}

/** Discovery request failed outright (network error, non-200, or an unparsable/incomplete document). */
export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** The discovery document's `issuer` field doesn't match the configured issuer — fail closed. */
export class IssuerMismatchError extends Error {
  constructor() {
    super(
      "DevAuth discovery document's issuer does not match the configured issuer.",
    );
  }
}

/** Authorization-code exchange failed. `providerErrorCode` is the standard short OAuth `error` value only. */
export class TokenExchangeError extends Error {
  readonly providerErrorCode?: string;

  constructor(message: string, providerErrorCode?: string) {
    super(message);
    if (providerErrorCode) this.providerErrorCode = providerErrorCode;
  }
}

/** The userinfo request failed or returned an unusable body. */
export class UserinfoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const discoveryCache = new Map<
  string,
  { document: DiscoveryDocument; fetchedAt: number }
>();

/**
 * Fetches and validates `{issuer}/.well-known/openid-configuration`, memoized per-issuer for
 * {@link DISCOVERY_CACHE_TTL_MS} to avoid an extra round trip on every login/callback. Fails closed
 * (throws) rather than falling back to a guessed conventional layout — an unreachable or
 * issuer-mismatched provider must stop the flow, not silently proceed.
 */
export async function discoverIssuer(
  issuer: string,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuer);

  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
    return cached.document;
  }

  let response: Response;

  try {
    response = await fetchImpl(`${issuer}/.well-known/openid-configuration`);
  } catch {
    throw new DiscoveryError('Could not reach the DevAuth discovery endpoint.');
  }

  if (!response.ok) {
    throw new DiscoveryError('DevAuth discovery endpoint returned an error.');
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new DiscoveryError('DevAuth discovery document is not valid JSON.');
  }

  const document = parseDiscoveryDocument(body);

  if (document.issuer !== issuer) {
    throw new IssuerMismatchError();
  }

  discoveryCache.set(issuer, { document, fetchedAt: Date.now() });
  return document;
}

function parseDiscoveryDocument(body: unknown): DiscoveryDocument {
  if (!body || typeof body !== 'object') {
    throw new DiscoveryError('DevAuth discovery document is malformed.');
  }

  const record = body as Record<string, unknown>;
  const issuer = readRequiredString(record, 'issuer');
  const authorizationEndpoint = readRequiredString(
    record,
    'authorization_endpoint',
  );
  const tokenEndpoint = readRequiredString(record, 'token_endpoint');
  const userinfoEndpoint = readRequiredString(record, 'userinfo_endpoint');

  return { issuer, authorizationEndpoint, tokenEndpoint, userinfoEndpoint };
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];

  if (typeof value !== 'string' || !value) {
    throw new DiscoveryError(`DevAuth discovery document is missing "${key}".`);
  }

  return value;
}

export interface AuthorizationUrlParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  scope?: string;
}

/** Builds the DevAuth authorization URL. PKCE (`S256`) is always included — DevAuth requires it. */
export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope ?? 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface ExchangeCodeParams {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/**
 * Exchanges an authorization code for tokens server-side, authenticating with
 * `client_secret_post` (form body) rather than `client_secret_basic` — both are supported by
 * DevAuth; the form-body variant avoids hand-rolling a Basic-auth header.
 */
export async function exchangeCodeForTokens(
  params: ExchangeCodeParams,
  fetchImpl: FetchLike = fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  });

  let response: Response;

  try {
    response = await fetchImpl(params.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new TokenExchangeError('Could not reach the DevAuth token endpoint.');
  }

  const parsed = await response.json().catch(() => null);

  if (!response.ok || !parsed || typeof parsed !== 'object') {
    const providerErrorCode = readOptionalString(
      parsed as Record<string, unknown> | null,
      'error',
    );
    throw new TokenExchangeError(
      'DevAuth token exchange failed.',
      providerErrorCode,
    );
  }

  const record = parsed as Record<string, unknown>;
  const accessToken = readOptionalString(record, 'access_token');

  if (!accessToken) {
    throw new TokenExchangeError('DevAuth token response has no access token.');
  }

  const result: TokenResponse = {
    accessToken,
    tokenType: readOptionalString(record, 'token_type') ?? 'Bearer',
  };
  const expiresIn = record['expires_in'];
  if (typeof expiresIn === 'number') result.expiresIn = expiresIn;
  const idToken = readOptionalString(record, 'id_token');
  if (idToken) result.idToken = idToken;
  const refreshToken = readOptionalString(record, 'refresh_token');
  if (refreshToken) result.refreshToken = refreshToken;
  const scope = readOptionalString(record, 'scope');
  if (scope) result.scope = scope;

  return result;
}

function readOptionalString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

/** Fetches `/userinfo` with the access token — the sole identity source in this design (no ID-token decoding). */
export async function fetchUserinfo(
  userinfoEndpoint: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<DevAuthUserinfo> {
  let response: Response;

  try {
    response = await fetchImpl(userinfoEndpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new UserinfoError('Could not reach the DevAuth userinfo endpoint.');
  }

  if (!response.ok) {
    throw new UserinfoError('DevAuth userinfo request failed.');
  }

  const body = await response.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    throw new UserinfoError('DevAuth userinfo response is not valid JSON.');
  }

  return body as DevAuthUserinfo;
}
