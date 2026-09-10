import { buildSessionCookie, ForgeAuthError } from '@forge-cms/auth';
import {
  AccessDeniedError,
  assertCsrfSafe,
  CsrfError,
  handleLogout,
  handleMe,
  toApiErrorBody,
} from '@forge-cms/runtime';
import {
  getHeader,
  getRequestHeaders,
  getRequestURL,
  sendWebResponse,
  setResponseStatus,
  toWebRequest,
  type H3Event,
} from 'h3';

import { SSO_TOKEN_PREFIX } from '../auth/session-token';
import {
  getCmsRuntime,
  getPasswordAuthAdapter,
  type GlossaCmsRuntime,
} from '../cms/runtime';
import { revokeSsoSessionByToken } from '../services/sso-session.service';
import { getCloudflareEnv } from './env';

export type GlossaRole = 'admin' | 'editor' | 'viewer';

export type AuthenticatedUser = {
  id: string;
  email?: string;
  name?: string;
  role?: string;
};

const WRITE_ROLES: GlossaRole[] = ['admin', 'editor'];

export async function getAuthRuntimeForEvent(
  event: H3Event,
): Promise<GlossaCmsRuntime> {
  const runtime = await getCmsRuntime(getCloudflareEnv(event));
  return runtime;
}

/**
 * The human-route auth boundary every `/api/projects/*` route calls through. Explicitly
 * rejects a machine principal (`role: 'machine'`) the same way an invalid/absent credential is
 * rejected: a project access token authenticates through this exact `CompositeAuthAdapter`
 * (nothing here recognizes its shape as "different"), but human routes take their project from
 * the URL, not from token metadata — letting a machine token pass here would let *any* project's
 * token read (or, via `requireWriteUser`, write) *any other* project's data over the human
 * surface, defeating the project isolation the machine API enforces via `metadata.projectId`.
 * Machine credentials work only through `/api/machine/v1/*` (`requireProjectMachineContext`).
 */
export async function requireUser(event: H3Event): Promise<AuthenticatedUser> {
  const runtime = await getAuthRuntimeForEvent(event);
  const user = await runtime.adapters.auth.requireAuth(
    toHeaderOnlyRequest(event),
  );

  if (user.role === 'machine') {
    throw new ForgeAuthError('Unauthorized', 'unauthorized');
  }

  return user;
}

export async function requireWriteUser(
  event: H3Event,
): Promise<AuthenticatedUser> {
  assertSameOriginMutation(event);
  const user = await requireUser(event);

  if (!WRITE_ROLES.includes(user.role as GlossaRole)) {
    throw new AccessDeniedError('Forbidden');
  }

  return user;
}

/**
 * Only `admin` may manage project access tokens (create/list/revoke/delete) — a stricter gate
 * than `requireWriteUser`'s admin-or-editor. A machine principal (`role: 'machine'`) is never an
 * admin, so this also blocks a token from being used to mint or manage other tokens. For mutating
 * routes (create/revoke/delete); GET routes use `requireAdminReadUser`, which skips the
 * same-origin CSRF check that only applies to state-changing requests.
 */
export async function requireAdminUser(
  event: H3Event,
): Promise<AuthenticatedUser> {
  assertSameOriginMutation(event);
  return requireAdminReadUser(event);
}

/** Admin-only read access (token listing) — see `requireAdminUser` for the mutation-side gate. */
export async function requireAdminReadUser(
  event: H3Event,
): Promise<AuthenticatedUser> {
  const user = await requireUser(event);

  if (user.role !== 'admin') {
    throw new AccessDeniedError('Forbidden');
  }

  return user;
}

export async function sendLogin(event: H3Event): Promise<void> {
  const runtime = await getAuthRuntimeForEvent(event);
  const auth = getPasswordAuthAdapter(runtime);

  const body = await readJsonBody(toWebRequest(event));
  const email = readBodyString(body, 'email');
  const password = readBodyString(body, 'password');

  if (!email || !password) {
    await sendForgeResponse(
      event,
      jsonError('INVALID_INPUT', 'Email and password are required.', 400),
    );
    return;
  }

  const result = await auth.login(email, password);

  if (!result.ok) {
    await sendForgeResponse(
      event,
      jsonError('UNAUTHORIZED', 'Invalid email or password.', 401),
    );
    return;
  }

  const response = Response.json({ data: { user: result.user } });
  response.headers.append(
    'set-cookie',
    buildSessionCookie(result.token, { secure: isSecureCookie(event) }),
  );
  await sendForgeResponse(event, response);
}

