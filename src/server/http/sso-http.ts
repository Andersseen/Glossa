import { buildSessionCookie } from '@forge-cms/auth';
import { getQuery, toWebRequest, type H3Event } from 'h3';

import { normalizeIdentity } from '../auth/identity';
import {
  buildTransactionClearCookie,
  buildTransactionCookie,
  isSafeReturnTo,
  readTransactionCookie,
} from '../auth/oauth-transaction-cookie';
import {
  buildAuthorizationUrl,
  discoverIssuer,
  exchangeCodeForTokens,
  fetchUserinfo,
} from '../auth/oidc-client';
import {
  deriveCodeChallengeS256,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from '../auth/pkce';
import { resolveOrLinkUser } from '../services/external-identity.service';
import { createSsoSession } from '../services/sso-session.service';
import { getAuthRuntimeForEvent, isSecureCookie } from './auth-http';
import { getCloudflareEnv } from './env';

const DEV_AUTH_PROVIDER = 'dev-auth';

export type SsoErrorCode =
  | 'access_denied'
  | 'invalid_state'
  | 'expired_transaction'
  | 'token_exchange_failed'
  | 'userinfo_failed'
  | 'account_not_linked'
  | 'provider_unavailable'
  | 'sso_failed';

function redirectToSignin(
  code: SsoErrorCode,
  extraSetCookie?: string,
): Response {
  const response = new Response(null, {
    status: 302,
    headers: { location: `/signin?error=${code}` },
  });
  if (extraSetCookie) {
    response.headers.append('set-cookie', extraSetCookie);
  }
  return response;
}

function readStringQueryParam(event: H3Event, key: string): string | undefined {
  const value = getQuery(event)[key];
  return typeof value === 'string' && value ? value : undefined;
}

/** `GET /api/auth/sso/login` — starts the OIDC Authorization Code + PKCE flow against DevAuth. */
export async function sendSsoLogin(event: H3Event): Promise<Response> {
  const env = getCloudflareEnv(event);

  if (
    !env.DEV_AUTH_ISSUER ||
    !env.DEV_AUTH_CLIENT_ID ||
    !env.DEV_AUTH_REDIRECT_URI
  ) {
    return redirectToSignin('provider_unavailable');
  }

  const requestedReturnTo = readStringQueryParam(event, 'returnTo');
  const returnTo = isSafeReturnTo(requestedReturnTo)
    ? requestedReturnTo
    : '/projects';

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallengeS256(codeVerifier);

  const discovery = await discoverIssuer(env.DEV_AUTH_ISSUER).catch(() => null);
  if (!discovery) {
    return redirectToSignin('provider_unavailable');
  }

  const authorizationUrl = buildAuthorizationUrl({
    authorizationEndpoint: discovery.authorizationEndpoint,
    clientId: env.DEV_AUTH_CLIENT_ID,
    redirectUri: env.DEV_AUTH_REDIRECT_URI,
    state,
    nonce,
    codeChallenge,
  });

  const response = new Response(null, {
    status: 302,
    headers: { location: authorizationUrl },
  });
  response.headers.append(
    'set-cookie',
    buildTransactionCookie(
      { state, nonce, codeVerifier, returnTo },
      { secure: isSecureCookie(event) },
    ),
  );
  return response;
}

/** `GET /api/auth/sso/callback` — validates the transaction, exchanges the code, links, and signs in. */
export async function sendSsoCallback(event: H3Event): Promise<Response> {
  const secure = isSecureCookie(event);
  const clearTxCookie = buildTransactionClearCookie({ secure });
  const transaction = readTransactionCookie(toWebRequest(event));

  const providerError = readStringQueryParam(event, 'error');
  if (providerError) {
    return redirectToSignin('access_denied', clearTxCookie);
  }

  if (!transaction) {
    return redirectToSignin('expired_transaction', clearTxCookie);
  }

  const returnedState = readStringQueryParam(event, 'state');
  const code = readStringQueryParam(event, 'code');
  if (!returnedState || returnedState !== transaction.state || !code) {
    return redirectToSignin('invalid_state', clearTxCookie);
  }

  const env = getCloudflareEnv(event);
  if (
    !env.DEV_AUTH_ISSUER ||
    !env.DEV_AUTH_CLIENT_ID ||
    !env.DEV_AUTH_CLIENT_SECRET ||
    !env.DEV_AUTH_REDIRECT_URI
  ) {
    return redirectToSignin('provider_unavailable', clearTxCookie);
  }

  const discovery = await discoverIssuer(env.DEV_AUTH_ISSUER).catch(() => null);
  if (!discovery) {
    return redirectToSignin('provider_unavailable', clearTxCookie);
  }

  const tokens = await exchangeCodeForTokens({
    tokenEndpoint: discovery.tokenEndpoint,
    clientId: env.DEV_AUTH_CLIENT_ID,
    clientSecret: env.DEV_AUTH_CLIENT_SECRET,
    code,
    redirectUri: env.DEV_AUTH_REDIRECT_URI,
    codeVerifier: transaction.codeVerifier,
  }).catch(() => null);
  if (!tokens) {
    return redirectToSignin('token_exchange_failed', clearTxCookie);
  }

  const userinfo = await fetchUserinfo(
    discovery.userinfoEndpoint,
    tokens.accessToken,
  ).catch(() => null);
  if (!userinfo) {
    return redirectToSignin('userinfo_failed', clearTxCookie);
  }

  let identity;
  try {
    identity = normalizeIdentity(userinfo);
  } catch {
    return redirectToSignin('userinfo_failed', clearTxCookie);
  }

  try {
    const cms = await getAuthRuntimeForEvent(event);
    const user = await resolveOrLinkUser(cms, DEV_AUTH_PROVIDER, identity);

    if (!user) {
      return redirectToSignin('account_not_linked', clearTxCookie);
    }

    const { token } = await createSsoSession(cms, user.id, DEV_AUTH_PROVIDER);

    const response = new Response(null, {
      status: 302,
      headers: { location: transaction.returnTo },
    });
    response.headers.append('set-cookie', clearTxCookie);
    response.headers.append(
      'set-cookie',
      buildSessionCookie(token, { secure }),
    );
    return response;
  } catch {
    return redirectToSignin('sso_failed', clearTxCookie);
  }
}
