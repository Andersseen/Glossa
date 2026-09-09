// Deterministic, in-memory test double for DevAuth's OAuth 2.1 / OIDC surface. Implements just
// enough of the real, verified DevAuth contract (discovery, authorization-code + PKCE S256,
// client_secret_post token exchange, userinfo) for Playwright to exercise Glossa's SSO flow without
// any dependency on a real deployed provider. Plain node:http + node:crypto — no dependencies.
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.MOCK_DEV_AUTH_PORT ?? 4310);
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = process.env.MOCK_DEV_AUTH_CLIENT_ID ?? 'glossa-dev';
const CLIENT_SECRET = process.env.MOCK_DEV_AUTH_CLIENT_SECRET ?? 'test-secret';
const SESSION_COOKIE = 'mock_dev_auth_session';
const CODE_TTL_MS = 60_000;

/** authorization code -> { clientId, redirectUri, codeChallenge, subject, email, emailVerified } */
const codes = new Map();
/** access token -> { subject, email, emailVerified, name } */
const accessTokens = new Map();
/** provider session id -> { subject, email, emailVerified, name } */
const providerSessions = new Map();

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomToken() {
  return base64UrlEncode(randomBytes(24));
}

function parseCookies(req) {
  const header = req.headers['cookie'];
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const [name, ...rest] = pair.trim().split('=');
      return [name, rest.join('=')];
    }),
  );
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function sendRedirect(res, location, setCookie) {
  const headers = { location };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function identityForEmail(email) {
  return {
    subject: `mock-${email}`,
    email,
    emailVerified: true,
    name: email.split('@')[0],
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function handleDiscovery(_req, res) {
  sendJson(res, 200, {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize`,
    token_endpoint: `${ISSUER}/api/auth/oauth2/token`,
    userinfo_endpoint: `${ISSUER}/api/auth/oauth2/userinfo`,
    jwks_uri: `${ISSUER}/api/auth/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
  });
}

function issueCodeAndRedirect(res, params, identity, setCookie) {
  const code = randomToken();
  codes.set(code, {
    clientId: params.get('client_id'),
    redirectUri: params.get('redirect_uri'),
    codeChallenge: params.get('code_challenge'),
    ...identity,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const redirectUrl = new URL(params.get('redirect_uri'));
  redirectUrl.searchParams.set('code', code);
  if (params.get('state'))
    redirectUrl.searchParams.set('state', params.get('state'));

  sendRedirect(res, redirectUrl.toString(), setCookie);
}

function handleAuthorizeGet(req, res, url) {
  const params = url.searchParams;

  if (params.get('client_id') !== CLIENT_ID) {
    sendJson(res, 400, { error: 'invalid_client' });
    return;
  }
  if (
    params.get('code_challenge_method') !== 'S256' ||
    !params.get('code_challenge')
  ) {
    sendJson(res, 400, {
      error: 'invalid_request',
      error_description: 'PKCE S256 is required',
    });
    return;
  }

  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  const existingSession = sessionId
    ? providerSessions.get(sessionId)
    : undefined;

  if (existingSession) {
    // An "existing DevAuth provider session" — no credential form, immediate redirect back.
    issueCodeAndRedirect(res, params, existingSession);
    return;
  }

  sendHtml(
    res,
    `<!doctype html>
<html><body>
<h1>Mock DevAuth sign-in</h1>
<form method="POST" action="/api/auth/oauth2/authorize?${url.searchParams.toString()}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" value="admin@example.com" />
  <button type="submit">Continue</button>
</form>
</body></html>`,
  );
}

async function handleAuthorizePost(req, res, url) {
  const params = url.searchParams;
  const body = await readBody(req);
  const form = new URLSearchParams(body);
  const email = (form.get('email') ?? '').trim().toLowerCase();

  if (!email) {
    sendJson(res, 400, {
      error: 'invalid_request',
      error_description: 'email is required',
    });
    return;
  }

  const identity = identityForEmail(email);
  const sessionId = randomToken();
  providerSessions.set(sessionId, identity);

  const setCookie = `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
  issueCodeAndRedirect(res, params, identity, setCookie);
}

async function handleToken(req, res) {
  const body = await readBody(req);
  const form = new URLSearchParams(body);

  if (form.get('grant_type') !== 'authorization_code') {
    sendJson(res, 400, { error: 'unsupported_grant_type' });
    return;
  }

  const code = form.get('code') ?? '';
  const entry = codes.get(code);
  codes.delete(code);

  if (!entry || entry.expiresAt < Date.now()) {
    sendJson(res, 400, { error: 'invalid_grant' });
    return;
  }
  if (
    form.get('client_id') !== entry.clientId ||
    form.get('client_id') !== CLIENT_ID ||
    form.get('client_secret') !== CLIENT_SECRET ||
    form.get('redirect_uri') !== entry.redirectUri
  ) {
    sendJson(res, 400, { error: 'invalid_client' });
    return;
  }

  const verifier = form.get('code_verifier') ?? '';
  const expectedChallenge = base64UrlEncode(
    createHash('sha256').update(verifier).digest(),
  );
  if (expectedChallenge !== entry.codeChallenge) {
    sendJson(res, 400, {
      error: 'invalid_grant',
      error_description: 'PKCE verification failed',
    });
    return;
  }

  const accessToken = randomToken();
  accessTokens.set(accessToken, {
    subject: entry.subject,
    email: entry.email,
    emailVerified: entry.emailVerified,
    name: entry.name,
  });

  sendJson(res, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid profile email',
  });
}

function handleUserinfo(req, res) {
  const authorization = req.headers['authorization'] ?? '';
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const identity = accessTokens.get(accessToken);

  if (!identity) {
    sendJson(res, 401, { error: 'invalid_token' });
    return;
  }

  sendJson(res, 200, {
    sub: identity.subject,
    email: identity.email,
    email_verified: identity.emailVerified,
    name: identity.name,
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', ISSUER);

  void (async () => {
    try {
      if (
        req.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/index.html')
      ) {
        // Playwright's webServer readiness probe requires a non-error status here.
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('mock-dev-auth ok');
      } else if (
        req.method === 'GET' &&
        url.pathname === '/.well-known/openid-configuration'
      ) {
        handleDiscovery(req, res);
      } else if (
        req.method === 'GET' &&
        url.pathname === '/api/auth/oauth2/authorize'
      ) {
        handleAuthorizeGet(req, res, url);
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/auth/oauth2/authorize'
      ) {
        await handleAuthorizePost(req, res, url);
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/auth/oauth2/token'
      ) {
        await handleToken(req, res);
      } else if (
        req.method === 'GET' &&
        url.pathname === '/api/auth/oauth2/userinfo'
      ) {
        handleUserinfo(req, res);
      } else {
        sendJson(res, 404, { error: 'not_found' });
      }
    } catch (error) {
      sendJson(res, 500, { error: 'internal_error', message: String(error) });
    }
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`mock-dev-auth listening on ${ISSUER}`);
});