export async function sendLogout(event: H3Event): Promise<void> {
  assertSameOriginMutation(event);
  const runtime = await getAuthRuntimeForEvent(event);
  const request = toWebRequest(event);
  const token = runtime.adapters.auth.extractToken(request);

  if (token && token.startsWith(SSO_TOKEN_PREFIX)) {
    await revokeSsoSessionByToken(runtime, token);
  }

  await sendForgeResponse(
    event,
    await handleLogout(
      { request, env: getCloudflareEnv(event) },
      { runtime, cookie: { secure: isSecureCookie(event) } },
    ),
  );
}

export async function sendMe(event: H3Event): Promise<void> {
  const runtime = await getAuthRuntimeForEvent(event);
  await sendForgeResponse(
    event,
    await handleMe(
      { request: toWebRequest(event), env: getCloudflareEnv(event) },
      { runtime, cookie: { secure: isSecureCookie(event) } },
    ),
  );
}

export async function bootstrapFirstAdmin(event: H3Event): Promise<Response> {
  assertSameOriginMutation(event);
  const env = getCloudflareEnv(event);
  const expectedKey = env.BOOTSTRAP_ADMIN_KEY;
  const providedKey = getHeader(event, 'x-glossa-bootstrap-key');

  if (!expectedKey) {
    return jsonError(
      'BOOTSTRAP_DISABLED',
      'First-admin bootstrap is not configured.',
      404,
    );
  }

  if (!providedKey || providedKey !== expectedKey) {
    return jsonError('FORBIDDEN', 'Forbidden', 403);
  }

  const runtime = await getCmsRuntime(env);
  const auth = getPasswordAuthAdapter(runtime);
  const users = await auth.listUsers();

  if (users.length > 0) {
    return jsonError(
      'BOOTSTRAP_ALREADY_COMPLETE',
      'First-admin bootstrap has already completed.',
      409,
    );
  }

  const body = await toWebRequest(event)
    .json()
    .catch(() => null);
  const email = readBodyString(body, 'email');
  const password = readBodyString(body, 'password');
  const name = readBodyString(body, 'name');

  if (!email || !password) {
    return jsonError('INVALID_INPUT', 'Email and password are required.', 400);
  }

  const result = await auth.createUser({
    email,
    password,
    ...(name ? { name } : {}),
    role: 'admin',
  });

  if (!result.ok) {
    const status = result.reason === 'email-in-use' ? 409 : 400;
    return jsonError(
      'INVALID_INPUT',
      'Admin user could not be created.',
      status,
    );
  }

  return Response.json({ user: result.user }, { status: 201 });
}

export function sendAuthBoundaryError(event: H3Event, error: unknown) {
  if (error instanceof CsrfError || error instanceof AccessDeniedError) {
    setResponseStatus(event, error.status);
    return toApiErrorBody(error);
  }

  if (error instanceof ForgeAuthError) {
    const status = error.code === 'forbidden' ? 403 : 401;
    setResponseStatus(event, status);

    return {
      error: {
        code: status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED',
        message: status === 403 ? 'Forbidden' : 'Unauthorized',
      },
    };
  }

  throw error;
}

function assertSameOriginMutation(event: H3Event): void {
  assertCsrfSafe(toHeaderOnlyRequest(event));
}

/**
 * Builds a headers-only `Request` for `AuthAdapter` calls — never touches the body stream, so it
 * is always safe to call before (or instead of) `readBody`/`toWebRequest` on the same event.
 */
export function toHeaderOnlyRequest(event: H3Event): Request {
  const headers = new Headers();

  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  return new Request(getRequestURL(event), {
    method: event.method,
    headers,
  });
}

async function sendForgeResponse(
  event: H3Event,
  response: Response,
): Promise<void> {
  await sendWebResponse(event, response);
}

export function isSecureCookie(event: H3Event): boolean {
  return getRequestURL(event).protocol === 'https:';
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readBodyString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
